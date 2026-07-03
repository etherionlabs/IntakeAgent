import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import Stripe from 'stripe';
import { buildServer } from '../src/server';
import { cleanupDb, seedTestTenant, TEST_JWT_SECRET, testPrisma, TEST_TENANT_ID } from './helpers/app';
import { seedTestPlan, TEST_PLAN_ID } from '../../tests/helpers/db';
import type { StripeLike } from '../src/billing/stripe';

const WHSEC = 'whsec_testsecret';
const realStripe = new Stripe('sk_test_dummy', { apiVersion: '2025-08-27.basil' as any });

describe('webhook checkout.session.completed → provisioning', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  const provision = vi.fn(async () => {});

  beforeEach(async () => {
    process.env.STRIPE_WEBHOOK_SECRET = WHSEC;
    delete process.env.TENANT_MANAGER_URL; delete process.env.WORKER_INTERNAL_URL;
    provision.mockClear();
    await cleanupDb();
    await seedTestTenant();
    await testPrisma.tenant.update({ where: { id: TEST_TENANT_ID }, data: { status: 'verified' } });
    await seedTestPlan();
    await testPrisma.subscription.create({ data: { tenantId: TEST_TENANT_ID, planId: TEST_PLAN_ID, stripeCustomerId: 'cus_x', status: 'incomplete' } });
    app = await buildServer({ jwtSecret: TEST_JWT_SECRET, stripe: realStripe as unknown as StripeLike, provision });
  });
  afterAll(async () => { await cleanupDb(); });

  function post(id: string) {
    const payload = JSON.stringify({ id, object: 'event', type: 'checkout.session.completed', created: 1700000000, data: { object: { client_reference_id: TEST_TENANT_ID, subscription: 'sub_1', customer: 'cus_x' } } });
    const header = realStripe.webhooks.generateTestHeaderString({ payload, secret: WHSEC });
    return app.inject({ method: 'POST', url: '/billing/webhook', headers: { 'stripe-signature': header, 'content-type': 'application/json' }, payload });
  }

  it('checkout completado aprovisiona una vez; evento duplicado no re-aprovisiona', async () => {
    await post('evt_a');
    expect(provision).toHaveBeenCalledWith(TEST_TENANT_ID);
    expect(provision).toHaveBeenCalledTimes(1);
    await post('evt_a'); // mismo event.id → idempotente (StripeEvent dedup)
    expect(provision).toHaveBeenCalledTimes(1);
  });
});
