import * as Sentry from '@sentry/react';

let initialized = false;

/** Inicializa Sentry si hay VITE_SENTRY_DSN; si no, no-op (dev/tests). */
export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn || initialized) return;
  initialized = true;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_GIT_SHA,
    tracesSampleRate: 0.1,
    sendDefaultPii: false, // nada de PII ni cuerpos de mensaje
  });
}

/** Etiqueta los errores con el tenant del usuario tras el login. */
export function setTenantTag(tenantId: string): void {
  if (initialized) Sentry.setTag('tenantId', tenantId);
}

export function clearTenantTag(): void {
  if (initialized) Sentry.setTag('tenantId', undefined);
}
