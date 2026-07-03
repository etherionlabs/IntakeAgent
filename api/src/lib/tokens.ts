import crypto from 'node:crypto';

/** Token aleatorio URL-safe para verificación de email / reset. */
export function randomToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Fecha a 24h en el futuro (expiración de verificación). */
export function in24h(now: Date = new Date()): Date {
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}
