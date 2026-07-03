import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildServer } from '../src/server';
import { seedTenantAndUser, loginCookie, cleanupDb, TEST_JWT_SECRET, testPrisma, TEST_TENANT_ID } from './helpers/app';
import { purgeOldMessages } from '../src/jobs/retention';
import { seedTestTenantSettings } from '../../tests/helpers/db';
import bcrypt from 'bcryptjs';

const TENANT_B = '00000000-0000-0000-0000-0000000000d4';

async function seedData() {
  // Tenant A (TEST_TENANT_ID) ya tiene admin + sub; añade contact/job/message.
  const cA = await testPrisma.contact.create({ data: { tenantId: TEST_TENANT_ID, phoneE164: '+5210000000001', displayName: 'A1' } });
  const jA = await testPrisma.job.create({ data: { tenantId: TEST_TENANT_ID, contactId: cA.id, status: 'OPEN_INTAKE', intake: '{}' } });
  await testPrisma.message.create({ data: { tenantId: TEST_TENANT_ID, contactId: cA.id, jobId: jA.id, direction: 'inbound', kind: 'text', body: 'hola' } });
  // Tenant B con sus datos (no deben aparecer ni borrarse)
  await testPrisma.tenant.create({ data: { id: TENANT_B, slug: 'tb', name: 'Tenant B', industry: 'test', profileDir: '' } });
  const cB = await testPrisma.contact.create({ data: { tenantId: TENANT_B, phoneE164: '+5210000000002', displayName: 'B1' } });
  await testPrisma.message.create({ data: { tenantId: TENANT_B, contactId: cB.id, direction: 'inbound', kind: 'text', body: 'b' } });
  return { contactA: cA.id };
}

describe('tenant-data (export / borrado / retención)', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  beforeEach(async () => { await seedTenantAndUser(); app = await buildServer({ jwtSecret: TEST_JWT_SECRET }); });
  afterAll(async () => { await cleanupDb(); });

  it('export devuelve SOLO los datos del tenant del JWT', async () => {
    await seedData();
    const { mutatingHeaders } = await loginCookie(app);
    const res = await app.inject({ method: 'POST', url: '/tenant/data-export', headers: mutatingHeaders });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tenantId).toBe(TEST_TENANT_ID);
    expect(body.contacts).toHaveLength(1);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].body).toBe('hola'); // nada de Tenant B
  });

  it('export requiere admin (rol viewer → 403)', async () => {
    const hash = await bcrypt.hash('pw1234567890', 8);
    await testPrisma.panelUser.create({ data: { tenantId: TEST_TENANT_ID, username: 'v', email: 'v@t.com', passwordHash: hash, role: 'viewer' } });
    const res0 = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'v@t.com', password: 'pw1234567890' } });
    const c = res0.cookies as Array<{ name: string; value: string }>;
    const cookie = `intake_session=${c.find((x) => x.name === 'intake_session')?.value}; intake_csrf=${c.find((x) => x.name === 'intake_csrf')?.value}`;
    const res = await app.inject({ method: 'POST', url: '/tenant/data-export', headers: { cookie, 'x-csrf-token': c.find((x) => x.name === 'intake_csrf')?.value! } });
    expect(res.statusCode).toBe(403);
  });

  it('borrado de un cliente final solo toca ese contacto del tenant; idempotente', async () => {
    const { contactA } = await seedData();
    const { mutatingHeaders } = await loginCookie(app);
    const r1 = await app.inject({ method: 'DELETE', url: `/tenant/contacts/${contactA}/data`, headers: mutatingHeaders });
    expect(r1.statusCode).toBe(200);
    expect(await testPrisma.contact.count({ where: { tenantId: TEST_TENANT_ID } })).toBe(0);
    expect(await testPrisma.contact.count({ where: { tenantId: TENANT_B } })).toBe(1); // intacto
    // idempotente
    const r2 = await app.inject({ method: 'DELETE', url: `/tenant/contacts/${contactA}/data`, headers: mutatingHeaders });
    expect(r2.statusCode).toBe(200);
  });

  it('borrado total: confirmación incorrecta → 400; correcta → borra datos pero conserva LegalAcceptance', async () => {
    await seedData();
    await testPrisma.legalAcceptance.create({ data: { tenantId: TEST_TENANT_ID, userId: 'u', document: 'terms', version: 'v1' } });
    const { mutatingHeaders } = await loginCookie(app);
    const bad = await app.inject({ method: 'POST', url: '/tenant/data-deletion', headers: mutatingHeaders, payload: { confirm: 'mal' } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/tenant/data-deletion', headers: mutatingHeaders, payload: { confirm: 'Test Tenant' } });
    expect(ok.statusCode).toBe(200);
    expect(await testPrisma.message.count({ where: { tenantId: TEST_TENANT_ID } })).toBe(0);
    expect(await testPrisma.contact.count({ where: { tenantId: TEST_TENANT_ID } })).toBe(0);
    expect(await testPrisma.legalAcceptance.count({ where: { tenantId: TEST_TENANT_ID } })).toBe(1); // sobrevive
    const t = await testPrisma.tenant.findUnique({ where: { id: TEST_TENANT_ID } });
    expect(t?.status).toBe('deleted');
  });

  it('retención purga solo mensajes fuera de ventana y solo del tenant', async () => {
    await seedTestTenantSettings(TEST_TENANT_ID, { messageRetentionMonths: 6 });
    const c = await testPrisma.contact.create({ data: { tenantId: TEST_TENANT_ID, phoneE164: '+5210000000009' } });
    const old = new Date(); old.setMonth(old.getMonth() - 8);
    const recent = new Date();
    await testPrisma.message.create({ data: { tenantId: TEST_TENANT_ID, contactId: c.id, direction: 'inbound', kind: 'text', body: 'viejo', createdAt: old } });
    await testPrisma.message.create({ data: { tenantId: TEST_TENANT_ID, contactId: c.id, direction: 'inbound', kind: 'text', body: 'nuevo', createdAt: recent } });
    const { deleted } = await purgeOldMessages(testPrisma);
    expect(deleted).toBe(1);
    const left = await testPrisma.message.findMany({ where: { tenantId: TEST_TENANT_ID } });
    expect(left.every((m) => m.body !== 'viejo')).toBe(true);
  });
});
