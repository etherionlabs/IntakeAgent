import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { buildTestApp, seedTenantAndUser, loginCookie, TEST_USER, testPrisma, cleanupDb } from './helpers/app';
import { setEmailSender } from '../src/lib/email';
import crypto from 'node:crypto';

function sha256(v: string) { return crypto.createHash('sha256').update(v).digest('hex'); }

describe('password flow (forgot / reset / change)', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  const sent: Array<{ to: string; body: string }> = [];

  beforeEach(async () => {
    sent.length = 0;
    setEmailSender({ async send(to, _s, body) { sent.push({ to, body }); } });
    await seedTenantAndUser();
    app = await buildTestApp();
  });
  afterAll(async () => { await cleanupDb(); });

  it('forgot-password siempre 200 (anti-enumeración) y persiste tokenHash para email real', async () => {
    const real = await app.inject({ method: 'POST', url: '/auth/forgot-password', payload: { email: TEST_USER.email } });
    expect(real.statusCode).toBe(200);
    const ghost = await app.inject({ method: 'POST', url: '/auth/forgot-password', payload: { email: 'nadie@test.local' } });
    expect(ghost.statusCode).toBe(200);
    const tokens = await testPrisma.passwordResetToken.findMany();
    expect(tokens.length).toBe(1); // solo el email real
    expect(tokens[0].tokenHash).not.toContain(' ');
    expect(tokens[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('reset-password canjea token de un solo uso y la nueva contraseña funciona', async () => {
    await app.inject({ method: 'POST', url: '/auth/forgot-password', payload: { email: TEST_USER.email } });
    const token = sent[0].body.match(/token=([a-f0-9]+)/)![1];
    const newPassword = 'nuevaClave12345';

    const ok = await app.inject({ method: 'POST', url: '/auth/reset-password', payload: { token, newPassword } });
    expect(ok.statusCode).toBe(200);

    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: TEST_USER.email, password: newPassword } });
    expect(login.statusCode).toBe(200);

    // reusar el token → falla
    const reuse = await app.inject({ method: 'POST', url: '/auth/reset-password', payload: { token, newPassword: 'otraClave12345' } });
    expect(reuse.statusCode).toBe(400);
  });

  it('reset-password rechaza contraseña que viola la política', async () => {
    await app.inject({ method: 'POST', url: '/auth/forgot-password', payload: { email: TEST_USER.email } });
    const token = sent[0].body.match(/token=([a-f0-9]+)/)![1];
    const res = await app.inject({ method: 'POST', url: '/auth/reset-password', payload: { token, newPassword: 'corta' } });
    expect(res.statusCode).toBe(400);
  });

  it('reset-password con token expirado → 400', async () => {
    const token = 'deadbeef'.repeat(8);
    const user = await testPrisma.panelUser.findFirst({ where: { email: TEST_USER.email } });
    await testPrisma.passwordResetToken.create({
      data: { userId: user!.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await app.inject({ method: 'POST', url: '/auth/reset-password', payload: { token, newPassword: 'validaClave123' } });
    expect(res.statusCode).toBe(400);
  });

  it('change-password verifica la actual e invalida sesiones previas', async () => {
    const { mutatingHeaders } = await loginCookie(app);
    const newPassword = 'cambiada123456';
    const change = await app.inject({
      method: 'POST', url: '/auth/change-password',
      headers: mutatingHeaders,
      payload: { currentPassword: TEST_USER.password, newPassword },
    });
    expect(change.statusCode).toBe(200);

    // la cookie/JWT anterior queda invalidada (emitida antes de passwordChangedAt)
    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: mutatingHeaders.cookie } });
    expect(me.statusCode).toBe(401);
  });

  it('change-password con contraseña actual incorrecta → 403', async () => {
    const { mutatingHeaders } = await loginCookie(app);
    const res = await app.inject({
      method: 'POST', url: '/auth/change-password',
      headers: mutatingHeaders,
      payload: { currentPassword: 'incorrecta', newPassword: 'cualquieraValida123' },
    });
    expect(res.statusCode).toBe(403);
  });
});
