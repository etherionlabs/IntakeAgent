import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import Stripe from 'stripe';
import { buildServer } from '../src/server';
import { seedTenantAndUser, cleanupDb, TEST_JWT_SECRET, testPrisma, TEST_TENANT_ID } from './helpers/app';
import { seedTestPlan, TEST_PLAN_ID } from '../../tests/helpers/db';
import type { StripeLike } from '../src/billing/stripe';

const WHSEC = 'whsec_testsecret';
// Instancia real solo para firmar/verificar (constructEvent y generateTestHeaderString
// son cripto puro, sin red). No se llaman customers/checkout aquí.
const realStripe = new Stripe('sk_test_dummy', { apiVersion: '2025-08-27.basil' as any });

async function seedSub(status = 'incomplete', currentPeriodEnd: Date | null = null) {
  await testPrisma.subscription.create({
    data: { tenantId: TEST_TENANT_ID, planId: TEST_PLAN_ID, stripeCustomerId: 'cus_x', status, currentPeriodEnd },
  });
}

function event(id: string, type: string, object: any) {
  return { id, object: 'event', type, data: { object }, created: 1700000000 };
}

describe('billing webhook (firma + idempotencia + estados)', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    process.env.STRIPE_WEBHOOK_SECRET = WHSEC;
    process.env.BILLING_GRACE_DAYS = '3';
    delete process.env.TENANT_MANAGER_URL; delete process.env.WORKER_INTERNAL_URL;
    await seedTenantAndUser({ activeSub: false });
    await seedTestPlan();
    app = await buildServer({ jwtSecret: TEST_JWT_SECRET, stripe: realStripe as unknown as StripeLike });
  });
  afterAll(async () => { await cleanupDb(); });

  async function post(evt: object, opts: { badSig?: boolean } = {}) {
    const payload = JSON.stringify(evt);
    const header = opts.badSig
      ? 't=1,v1=deadbeef'
      : realStripe.webhooks.generateTestHeaderString({ payload, secret: WHSEC });
    return app.inject({
      method: 'POST', url: '/billing/webhook',
      headers: { 'stripe-signature': header, 'content-type': 'application/json' },
      payload,
    });
  }

  it('firma inválida → 400 sin cambios', async () => {
    await seedSub();
    const res = await post(event('evt_bad', 'checkout.session.completed', { client_reference_id: TEST_TENANT_ID, subscription: 'sub_1' }), { badSig: true });
    expect(res.statusCode).toBe(400);
    expect(await testPrisma.stripeEvent.count()).toBe(0);
  });

  it('checkout.session.completed → active + vincula stripeSubscriptionId', async () => {
    await seedSub();
    const res = await post(event('evt_1', 'checkout.session.completed', { client_reference_id: TEST_TENANT_ID, subscription: 'sub_1', customer: 'cus_x' }));
    expect(res.statusCode).toBe(200);
    const sub = await testPrisma.subscription.findUnique({ where: { tenantId: TEST_TENANT_ID } });
    expect(sub?.status).toBe('active');
    expect(sub?.stripeSubscriptionId).toBe('sub_1');
  });

  it('idempotencia: mismo event.id no reprocesa', async () => {
    await seedSub();
    const evt = event('evt_dup', 'invoice.payment_failed', { customer: 'cus_x' });
    await post(evt);
    const res2 = await post(evt);
    expect(res2.statusCode).toBe(200);
    expect(res2.json().duplicate).toBe(true);
    expect(await testPrisma.stripeEvent.count()).toBe(1);
  });

  it('invoice.payment_failed → past_due + gracePeriodEndsAt', async () => {
    await seedSub('active');
    await post(event('evt_pf', 'invoice.payment_failed', { customer: 'cus_x' }));
    const sub = await testPrisma.subscription.findUnique({ where: { tenantId: TEST_TENANT_ID } });
    expect(sub?.status).toBe('past_due');
    expect(sub?.gracePeriodEndsAt).toBeTruthy();
  });

  it('customer.subscription.deleted → canceled', async () => {
    await seedSub('active');
    await post(event('evt_del', 'customer.subscription.deleted', { customer: 'cus_x' }));
    const sub = await testPrisma.subscription.findUnique({ where: { tenantId: TEST_TENANT_ID } });
    expect(sub?.status).toBe('canceled');
  });

  it('invoice.payment_succeeded → active y limpia gracia', async () => {
    await seedSub('past_due', null);
    await testPrisma.subscription.update({ where: { tenantId: TEST_TENANT_ID }, data: { gracePeriodEndsAt: new Date() } });
    await post(event('evt_ps', 'invoice.payment_succeeded', { customer: 'cus_x' }));
    const sub = await testPrisma.subscription.findUnique({ where: { tenantId: TEST_TENANT_ID } });
    expect(sub?.status).toBe('active');
    expect(sub?.gracePeriodEndsAt).toBeNull();
  });

  it('transición a no-operativo dispara /internal/tenant/suspend en el worker', async () => {
    process.env.TENANT_MANAGER_URL = 'http://worker:3002';
    process.env.INTERNAL_API_TOKEN = 'tok';
    const hits: string[] = [];
    const fetcher = (async (url: any) => { hits.push(String(url)); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
    app = await buildServer({ jwtSecret: TEST_JWT_SECRET, stripe: realStripe as unknown as StripeLike, fetcher });
    await seedSub('active');
    await post(event('evt_susp', 'customer.subscription.deleted', { customer: 'cus_x' }));
    expect(hits.some((u) => u.endsWith('/internal/tenant/suspend'))).toBe(true);
  });

  it('subscription.updated fuera de orden (periodo más viejo) se ignora', async () => {
    const future = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    await seedSub('active', future);
    const olderUnix = Math.floor((Date.now() - 24 * 3600 * 1000) / 1000);
    await post(event('evt_old', 'customer.subscription.updated', { customer: 'cus_x', status: 'past_due', current_period_end: olderUnix }));
    const sub = await testPrisma.subscription.findUnique({ where: { tenantId: TEST_TENANT_ID } });
    expect(sub?.status).toBe('active'); // no retrocedió
  });
});
