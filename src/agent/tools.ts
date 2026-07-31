import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { TurnContext, AgentDeps, OutboundAttachment } from './types';
import {
  bulkUpdate,
  addFreeNote,
  isIntakeComplete,
  upsertOpportunities,
  acceptedOpportunities,
  updateDiagnosis,
  getDiagnosis,
  createEmptyIntakeFromSchema,
  openObjections,
  type IntakeState,
} from '../services/intake';
import { updateJobIntake, markReadyForReview, JOB_STATUS, closeJob, openJob, parseJobIntake } from '../services/job';
import { flagNonIntake } from '../services/contact';
import type { Config, Profile } from '../config/schema';
import type { Notifier } from '../services/notification';
import { buildDescribeBaseContext, reanalyzeDescription } from '../services/imageDescription';
import { imageMimeFromPath } from '../media/describer';
import { incOpportunity, incObjection } from '../lib/metrics';

/** Forma común a todas las tools del agent. Compatible con @openrouter/sdk `tool()`. */
export interface AgentTool {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  execute: (args: any) => Promise<{ ok: true; [k: string]: unknown } | { ok: false; error: string }>;
}

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

const RegisterOpportunityArgsZ = z.object({
  items: z
    .array(
      z.object({
        service: z
          .string()
          .min(2, 'service es el nombre del servicio extra')
          .max(80),
        status: z.enum(['offered', 'accepted', 'declined']),
        note: z.string().max(300).optional(),
      }),
    )
    .min(1)
    .max(5),
});

export type RegisterOpportunityArgs = z.infer<typeof RegisterOpportunityArgsZ>;

/**
 * Deja rastro estructurado de la VENTA (no solo del intake): qué servicio extra
 * se ofreció y cómo respondió el cliente. Es lo que permite que el agente no
 * repita una oferta rechazada y que el dueño reciba la lista de extras a cotizar.
 */
export function buildRegisterOpportunityTool(
  ctx: TurnContext,
  deps: Pick<AgentDeps, 'prisma' | 'tenantId'>,
): AgentTool {
  return {
    name: 'register_opportunity',
    description:
      'Registra los servicios ADICIONALES (extras/complementos) que ofreciste y cómo respondió el cliente. ' +
      'status=offered cuando lo acabas de proponer y aún no contesta; accepted cuando lo quiere o se entusiasma; ' +
      'declined cuando lo rechaza. Llama a esta tool EN EL MISMO TURNO en que ofreces o en que el cliente responde, ' +
      'agrupando todos los cambios en una sola llamada. Usa el mismo nombre de servicio para actualizar su estado. ' +
      'NO la uses para el servicio principal que el cliente vino a pedir, ese va en el intake.',
    inputSchema: RegisterOpportunityArgsZ,
    execute: async (rawArgs) => {
      const parse = RegisterOpportunityArgsZ.safeParse(rawArgs);
      if (!parse.success) return { ok: false, error: `args inválidos: ${parse.error.message}` };

      const sourceMessageId = ctx.batchMessages[ctx.batchMessages.length - 1]?.id ?? null;
      const nextIntake = upsertOpportunities(
        ctx.intake,
        parse.data.items,
        ctx.now,
        sourceMessageId,
      );

      await updateJobIntake(deps.prisma, deps.tenantId, ctx.job.id, nextIntake);
      ctx.intake = nextIntake;
      for (const item of parse.data.items) incOpportunity(item.status);

      return {
        ok: true,
        registered: parse.data.items.length,
        accepted: acceptedOpportunities(nextIntake).map((o) => o.service),
      };
    },
  };
}

const RegisterDiscoveryArgsZ = z
  .object({
    pain: z.string().min(3).max(300).optional(),
    implication: z.string().min(3).max(300).optional(),
    urgency: z.enum(['alta', 'media', 'baja']).optional(),
    objection: z
      .object({
        type: z.enum(['precio', 'tiempo', 'confianza', 'competencia', 'lo_piensa', 'otro']),
        note: z.string().min(3).max(300),
        resolved: z.boolean().optional(),
      })
      .optional(),
  })
  .refine(
    (d) => d.pain || d.implication || d.urgency || d.objection,
    { message: 'manda al menos uno: pain, implication, urgency u objection' },
  );

export type RegisterDiscoveryArgs = z.infer<typeof RegisterDiscoveryArgsZ>;

/**
 * Guarda lo que el agente DESCUBRIÓ, no lo que el cliente pidió.
 *
 * El intake captura el pedido ("retapizar un sillón"); esto captura por qué le
 * importa y qué le cuesta no hacerlo. Sin ese registro el agente vuelve a empezar
 * en cada turno y termina proponiendo antes de entender, que es el error que más
 * cuesta en una venta consultiva.
 */
export function buildRegisterDiscoveryTool(
  ctx: TurnContext,
  deps: Pick<AgentDeps, 'prisma' | 'tenantId'>,
): AgentTool {
  return {
    name: 'register_discovery',
    description:
      'Guarda lo que vas descubriendo de la NECESIDAD del cliente, en cuanto lo sepas y sin esperar al final: ' +
      'pain = el problema en SUS palabras; implication = qué le cuesta si no lo resuelve (tiempo, dinero, ' +
      'riesgo, incomodidad); urgency = alta/media/baja. Manda solo lo que hayas descubierto en este turno. ' +
      'objection = una fricción que el cliente planteó (precio, tiempo, confianza, competencia, lo_piensa), ' +
      'con resolved=true SOLO cuando de verdad quedó resuelta. No lo inventes: si no lo dijo, no lo guardes.',
    inputSchema: RegisterDiscoveryArgsZ,
    execute: async (rawArgs) => {
      const parse = RegisterDiscoveryArgsZ.safeParse(rawArgs);
      if (!parse.success) return { ok: false, error: `args inválidos: ${parse.error.message}` };

      const nextIntake = updateDiagnosis(ctx.intake, parse.data, ctx.now);
      await updateJobIntake(deps.prisma, deps.tenantId, ctx.job.id, nextIntake);
      ctx.intake = nextIntake;

      if (parse.data.objection) {
        incObjection(parse.data.objection.type, parse.data.objection.resolved ?? false);
      }

      const diag = getDiagnosis(nextIntake);
      return {
        ok: true,
        // Se le devuelve qué sigue faltando: es el recordatorio más barato de que
        // todavía no toca proponer.
        missing: [
          !diag.pain ? 'pain' : null,
          !diag.implication ? 'implication' : null,
          !diag.urgency ? 'urgency' : null,
        ].filter(Boolean),
        open_objections: openObjections(nextIntake).length,
      };
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

export function buildTools(ctx: TurnContext, deps: AgentDeps): AgentTool[] {
  const tools: AgentTool[] = [
    buildUpdateIntakeTool(ctx, deps),
    buildMarkReadyTool(ctx, deps),
    buildCloseJobTool(ctx, deps),
    buildFlagNonIntakeTool(ctx, deps),
    buildRequestPhotoTool(ctx),
    buildRegisterOpportunityTool(ctx, deps),
    buildRegisterDiscoveryTool(ctx, deps),
  ];
  // Con UN solo otro trabajo abierto el mensaje ya puede ser ambiguo: el contacto
  // tiene dos y hay que poder decir a cuál va.
  if (ctx.otherOpenJobs.length >= 1) {
    tools.push(buildSelectOrOpenJobTool(ctx, deps));
  }
  if ((ctx.availablePhotos?.length ?? 0) > 0 && deps.mediaStore && deps.describer) {
    tools.push(
      buildReanalyzeImageTool(ctx, {
        prisma: deps.prisma,
        tenantId: deps.tenantId,
        profile: deps.profile,
        mediaStore: deps.mediaStore,
        describer: deps.describer,
      }),
    );
  }
  if ((ctx.availablePhotos?.length ?? 0) > 0 && deps.mediaStore && deps.imageEditor) {
    tools.push(
      buildGeneratePreviewTool(ctx, {
        prisma: deps.prisma,
        tenantId: deps.tenantId,
        profile: deps.profile,
        mediaStore: deps.mediaStore,
        imageEditor: deps.imageEditor,
      }),
    );
  }
  return tools;
}
