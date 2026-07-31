import type { PrismaClient, Job, Contact, Message } from '@prisma/client';
import type { Config } from '../config/schema';
import { JOB_STATUS, parseJobIntake } from './job';
import { listOpportunities, getDiagnosis, openObjections } from './intake';
import type { IntakeSchema } from '../config/intake-schema';
import { listRequiredPaths } from '../config/intake-schema';
import { getByPath } from '../lib/path';
import type { FieldState } from './intake';

/**
 * Seguimiento proactivo: la parte del agente que NO nace de un mensaje del
 * cliente. Todo el pipeline es reactivo (adapter → coordinator → agente), así que
 * sin esto una oferta que el cliente no contestó se muere en silencio.
 *
 * Este módulo decide A QUIÉN y POR QUÉ escribirle. El envío vive en
 * `pipeline/followUp.ts`. La selección se mantiene aparte y sin efectos para
 * poder probar la política —que es donde está el riesgo de molestar al cliente—
 * sin levantar el pipeline entero.
 */

export interface FollowUpPolicy {
  afterHours: number;
  maxFollowUps: number;
  minHoursBetween: number;
}

export function policyFromConfig(config: Config): FollowUpPolicy {
  return {
    afterHours: config.followUp.afterHours,
    maxFollowUps: config.followUp.maxFollowUps,
    minHoursBetween: config.followUp.minHoursBetween,
  };
}

/** Por qué le escribimos. Determina el tono y el objetivo del mensaje. */
export type FollowUpReason = 'pending_offer' | 'incomplete_intake';

export interface FollowUpCandidate {
  job: Job;
  contact: Contact;
  reason: FollowUpReason;
  /** Servicios ofrecidos que siguen sin respuesta (solo en `pending_offer`). */
  pendingServices: string[];
  /** Etiquetas de los campos requeridos que faltan (solo en `incomplete_intake`). */
  missingLabels: string[];
  /** Horas de silencio desde nuestro último mensaje. */
  silentHours: number;
  /** El problema del cliente en sus palabras, si el agente llegó a descubrirlo. */
  pain?: string;
  /** Objeciones que quedaron sin resolver: suelen ser el motivo real del silencio. */
  openObjections: string[];
}

const HOUR_MS = 3600_000;

/**
 * ¿Este job merece un seguimiento? Devuelve el motivo o null.
 *
 * Reglas, en orden de "cuánto puede molestar":
 *   1. El bot debe seguir activo para el contacto y no estar marcado como spam.
 *   2. El job sigue en intake (uno READY_FOR_REVIEW ya está en manos del dueño).
 *   3. Hablamos NOSOTROS al final: si el último mensaje es del cliente, el
 *      pipeline normal ya lo está atendiendo y meternos sería duplicar.
 *   4. Pasó el silencio mínimo, no se agotó el tope y se respetó la espera
 *      entre seguimientos.
 *   5. Hay algo real que perseguir: una oferta sin responder o campos faltantes.
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

  if (!contact.botActive || contact.flaggedNonIntake) return null;
  if (contact.archivedAt) return null;
  if (job.archivedAt) return null;
  if (job.status !== JOB_STATUS.OPEN) return null;
  if (job.followUpCount >= policy.maxFollowUps) return null;

  // Sin conversación no hay a qué darle seguimiento (job recién abierto sin
  // mensajes, o uno cuyo historial ya purgó la retención).
  if (!lastMessage) return null;
  // Si el cliente escribió al final, el turno normal es quien responde.
  if (lastMessage.direction !== 'outbound') return null;

  const silentMs = now.getTime() - lastMessage.createdAt.getTime();
  const silentHours = silentMs / HOUR_MS;
  if (silentHours < policy.afterHours) return null;

  if (job.lastFollowUpAt) {
    const sinceLast = (now.getTime() - job.lastFollowUpAt.getTime()) / HOUR_MS;
    if (sinceLast < policy.minHoursBetween) return null;
  }

  const intake = parseJobIntake(job);

  // Una oferta en el aire es el mejor motivo: el cliente ya mostró interés y
  // nadie cerró el tema. Va antes que el intake incompleto.
  const diagnosis = getDiagnosis(intake);
  const unresolved = openObjections(intake).map((o) => `${o.type}: ${o.note}`);
  const base = { pain: diagnosis.pain, openObjections: unresolved };

  const pendingServices = listOpportunities(intake)
    .filter((o) => o.status === 'offered')
    .map((o) => o.service);
  if (pendingServices.length > 0) {
    return { ...base, reason: 'pending_offer', pendingServices, missingLabels: [], silentHours };
  }

  const missingLabels: string[] = [];
  for (const path of listRequiredPaths(schema)) {
    const field = getByPath(intake, path) as FieldState | undefined;
    const satisfied = field && (field.value !== null || field.declined === true);
    if (!satisfied) missingLabels.push(labelForPath(schema, path));
  }
  if (missingLabels.length > 0) {
    return { ...base, reason: 'incomplete_intake', pendingServices: [], missingLabels, silentHours };
  }

  // Intake completo y sin ofertas pendientes: no hay nada que perseguir. Si el
  // cliente nunca confirmó el resumen, el dueño ya lo ve en el panel.
  return null;
}

function labelForPath(schema: IntakeSchema, path: string): string {
  const [sectionKey, fieldKey] = path.split('.');
  const section = schema.sections.find((s) => s.key === sectionKey);
  const field = section?.fields.find((f) => f.key === fieldKey);
  return field?.label ?? path;
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

/**
 * Instrucción que se le da al agente para el turno de seguimiento. Va como
 * mensaje de usuario (el turno no tiene mensaje del cliente) y deja claro que
 * NO lo escribió el cliente, para que el modelo no le conteste a un fantasma.
 */
export function buildFollowUpDirective(candidate: FollowUpCandidate): string {
  const lines: string[] = [];
  lines.push('[SEGUIMIENTO PROACTIVO — este turno NO lo disparó el cliente]');
  lines.push(
    `El cliente lleva ~${Math.round(candidate.silentHours)} h sin responder a tu último mensaje. ` +
      'Escríbele TÚ para retomar la conversación.',
  );
  if (candidate.pain) {
    lines.push(`Lo que te contó que necesita: ${candidate.pain}`);
  }
  if (candidate.openObjections.length > 0) {
    lines.push(
      `Quedó sin resolver: ${candidate.openObjections.join(' | ')}. Retómalo por AHÍ — ` +
        'lo más probable es que sea el motivo real del silencio.',
    );
  }
  lines.push('');

  if (candidate.reason === 'pending_offer') {
    lines.push(
      `Quedó en el aire lo que le ofreciste: ${candidate.pendingServices.join(', ')}. ` +
        'Retómalo de forma ligera, recordando el beneficio en una frase, y facilítale la ' +
        'respuesta (que solo tenga que decir sí o no).',
    );
  } else {
    lines.push(
      `Falta capturar: ${candidate.missingLabels.join(', ')}. ` +
        'Retoma pidiendo SOLO el dato más importante que falte, no toda la lista.',
    );
  }

  lines.push('');
  lines.push('Reglas de este mensaje:');
  lines.push('- UN solo mensaje, corto (1-2 frases), cálido y sin reclamo por no haber contestado.');
  lines.push('- NO repitas el saludo de presentación ni vuelvas a explicar lo ya explicado.');
  lines.push('- NO inventes novedades, promociones ni urgencias que no existan.');
  lines.push(
    `- Es tu seguimiento número ${candidate.job.followUpCount + 1}. Si el cliente sigue sin ` +
      'contestar no habrá muchos más: deja la puerta abierta, no presiones.',
  );
  lines.push('- No uses tools salvo que de verdad haya algo que registrar.');
  return lines.join('\n');
}
