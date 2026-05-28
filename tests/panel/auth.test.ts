import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  encodeSession,
  decodeSession,
  type PanelUser,
} from '../../src/panel/auth';

describe('hashPassword / verifyPassword', () => {
  it('hash genera string bcrypt válido', async () => {
    const h = await hashPassword('secret123');
    expect(h).toMatch(/^\$2[aby]\$\d+\$/);
  });

  it('verifyPassword acepta password correcto', async () => {
    const h = await hashPassword('hola');
    expect(await verifyPassword('hola', h)).toBe(true);
  });

  it('verifyPassword rechaza password incorrecto', async () => {
    const h = await hashPassword('hola');
    expect(await verifyPassword('chao', h)).toBe(false);
  });
});

describe('encodeSession / decodeSession', () => {
  const secret = 'panel-session-secret-123';

  it('round-trip preserva el username', () => {
    const token = encodeSession('duenio', secret);
    const decoded = decodeSession(token, secret);
    expect(decoded).toBe('duenio');
  });

  it('rechaza token firmado con otro secret', () => {
    const token = encodeSession('duenio', secret);
    expect(decodeSession(token, 'otro')).toBeNull();
  });

  it('rechaza token manipulado', () => {
    const token = encodeSession('duenio', secret);
    const [user, sig] = token.split('.');
    const tampered = `${user}.tampered`;
    expect(decodeSession(tampered, secret)).toBeNull();
  });

  it('rechaza token malformado', () => {
    expect(decodeSession('not-a-token', secret)).toBeNull();
  });
});

describe('resolveUser', () => {
  it('encuentra usuario por nombre y verifica password', async () => {
    const hash = await hashPassword('mi-pass');
    const { resolveUser } = await import('../../src/panel/auth');
    const users: PanelUser[] = [{ username: 'duenio', passwordHash: hash }];
    expect(await resolveUser(users, 'duenio', 'mi-pass')).toEqual({
      username: 'duenio',
      passwordHash: hash,
    });
    expect(await resolveUser(users, 'duenio', 'mala')).toBeNull();
    expect(await resolveUser(users, 'otra', 'mi-pass')).toBeNull();
  });
});
