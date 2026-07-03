import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildTestApp, seedTenantAndUser, loginCookie, cleanupDb } from './helpers/app';

describe('csrf double-submit', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  beforeEach(async () => {
    await seedTenantAndUser();
    app = await buildTestApp();
    app.post('/__mutate', { preHandler: (app as any).authenticate }, async () => ({ ok: true }));
  });
  afterAll(async () => { await cleanupDb(); });

  it('mutación con cookie de sesión pero SIN x-csrf-token → 403', async () => {
    const { headers } = await loginCookie(app); // headers solo trae la cookie
    const res = await app.inject({ method: 'POST', url: '/__mutate', headers, payload: {} });
    expect(res.statusCode).toBe(403);
  });

  it('mutación con cookie + x-csrf-token coincidente → pasa', async () => {
    const { mutatingHeaders } = await loginCookie(app);
    const res = await app.inject({ method: 'POST', url: '/__mutate', headers: mutatingHeaders, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it('GET no requiere CSRF', async () => {
    const { headers } = await loginCookie(app);
    const res = await app.inject({ method: 'GET', url: '/auth/me', headers });
    expect(res.statusCode).toBe(200);
  });

  it('mutación con Bearer (sin cookie) está exenta de CSRF', async () => {
    // El navegador no adjunta Bearer automáticamente ⇒ no es vulnerable a CSRF.
    const userId = await seedTenantAndUser();
    const token = app.jwt.sign({ userId, tenantId: '00000000-0000-0000-0000-000000000001', role: 'admin' });
    const res = await app.inject({ method: 'POST', url: '/__mutate', headers: { authorization: `Bearer ${token}` }, payload: {} });
    expect(res.statusCode).toBe(200);
  });
});
