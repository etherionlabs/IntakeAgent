import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildServer } from '../src/server';
import { seedTenantAndUser, loginCookie, cleanupDb, TEST_JWT_SECRET, testPrisma, TEST_TENANT_ID } from './helpers/app';
import { seedTestTenantSettings } from '../../tests/helpers/db';
import { deriveStep } from '../src/routes/onboarding';

describe('deriveStep', () => {
  it('deriva el primer paso pendiente', () => {
    expect(deriveStep('pending_verification', null, null)).toBe('verify_email');
    expect(deriveStep('verified', null, null)).toBe('subscription');
    expect(deriveStep('verified', 'active', null)).toBe('provisioning');
    expect(deriveStep('provisioning', 'active', null)).toBe('provisioning');
    expect(deriveStep('active', 'active', null)).toBe('business');
    expect(deriveStep('active', 'active', { businessDone: true })).toBe('welcome');
    expect(deriveStep('active', 'active', { businessDone: true, welcomeDone: true, schemaDone: true })).toBe('whatsapp');
    expect(deriveStep('active', 'active', { businessDone: true, welcomeDone: true, schemaDone: true, whatsappLinked: true, testDone: true, completed: true })).toBe('done');
  });
});

describe('onboarding endpoints', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  beforeEach(async () => {
    await seedTenantAndUser(); // tenant active + sub active
    await seedTestTenantSettings();
    await testPrisma.tenant.update({ where: { id: TEST_TENANT_ID }, data: { status: 'active', onboarding: {} } });
    app = await buildServer({ jwtSecret: TEST_JWT_SECRET });
  });
  afterAll(async () => { await cleanupDb(); });

  it('GET /onboarding/state devuelve el paso pendiente', async () => {
    const { headers } = await loginCookie(app);
    const res = await app.inject({ method: 'GET', url: '/onboarding/state', headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().step).toBe('business');
  });

  it('PATCH welcome persiste en TenantSettings y marca el flag (reanuda al siguiente)', async () => {
    const { headers, mutatingHeaders } = await loginCookie(app);
    await app.inject({ method: 'PATCH', url: '/onboarding/business', headers: mutatingHeaders, payload: { businessName: 'Nuevo Nombre' } });
    await app.inject({ method: 'PATCH', url: '/onboarding/welcome', headers: mutatingHeaders, payload: { welcome: 'Hola nuevo' } });
    const s = await testPrisma.tenantSettings.findUnique({ where: { tenantId: TEST_TENANT_ID } });
    expect(s?.welcomeTemplate).toBe('Hola nuevo');
    expect(s?.businessName).toBe('Nuevo Nombre');
    const state = await app.inject({ method: 'GET', url: '/onboarding/state', headers });
    expect(state.json().step).toBe('schema'); // saltó los dos hechos
  });

  it('flag whatsapp/test + complete avanzan el estado', async () => {
    const { headers, mutatingHeaders } = await loginCookie(app);
    await app.inject({ method: 'PATCH', url: '/onboarding/business', headers: mutatingHeaders, payload: { businessName: 'N' } });
    await app.inject({ method: 'PATCH', url: '/onboarding/welcome', headers: mutatingHeaders, payload: { welcome: 'h' } });
    await app.inject({ method: 'PATCH', url: '/onboarding/schema', headers: mutatingHeaders, payload: { intakeSchema: { sections: [] } } });
    await app.inject({ method: 'POST', url: '/onboarding/flag', headers: mutatingHeaders, payload: { whatsappLinked: true } });
    await app.inject({ method: 'POST', url: '/onboarding/flag', headers: mutatingHeaders, payload: { testDone: true } });
    let state = await app.inject({ method: 'GET', url: '/onboarding/state', headers });
    expect(state.json().step).toBe('checklist');
    await app.inject({ method: 'POST', url: '/onboarding/complete', headers: mutatingHeaders });
    state = await app.inject({ method: 'GET', url: '/onboarding/state', headers });
    expect(state.json().step).toBe('done');
  });
});
