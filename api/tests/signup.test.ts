import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildServer } from '../src/server';
import { cleanupDb, TEST_JWT_SECRET, testPrisma } from './helpers/app';
import type { EmailSender } from '../src/lib/email';

function fakeEmail() {
  const sent: Array<{ to: string; subject: string; body: string }> = [];
  const sender: EmailSender = { async send(to, subject, body) { sent.push({ to, subject, body }); } };
  return { sender, sent };
}

const VALID = { email: 'nuevo@negocio.com', password: 'pw1234567890', businessName: 'Tapicería Luz', industry: 'tapiceria' };

describe('POST /auth/signup', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let mail: ReturnType<typeof fakeEmail>;

  beforeEach(async () => {
    await cleanupDb();
    mail = fakeEmail();
    app = await buildServer({ jwtSecret: TEST_JWT_SECRET, emailSender: mail.sender });
  });
  afterAll(async () => { await cleanupDb(); });

  it('201 crea Tenant + PanelUser + EmailVerification y envía verificación', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: VALID });
    expect(res.statusCode).toBe(201);
    const tenantId = res.json().tenantId;
    const tenant = await testPrisma.tenant.findUnique({ where: { id: tenantId } });
    expect(tenant?.status).toBe('pending_verification');
    expect(await testPrisma.panelUser.findUnique({ where: { email: VALID.email } })).not.toBeNull();
    const ev = await testPrisma.emailVerification.findFirst({ where: { tenantId } });
    expect(ev).not.toBeNull();
    expect(mail.sent[0].to).toBe(VALID.email);
    expect(mail.sent[0].body).toContain(ev!.token);
  });

  it('email duplicado → 409 sin tenant huérfano (atomicidad)', async () => {
    await app.inject({ method: 'POST', url: '/auth/signup', payload: VALID });
    const before = await testPrisma.tenant.count();
    const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: { ...VALID, businessName: 'Otro' } });
    expect(res.statusCode).toBe(409);
    expect(await testPrisma.tenant.count()).toBe(before); // no se creó tenant huérfano
  });

  it('body inválido → 400; industry fuera del enum → 400; password corta → 400', async () => {
    expect((await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'x' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/auth/signup', payload: { ...VALID, industry: 'otra' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/auth/signup', payload: { ...VALID, password: 'corta' } })).statusCode).toBe(400);
  });

  it('rate-limit: 6.º signup desde la misma IP → 429', async () => {
    let last;
    for (let i = 0; i < 6; i++) {
      last = await app.inject({
        method: 'POST', url: '/auth/signup',
        headers: { 'x-forwarded-for': '198.51.100.9' }, remoteAddress: '198.51.100.9',
        payload: { ...VALID, email: `u${i}@negocio.com`, businessName: `Negocio ${i}` },
      });
    }
    expect(last!.statusCode).toBe(429);
  });
});
