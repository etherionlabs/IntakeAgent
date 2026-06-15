import { z } from 'zod';
import type { TurnContext, AgentDeps } from './types';
import { bulkUpdate, addFreeNote, isIntakeComplete, type IntakeState } from '../services/intake';
import { updateJobIntake, markReadyForReview, JOB_STATUS, closeJob } from '../services/job';
import { flagNonIntake } from '../services/contact';
import type { Config, Profile } from '../config/schema';
import type { Notifier } from '../services/notification';

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

export function buildSelectOrOpenJobTool(ctx: TurnContext): AgentTool {
  return {
    name: 'select_or_open_job',
    description:
      'Solo disponible si hay múltiples jobs abiertos. Decide a cuál pertenece el mensaje o abre uno nuevo. La asignación efectiva la hace el pipeline; aquí sólo registras la decisión.',
    inputSchema: SelectOrOpenJobArgsZ,
    execute: async (rawArgs) => {
      const parse = SelectOrOpenJobArgsZ.safeParse(rawArgs);
      if (!parse.success) return { ok: false, error: `args inválidos: ${parse.error.message}` };
      const args = parse.data;
      if (args.action === 'use_existing') {
        const exists = ctx.otherOpenJobs.some((j) => j.id === args.existing_job_id);
        if (!exists) {
          return {
            ok: false,
            error: `existing_job_id ${args.existing_job_id} no está en la lista de jobs abiertos`,
          };
        }
        return { ok: true, selected_job_id: args.existing_job_id };
      }
      return { ok: true, action: 'open_new' };
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
  ];
  if (ctx.otherOpenJobs.length >= 2) {
    tools.push(buildSelectOrOpenJobTool(ctx));
  }
  return tools;
}
