import type { BatchMessage } from './types';
import type { BusinessFacts, Config } from '../config/schema';
import type { OpenJobSummary } from './types';

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
      case 'image':
        parts.push(
          `[mensaje ${n} — foto recibida]\n(imagen guardada en ${m.mediaPath ?? 'desconocido'})`,
        );
        break;
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

export function buildOpenJobsBlock(otherOpenJobs: OpenJobSummary[]): string {
  if (otherOpenJobs.length < 2) return '';
  const lines: string[] = [];
  lines.push('=== JOBS ABIERTOS MÚLTIPLES ===');
  lines.push(
    `Hay ${otherOpenJobs.length} jobs abiertos para este contacto. Decide a cuál pertenece el mensaje o abre uno nuevo usando la tool select_or_open_job.`,
  );
  for (const j of otherOpenJobs) {
    const date = j.openedAt.toISOString().slice(0, 10);
    lines.push(`- ${j.id} (abierto ${date}): ${j.summary ?? 'sin resumen aún'}`);
  }
  return lines.join('\n');
}

type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';
const DAY_KEYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function buildHoursBlock(config: Config, now: Date): string {
  const h = config.hours;
  if (!h.enabled) return '';

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

  const lines: string[] = [];
  lines.push('=== HORARIO ACTUAL ===');
  lines.push(`Día/hora local (${h.timezone}): ${dayKey} ${hour}:${minute}`);

  let withinHours = false;
  if (range && DAY_KEYS.includes(dayKey)) {
    const [start, end] = range;
    const cur = `${hour}:${minute}`;
    withinHours = cur >= start && cur <= end;
  }

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
