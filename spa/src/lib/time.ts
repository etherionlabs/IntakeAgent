/**
 * Tiempo relativo en español ("hace 2 h"). Una fecha absoluta no dice nada de
 * urgencia; el dueño necesita saber cuánto lleva esperando un cliente, no el
 * día y hora exactos.
 */
export function relativeTime(value?: string | null, now: Date = new Date()): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';

  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 0) return 'ahora';

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `hace ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days} días`;

  const months = Math.floor(days / 30);
  if (months < 12) return `hace ${months} ${months === 1 ? 'mes' : 'meses'}`;

  const years = Math.floor(months / 12);
  return `hace ${years} ${years === 1 ? 'año' : 'años'}`;
}

/** Fecha completa, para el `title` de un tiempo relativo. */
export function absoluteTime(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}
