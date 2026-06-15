import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildTestApp, seedTenantAndUser, TEST_USER, cleanupDb } from './helpers/app';

describe('auth', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  beforeEach(async () => { await seedTenantAndUser(); app = await buildTestApp(); });
  afterAll(async () => { await cleanupDb(); });

  it('login OK devuelve token y user', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { username: TEST_USER.username, password: TEST_USER.password } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.token).toBe('string');
    expect(body.user.role).toBe('admin');
  });

  it('password incorrecto → 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { username: TEST_USER.username, password: 'wrong' } });
    expect(res.statusCode).toBe(401);
  });

  it('usuario inexistente → 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { username: 'nope', password: 'x' } });
    expect(res.statusCode).toBe(401);
  });

  it('ruta protegida (app.authenticate) sin token → 401', async () => {
    // Ruta registrada detrás del decorator para probar que protege.
    // (/jobs llega en Task 4; aquí registramos una ruta efímera equivalente.)
    app.get('/__protected', { preHandler: (app as any).authenticate }, async () => ({ ok: true }));
    const res = await app.inject({ method: 'GET', url: '/__protected' });
    expect(res.statusCode).toBe(401);
  });
});
