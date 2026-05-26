import { z } from 'zod';
import type { TurnContext, AgentDeps } from './types';
import { bulkUpdate, addFreeNote, isIntakeComplete, type IntakeState } from '../services/intake';
import { updateJobIntake, markReadyForReview, JOB_STATUS } from '../services/job';
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
  deps: Pick<AgentDeps, 'prisma' | 'profile'>,
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

      await updateJobIntake(deps.prisma, ctx.job.id, nextIntake);
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
      const updated = await markReadyForReview(deps.prisma, ctx.job.id, summary);

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
