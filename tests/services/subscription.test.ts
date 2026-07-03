import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, cleanupDb, seedTestTenant, seedTestPlan, TEST_TENANT_ID, TEST_PLAN_ID } from '../helpers/db';

describe('Subscription / Plan / StripeEvent', () => {
  beforeEach(async () => { await cleanupDb(); await seedTestTenant(); await seedTestPlan(); });
  afterAll(async () => { await cleanupDb(); });

  it('relación 1:1 Tenant↔Subscription', async () => {
    await testPrisma.subscription.create({
      data: { tenantId: TEST_TENANT_ID, planId: TEST_PLAN_ID, stripeCustomerId: 'cus_1', status: 'active' },
    });
    const t = await testPrisma.tenant.findUnique({ where: { id: TEST_TENANT_ID }, include: { subscription: true } });
    expect(t?.subscription?.status).toBe('active');
  });

  it('tenantId y stripeCustomerId son únicos', async () => {
    await testPrisma.subscription.create({ data: { tenantId: TEST_TENANT_ID, planId: TEST_PLAN_ID, stripeCustomerId: 'cus_1', status: 'active' } });
    await expect(
      testPrisma.subscription.create({ data: { tenantId: TEST_TENANT_ID, planId: TEST_PLAN_ID, stripeCustomerId: 'cus_2', status: 'active' } }),
    ).rejects.toThrow();
  });

  it('StripeEvent con PK duplicada lanza (idempotencia a nivel DB)', async () => {
    await testPrisma.stripeEvent.create({ data: { id: 'evt_1', type: 'checkout.session.completed' } });
    await expect(
      testPrisma.stripeEvent.create({ data: { id: 'evt_1', type: 'checkout.session.completed' } }),
    ).rejects.toThrow();
  });
});
