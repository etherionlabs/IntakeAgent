/**
 * MÓDULO `ventas`: sus tools.
 *
 * Estas dos tools son lo que convierte al agente en un ASESOR DE VENTAS y no en
 * un recepcionista: registran lo que se ofreció y lo que se descubrió. No tienen
 * nada de genérico y vivían mezcladas con las capacidades del runtime en
 * `src/agent/tools.ts`.
 *
 * Van juntas con el resto del módulo: una vertical que componga `ventas` las
 * obtiene; una que no lo componga no las ve. No se copian ni se adaptan.
 */
import { z } from 'zod';
import type { TurnContext } from '../../agent/types';
import type { AgentTool, ElementToolProvider } from '../../agent/toolRegistry';
import type { ElementHost } from '../../agent/elementHost';
import {
  acceptedOpportunities,
  getDiagnosis,
  openObjections,
  updateDiagnosis,
  upsertOpportunities,
  validateDiagnosisUpdate,
} from './state';

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
export function buildRegisterOpportunityTool(ctx: TurnContext, host: ElementHost): AgentTool {
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

      await host.saveArtifact(ctx.job.id, nextIntake);
      ctx.intake = nextIntake;
      for (const item of parse.data.items) host.countEvent('opportunities', { status: item.status });

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
export function buildRegisterDiscoveryTool(ctx: TurnContext, host: ElementHost): AgentTool {
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

      const invalido = validateDiagnosisUpdate(parse.data);
      if (invalido) return { ok: false, error: `diagnóstico inválido: ${invalido}` };

      const nextIntake = updateDiagnosis(ctx.intake, parse.data, ctx.now);
      await host.saveArtifact(ctx.job.id, nextIntake);
      ctx.intake = nextIntake;

      if (parse.data.objection) {
        host.countEvent('objections', {
          type: parse.data.objection.type,
          state: parse.data.objection.resolved ? 'resuelta' : 'abierta',
        });
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

/** Pack de tools que aporta el dominio de venta. */
export const salesToolProviders: readonly ElementToolProvider[] = [
  { name: 'register_opportunity', build: buildRegisterOpportunityTool },
  { name: 'register_discovery', build: buildRegisterDiscoveryTool },
];
