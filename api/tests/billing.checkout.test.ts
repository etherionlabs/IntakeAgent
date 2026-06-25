import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { buildServer } from '../src/server';
import { seedTenantAndUser, loginCookie, cleanupDb, TEST_JWT_SECRET, testPrisma, TEST_TENANT_ID } from './helpers/app';
import { seedTestPlan, TEST_PLAN_ID } from '../../tests/helpers/db';
import type { StripeLike } from '../src/billing/stripe';

function mockStripe() {
  const calls: any = { customers: [], checkout: [], portal: [] };
  const stripe = {
    customers: { create: vi.fn(async (p: any) => { calls.customers.push(p); return { id: 'cus_mock' }; }) },
    checkout: { sessions: { create: vi.fn(async (p: any) => { calls.checkout.push(p); return { id: 'cs_1', url: 'https://checkout.stripe/x' }; }) } },
    billingPortal: { sessions: { create: vi.fn(async (p: any) => { calls.portal.push(p); return { url: 'https://portal.stripe/y' }; }) } },
    webhooks: { constructEvent: vi.fn() },
  } as unknown as StripeLike;
  return { stripe, calls };
}

describe('billing checkout/portal/status', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let mock: ReturnType<typeof mockStripe>;

  beforeEach(async () => {
    await seedTenantAndUser();
    await seedTestPlan();
    mock = mockStripe();
    app = await buildServer({ jwtSecret: TEST_JWT_SECRET, stripe: mock.stripe });
  });
  afterAll(async () => { await cleanupDb(); });

  it('checkout sin token → 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/billing/checkout' });
    expect(res.statusCode).toBe(401);
  });

  it('checkout crea Customer (metadata.tenantId), persiste Subscription incomplete y crea la sesión', async () => {
    const { mutatingHeaders } = await loginCookie(app);
    const res = await app.inject({ method: 'POST', url: '/billing/checkout', headers: mutatingHeaders });
    expect(res.statusCode).toBe(200);
    expect(res.json().url).toBe('https://checkout.stripe/x');
    expect(mock.calls.customers[0].metadata.tenantId).toBe(TEST_TENANT_ID);
    const session = mock.calls.checkout[0];
    expect(session.mode).toBe('subscription');
    expect(session.client_reference_id).toBe(TEST_TENANT_ID);
    expect(session.line_items[0].price).toBe('price_test');
    expect(session.subscription_data).toBeUndefined(); // trialDays=0 → sin trial
    const sub = await testPrisma.subscription.findUnique({ where: { tenantId: TEST_TENANT_ID } });
    expect(sub?.status).toBe('incomplete');
    expect(sub?.stripeCustomerId).toBe('cus_mock');
  });

  it('reutiliza el Customer existente (no lo crea dos veces)', async () => {
    const { mutatingHeaders } = await loginCookie(app);
    await app.inject({ method: 'POST', url: '/billing/checkout', headers: mutatingHeaders });
    await app.inject({ method: 'POST', url: '/billing/checkout', headers: mutatingHeaders });
    expect(mock.calls.customers).toHaveLength(1);
  });

  it('incluye trial_period_days cuando trialDays > 0', async () => {
    await testPrisma.plan.update({ where: { id: TEST_PLAN_ID }, data: { trialDays: 7 } });
    const { mutatingHeaders } = await loginCookie(app);
    await app.inject({ method: 'POST', url: '/billing/checkout', headers: mutatingHeaders });
    expect(mock.calls.checkout[0].subscription_data.trial_period_days).toBe(7);
  });

  it('portal sin suscripción → 409; con suscripción → url', async () => {
    const { mutatingHeaders } = await loginCookie(app);
    const r1 = await app.inject({ method: 'POST', url: '/billing/portal', headers: mutatingHeaders });
    expect(r1.statusCode).toBe(409);
    await app.inject({ method: 'POST', url: '/billing/checkout', headers: mutatingHeaders }); // crea sub+customer
    const r2 = await app.inject({ method: 'POST', url: '/billing/portal', headers: mutatingHeaders });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().url).toBe('https://portal.stripe/y');
  });

  it('status refleja el espejo local', async () => {
    const { headers, mutatingHeaders } = await loginCookie(app);
    await app.inject({ method: 'POST', url: '/billing/checkout', headers: mutatingHeaders });
    const res = await app.inject({ method: 'GET', url: '/billing/status', headers });
    expect(res.json().status).toBe('incomplete');
    expect(res.json().planName).toBe('Plan Test');
  });
});
