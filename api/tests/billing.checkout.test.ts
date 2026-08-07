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
    await seedTenantAndUser({ activeSub: false });
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

  // Un plan sembrado sin pensar en el trial le cobra el día 1 a quien le
  // prometimos 14 días de prueba. Por eso el default vive en el schema y no en
  // el criterio de quien siembra.
  it('aplica los días de prueba del plan sin que haya que acordarse de fijarlos', async () => {
    const plan = await testPrisma.plan.findUnique({ where: { id: TEST_PLAN_ID } });
    expect(plan?.trialDays).toBe(14);
    const { mutatingHeaders } = await loginCookie(app);
    await app.inject({ method: 'POST', url: '/billing/checkout', headers: mutatingHeaders });
    expect(mock.calls.checkout[0].subscription_data.trial_period_days).toBe(14);
  });

  it('trialDays=0 → sin trial (plan explícitamente sin prueba)', async () => {
    await testPrisma.plan.update({ where: { id: TEST_PLAN_ID }, data: { trialDays: 0 } });
    const { mutatingHeaders } = await loginCookie(app);
    await app.inject({ method: 'POST', url: '/billing/checkout', headers: mutatingHeaders });
    expect(mock.calls.checkout[0].subscription_data).toBeUndefined();
  });

  // El precio cambia por país. Con tres planes activos, "el plan activo" no
  // identifica a ninguno: hay que elegir por el mercado del tenant o se le cobra
  // a un colombiano el precio de Estados Unidos.
  describe('elección de plan por mercado', () => {
    async function seedTresMercados() {
      await testPrisma.plan.createMany({
        data: [
          { stripePriceId: 'price_us', market: 'US', name: 'Intake US', amountCents: 9900, currency: 'usd', interval: 'month' },
          { stripePriceId: 'price_co', market: 'CO', name: 'Intake CO', amountCents: 5900, currency: 'usd', interval: 'month' },
        ],
      });
    }

    it('cobra el plan del mercado del tenant, no el primero de la tabla', async () => {
      await seedTresMercados(); // el de MX ya lo sembró seedTestPlan
      await testPrisma.tenant.update({ where: { id: TEST_TENANT_ID }, data: { market: 'CO' } });
      const { mutatingHeaders } = await loginCookie(app);
      const res = await app.inject({ method: 'POST', url: '/billing/checkout', headers: mutatingHeaders });
      expect(res.statusCode).toBe(200);
      expect(mock.calls.checkout[0].line_items[0].price).toBe('price_co');
    });

    it('un tenant de otro mercado recibe SU precio, con los mismos planes sembrados', async () => {
      await seedTresMercados();
      await testPrisma.tenant.update({ where: { id: TEST_TENANT_ID }, data: { market: 'US' } });
      const { mutatingHeaders } = await loginCookie(app);
      await app.inject({ method: 'POST', url: '/billing/checkout', headers: mutatingHeaders });
      expect(mock.calls.checkout[0].line_items[0].price).toBe('price_us');
    });

    it('tenant sin mercado → 409 y NO se crea Customer (no cobrar > cobrar mal)', async () => {
      await testPrisma.tenant.update({ where: { id: TEST_TENANT_ID }, data: { market: null } });
      const { mutatingHeaders } = await loginCookie(app);
      const res = await app.inject({ method: 'POST', url: '/billing/checkout', headers: mutatingHeaders });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toMatch(/mercado/i);
      expect(mock.calls.customers).toHaveLength(0);
      expect(mock.calls.checkout).toHaveLength(0);
    });

    it('mercado sin plan activo → 409 en vez de caer en el plan de otro país', async () => {
      await testPrisma.tenant.update({ where: { id: TEST_TENANT_ID }, data: { market: 'US' } });
      const res0 = await loginCookie(app);
      const res = await app.inject({ method: 'POST', url: '/billing/checkout', headers: res0.mutatingHeaders });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toMatch(/US/);
      expect(mock.calls.checkout).toHaveLength(0);
    });

    it('un plan inactivo no se cobra aunque sea el único de ese mercado', async () => {
      await testPrisma.plan.update({ where: { id: TEST_PLAN_ID }, data: { active: false } });
      const { mutatingHeaders } = await loginCookie(app);
      const res = await app.inject({ method: 'POST', url: '/billing/checkout', headers: mutatingHeaders });
      expect(res.statusCode).toBe(409);
    });

    it('el intervalo desempata entre el mensual y el anual del mismo mercado', async () => {
      await testPrisma.plan.create({
        data: { stripePriceId: 'price_mx_year', market: 'MX', name: 'Intake MX anual', amountCents: 69000, currency: 'usd', interval: 'year' },
      });
      const { mutatingHeaders } = await loginCookie(app);
      const res = await app.inject({ method: 'POST', url: '/billing/checkout', headers: mutatingHeaders, payload: { interval: 'year' } });
      expect(res.statusCode).toBe(200);
      expect(mock.calls.checkout[0].line_items[0].price).toBe('price_mx_year');
    });

    it('la base de datos impide dos planes activos del mismo mercado e intervalo', async () => {
      // La invariante que hace determinista la elección: si se puede sembrar un
      // segundo plan activo de MX, volvemos a tener el bug original.
      await expect(
        testPrisma.plan.create({
          data: { stripePriceId: 'price_mx_dup', market: 'MX', name: 'Intake MX bis', amountCents: 7900, currency: 'usd', interval: 'month' },
        }),
      ).rejects.toThrow();
    });
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
