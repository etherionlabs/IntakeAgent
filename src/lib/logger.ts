import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
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
