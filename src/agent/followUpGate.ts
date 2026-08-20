/**
 * COMPUERTA DEL SEGUIMIENTO PROACTIVO (genérico — candidato a extracción).
 *
 * El seguimiento es el único camino por el que el agente habla SIN mensaje
 * entrante, así que es también el único donde puede molestar a alguien que no
 * pidió nada. Estas reglas son las que protegen de eso, y ninguna depende del
 * dominio: valen igual para vender un retapizado que para perseguir un
 * documento faltante.
 *
 * La compuerta decide SI se puede escribir. QUÉ hay que perseguir —y con qué
 * palabras— lo decide el dominio (`src/domain/<dominio>/followUp.ts`): es ahí
 * donde vive el juicio de negocio sobre qué silencio vale la pena romper.
 */
import type { Job, Contact, Message } from '@prisma/client';

export interface FollowUpPolicy {
  /** Silencio del cliente (horas) antes del primer seguimiento. */
  afterHours: number;
  /** Tope de seguimientos por job. Agotado, el bot no vuelve a insistir. */
  maxFollowUps: number;
  /** Espera mínima (horas) entre dos seguimientos del mismo job. */
  minHoursBetween: number;
}

const HOUR_MS = 3600_000;

export interface GateArgs {
  job: Job;
  contact: Contact;
  lastMessage: Message | null;
  policy: FollowUpPolicy;
  now: Date;
  /** Estados del job en los que el seguimiento tiene sentido. */
  openStatuses: readonly string[];
}

/**
 * ¿Se le puede escribir a este contacto por iniciativa nuestra?
 *
 * Devuelve las horas de silencio si pasa todas las reglas, o null. En orden de
 * "cuánto puede molestar":
 *   1. El bot debe seguir activo para el contacto y no estar marcado como spam.
 *   2. El caso sigue abierto (uno ya escalado está en manos de una persona).
 *   3. Hablamos NOSOTROS al final: si el último mensaje es del cliente, el
 *      pipeline normal ya lo está atendiendo y meternos sería duplicar.
 *   4. Pasó el silencio mínimo, no se agotó el tope y se respetó la espera
 *      entre seguimientos.
 */
export function passesFollowUpGate(args: GateArgs): { silentHours: number } | null {
  const { job, contact, lastMessage, policy, now, openStatuses } = args;

  if (!contact.botActive || contact.flaggedNonIntake) return null;
  if (contact.archivedAt) return null;
  if (job.archivedAt) return null;
  if (!openStatuses.includes(job.status)) return null;
  if (job.followUpCount >= policy.maxFollowUps) return null;

  // Sin conversación no hay a qué darle seguimiento (job recién abierto sin
  // mensajes, o uno cuyo historial ya purgó la retención).
  if (!lastMessage) return null;
  // Si el cliente escribió al final, el turno normal es quien responde.
  if (lastMessage.direction !== 'outbound') return null;

  const silentHours = (now.getTime() - lastMessage.createdAt.getTime()) / HOUR_MS;
  if (silentHours < policy.afterHours) return null;

  if (job.lastFollowUpAt) {
    const sinceLast = (now.getTime() - job.lastFollowUpAt.getTime()) / HOUR_MS;
    if (sinceLast < policy.minHoursBetween) return null;
  }

  return { silentHours };
}
