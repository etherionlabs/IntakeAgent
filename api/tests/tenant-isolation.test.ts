import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildTestApp, loginCookie, testPrisma, cleanupDb, seedTestTenant, TEST_TENANT_ID } from './helpers/app';
import { seedTestPlan, TEST_PLAN_ID } from '../../tests/helpers/db';
import bcrypt from 'bcryptjs';

const TENANT_B = '00000000-0000-0000-0000-0000000000b2';

/** Siembra el tenant A (con su admin + suscripción activa) y un tenant B con datos propios. */
async function seedTwoTenants() {
  await cleanupDb();
  await seedTestTenant(); // tenant A = TEST_TENANT_ID
  const hash = await bcrypt.hash('pw1234567890', 8);
  await testPrisma.panelUser.create({
    data: { tenantId: TEST_TENANT_ID, username: 'a-admin', email: 'a@test.local', passwordHash: hash, role: 'admin' },
  });
  await seedTestPlan();
  await testPrisma.subscription.create({
    data: { tenantId: TEST_TENANT_ID, planId: TEST_PLAN_ID, stripeCustomerId: 'cus_a', status: 'active' },
  });
  await testPrisma.tenant.create({
    data: { id: TENANT_B, slug: 'tenant-b', name: 'Tenant B', industry: 'test', profileDir: './profiles/tapiceria' },
  });
  const contactB = await testPrisma.contact.create({
    data: { tenantId: TENANT_B, phoneE164: '+5219999999999', displayName: 'Cliente B' },
  });
  const jobB = await testPrisma.job.create({
    data: { tenantId: TENANT_B, contactId: contactB.id, status: 'OPEN_INTAKE', intake: '{}' },
  });
  return { contactB, jobB };
}

describe('aislamiento entre tenants', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let jobBId: string;
  let contactBId: string;

  beforeEach(async () => {
    const seeded = await seedTwoTenants();
    jobBId = seeded.jobB.id;
    contactBId = seeded.contactB.id;
    app = await buildTestApp();
  });
  afterAll(async () => { await cleanupDb(); });

  it('un usuario de A no ve datos de B en las listas', async () => {
    const { headers } = await loginCookie(app, 'a@test.local', 'pw1234567890');
    const jobs = await app.inject({ method: 'GET', url: '/jobs', headers });
    expect(jobs.json().jobs).toHaveLength(0);
    const contacts = await app.inject({ method: 'GET', url: '/contacts', headers });
    expect(contacts.json().contacts).toHaveLength(0);
  });

  it('un usuario de A no accede a un job/contact de B por id directo → 404', async () => {
    const { headers, mutatingHeaders } = await loginCookie(app, 'a@test.local', 'pw1234567890');
    const getJob = await app.inject({ method: 'GET', url: `/jobs/${jobBId}`, headers });
    expect(getJob.statusCode).toBe(404);

    const patchIntake = await app.inject({
      method: 'PATCH', url: `/jobs/${jobBId}/intake`, headers: mutatingHeaders,
      payload: { path: 'mueble.tipo', value: 'hackeado' },
    });
    expect(patchIntake.statusCode).toBe(404);

    const action = await app.inject({
      method: 'POST', url: `/jobs/${jobBId}/actions`, headers: mutatingHeaders,
      payload: { action: 'mark_ready' },
    });
    expect(action.statusCode).toBe(404);

    const patchContact = await app.inject({
      method: 'PATCH', url: `/contacts/${contactBId}`, headers: mutatingHeaders,
      payload: { botPaused: true },
    });
    expect(patchContact.statusCode).toBe(404);

    // los datos de B no se modificaron
    const jobB = await testPrisma.job.findUnique({ where: { id: jobBId } });
    expect(jobB?.status).toBe('OPEN_INTAKE');
  });
});
