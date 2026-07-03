/**
 * Capa de error tracking compartida (worker + API). Sin DSN es no-op (dev/tests).
 * El backend real es Sentry; aquí se concentra el SCRUBBING de secretos y el
 * tagging por `tenantId`, ambos testeables sin pegarle a Sentry.
 */
import { logger } from './logger';

export interface ErrorContext {
  tenantId?: string;
  service?: string;
  extra?: Record<string, unknown>;
}

export type Reporter = (err: unknown, ctx: ErrorContext) => void;

const SECRET_KEYS = /^(authorization|cookie|password|token|apikey|openrouter_api_key|internal_api_token|jwt_secret|stripe_secret_key|stripe_webhook_secret)$/i;
const PHONE_RE = /\+?\d[\d\s()-]{7,}\d/g;

/** Elimina claves secretas y enmascara teléfonos de un objeto (profundo, acotado). */
export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[depth]';
  if (typeof value === 'string') return value.replace(PHONE_RE, '[phone]');
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEYS.test(k) ? '[redacted]' : scrub(v, depth + 1);
    }
    return out;
  }
  return value;
}

let reporter: Reporter = () => {}; // no-op por defecto
let initialized = false;

/** Inyecta un reporter (tests) o lo reemplaza. */
export function setReporter(fn: Reporter): void { reporter = fn; }

/** Captura un error con contexto. Aplica scrubbing al `extra` antes de reportar. */
export function captureError(err: unknown, ctx: ErrorContext = {}): void {
  const safeCtx: ErrorContext = { ...ctx, extra: ctx.extra ? (scrub(ctx.extra) as Record<string, unknown>) : undefined };
  try { reporter(err, safeCtx); } catch { /* el tracking nunca debe tumbar el proceso */ }
}

/**
 * Inicializa Sentry si hay SENTRY_DSN; si no, deja el no-op. Idempotente.
 * Cablea el reporter a Sentry con tag tenantId y beforeSend de scrubbing.
 */
export async function initErrorTracking(opts: { service: string }): Promise<void> {
  if (initialized) return;
  initialized = true;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return; // dev/tests: no-op
  try {
    const Sentry = await import('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? 'production',
      release: process.env.GIT_SHA,
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
      beforeSend(event) { return scrub(event) as typeof event; },
    });
    setReporter((err, ctx) => {
      Sentry.withScope((scope) => {
        scope.setTag('service', ctx.service ?? opts.service);
        if (ctx.tenantId) scope.setTag('tenantId', ctx.tenantId);
        if (ctx.extra) scope.setContext('extra', ctx.extra as Record<string, unknown>);
        Sentry.captureException(err);
      });
    });
    logger.info({ service: opts.service }, 'error_tracking.initialized');
  } catch (e) {
    logger.warn({ err: e instanceof Error ? e.message : String(e) }, 'error_tracking.init_failed');
  }
}
