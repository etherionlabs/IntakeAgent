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

/** Lo que un módulo aporta para armar la directiva del turno de seguimiento. */
export interface DirectiveParts {
  /** Horas de silencio del cliente. */
  silentHours: number;
  /** Seguimientos ya enviados en este caso. */
  previousFollowUps: number;
  /** Contexto que los módulos aportan al preámbulo. */
  context: string[];
  /** Qué perseguir: lo aporta el módulo que reclamó el turno. */
  body: string[];
}

/**
 * Instrucción que se le da al agente para el turno de seguimiento.
 *
 * Va como mensaje de usuario (el turno no tiene mensaje del cliente) y deja
 * claro que NO lo escribió el cliente, para que el modelo no le conteste a un
 * fantasma. El preámbulo y las reglas son genéricos —protegen al cliente de un
 * mensaje pesado, no dependen del dominio—; el contexto y el cuerpo los ponen
 * los módulos compuestos.
 */
export function buildFollowUpDirective(parts: DirectiveParts): string {
  const lines: string[] = [];
  lines.push('[SEGUIMIENTO PROACTIVO — este turno NO lo disparó el cliente]');
  lines.push(
    `El cliente lleva ~${Math.round(parts.silentHours)} h sin responder a tu último mensaje. ` +
      'Escríbele TÚ para retomar la conversación.',
  );
  lines.push(...parts.context);
  lines.push('');
  lines.push(...parts.body);
  lines.push('');
  lines.push('Reglas de este mensaje:');
  lines.push('- UN solo mensaje, corto (1-2 frases), cálido y sin reclamo por no haber contestado.');
  lines.push('- NO repitas el saludo de presentación ni vuelvas a explicar lo ya explicado.');
  lines.push('- NO inventes novedades, promociones ni urgencias que no existan.');
  lines.push(
    `- Es tu seguimiento número ${parts.previousFollowUps + 1}. Si el cliente sigue sin ` +
      'contestar no habrá muchos más: deja la puerta abierta, no presiones.',
  );
  lines.push('- No uses tools salvo que de verdad haya algo que registrar.');
  return lines.join('\n');
}
