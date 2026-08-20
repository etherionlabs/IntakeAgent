/**
 * MÓDULO `ventas`: su motivo de seguimiento y su copy.
 *
 * La compuerta genérica (`src/agent/followUpGate.ts`) ya decidió que SE PUEDE
 * escribir. Aquí se decide si HAY ALGO QUE PERSEGUIR y con qué palabras, que es
 * puro juicio comercial: una oferta en el aire vale más que un dato faltante,
 * porque el cliente ya mostró interés y nadie cerró el tema.
 *
 * Cada módulo aporta los suyos. La PRIORIDAD entre motivos de módulos distintos
 * no la decide ningún módulo: es una decisión de la composición (la vertical).
 */
import type { Job } from '@prisma/client';
import type { IntakeSchema } from '../../config/intake-schema';
import { labelForPath, missingRequiredPaths } from '../../artifact/state';
import type { IntakeState } from '../../services/intake';
import { getDiagnosis, openObjections, pendingOpportunities } from './state';

/** Por qué le escribimos. Determina el tono y el objetivo del mensaje. */
export type FollowUpReason = 'pending_offer' | 'incomplete_intake';

/** Lo que el dominio aporta sobre un candidato: el motivo y su material. */
export interface FollowUpSubject {
  reason: FollowUpReason;
  /** Servicios ofrecidos que siguen sin respuesta (solo en `pending_offer`). */
  pendingServices: string[];
  /** Etiquetas de los campos requeridos que faltan (solo en `incomplete_intake`). */
  missingLabels: string[];
  /** El problema del cliente en sus palabras, si el agente llegó a descubrirlo. */
  pain?: string;
  /** Objeciones que quedaron sin resolver: suelen ser el motivo real del silencio. */
  openObjections: string[];
}

/**
 * ¿Hay algo real que perseguir en este trabajo? Devuelve el motivo o null.
 *
 * Una oferta en el aire va ANTES que el intake incompleto: el cliente ya mostró
 * interés y perseguir el dato menor mientras la propuesta se enfría es el error
 * caro. Intake completo y sin ofertas pendientes = no hay nada que perseguir; si
 * el cliente nunca confirmó el resumen, el dueño ya lo ve en el panel.
 */
export function resolveFollowUpSubject(
  intake: IntakeState,
  schema: IntakeSchema,
): FollowUpSubject | null {
  const diagnosis = getDiagnosis(intake);
  const unresolved = openObjections(intake).map((o) => `${o.type}: ${o.note}`);
  const base = { pain: diagnosis.pain, openObjections: unresolved };

  const pendingServices = pendingOpportunities(intake).map((o) => o.service);
  if (pendingServices.length > 0) {
    return { ...base, reason: 'pending_offer', pendingServices, missingLabels: [] };
  }

  const missingLabels = missingRequiredPaths(schema, intake).map((p) => labelForPath(schema, p));
  if (missingLabels.length > 0) {
    return { ...base, reason: 'incomplete_intake', pendingServices: [], missingLabels };
  }

  return null;
}

/** Lo que la directiva necesita saber: el motivo, el silencio y el intento. */
export interface DirectiveInput extends FollowUpSubject {
  job: Pick<Job, 'followUpCount'>;
  silentHours: number;
}

/**
 * Instrucción que se le da al agente para el turno de seguimiento. Va como
 * mensaje de usuario (el turno no tiene mensaje del cliente) y deja claro que
 * NO lo escribió el cliente, para que el modelo no le conteste a un fantasma.
 */
export function buildFollowUpDirective(candidate: DirectiveInput): string {
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
