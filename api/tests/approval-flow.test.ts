import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { buildServer } from '../src/server';
import { cleanupDb, TEST_JWT_SECRET, testPrisma, TEST_TENANT_ID, seedTenantAndUser } from './helpers/app';
import { checkTenantAccess } from '../src/billing/access';
import { deriveStep } from '../src/routes/onboarding';
import type { EmailSender } from '../src/lib/email';

const SIGNUP = { email: 'nuevo@negocio.com', password: 'pw1234567890', businessName: 'Paquetería Luna', industry: 'paqueteria', acceptedTerms: true, acceptedWhatsappRisk: true };

async function makeOperator() {
  const hash = await bcrypt.hash('pw1234567890', 8);
  return testPrisma.panelUser.create({
    data: { tenantId: TEST_TENANT_ID, username: 'op', email: 'op@plat.com', passwordHash: hash, role: 'operator' },
  });
}

async function login(app: any, email: string, password = 'pw1234567890') {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  const c = res.cookies as Array<{ name: string; value: string }>;
  const cookie = `intake_session=${c.find((x) => x.name === 'intake_session')?.value}; intake_csrf=${c.find((x) => x.name === 'intake_csrf')?.value}`;
  return { headers: { cookie }, mutating: { cookie, 'x-csrf-token': c.find((x) => x.name === 'intake_csrf')?.value! } };
}

describe('v1 free: aprobación manual de cuentas (ACCESS_MODE=approval, default)', () => {
  const calls: string[] = [];
  const emails: Array<{ to: string; subject: string }> = [];
  const fetcher = (async (url: any) => { calls.push(String(url)); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }) as unknown as typeof fetch;
  const emailSender: EmailSender = { async send(to, subject) { emails.push({ to, subject }); } };
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    delete process.env.ACCESS_MODE; // default = approval
    process.env.TENANT_MANAGER_URL = 'http://worker:3002';
    process.env.INTERNAL_API_TOKEN = 'tok';
    calls.length = 0; emails.length = 0;
    await seedTenantAndUser(); // tenant de plataforma (aprobado) para el operador
    await makeOperator();
    // SIN provision inyectado: se prueba el provision por defecto con la compuerta
    // de aprobación (siembra plantilla; el alta en worker espera al approve).
    app = await buildServer({ jwtSecret: TEST_JWT_SECRET, fetcher, emailSender });
  });
  afterAll(async () => { await cleanupDb(); });

  it('signup → verify → wizard → awaiting_approval → approve → whatsapp y rutas abiertas', async () => {
    // Signup self-service: nace pendiente e inactivo (el worker no lo levanta).
    const signup = await app.inject({ method: 'POST', url: '/auth/signup', payload: SIGNUP });
    expect(signup.statusCode).toBe(201);
    const tenantId = signup.json().tenantId;
    let t = await testPrisma.tenant.findUnique({ where: { id: tenantId } });
    expect(t?.approvalStatus).toBe('pending');
    expect(t?.active).toBe(false);

    // Verificación: aprovisiona (siembra plantilla) SIN alta en el worker.
    const ev = await testPrisma.emailVerification.findFirst({ where: { tenantId } });
    expect((await app.inject({ method: 'GET', url: `/auth/verify-email?token=${ev!.token}` })).statusCode).toBe(200);
    t = await testPrisma.tenant.findUnique({ where: { id: tenantId } });
    expect(t?.status).toBe('active'); // aprovisionado (estado de onboarding)
    expect(await testPrisma.tenantSettings.findUnique({ where: { tenantId } })).not.toBeNull();
    expect(calls.some((u) => u.endsWith('/internal/tenant/add'))).toBe(false);

    // Pendiente: rutas de negocio 403; usage/billing/onboarding accesibles.
    const client = await login(app, SIGNUP.email);
    const jobs = await app.inject({ method: 'GET', url: '/jobs', headers: client.headers });
    expect(jobs.statusCode).toBe(403);
    expect(jobs.json().error).toBe('account_pending_approval');
    expect((await app.inject({ method: 'GET', url: '/usage', headers: client.headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/billing/status', headers: client.headers })).statusCode).toBe(200);

    // Wizard de config completo → la compuerta detiene en awaiting_approval.
    await app.inject({ method: 'PATCH', url: '/onboarding/business', headers: client.mutating, payload: { businessName: 'Paquetería Luna', ownerPhoneE164: '+5215551112233' } });
    await app.inject({ method: 'PATCH', url: '/onboarding/welcome', headers: client.mutating, payload: { welcome: 'Hola, soy el bot.' } });
    await app.inject({ method: 'PATCH', url: '/onboarding/schema', headers: client.mutating, payload: {} });
    let state = await app.inject({ method: 'GET', url: '/onboarding/state', headers: client.headers });
    expect(state.json().step).toBe('awaiting_approval');
    expect(state.json().mode).toBe('approval');

    // Aprobación del operador: activa, da de alta en el worker, audita y avisa.
    const op = await login(app, 'op@plat.com');
    const approve = await app.inject({ method: 'POST', url: `/admin/tenants/${tenantId}/approve`, headers: op.mutating });
    expect(approve.statusCode).toBe(200);
    t = await testPrisma.tenant.findUnique({ where: { id: tenantId } });
    expect(t?.approvalStatus).toBe('approved');
    expect(t?.active).toBe(true);
    expect(t?.approvedAt).not.toBeNull();
    expect(calls.some((u) => u.endsWith('/internal/tenant/add'))).toBe(true);
    expect(await testPrisma.operatorAuditLog.findFirst({ where: { tenantId, action: 'approve' } })).not.toBeNull();
    expect(emails.some((e) => e.to === SIGNUP.email && e.subject.includes('aprobada'))).toBe(true);

    // Cliente: sigue al paso whatsapp y las rutas de negocio abren.
    state = await app.inject({ method: 'GET', url: '/onboarding/state', headers: client.headers });
    expect(state.json().step).toBe('whatsapp');
    expect((await app.inject({ method: 'GET', url: '/jobs', headers: client.headers })).statusCode).toBe(200);
  });

  it('reject: bloquea con account_rejected, suspende en worker, audita y avisa', async () => {
    const signup = await app.inject({ method: 'POST', url: '/auth/signup', payload: { ...SIGNUP, email: 'spam@abuso.com' } });
    const tenantId = signup.json().tenantId;
    const ev = await testPrisma.emailVerification.findFirst({ where: { tenantId } });
    await app.inject({ method: 'GET', url: `/auth/verify-email?token=${ev!.token}` });

    const op = await login(app, 'op@plat.com');
    const reject = await app.inject({ method: 'POST', url: `/admin/tenants/${tenantId}/reject`, headers: op.mutating });
    expect(reject.statusCode).toBe(200);
    const t = await testPrisma.tenant.findUnique({ where: { id: tenantId } });
    expect(t?.approvalStatus).toBe('rejected');
    expect(t?.active).toBe(false);
    expect(await testPrisma.operatorAuditLog.findFirst({ where: { tenantId, action: 'reject' } })).not.toBeNull();

    const client = await login(app, 'spam@abuso.com');
    const jobs = await app.inject({ method: 'GET', url: '/jobs', headers: client.headers });
    expect(jobs.statusCode).toBe(403);
    expect(jobs.json().error).toBe('account_rejected');
  });

  it('límite mensual por tenant: set, reset a default y validación', async () => {
    const op = await login(app, 'op@plat.com');
    const set = await app.inject({ method: 'PATCH', url: `/admin/tenants/${TEST_TENANT_ID}/limit`, headers: op.mutating, payload: { monthlyRunLimit: 500 } });
    expect(set.statusCode).toBe(200);
    expect((await testPrisma.tenant.findUnique({ where: { id: TEST_TENANT_ID } }))?.monthlyRunLimit).toBe(500);
    expect(await testPrisma.operatorAuditLog.findFirst({ where: { tenantId: TEST_TENANT_ID, action: 'set_limit' } })).not.toBeNull();

    const reset = await app.inject({ method: 'PATCH', url: `/admin/tenants/${TEST_TENANT_ID}/limit`, headers: op.mutating, payload: { monthlyRunLimit: null } });
    expect(reset.statusCode).toBe(200);
    expect((await testPrisma.tenant.findUnique({ where: { id: TEST_TENANT_ID } }))?.monthlyRunLimit).toBeNull();

    expect((await app.inject({ method: 'PATCH', url: `/admin/tenants/${TEST_TENANT_ID}/limit`, headers: op.mutating, payload: { monthlyRunLimit: -5 } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: `/admin/tenants/${TEST_TENANT_ID}/limit`, headers: op.mutating, payload: { monthlyRunLimit: 2.5 } })).statusCode).toBe(400);
  });

  it('el listado /admin/tenants trae approvalStatus, límite y uso del mes', async () => {
    const op = await login(app, 'op@plat.com');
    const res = await app.inject({ method: 'GET', url: '/admin/tenants', headers: op.headers });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.defaultMonthlyLimit).toBeGreaterThan(0);
    const t = body.tenants.find((x: any) => x.id === TEST_TENANT_ID);
    expect(t.approvalStatus).toBe('approved');
    expect(t.monthUsed).toBe(0);
    expect(t.monthlyRunLimit).toBeNull();
  });

  it('/usage expone el plan gratuito con límite y consumo', async () => {
    const { headers } = await login(app, 'admin@test.local', 'pw1234567890');
    const res = await app.inject({ method: 'GET', url: '/usage', headers });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mode).toBe('approval');
    expect(body.plan.name).toBe('Gratuito');
    expect(body.plan.monthlyLimit).toBeGreaterThan(0);
    expect(body.plan.monthUsed).toBe(0);
  });
});

describe('checkTenantAccess (unidad)', () => {
  const sub = { status: 'active', gracePeriodEndsAt: null };

  it("modo approval (default): pending/rejected bloquean, approved permite, suspended manda", () => {
    delete process.env.ACCESS_MODE;
    expect(checkTenantAccess('t1', { approvalStatus: 'approved', status: 'active' }, null)).toEqual({ allowed: true });
    expect(checkTenantAccess('t1', { approvalStatus: 'pending', status: 'active' }, sub))
      .toEqual({ allowed: false, reason: 'pending_approval' });
    expect(checkTenantAccess('t1', { approvalStatus: 'rejected', status: 'active' }, sub))
      .toEqual({ allowed: false, reason: 'rejected' });
    expect(checkTenantAccess('t1', { approvalStatus: 'approved', status: 'suspended' }, sub))
      .toEqual({ allowed: false, reason: 'suspended' });
    expect(checkTenantAccess('t1', null, sub)).toEqual({ allowed: false, reason: 'pending_approval' });
  });

  it('modo subscription: delega en la suscripción e ignora la aprobación', () => {
    process.env.ACCESS_MODE = 'subscription';
    try {
      expect(checkTenantAccess('t1', { approvalStatus: 'pending', status: 'active' }, sub)).toEqual({ allowed: true });
      expect(checkTenantAccess('t1', { approvalStatus: 'approved', status: 'active' }, null))
        .toEqual({ allowed: false, reason: 'subscription_inactive' });
    } finally {
      delete process.env.ACCESS_MODE;
    }
  });
});

describe('deriveStep en modo approval (unidad)', () => {
  const done = { businessDone: true, welcomeDone: true, schemaDone: true };

  it('verified va directo a provisioning (sin paso subscription)', () => {
    expect(deriveStep('verified', null, null, { mode: 'approval', approvalStatus: 'pending' })).toBe('provisioning');
  });

  it('config completa + pendiente → awaiting_approval; aprobado → whatsapp', () => {
    expect(deriveStep('active', null, done, { mode: 'approval', approvalStatus: 'pending' })).toBe('awaiting_approval');
    expect(deriveStep('active', null, done, { mode: 'approval', approvalStatus: 'approved' })).toBe('whatsapp');
  });

  it('la config es accesible antes de la aprobación (business primero)', () => {
    expect(deriveStep('active', null, null, { mode: 'approval', approvalStatus: 'pending' })).toBe('business');
  });

  it('modo subscription conserva el paso subscription', () => {
    expect(deriveStep('verified', null, null, { mode: 'subscription' })).toBe('subscription');
    expect(deriveStep('verified', 'active', null, { mode: 'subscription' })).toBe('provisioning');
  });
});
