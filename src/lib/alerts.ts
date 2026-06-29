/**
 * Reglas de alerta accionables (Fase 5). La lógica de umbrales es pura y
 * testeable; el envío al canal (email/Slack/Telegram) se inyecta.
 */

export type AlertSeverity = 'media' | 'alta' | 'critica';

export interface Alert {
  kind: 'bot_down' | 'payment_failed' | 'error_rate' | 'openrouter_low' | 'disk_db';
  severity: AlertSeverity;
  tenantId?: string;
  message: string;
}

export type AlertSink = (alert: Alert) => void | Promise<void>;

/** Umbral de bot caído (min) — Decisión abierta; default 5 (criterio < 5 min). */
export const BOT_DOWN_MINUTES = Number(process.env.ALERT_BOT_DOWN_MIN ?? 5);

/**
 * ¿Una desconexión sostenida debe alertar? Histéresis: solo si lleva >= N min
 * desconectado y NO es un loggedOut esperado (ese es acción de re-vinculación,
 * no alerta de caída). Evita flapping por reconexiones rápidas.
 */
export function shouldAlertBotDown(args: {
  disconnectedSinceMs: number | null; now: number; loggedOut: boolean; minutes?: number;
}): boolean {
  if (args.loggedOut) return false;
  if (args.disconnectedSinceMs == null) return false;
  const mins = (args.now - args.disconnectedSinceMs) / 60000;
  return mins >= (args.minutes ?? BOT_DOWN_MINUTES);
}

/** ¿La tasa de 5xx supera el umbral en la ventana? */
export function shouldAlertErrorRate(fivexx: number, total: number, threshold = 0.1): boolean {
  if (total < 20) return false; // muestra mínima para evitar ruido
  return fivexx / total >= threshold;
}

/** ¿El conteo de errores por saldo/quota de OpenRouter supera el umbral? */
export function shouldAlertOpenRouter(insufficientCredits: number, threshold = 1): boolean {
  return insufficientCredits >= threshold;
}

/** Deduplicación simple por (kind,tenant) para no repetir la misma alerta. */
export class AlertDeduper {
  private readonly seen = new Set<string>();
  constructor(private readonly sink: AlertSink) {}
  async emit(alert: Alert): Promise<void> {
    const key = `${alert.kind}:${alert.tenantId ?? '-'}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    await this.sink(alert);
  }
  /** Limpia una alerta resuelta (ej. el bot reconectó) para permitir re-alertar. */
  clear(kind: Alert['kind'], tenantId?: string): void {
    this.seen.delete(`${kind}:${tenantId ?? '-'}`);
  }
}
