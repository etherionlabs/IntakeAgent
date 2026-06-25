import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildServer } from '../src/server';
import { seedTenantAndUser, loginCookie, cleanupDb, TEST_JWT_SECRET, testPrisma, TEST_TENANT_ID } from './helpers/app';
import { seedTestPlan, TEST_PLAN_ID } from '../../tests/helpers/db';

async function setSub(status: string, gracePeriodEndsAt: Date | null = null) {
  await seedTestPlan();
  await testPrisma.subscription.upsert({
    where: { tenantId: TEST_TENANT_ID },
    update: { status, gracePeriodEndsAt },
    create: { tenantId: TEST_TENANT_ID, planId: TEST_PLAN_ID, stripeCustomerId: 'cus_e', status, gracePeriodEndsAt },
  });
}

describe('enforcement de suscripción (402)', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  beforeEach(async () => {
    await seedTenantAndUser({ activeSub: false });
    app = await buildServer({ jwtSecret: TEST_JWT_SECRET });
  });
  afterAll(async () => { await cleanupDb(); });

  it('sin suscripción → /jobs 402; /billing, /auth, /health accesibles', async () => {
    const { headers } = await loginCookie(app);
    expect((await app.inject({ method: 'GET', url: '/jobs', headers })).statusCode).toBe(402);
    expect((await app.inject({ method: 'GET', url: '/billing/status', headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });

  it('active / trialing → /jobs 200', async () => {
    for (const status of ['active', 'trialing']) {
      await setSub(status);
      const { headers } = await loginCookie(app);
      expect((await app.inject({ method: 'GET', url: '/jobs', headers })).statusCode).toBe(200);
    }
  });

  it('canceled → 402', async () => {
    await setSub('canceled');
    const { headers } = await loginCookie(app);
    const res = await app.inject({ method: 'GET', url: '/jobs', headers });
    expect(res.statusCode).toBe(402);
    expect(res.json().error).toBe('subscription_inactive');
  });

  it('past_due dentro de gracia → 200; fuera → 402', async () => {
    await setSub('past_due', new Date(Date.now() + 3600_000));
    let { headers } = await loginCookie(app);
    expect((await app.inject({ method: 'GET', url: '/jobs', headers })).statusCode).toBe(200);

    await setSub('past_due', new Date(Date.now() - 3600_000));
    ({ headers } = await loginCookie(app));
    expect((await app.inject({ method: 'GET', url: '/jobs', headers })).statusCode).toBe(402);
  });
});
