import type { PrismaClient, Job, Contact, Message } from '@prisma/client';
import type { Config } from '../config/schema';
import { JOB_STATUS, parseJobIntake } from './job';
import type { IntakeSchema } from '../config/intake-schema';
import { passesFollowUpGate, type FollowUpPolicy } from '../agent/followUpGate';
import { resolveFollowUpSubject, type FollowUpSubject } from '../domain/sales/followUp';

/**
 * Seguimiento proactivo: la parte del agente que NO nace de un mensaje del
 * cliente. Todo el pipeline es reactivo (adapter → coordinator → agente), así que
 * sin esto una oferta que el cliente no contestó se muere en silencio.
 *
 * Este módulo COMPONE dos piezas que antes estaban fundidas en una:
 *   - la compuerta genérica (`agent/followUpGate`), que decide si se PUEDE
 *     escribir sin molestar — reglas que no dependen del dominio;
 *   - el criterio del dominio (`domain/sales/followUp`), que decide si HAY algo
 *     que perseguir y con qué palabras.
 *
 * El envío vive en `pipeline/followUp.ts`. La selección se mantiene aparte y sin
 * efectos para poder probar la política —que es donde está el riesgo de molestar
 * al cliente— sin levantar el pipeline entero.
 */

export type { FollowUpPolicy } from '../agent/followUpGate';
export type { FollowUpReason } from '../domain/sales/followUp';
export { buildFollowUpDirective } from '../domain/sales/followUp';

export function policyFromConfig(config: Config): FollowUpPolicy {
  return {
    afterHours: config.followUp.afterHours,
    maxFollowUps: config.followUp.maxFollowUps,
    minHoursBetween: config.followUp.minHoursBetween,
  };
}

export interface FollowUpCandidate extends FollowUpSubject {
  job: Job;
  contact: Contact;
  /** Horas de silencio desde nuestro último mensaje. */
  silentHours: number;
}

/** Estados del job en los que un seguimiento tiene sentido. Uno READY_FOR_REVIEW
 *  ya está en manos del dueño. */
const FOLLOW_UP_STATUSES = [JOB_STATUS.OPEN] as const;

/**
 * ¿Este job merece un seguimiento? Devuelve el motivo o null.
 *
 * Primero la compuerta (¿se puede molestar?), después el dominio (¿hay algo que
 * perseguir?). Ese orden importa: ninguna razón comercial justifica escribirle a
 * quien pausó el bot o ya recibió el tope de seguimientos.
 */
export function evaluateJob(args: {
  job: Job;
  contact: Contact;
  lastMessage: Message | null;
  schema: IntakeSchema;
  policy: FollowUpPolicy;
  now: Date;
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

  const subject = resolveFollowUpSubject(parseJobIntake(job), schema);
  if (!subject) return null;

  return { ...subject, silentHours: gate.silentHours };
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
