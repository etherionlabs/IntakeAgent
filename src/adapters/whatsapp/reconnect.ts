import { DisconnectReason } from 'baileys';

export interface BackoffOptions {
  /** Delay base del primer reintento (ms). */
  baseMs?: number;
  /** Tope superior del delay (ms). */
  capMs?: number;
}

const DEFAULT_BASE = 1000;
const DEFAULT_CAP = 30_000;

/**
 * Backoff exponencial con jitter completo, topado. `attempt` empieza en 0.
 *   delay = random(0, min(cap, base * 2^attempt))
 * El jitter evita tormentas de reconexión sincronizadas entre tenants/procesos.
 */
export function reconnectDelay(attempt: number, opts: BackoffOptions = {}): number {
  const base = opts.baseMs ?? DEFAULT_BASE;
  const cap = opts.capMs ?? DEFAULT_CAP;
  const exp = Math.min(cap, base * 2 ** Math.max(0, attempt));
  return Math.floor(Math.random() * exp);
}

/** Tope del exponencial sin jitter — útil para aserciones de crecimiento en tests. */
export function reconnectDelayCeiling(attempt: number, opts: BackoffOptions = {}): number {
  const base = opts.baseMs ?? DEFAULT_BASE;
  const cap = opts.capMs ?? DEFAULT_CAP;
  return Math.min(cap, base * 2 ** Math.max(0, attempt));
}

export type DisconnectDecision =
  | { action: 'logged_out' } // sesión inválida: NO reintentar, requiere re-vincular QR
  | { action: 'retry' }; //     caída transitoria: reintentar con backoff

/**
 * Decide qué hacer ante un cierre de conexión según el código de Baileys.
 * `loggedOut` (401) nunca reintenta; el resto (restartRequired, connectionLost,
 * timedOut, 503, desconocido) se trata como transitorio y reintenta.
 */
export function classifyDisconnect(code: number | undefined): DisconnectDecision {
  if (code === DisconnectReason.loggedOut) return { action: 'logged_out' };
  return { action: 'retry' };
}
