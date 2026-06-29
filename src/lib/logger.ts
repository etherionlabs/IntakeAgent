import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  // service identifica el proceso (worker | api). Cada línea lo lleva.
  base: { service: process.env.SERVICE_NAME ?? 'worker' },
  // Nunca serializar credenciales/cookies ni cuerpos de auth en los logs.
  redact: {
    paths: [
      'authorization',
      'headers.authorization',
      'headers.cookie',
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'newPassword',
      'currentPassword',
      'token',
      'apiKey',
      'OPENROUTER_API_KEY',
      'INTERNAL_API_TOKEN',
      'JWT_SECRET',
    ],
    censor: '[redacted]',
  },
});

/** Child logger con el tenantId, para correlacionar todos los logs de un tenant. */
export const loggerForTenant = (tenantId: string) => logger.child({ tenantId });
