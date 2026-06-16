import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildTestApp, seedTenantAndUser, authHeader, cleanupDb, testPrisma, TEST_TENANT_ID } from './helpers/app';

const OTHER_TENANT_ID = '00000000-0000-0000-0000-000000000002';

describe('jobs', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let userId: string;
  let openJobId: string;
  let otherTenantJobId: string;
  let contactId: string;

  beforeEach(async () => {
    userId = await seedTenantAndUser();
    app = await buildTestApp();

    // Contacto + 2 jobs (OPEN_INTAKE y CLOSED) para el tenant de test.
    const contact = await testPrisma.contact.create({
      data: { tenantId: TEST_TENANT_ID, phoneE164: '+34600000001', displayName: 'Cliente A' },
    });
    contactId = contact.id;
    const openJob = await testPrisma.job.create({
      data: {
        tenantId: TEST_TENANT_ID,
        contactId: contact.id,
        status: 'OPEN_INTAKE',
        intake: JSON.stringify({ client: { name: 'Ana' } }),
      },
    });
    openJobId = openJob.id;
    await testPrisma.job.create({
      data: {
        tenantId: TEST_TENANT_ID,
        contactId: contact.id,
        status: 'CLOSED',
        intake: JSON.stringify({ client: { name: 'Beto' } }),
      },
    });

    // Mensajes para el job abierto (orden por createdAt).
    await testPrisma.message.create({
      data: { tenantId: TEST_TENANT_ID, contactId: contact.id, jobId: openJobId, direction: 'inbound', kind: 'text', body: 'hola' },
    });

    // Segundo tenant + su propio contacto + job: NUNCA debe aparecer.
    await testPrisma.tenant.create({
      data: { id: OTHER_TENANT_ID, slug: 'other-tenant', name: 'Other', industry: 'test', profileDir: './profiles/tapiceria' },
    });
    const otherContact = await testPrisma.contact.create({
      data: { tenantId: OTHER_TENANT_ID, phoneE164: '+34600000099', displayName: 'Otro' },
    });
    const otherJob = await testPrisma.job.create({
      data: {
        tenantId: OTHER_TENANT_ID,
        contactId: otherContact.id,
        status: 'OPEN_INTAKE',
        intake: JSON.stringify({ client: { name: 'Carlos' } }),
      },
    });
    otherTenantJobId = otherJob.id;
  });

  afterAll(async () => { await cleanupDb(); });

  it('GET /jobs con auth devuelve solo los jobs del tenant', async () => {
    const res = await app.inject({ method: 'GET', url: '/jobs', headers: await authHeader(app, userId) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jobs.length).toBe(2);
    const ids = body.jobs.map((j: any) => j.id);
    expect(ids).not.toContain(otherTenantJobId);
    for (const j of body.jobs) expect(j.tenantId).toBe(TEST_TENANT_ID);
  });

  it('GET /jobs?status=OPEN_INTAKE filtra por estado', async () => {
    const res = await app.inject({ method: 'GET', url: '/jobs?status=OPEN_INTAKE', headers: await authHeader(app, userId) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jobs.length).toBe(1);
    expect(body.jobs[0].id).toBe(openJobId);
    expect(body.jobs[0].status).toBe('OPEN_INTAKE');
  });

  it('GET /jobs/:id devuelve { job, intake, messages }', async () => {
    const res = await app.inject({ method: 'GET', url: `/jobs/${openJobId}`, headers: await authHeader(app, userId) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.job.id).toBe(openJobId);
    expect(typeof body.intake).toBe('object');
    expect(body.intake.client.name).toBe('Ana');
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.messages.length).toBe(1);
  });

  it('GET /jobs/:otherTenantJobId → 404 (aislamiento)', async () => {
    const res = await app.inject({ method: 'GET', url: `/jobs/${otherTenantJobId}`, headers: await authHeader(app, userId) });
    expect(res.statusCode).toBe(404);
  });

  it('GET /jobs sin token → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/jobs' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /jobs/:id/archive marca archivedAt y lo saca del listado por defecto', async () => {
    const job = await testPrisma.job.create({ data: { tenantId: TEST_TENANT_ID, contactId, status: 'OPEN_INTAKE', intake: '{}' } });
    const arch = await app.inject({ method: 'POST', url: `/jobs/${job.id}/archive`, headers: await authHeader(app, userId) });
    expect(arch.statusCode).toBe(200);
    expect(arch.json().job.archivedAt).not.toBeNull();

    const list = await app.inject({ method: 'GET', url: '/jobs', headers: await authHeader(app, userId) });
    expect(list.json().jobs.map((j: any) => j.id)).not.toContain(job.id);

    const listArch = await app.inject({ method: 'GET', url: '/jobs?includeArchived=true', headers: await authHeader(app, userId) });
    expect(listArch.json().jobs.map((j: any) => j.id)).toContain(job.id);
  });

  it('POST /jobs/:id/restore limpia archivedAt', async () => {
    const job = await testPrisma.job.create({ data: { tenantId: TEST_TENANT_ID, contactId, status: 'OPEN_INTAKE', intake: '{}', archivedAt: new Date() } });
    const res = await app.inject({ method: 'POST', url: `/jobs/${job.id}/restore`, headers: await authHeader(app, userId) });
    expect(res.statusCode).toBe(200);
    expect(res.json().job.archivedAt).toBeNull();
  });

  it('DELETE /jobs/:id borra el job', async () => {
    const job = await testPrisma.job.create({ data: { tenantId: TEST_TENANT_ID, contactId, status: 'OPEN_INTAKE', intake: '{}' } });
    const res = await app.inject({ method: 'DELETE', url: `/jobs/${job.id}`, headers: await authHeader(app, userId) });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(await testPrisma.job.findFirst({ where: { id: job.id } })).toBeNull();
  });

  it('DELETE /jobs/:otherTenantJobId → 404 (aislamiento)', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/jobs/${otherTenantJobId}`, headers: await authHeader(app, userId) });
    expect(res.statusCode).toBe(404);
  });
});
