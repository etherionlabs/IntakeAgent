/** Inicio del mes calendario en curso (UTC) para el conteo del plan gratuito. */
export function startOfMonthUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
