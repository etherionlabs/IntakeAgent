import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildServer } from '../src/server';
import { seedTenantAndUser, loginCookie, cleanupDb, TEST_JWT_SECRET, testPrisma, TEST_TENANT_ID } from './helpers/app';
import bcrypt from 'bcryptjs';

async function makeOperator() {
  const hash = await bcrypt.hash('pw1234567890', 8);
  return testPrisma.panelUser.create({
    data: { tenantId: TEST_TENANT_ID, username: 'op', email: 'op@plat.com', passwordHash: hash, role: 'operator' },
  });
}

async function operatorLogin(app: any) {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'op@plat.com', password: 'pw1234567890' } });
  const c = res.cookies as Array<{ name: string; value: string }>;
  const cookie = `intake_session=${c.find((x) => x.name === 'intake_session')?.value}; intake_csrf=${c.find((x) => x.name === 'intake_csrf')?.value}`;
  return { headers: { cookie }, mutating: { cookie, 'x-csrf-token': c.find((x) => x.name === 'intake_csrf')?.value! } };
}

describe('panel de operador /admin', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  const calls: string[] = [];
  const fetcher = (async (url: any) => { calls.push(String(url)); return new Response(JSON.stringify({ ok: true, connected: true }), { status: 200 }); }) as unknown as typeof fetch;

  beforeEach(async () => {
    calls.length = 0;
    process.env.TENANT_MANAGER_URL = 'http://worker:3002';
    process.env.INTERNAL_API_TOKEN = 'tok';
    await seedTenantAndUser(); // tenant active + admin + sub active
    await makeOperator();
    app = await buildServer({ jwtSecret: TEST_JWT_SECRET, fetcher });
  });
  afterAll(async () => { await cleanupDb(); });

  it('admin de tenant → 403; operator → 200', async () => {
    const tenant = await loginCookie(app); // admin de tenant
    expect((await app.inject({ method: 'GET', url: '/admin/tenants', headers: tenant.headers })).statusCode).toBe(403);
    const op = await operatorLogin(app);
    const res = await app.inject({ method: 'GET', url: '/admin/tenants', headers: op.headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().tenants.length).toBeGreaterThan(0);
    expect(res.json().tenants[0].subscription).toBe('active');
  });

  it('suspend: marca suspended, llama al worker y audita', async () => {
    const op = await operatorLogin(app);
    const res = await app.inject({ method: 'POST', url: `/admin/tenants/${TEST_TENANT_ID}/suspend`, headers: op.mutating });
    expect(res.statusCode).toBe(200);
    expect(calls.some((u) => u.endsWith('/internal/tenant/suspend'))).toBe(true);
    const t = await testPrisma.tenant.findUnique({ where: { id: TEST_TENANT_ID } });
    expect(t?.status).toBe('suspended');
    const audit = await testPrisma.operatorAuditLog.findFirst({ where: { tenantId: TEST_TENANT_ID, action: 'suspend' } });
    expect(audit).not.toBeNull();
  });

  it('reactivate vuelve a active y audita', async () => {
    const op = await operatorLogin(app);
    await app.inject({ method: 'POST', url: `/admin/tenants/${TEST_TENANT_ID}/suspend`, headers: op.mutating });
    await app.inject({ method: 'POST', url: `/admin/tenants/${TEST_TENANT_ID}/reactivate`, headers: op.mutating });
    const t = await testPrisma.tenant.findUnique({ where: { id: TEST_TENANT_ID } });
    expect(t?.status).toBe('active');
    expect(calls.some((u) => u.endsWith('/internal/tenant/resume'))).toBe(true);
  });
});
