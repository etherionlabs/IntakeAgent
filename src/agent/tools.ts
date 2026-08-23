import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { TurnContext, AgentDeps, OutboundAttachment } from './types';
import type { AgentTool, ToolProvider } from './toolRegistry';
import { buildToolsFrom } from './toolRegistry';
import {
  bulkUpdate,
  addFreeNote,
  isIntakeComplete,
  acceptedOpportunities,
  createEmptyIntakeFromSchema,
  type IntakeState,
} from '../services/intake';
import { updateJobIntake, markReadyForReview, JOB_STATUS, closeJob, openJob, parseJobIntake } from '../services/job';
import { flagNonIntake } from '../services/contact';
import type { Config, Profile } from '../config/schema';
import type { Notifier } from '../services/notification';
import { buildDescribeBaseContext, reanalyzeDescription } from '../services/imageDescription';
import { imageMimeFromPath } from '../media/describer';
import { buildElementTools } from './toolRegistry';
import { createElementHost } from '../services/elementHost';
import { resolveModules, toolProvidersFor } from '../domain/modules';
import { INTAKE_MODULES, MODULE_REGISTRY } from '../domain/registry';

export type { AgentTool, ToolProvider } from './toolRegistry';

const UpdateIntakeArgsZ = z.object({
  fields: z
    .array(
      z
        .object({
          path: z.string(),
          value: z.union([z.string(), z.number(), z.boolean()]).optional(),
          declined: z.boolean().optional(),
          declined_reason: z.string().optional(),
        })
        .refine(
          (d) => d.value !== undefined || d.declined === true,
          { message: 'cada campo debe traer value o declined=true' },
        ),
    )
    .min(1),
  notes_to_add: z.array(z.string().min(3).max(500)).optional(),
});

export type UpdateIntakeArgs = z.infer<typeof UpdateIntakeArgsZ>;

export function buildUpdateIntakeTool(
  ctx: TurnContext,
  deps: Pick<AgentDeps, 'prisma' | 'tenantId' | 'profile'>,
): AgentTool {
  return {
    name: 'update_intake',
    description:
      'Guarda valores y/o marca campos como declinados por el cliente. Agrupa TODOS los cambios del turno en una sola llamada. Usa notes_to_add para detalles que no caben en campos.',
    inputSchema: UpdateIntakeArgsZ,
    execute: async (rawArgs) => {
      const parse = UpdateIntakeArgsZ.safeParse(rawArgs);
      if (!parse.success) {
        return { ok: false, error: `args inválidos: ${parse.error.message}` };
      }
      const args = parse.data;

      // Defensa en profundidad: el modelo a veces copia el path CON los corchetes
      // que usamos como delimitador visual en el estado del intake ('[client.name]').
      // Normalizamos quitando corchetes/espacios para que la escritura no se pierda.
      for (const field of args.fields) {
        field.path = field.path.trim().replace(/^\[+|\]+$/g, '').trim();
      }

      const sourceMessageId = ctx.batchMessages[ctx.batchMessages.length - 1]?.id ?? null;
      const meta = { now: ctx.now, source_message_id: sourceMessageId };

      const result = bulkUpdate(deps.profile.intakeSchema, ctx.intake, args.fields, meta);
      if (!result.ok) return { ok: false, error: result.error };

      let nextIntake: IntakeState = result.intake;
      if (args.notes_to_add) {
        for (const note of args.notes_to_add) {
          nextIntake = addFreeNote(nextIntake, note, ctx.now, sourceMessageId);
        }
      }

      await updateJobIntake(deps.prisma, deps.tenantId, ctx.job.id, nextIntake);
      ctx.intake = nextIntake;
      // Se recuerda la escritura por si el agente se cambia de trabajo más
      // adelante en este mismo turno: entonces hay que reaplicarla allí.
      ctx.turnIntakeOps = [...(ctx.turnIntakeOps ?? []), args];
      return { ok: true, updated_fields: args.fields.length };
    },
  };
}

const MarkReadyArgsZ = z.object({
  summary: z.string().min(20, 'summary debe tener al menos 20 caracteres'),
});

export interface MarkReadyDeps {
  prisma: AgentDeps['prisma'];
  tenantId: string;
  profile: Profile;
  notifier: Notifier;
  config: Config;
}

export function buildMarkReadyTool(
  ctx: TurnContext,
  deps: MarkReadyDeps,
): AgentTool {
  return {
    name: 'mark_ready_for_review',
    description:
      'Llama esto SOLO cuando todos los campos REQUERIDOS estén satisfechos (con valor o declined) y el cliente confirme el resumen. Cambia el job a READY_FOR_REVIEW y notifica al dueño.',
    inputSchema: MarkReadyArgsZ,
    execute: async (rawArgs) => {
      const parse = MarkReadyArgsZ.safeParse(rawArgs);
      if (!parse.success) return { ok: false, error: `args inválidos: ${parse.error.message}` };

      if (ctx.job.status !== JOB_STATUS.OPEN) {
        return {
          ok: false,
          error: `mark_ready_for_review requiere job en OPEN_INTAKE, actual=${ctx.job.status}`,
        };
      }

      if (!isIntakeComplete(deps.profile.intakeSchema, ctx.intake)) {
        return {
          ok: false,
          error: 'aún hay campos REQUERIDOS sin satisfacer (value o declined). Sigue preguntando.',
        };
      }

      const summary = parse.data.summary;
      const updated = await markReadyForReview(deps.prisma, deps.tenantId, ctx.job.id, summary);

      if (deps.config.owner.notifyOnReady) {
        await deps.notifier.notifyOwnerReady({
          jobId: updated.id,
          contactDisplayName: ctx.contact.displayName,
          contactPhone: ctx.contact.phoneE164,
          summary,
          // Extras que el cliente aceptó: el dueño los ve en el aviso para
          // cotizar el trabajo completo, no solo lo que el cliente pidió al inicio.
          extras: acceptedOpportunities(ctx.intake).map((o) => o.service),
          panelUrl: deps.config.owner.panelUrl,
        });
      }

      ctx.job.status = updated.status;
      ctx.job.summary = updated.summary;

      return { ok: true, status: 'READY_FOR_REVIEW' };
    },
  };
}

const CloseJobArgsZ = z.object({});

export function buildCloseJobTool(
  ctx: TurnContext,
  deps: Pick<AgentDeps, 'prisma' | 'tenantId'>,
): AgentTool {
  return {
    name: 'close_job',
    description:
      'Cierra el job. SOLO cuando el cliente diga explícitamente que terminó (ej: "eso es todo", "gracias, espero respuesta"). Requiere status OPEN_INTAKE o READY_FOR_REVIEW.',
    inputSchema: CloseJobArgsZ,
    execute: async () => {
      if (ctx.job.status !== JOB_STATUS.OPEN && ctx.job.status !== JOB_STATUS.READY) {
        return {
          ok: false,
          error: `close_job requiere OPEN_INTAKE o READY_FOR_REVIEW, actual=${ctx.job.status}`,
        };
      }
      const updated = await closeJob(deps.prisma, deps.tenantId, ctx.job.id);
      ctx.job.status = updated.status;
      return { ok: true, status: 'CLOSED' };
    },
  };
}

const FlagNonIntakeArgsZ = z.object({
  reason: z.string().min(5, 'reason debe describir por qué este contacto no es un intake'),
});

export function buildFlagNonIntakeTool(
  ctx: TurnContext,
  deps: Pick<AgentDeps, 'prisma' | 'tenantId'>,
): AgentTool {
  return {
    name: 'flag_non_intake',
    description:
      'Marca al contacto como NO intake (spam, conversación irrelevante después de reconducir 1-2 veces). El bot dejará de responder.',
    inputSchema: FlagNonIntakeArgsZ,
    execute: async (rawArgs) => {
      const parse = FlagNonIntakeArgsZ.safeParse(rawArgs);
      if (!parse.success) return { ok: false, error: `args inválidos: ${parse.error.message}` };
      await flagNonIntake(deps.prisma, deps.tenantId, ctx.contact.id, parse.data.reason);
      ctx.contact.flaggedNonIntake = true;
      ctx.contact.flaggedReason = parse.data.reason;
      return { ok: true };
    },
  };
}

const RequestPhotoArgsZ = z.object({
  purpose: z.string().min(3, 'describe brevemente para qué se piden las fotos'),
});

export function buildRequestPhotoTool(ctx: TurnContext): AgentTool {
  return {
    name: 'request_photo',
    description:
      'Indica que tu respuesta al cliente va a PEDIR fotos específicas. No envía nada por sí solo; tu texto al cliente debe pedirlas. Sirve para registrar la intención.',
    inputSchema: RequestPhotoArgsZ,
    execute: async (rawArgs) => {
      const parse = RequestPhotoArgsZ.safeParse(rawArgs);
      if (!parse.success) return { ok: false, error: `args inválidos: ${parse.error.message}` };
      return { ok: true, purpose: parse.data.purpose };
    },
  };
}

const SelectOrOpenJobArgsZ = z
  .object({
    action: z.enum(['use_existing', 'open_new']),
    existing_job_id: z.string().optional(),
  })
  .refine(
    (d) => d.action === 'open_new' || (d.action === 'use_existing' && !!d.existing_job_id),
    { message: 'use_existing requiere existing_job_id' },
  );

/**
 * Cambia el turno de trabajo, con todo lo que eso arrastra.
 *
 * El cambio se aplica AQUÍ y no al final del turno: a partir de esta llamada,
 * `update_intake`, `mark_ready_for_review` y `close_job` operan sobre el trabajo
 * elegido, porque `ctx.job` ya es ese. Y lo que el agente hubiera guardado
 * ANTES de decidirse se mueve también: se deja el trabajo de origen como estaba
 * al empezar el turno y se reaplican esas escrituras en el destino. El dato que
 * dio el cliente pertenece al trabajo del que habla, no a aquel por el que entró
 * el mensaje.
 */
export function buildSelectOrOpenJobTool(
  ctx: TurnContext,
  deps: Pick<AgentDeps, 'prisma' | 'tenantId' | 'profile'>,
): AgentTool {
  return {
    name: 'select_or_open_job',
    description:
      'Solo disponible si hay varios jobs abiertos de este contacto. Decide a cuál pertenece el mensaje, o abre uno nuevo. A partir de esta llamada el turno trabaja sobre el job elegido: lo que guardes después se guarda ahí, y lo que hubieras guardado antes se mueve solo.',
    inputSchema: SelectOrOpenJobArgsZ,
    execute: async (rawArgs) => {
      const parse = SelectOrOpenJobArgsZ.safeParse(rawArgs);
      if (!parse.success) return { ok: false, error: `args inválidos: ${parse.error.message}` };
      const args = parse.data;

      let target;
      if (args.action === 'use_existing') {
        if (!ctx.otherOpenJobs.some((j) => j.id === args.existing_job_id)) {
          return {
            ok: false,
            error: `existing_job_id ${args.existing_job_id} no está en la lista de jobs abiertos`,
          };
        }
        // Se relee de la base: entre que se armó el prompt y ahora pudo cerrarse.
        target = await deps.prisma.job.findFirst({
          where: {
            id: args.existing_job_id,
            tenantId: deps.tenantId,
            contactId: ctx.contact.id,
            status: { in: [JOB_STATUS.OPEN, JOB_STATUS.READY] },
          },
        });
        if (!target) {
          return { ok: false, error: `el job ${args.existing_job_id} ya no está abierto` };
        }
      } else {
        target = await openJob(
          deps.prisma,
          deps.tenantId,
          ctx.contact.id,
          createEmptyIntakeFromSchema(deps.profile.intakeSchema),
        );
      }

      if (target.id === ctx.job.id) {
        return { ok: true, selected_job_id: target.id, moved_updates: 0 };
      }

      // Lo escrito en el trabajo de origen durante ESTE turno se deshace y se
      // reaplica en el destino. Fuera de este turno no se toca nada: lo que el
      // cliente contó antes sigue donde estaba.
      const ops = ctx.turnIntakeOps ?? [];
      if (ops.length > 0 && ctx.intakeAtTurnStart) {
        await updateJobIntake(deps.prisma, deps.tenantId, ctx.job.id, ctx.intakeAtTurnStart);
      }

      let intake = parseJobIntake(target);
      const intakeDestinoOriginal = intake;
      const sourceMessageId = ctx.batchMessages[ctx.batchMessages.length - 1]?.id ?? null;
      const meta = { now: ctx.now, source_message_id: sourceMessageId };
      let movidas = 0;
      for (const op of ops) {
        const res = bulkUpdate(deps.profile.intakeSchema, intake, op.fields, meta);
        // Un campo que no existe en el destino se descarta en vez de tumbar el
        // cambio de trabajo: el resto de la conversación vale más que ese dato.
        if (!res.ok) continue;
        intake = res.intake;
        for (const note of op.notes_to_add ?? []) {
          intake = addFreeNote(intake, note, ctx.now, sourceMessageId);
        }
        movidas += 1;
      }
      if (movidas > 0) {
        await updateJobIntake(deps.prisma, deps.tenantId, target.id, intake);
      }

      const anterior = ctx.job;
      ctx.job = target;
      ctx.intake = intake;
      // El destino pasa a ser el nuevo punto de partida: si el agente se cambia
      // otra vez, lo que se deshace es lo de este tramo.
      ctx.intakeAtTurnStart = intakeDestinoOriginal;
      // El destino sale de la lista de "otros" y entra el que se acaba de dejar,
      // para que el agente pueda corregirse sin quedarse sin salida.
      ctx.otherOpenJobs = [
        ...ctx.otherOpenJobs.filter((j) => j.id !== target.id),
        { id: anterior.id, summary: anterior.summary, openedAt: anterior.openedAt },
      ];

      return { ok: true, selected_job_id: target.id, moved_updates: movidas };
    },
  };
}

const ReanalyzeImageArgsZ = z.object({
  photo_ref: z.string().min(1, 'photo_ref es el ref de la foto (ej. el de "(ref: ...)")'),
  focus: z.string().min(3, 'describe en qué enfocar el nuevo análisis'),
});

export interface ReanalyzeImageDeps {
  prisma: AgentDeps['prisma'];
  tenantId: string;
  profile: Profile;
  mediaStore: NonNullable<AgentDeps['mediaStore']>;
  describer: NonNullable<AgentDeps['describer']>;
}

export function buildReanalyzeImageTool(ctx: TurnContext, deps: ReanalyzeImageDeps): AgentTool {
  return {
    name: 'reanalyze_image',
    description:
      'Vuelve a analizar una foto que el cliente ya envió, enfocándote en algo específico (ej. "el color exacto", "las medidas", "el tipo de daño en el respaldo"). Útil cuando surge información nueva o necesitas un detalle que la descripción inicial no cubrió. Usa el ref que aparece en cada foto como photo_ref.',
    inputSchema: ReanalyzeImageArgsZ,
    execute: async (rawArgs) => {
      const parse = ReanalyzeImageArgsZ.safeParse(rawArgs);
      if (!parse.success) return { ok: false, error: `args inválidos: ${parse.error.message}` };
      const { photo_ref, focus } = parse.data;

      const photos = ctx.availablePhotos ?? [];
      const photo = photos.find((p) => p.messageId === photo_ref);
      if (!photo) {
        const refs = photos.map((p) => p.messageId).join(', ') || '(ninguna)';
        return { ok: false, error: `no hay foto con ref "${photo_ref}". Refs disponibles: ${refs}` };
      }

      const message = await deps.prisma.message.findFirst({
        where: { id: photo_ref, tenantId: deps.tenantId, kind: 'image' },
      });
      if (!message || !message.mediaPath) {
        return { ok: false, error: `la foto ${photo_ref} no tiene archivo disponible para analizar` };
      }

      const base = buildDescribeBaseContext(deps.profile, ctx.recentHistory, ctx.batchMessages);
      const description = await reanalyzeDescription(
        deps.prisma,
        deps.tenantId,
        deps.mediaStore,
        deps.describer,
        message,
        base,
        focus,
      );
      if (!description) {
        return { ok: false, error: 'no se pudo generar una nueva descripción de la imagen' };
      }

      // Refleja la nueva descripción en el contexto del turno por si el agente
      // re-analiza otra vez o la usa más adelante en el mismo turno.
      photo.description = description;
      const batchMsg = ctx.batchMessages.find((m) => m.id === photo_ref);
      if (batchMsg) batchMsg.description = description;

      return { ok: true, description };
    },
  };
}

const GeneratePreviewArgsZ = z.object({
  photo_ref: z.string().min(1, 'photo_ref es el ref de la foto (ej. el de "(ref: ...)")'),
  instruction: z
    .string()
    .min(5, 'describe el cambio visual a aplicar (ej. "agregar franjas deportivas negras al cofre")'),
  caption: z.string().max(300).optional(),
});

export interface GeneratePreviewDeps {
  prisma: AgentDeps['prisma'];
  tenantId: string;
  profile: Profile;
  mediaStore: NonNullable<AgentDeps['mediaStore']>;
  imageEditor: NonNullable<AgentDeps['imageEditor']>;
}

export function buildGeneratePreviewTool(ctx: TurnContext, deps: GeneratePreviewDeps): AgentTool {
  return {
    name: 'generate_preview',
    description:
      'Genera una PREVISUALIZACIÓN aproximada editando una foto que el cliente ya envió: aplica un cambio visual (ej. rayas/franjas deportivas, color de wrap, tono de polarizado, acabado) y la imagen resultante se le envía automáticamente al cliente. Usa el ref que aparece en cada foto como photo_ref e instruction con el cambio a aplicar. Es una ayuda visual aproximada, no el resultado final; adviértelo en tu texto.',
    inputSchema: GeneratePreviewArgsZ,
    execute: async (rawArgs) => {
      const parse = GeneratePreviewArgsZ.safeParse(rawArgs);
      if (!parse.success) return { ok: false, error: `args inválidos: ${parse.error.message}` };
      const { photo_ref, instruction, caption } = parse.data;

      const photos = ctx.availablePhotos ?? [];
      if (!photos.some((p) => p.messageId === photo_ref)) {
        const refs = photos.map((p) => p.messageId).join(', ') || '(ninguna)';
        return { ok: false, error: `no hay foto con ref "${photo_ref}". Refs disponibles: ${refs}` };
      }

      const message = await deps.prisma.message.findFirst({
        where: { id: photo_ref, tenantId: deps.tenantId, kind: 'image' },
      });
      if (!message || !message.mediaPath) {
        return { ok: false, error: `la foto ${photo_ref} no tiene archivo disponible para editar` };
      }

      let source: Buffer;
      try {
        source = await readFile(deps.mediaStore.absolutePathFor(message.mediaPath));
      } catch {
        return { ok: false, error: `no se pudo leer el archivo de la foto ${photo_ref}` };
      }

      const edited = await deps.imageEditor.edit(
        source,
        imageMimeFromPath(message.mediaPath),
        {
          businessName: deps.profile.intakeSchema.$businessName,
          businessDomain: deps.profile.intakeSchema.$businessDomain,
          editGuidance: deps.profile.imageEditGuidance ?? '',
          instruction,
        },
      );
      if (!edited) {
        return { ok: false, error: 'no se pudo generar la previsualización de la imagen' };
      }

      // Reservamos el ID del futuro mensaje outbound y lo usamos como nombre del
      // archivo, para que el media-store y el registro en DB queden consistentes.
      const messageId = randomUUID();
      const mediaPath = await deps.mediaStore.save({
        buffer: edited.buffer,
        mimetype: edited.mimetype,
        contactId: ctx.contact.id,
        jobId: ctx.job.id,
        messageId,
      });

      const attachment: OutboundAttachment = {
        messageId,
        mediaPath,
        mimetype: edited.mimetype,
        caption: caption ?? null,
      };
      ctx.pendingAttachments = ctx.pendingAttachments ?? [];
      ctx.pendingAttachments.push(attachment);

      // Contabiliza el costo de la edición hacia el gasto del turno.
      if (edited.costUsd) ctx.extraCostUsd = (ctx.extraCostUsd ?? 0) + edited.costUsd;

      return { ok: true, preview_generated: true, instruction };
    },
  };
}

/**
 * CAPACIDADES DEL RUNTIME.
 *
 * NO son módulos de dominio: van siempre, compongas lo que compongas. Cortar con
 * quien no es un caso real, pedir material, re-analizar una foto o decidir a qué
 * caso pertenece un mensaje son necesidades del canal y del loop, no del negocio.
 *
 * Las tools que SÍ son de dominio (escribir el artefacto, darlo por completo,
 * registrar una venta) las aporta cada módulo desde `src/domain/`.
 */
export const runtimeToolProviders: readonly ToolProvider[] = [
  { name: 'update_intake', build: buildUpdateIntakeTool },
  { name: 'mark_ready_for_review', build: buildMarkReadyTool },
  { name: 'close_job', build: buildCloseJobTool },
  { name: 'flag_non_intake', build: buildFlagNonIntakeTool },
  { name: 'request_photo', build: (ctx) => buildRequestPhotoTool(ctx) },
];

/**
 * Capacidades condicionadas al contexto del turno. Una tool que el modelo no
 * puede usar no se le muestra: si aparece, la llama y gasta pasos del turno.
 */
export const conditionalToolProviders: readonly ToolProvider[] = [
  {
    name: 'select_or_open_job',
    // Con UN solo otro trabajo abierto el mensaje ya puede ser ambiguo: el contacto
    // tiene dos y hay que poder decir a cuál va.
    isAvailable: (ctx) => ctx.otherOpenJobs.length >= 1,
    build: buildSelectOrOpenJobTool,
  },
  {
    name: 'reanalyze_image',
    isAvailable: (ctx, deps) =>
      (ctx.availablePhotos?.length ?? 0) > 0 && !!deps.mediaStore && !!deps.describer,
    build: (ctx, deps) =>
      buildReanalyzeImageTool(ctx, {
        prisma: deps.prisma,
        tenantId: deps.tenantId,
        profile: deps.profile,
        mediaStore: deps.mediaStore!,
        describer: deps.describer!,
      }),
  },
  {
    name: 'generate_preview',
    isAvailable: (ctx, deps) =>
      (ctx.availablePhotos?.length ?? 0) > 0 && !!deps.mediaStore && !!deps.imageEditor,
    build: (ctx, deps) =>
      buildGeneratePreviewTool(ctx, {
        prisma: deps.prisma,
        tenantId: deps.tenantId,
        profile: deps.profile,
        mediaStore: deps.mediaStore!,
        imageEditor: deps.imageEditor!,
      }),
  },
];

/**
 * Catálogo del turno: tools de los elementos compuestos, luego las capacidades
 * del runtime, luego las condicionales. El orden es el que ve el modelo; moverlo
 * cambia su comportamiento sin que ningún test lo note.
 *
 * Las dos mitades se construyen distinto a propósito: las capacidades del
 * runtime reciben `AgentDeps` (base de datos, notifier, media); los elementos
 * reciben solo `ElementHost`. Un elemento no puede alcanzar el núcleo aunque
 * quiera, porque nunca se le entrega.
 */
export function elementProvidersFor(modules: readonly string[]) {
  return toolProvidersFor(resolveModules(modules, MODULE_REGISTRY));
}

/** Nombres de todas las tools del turno, en el orden en que las ve el modelo. */
export function toolNamesFor(modules: readonly string[]): string[] {
  return [
    ...runtimeToolProviders.map((p) => p.name),
    ...elementProvidersFor(modules).map((p) => p.name),
    ...conditionalToolProviders.map((p) => p.name),
  ];
}

export function buildTools(ctx: TurnContext, deps: AgentDeps): AgentTool[] {
  const modules = deps.profile.modules ?? INTAKE_MODULES;
  const host = deps.host ?? createElementHost(deps.prisma, deps.tenantId);
  return [
    ...buildToolsFrom(runtimeToolProviders, ctx, deps),
    ...buildElementTools(elementProvidersFor(modules), ctx, host),
    ...buildToolsFrom(conditionalToolProviders, ctx, deps),
  ];
}
