import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildTestApp, seedTenantAndUser, loginCookie, TEST_USER, cleanupDb } from './helpers/app';

describe('auth', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  beforeEach(async () => { await seedTenantAndUser(); app = await buildTestApp(); });
  afterAll(async () => { await cleanupDb(); });

  it('login OK fija cookies (sesión HttpOnly + csrf) y NO devuelve token', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: TEST_USER.email, password: TEST_USER.password } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toBeUndefined();
    expect(body.user.role).toBe('admin');
    expect(body.user.email).toBe(TEST_USER.email);
    const cookies = res.cookies as Array<{ name: string; httpOnly?: boolean }>;
    const session = cookies.find((c) => c.name === 'intake_session');
    const csrf = cookies.find((c) => c.name === 'intake_csrf');
    expect(session?.httpOnly).toBe(true);
    expect(csrf).toBeDefined();
    expect(csrf?.httpOnly).toBeFalsy();
  });

  it('password incorrecto → 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: TEST_USER.email, password: 'wrongpassword' } });
    expect(res.statusCode).toBe(401);
  });

  it('email inexistente → 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'nope@test.local', password: 'x' } });
    expect(res.statusCode).toBe(401);
  });

  it('ruta protegida sin sesión → 401', async () => {
    app.get('/__protected', { preHandler: (app as any).authenticate }, async () => ({ ok: true }));
    const res = await app.inject({ method: 'GET', url: '/__protected' });
    expect(res.statusCode).toBe(401);
  });

  it('/auth/me con cookie válida devuelve el user; logout invalida', async () => {
    const { headers } = await loginCookie(app);
    const me = await app.inject({ method: 'GET', url: '/auth/me', headers });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe(TEST_USER.email);

    const out = await app.inject({ method: 'POST', url: '/auth/logout', headers });
    expect(out.statusCode).toBe(200);
    // sin cookie → 401
    const me2 = await app.inject({ method: 'GET', url: '/auth/me' });
    expect(me2.statusCode).toBe(401);
  });
});
