import bcrypt from 'bcryptjs';
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface PanelUser {
  username: string;
  passwordHash: string;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function resolveUser(
  users: PanelUser[],
  username: string,
  password: string,
): Promise<PanelUser | null> {
  const user = users.find((u) => u.username === username);
  if (!user) return null;
  const ok = await verifyPassword(password, user.passwordHash);
  return ok ? user : null;
}

/**
 * Token de sesión: `usernameBase64.signatureBase64`.
 * signature = HMAC-SHA256(secret, username) en base64url.
 */
export function encodeSession(username: string, secret: string): string {
  const sig = createHmac('sha256', secret).update(username).digest('base64url');
  return `${Buffer.from(username).toString('base64url')}.${sig}`;
}

export function decodeSession(token: string, secret: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encUser, sig] = parts;
  let username: string;
  try {
    username = Buffer.from(encUser, 'base64url').toString('utf-8');
  } catch {
    return null;
  }
  if (!username) return null;
  const expectedSig = createHmac('sha256', secret).update(username).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? username : null;
}

export const COOKIE_NAME = 'intake_panel_session';
