import type { PrismaClient, Job, Contact, Message } from '@prisma/client';
import type { Config } from '../config/schema';
import { JOB_STATUS, parseJobIntake } from './job';
import type { IntakeSchema } from '../config/intake-schema';
import {
  buildFollowUpDirective,
  passesFollowUpGate,
  type FollowUpPolicy,
} from '../agent/followUpGate';
import type { DomainModule } from '../domain/modules';
import { resolveModules } from '../domain/modules';
import { INTAKE_MODULES, MODULE_REGISTRY } from '../domain/registry';

/**
 * Seguimiento proactivo: la parte del agente que NO nace de un mensaje del
 * cliente. Todo el pipeline es reactivo (adapter → coordinator → agente), así que
 * sin esto una oferta que el cliente no contestó se muere en silencio.
 *
 * Este módulo COMPONE tres piezas:
 *   - la compuerta genérica (`agent/followUpGate`), que decide si se PUEDE
 *     escribir sin molestar — reglas que no dependen del dominio;
 *   - los módulos compuestos, que dicen si HAY algo que perseguir;
 *   - el ensamblado de la directiva, otra vez genérico.
 *
 * El envío vive en `pipeline/followUp.ts`. La selección se mantiene aparte y sin
 * efectos para poder probar la política —que es donde está el riesgo de molestar
 * al cliente— sin levantar el pipeline entero.
 */

export type { FollowUpPolicy } from '../agent/followUpGate';
export { buildFollowUpDirective } from '../agent/followUpGate';

export function policyFromConfig(config: Config): FollowUpPolicy {
  return {
    afterHours: config.followUp.afterHours,
    maxFollowUps: config.followUp.maxFollowUps,
    minHoursBetween: config.followUp.minHoursBetween,
  };
}

export interface FollowUpCandidate {
  job: Job;
  contact: Contact;
  /** Motivo con el que un módulo reclamó el turno (ej. `pending_offer`). */
  reason: string;
  /** Qué perseguir, aportado por el módulo que reclamó. */
  body: string[];
  /** Contexto que aportan TODOS los módulos compuestos. */
  context: string[];
  /** Horas de silencio desde nuestro último mensaje. */
  silentHours: number;
}

/** Estados del job en los que un seguimiento tiene sentido. Uno READY_FOR_REVIEW
 *  ya está en manos del dueño. */
const FOLLOW_UP_STATUSES = [JOB_STATUS.OPEN] as const;

function modulesFrom(names?: readonly string[]): DomainModule[] {
  return resolveModules(names ?? INTAKE_MODULES, MODULE_REGISTRY);
}

/**
 * ¿Este job merece un seguimiento? Devuelve el motivo o null.
 *
 * Primero la compuerta (¿se puede molestar?), después los módulos (¿hay algo que
 * perseguir?). Ese orden importa: ninguna razón de negocio justifica escribirle a
 * quien pausó el bot o ya recibió el tope de seguimientos.
 *
 * Entre módulos que reclaman gana el de menor `followUpPriority`. Esa prioridad
 * es hoy un defecto del módulo; el día que una vertical necesite otro orden
 * tendrá que subir a la composición.
 */
export function evaluateJob(args: {
  job: Job;
  contact: Contact;
  lastMessage: Message | null;
  schema: IntakeSchema;
  policy: FollowUpPolicy;
  now: Date;
  /** Módulos compuestos. Por defecto, la composición de Intake. */
  modules?: readonly string[];
}): Omit<FollowUpCandidate, 'job' | 'contact'> | null {
  const { job, contact, lastMessage, schema, policy, now } = args;

  const gate = passesFollowUpGate({
    job,
    contact,
    lastMessage,
    policy,
    now,
    openStatuses: FOLLOW_UP_STATUSES,
  });
  if (!gate) return null;

  const modules = modulesFrom(args.modules);
  const intake = parseJobIntake(job);

  const claims = modules
    .map((m) => ({ module: m, claim: m.resolveFollowUp?.(intake, schema) ?? null }))
    .filter((c): c is { module: DomainModule; claim: NonNullable<typeof c.claim> } => !!c.claim)
    .sort((a, b) => (a.module.followUpPriority ?? 100) - (b.module.followUpPriority ?? 100));

  const winner = claims[0];
  if (!winner) return null;

  // El contexto lo aportan TODOS los módulos, reclamen o no: `ventas` enriquece
  // el seguimiento de `intake` sin que `intake` sepa que existe.
  const context = modules.flatMap((m) => m.followUpContext?.(intake) ?? []);

  return {
    reason: winner.claim.reason,
    body: winner.claim.body,
    context,
    silentHours: gate.silentHours,
  };
}

/**
 * Busca los jobs del tenant que tocan seguimiento. Acota en SQL lo barato
 * (tenant, estado, archivado, tope) y evalúa el resto en memoria, que necesita
 * el intake parseado y el último mensaje.
 */
export async function findFollowUpCandidates(
  prisma: PrismaClient,
  tenantId: string,
  schema: IntakeSchema,
  policy: FollowUpPolicy,
  now: Date,
  limit = 20,
): Promise<FollowUpCandidate[]> {
  if (policy.maxFollowUps <= 0) return [];

  const jobs = await prisma.job.findMany({
    where: {
      tenantId,
      status: JOB_STATUS.OPEN,
      archivedAt: null,
      followUpCount: { lt: policy.maxFollowUps },
      contact: { botActive: true, flaggedNonIntake: false, archivedAt: null },
    },
    include: { contact: true },
    orderBy: { openedAt: 'asc' },
    take: limit * 5,
  });

  const out: FollowUpCandidate[] = [];
  for (const job of jobs) {
    const lastMessage = await prisma.message.findFirst({
      where: { jobId: job.id, tenantId },
      orderBy: { createdAt: 'desc' },
    });
    const verdict = evaluateJob({
      job,
      contact: job.contact,
      lastMessage,
      schema,
      policy,
      now,
    });
    if (verdict) out.push({ job, contact: job.contact, ...verdict });
    if (out.length >= limit) break;
  }
  return out;
}
