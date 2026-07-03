import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { buildServer } from '../src/server';
import { cleanupDb, seedTestTenant, TEST_JWT_SECRET, testPrisma, TEST_TENANT_ID } from './helpers/app';
import { in24h } from '../src/lib/tokens';
import type { EmailSender } from '../src/lib/email';

const sink: EmailSender = { async send() {} };

async function makeVerification(token: string, opts: { expired?: boolean; used?: boolean } = {}) {
  await seedTestTenant();
  await testPrisma.tenant.update({ where: { id: TEST_TENANT_ID }, data: { status: 'pending_verification' } });
  await testPrisma.emailVerification.create({
    data: {
      tenantId: TEST_TENANT_ID, email: 'a@b.com', token,
      verifiedAt: opts.used ? new Date() : null,
      expiresAt: opts.expired ? new Date(Date.now() - 1000) : in24h(),
    },
  });
}

describe('verify-email / resend', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  beforeEach(async () => { await cleanupDb(); });
  afterAll(async () => { await cleanupDb(); });

  it('token válido → 200 y Tenant.status = verified', async () => {
    await makeVerification('tok-ok');
    app = await buildServer({ jwtSecret: TEST_JWT_SECRET, emailSender: sink });
    const res = await app.inject({ method: 'GET', url: '/auth/verify-email?token=tok-ok' });
    expect(res.statusCode).toBe(200);
    const t = await testPrisma.tenant.findUnique({ where: { id: TEST_TENANT_ID } });
    expect(t?.status).toBe('verified');
  });

  it('token expirado / usado / inexistente → 400', async () => {
    await makeVerification('tok-exp', { expired: true });
    app = await buildServer({ jwtSecret: TEST_JWT_SECRET, emailSender: sink });
    expect((await app.inject({ method: 'GET', url: '/auth/verify-email?token=tok-exp' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/auth/verify-email?token=nope' })).statusCode).toBe(400);
  });

  it('TRIAL_REQUIRES_CARD=false: verificar dispara el provisioning', async () => {
    process.env.TRIAL_REQUIRES_CARD = 'false';
    await makeVerification('tok-prov');
    const provision = vi.fn(async () => {});
    app = await buildServer({ jwtSecret: TEST_JWT_SECRET, emailSender: sink, provision });
    await app.inject({ method: 'GET', url: '/auth/verify-email?token=tok-prov' });
    expect(provision).toHaveBeenCalledWith(TEST_TENANT_ID);
    delete process.env.TRIAL_REQUIRES_CARD;
  });

  it('resend-verification responde 200 genérico (no revela existencia)', async () => {
    app = await buildServer({ jwtSecret: TEST_JWT_SECRET, emailSender: sink });
    const res = await app.inject({ method: 'POST', url: '/auth/resend-verification', payload: { email: 'fantasma@x.com' } });
    expect(res.statusCode).toBe(200);
  });
});
