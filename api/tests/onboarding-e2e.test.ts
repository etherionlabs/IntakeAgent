import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import Stripe from 'stripe';
import { buildServer } from '../src/server';
import { cleanupDb, TEST_JWT_SECRET, testPrisma } from './helpers/app';
import { seedTestPlan, TEST_PLAN_ID } from '../../tests/helpers/db';
import { provisionTenant } from '../src/onboarding/provision';
import type { StripeLike } from '../src/billing/stripe';
import type { EmailSender } from '../src/lib/email';

const WHSEC = 'whsec_testsecret';
const realStripe = new Stripe('sk_test_dummy', { apiVersion: '2025-08-27.basil' as any });
const sink: EmailSender = { async send() {} };
const SIGNUP = { email: 'dueno@negocio.com', password: 'pw1234567890', businessName: 'Tapicería Sol', industry: 'tapiceria' };

async function loginCookieFor(app: any, email: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  const c = res.cookies as Array<{ name: string; value: string }>;
  const cookie = `intake_session=${c.find((x) => x.name === 'intake_session')?.value}; intake_csrf=${c.find((x) => x.name === 'intake_csrf')?.value}`;
  const csrf = c.find((x) => x.name === 'intake_csrf')?.value;
  return { headers: { cookie }, mutating: { cookie, 'x-csrf-token': csrf! } };
}

/** Recorre el wizard desde 'business' hasta 'done'. */
async function walkWizard(app: any, m: Record<string, string>, h: Record<string, string>) {
  await app.inject({ method: 'PATCH', url: '/onboarding/business', headers: m, payload: { businessName: 'Tapicería Sol', ownerPhoneE164: '+5215551112233' } });
  await app.inject({ method: 'PATCH', url: '/onboarding/welcome', headers: m, payload: { welcome: 'Hola, soy el bot.' } });
  await app.inject({ method: 'PATCH', url: '/onboarding/schema', headers: m, payload: {} });
  await app.inject({ method: 'POST', url: '/onboarding/flag', headers: m, payload: { whatsappLinked: true } });
  await app.inject({ method: 'POST', url: '/onboarding/flag', headers: m, payload: { testDone: true } });
  await app.inject({ method: 'POST', url: '/onboarding/complete', headers: m });
  return app.inject({ method: 'GET', url: '/onboarding/state', headers: h });
}

describe('onboarding E2E', () => {
  const addTenant = vi.fn(async () => {});
  beforeEach(async () => { await cleanupDb(); await seedTestPlan(); addTenant.mockClear(); process.env.STRIPE_WEBHOOK_SECRET = WHSEC; });
  afterAll(async () => { await cleanupDb(); });

  it('TRIAL_REQUIRES_CARD=true: signup → verify → webhook Checkout → provisioning → wizard → done', async () => {
    process.env.TRIAL_REQUIRES_CARD = 'true';
    const provision = (id: string) => provisionTenant(testPrisma, id, { addTenant }).then(() => {});
    const app = await buildServer({ jwtSecret: TEST_JWT_SECRET, emailSender: sink, stripe: realStripe as unknown as StripeLike, provision });

    // signup
    const signup = await app.inject({ method: 'POST', url: '/auth/signup', payload: SIGNUP });
    expect(signup.statusCode).toBe(201);
    const tenantId = signup.json().tenantId;

    // verify email
    const ev = await testPrisma.emailVerification.findFirst({ where: { tenantId } });
    const verify = await app.inject({ method: 'GET', url: `/auth/verify-email?token=${ev!.token}` });
    expect(verify.statusCode).toBe(200);
    expect((await testPrisma.tenant.findUnique({ where: { id: tenantId } }))?.status).toBe('verified');

    // checkout creó la Subscription (simulada) → webhook la confirma y aprovisiona
    await testPrisma.subscription.create({ data: { tenantId, planId: TEST_PLAN_ID, stripeCustomerId: 'cus_x', status: 'incomplete' } });
    const payload = JSON.stringify({ id: 'evt_e2e', object: 'event', type: 'checkout.session.completed', created: 1700000000, data: { object: { client_reference_id: tenantId, subscription: 'sub_1', customer: 'cus_x' } } });
    const header = realStripe.webhooks.generateTestHeaderString({ payload, secret: WHSEC });
    await app.inject({ method: 'POST', url: '/billing/webhook', headers: { 'stripe-signature': header, 'content-type': 'application/json' }, payload });

    expect(addTenant).toHaveBeenCalledWith(tenantId);
    expect((await testPrisma.tenant.findUnique({ where: { id: tenantId } }))?.status).toBe('active');
    expect(await testPrisma.tenantSettings.findUnique({ where: { tenantId } })).not.toBeNull();

    // wizard hasta done
    const { headers, mutating } = await loginCookieFor(app, SIGNUP.email, SIGNUP.password);
    const start = await app.inject({ method: 'GET', url: '/onboarding/state', headers });
    expect(start.json().step).toBe('business');
    const final = await walkWizard(app, mutating, headers);
    expect(final.json().step).toBe('done');
    delete process.env.TRIAL_REQUIRES_CARD;
  });

  it('TRIAL_REQUIRES_CARD=false: la verificación de email dispara el provisioning', async () => {
    process.env.TRIAL_REQUIRES_CARD = 'false';
    const provision = (id: string) => provisionTenant(testPrisma, id, { addTenant }).then(() => {});
    const app = await buildServer({ jwtSecret: TEST_JWT_SECRET, emailSender: sink, provision });

    const signup = await app.inject({ method: 'POST', url: '/auth/signup', payload: { ...SIGNUP, email: 'sin-tarjeta@negocio.com' } });
    const tenantId = signup.json().tenantId;
    const ev = await testPrisma.emailVerification.findFirst({ where: { tenantId } });
    await app.inject({ method: 'GET', url: `/auth/verify-email?token=${ev!.token}` });

    expect(addTenant).toHaveBeenCalledWith(tenantId);
    expect((await testPrisma.tenant.findUnique({ where: { id: tenantId } }))?.status).toBe('active');
    delete process.env.TRIAL_REQUIRES_CARD;
  });
});
