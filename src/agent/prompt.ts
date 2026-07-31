import type { BatchMessage } from './types';
import type { BusinessFacts, Config, Profile } from '../config/schema';
import type { OpenJobSummary } from './types';
import type { IntakeState } from '../services/intake';
import { renderIntakeForModel } from '../services/intake';

export function renderUserMessage(batch: BatchMessage[]): string {
  if (batch.length === 0) {
    throw new Error('renderUserMessage: batch vacío');
  }
  const parts: string[] = [];
  batch.forEach((m, idx) => {
    const n = idx + 1;
    switch (m.kind) {
      case 'text':
        parts.push(`[mensaje ${n} — texto]\n${m.body ?? ''}`);
        break;
      case 'image': {
        const imgLines = [`[mensaje ${n} — foto recibida]`];
        if (m.body && m.body.trim().length > 0) {
          imgLines.push(`Caption del cliente: ${m.body}`);
        }
        if (m.description && m.description.trim().length > 0) {
          imgLines.push(`Descripción de la imagen: ${m.description}`);
        } else {
          imgLines.push(
            'Descripción de la imagen: (no disponible — usa reanalyze_image si necesitas analizarla)',
          );
        }
        imgLines.push(`(ref: ${m.id})`);
        parts.push(imgLines.join('\n'));
        break;
      }
      case 'audio':
        parts.push(
          `[mensaje ${n} — audio transcrito]\n${m.body ?? '(sin transcripción)'}\n(archivo: ${m.mediaPath ?? 'desconocido'})`,
        );
        break;
      case 'sticker':
      case 'location':
      case 'other':
      default:
        parts.push(`[mensaje ${n} — ${m.kind} no soportado]\n${m.body ?? ''}`);
        break;
    }
  });
  return parts.join('\n\n');
}

export function buildBusinessFactsBlock(facts: BusinessFacts, businessName: string): string {
  const lines: string[] = [];
  lines.push('=== INFORMACIÓN DEL NEGOCIO ===');
  lines.push(`[${businessName}]`);
  if (facts.facts.length > 0) {
    lines.push('');
    lines.push('Hechos clave (úsalos solo si el cliente pregunta sobre ellos):');
    for (const f of facts.facts) {
      lines.push(`- ${f.topic}: ${f.answer}`);
    }
  }
  if (facts.freeContext && facts.freeContext.trim().length > 0) {
    lines.push('');
    lines.push('Contexto general:');
    lines.push(facts.freeContext);
  }
  return lines.join('\n');
}

/**
 * `otherOpenJobs` son los OTROS trabajos abiertos del contacto: el actual no
 * está en la lista. Basta con que haya UNO para que el mensaje sea ambiguo — el
 * caso más común de un cliente que vuelve es tener dos trabajos, no tres.
 */
export function buildOpenJobsBlock(otherOpenJobs: OpenJobSummary[]): string {
  if (otherOpenJobs.length < 1) return '';
  const lines: string[] = [];
  lines.push('=== JOBS ABIERTOS MÚLTIPLES ===');
  lines.push(
    `Este contacto tiene ${otherOpenJobs.length + 1} trabajos abiertos: el de esta conversación y ${otherOpenJobs.length === 1 ? 'el siguiente' : 'los siguientes'}. ` +
      `Si el mensaje se refiere a otro, o a algo nuevo, dilo con select_or_open_job; si sigue con el de esta conversación, no llames a la tool. ` +
      `Ante la duda, PREGÚNTALE al cliente de cuál habla en vez de adivinar. ` +
      `Puedes guardar datos antes o después de cambiarte: lo que hayas guardado en este turno se mueve solo al trabajo que elijas.`,
  );
  for (const j of otherOpenJobs) {
    const date = j.openedAt.toISOString().slice(0, 10);
    lines.push(`- ${j.id} (abierto ${date}): ${j.summary ?? 'sin resumen aún'}`);
  }
  return lines.join('\n');
}

type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';
const DAY_KEYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Día/hora local del negocio y si cae dentro del horario configurado. */
export function localBusinessTime(
  config: Config,
  now: Date,
): { dayKey: DayKey; hour: string; minute: string; withinHours: boolean } {
  const h = config.hours;
  // Toma la hora en la zona horaria configurada usando Intl.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: h.timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const weekday = parts.find((p) => p.type === 'weekday')?.value.toLowerCase() ?? '';
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  // weekday viene como "mon", "tue"... que ya coincide con nuestras keys.
  const dayKey = weekday as DayKey;
  const range = h.schedule[dayKey];

  let withinHours = false;
  if (range && DAY_KEYS.includes(dayKey)) {
    const [start, end] = range;
    const cur = `${hour}:${minute}`;
    withinHours = cur >= start && cur <= end;
  }
  return { dayKey, hour, minute, withinHours };
}

/**
 * ¿Es momento de escribirle al cliente por iniciativa nuestra? Con el horario
 * apagado no hay restricción; con horario, solo dentro de él. Lo usa el
 * seguimiento proactivo: un mensaje no solicitado a medianoche es una molestia.
 */
export function isWithinBusinessHours(config: Config, now: Date): boolean {
  if (!config.hours.enabled) return true;
  return localBusinessTime(config, now).withinHours;
}

export function buildHoursBlock(config: Config, now: Date): string {
  const h = config.hours;
  if (!h.enabled) return '';

  const { dayKey, hour, minute, withinHours } = localBusinessTime(config, now);

  const lines: string[] = [];
  lines.push('=== HORARIO ACTUAL ===');
  lines.push(`Día/hora local (${h.timezone}): ${dayKey} ${hour}:${minute}`);

  if (withinHours) {
    lines.push('Estás dentro de horario.');
  } else {
    lines.push('Estás fuera de horario.');
    if (h.outOfHoursNotice) {
      lines.push(`Aviso configurado: ${h.outOfHoursNotice}`);
    }
  }
  return lines.join('\n');
}

export interface BuildSystemPromptArgs {
  profile: Profile;
  config: Config;
  intake: IntakeState;
  jobId: string;
  jobStatus: string;
  otherOpenJobs: OpenJobSummary[];
  now: Date;
  recentHistory?: import('./types').HistoryEntry[];
}

export function buildSystemPrompt(args: BuildSystemPromptArgs): string {
  const { profile, config, intake, jobId, jobStatus, otherOpenJobs, now, recentHistory } = args;

  // 1. Aplicar plantilla con variables.
  const allVars: Record<string, string> = {
    businessName: profile.intakeSchema.$businessName,
    businessDomain: profile.intakeSchema.$businessDomain,
    ...profile.promptVars.vars,
  };
  const baseTemplate = profile.promptVars.promptTemplate.replace(
    /\{\{(\w+)\}\}/g,
    (_, key) => allVars[key] ?? '',
  );

  // 2. Componer bloques opcionales.
  const skills = buildSkillsBlock(profile.skills);
  const facts = buildBusinessFactsBlock(
    profile.businessFacts,
    profile.intakeSchema.$businessName,
  );
  const history = buildHistoryBlock(recentHistory ?? []);
  const intakeBlock = renderIntakeForModel(profile.intakeSchema, intake, {
    jobId,
    status: jobStatus,
  });
  const openJobs = buildOpenJobsBlock(otherOpenJobs);
  const hours = buildHoursBlock(config, now);

  // 3. Unir con separadores. Las skills (técnicas) van junto al comportamiento
  //    base; el historial va antes del estado del intake.
  return [baseTemplate, skills, facts, history, intakeBlock, openJobs, hours]
    .filter((s) => s.length > 0)
    .join('\n\n');
}

/**
 * Bloque de "skills": técnicas reutilizables (venta, objeciones…) resueltas
 * desde la biblioteca `skills/`. Enseñan al modelo CÓMO trabajar; no se mencionan
 * al cliente y nunca ganan a las reglas duras.
 */
export function buildSkillsBlock(skills: import('../config/schema').LoadedSkill[]): string {
  if (skills.length === 0) return '';
  const lines: string[] = [];
  lines.push('=== HABILIDADES / TÉCNICAS ===');
  lines.push(
    'Domina estas técnicas y aplícalas de forma natural cuando ayuden. Son para TU forma de ' +
      'trabajar: NO las menciones ni las expliques al cliente, y NUNCA contradigas las REGLAS ' +
      'DURAS ni inventes datos (precios, servicios, garantías).',
  );
  for (const s of skills) {
    lines.push('');
    lines.push(`## ${s.title}`);
    if (s.description.trim().length > 0) lines.push(`(${s.description.trim()})`);
    lines.push(s.instructions.trim());
  }
  return lines.join('\n');
}

export function buildHistoryBlock(history: import('./types').HistoryEntry[]): string {
  if (history.length === 0) return '';
  const lines: string[] = [];
  lines.push('=== HISTORIAL RECIENTE DE LA CONVERSACIÓN ===');
  lines.push(
    'IMPORTANTE: los mensajes a continuación YA OCURRIERON en este chat. ' +
      'NO los repitas. Si ya saludaste, NO saludes de nuevo — continúa donde quedaste. ' +
      'Si ya preguntaste algo, NO lo vuelvas a preguntar.',
  );
  for (const h of history) {
    const who = h.direction === 'inbound' ? 'Cliente' : 'Tú (asistente)';
    let content = h.body ?? `(${h.kind})`;
    if (content.length > 400) content = content.slice(0, 397) + '…';
    lines.push(`[${who}] ${content}`);
  }
  return lines.join('\n');
}
