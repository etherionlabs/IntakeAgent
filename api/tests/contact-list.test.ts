import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildTestApp, testPrisma, cleanupDb } from './helpers/app';
import { seedTestPlan, TEST_PLAN_ID } from '../../tests/helpers/db';

const NOW = new Date();
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);

async function seedTenant() {
  const tenant = await testPrisma.tenant.create({
    data: { slug: `s-${Date.now()}-${Math.random()}`, name: 'T', industry: 'test', profileDir: './profiles/tapiceria', approvalStatus: 'approved' },
  });
  const user = await testPrisma.panelUser.create({
    data: { tenantId: tenant.id, username: `u-${Date.now()}-${Math.random()}`, passwordHash: 'x', role: 'admin' },
  });
  await seedTestPlan();
  await testPrisma.subscription.create({
    data: { tenantId: tenant.id, planId: TEST_PLAN_ID, stripeCustomerId: `cus_${tenant.id}`, status: 'active' },
  });
  return { tenantId: tenant.id, userId: user.id };
}

async function seedContact(tenantId: string, displayName: string | null, over: { archived?: boolean } = {}) {
  return testPrisma.contact.create({
    data: {
      tenantId,
      phoneE164: `+521${Math.floor(Math.random() * 1e9)}`,
      displayName,
      archivedAt: over.archived ? NOW : null,
    },
  });
}

async function seedJob(tenantId: string, contactId: string, status = 'OPEN_INTAKE', over: { archived?: boolean; openedAt?: Date } = {}) {
  return testPrisma.job.create({
    data: {
      tenantId,
      contactId,
      status,
      intake: '{}',
      archivedAt: over.archived ? NOW : null,
      openedAt: over.openedAt ?? hoursAgo(5),
    },
  });
}

describe('GET /contacts (agenda con contexto)', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    await cleanupDb();
    app = await buildTestApp();
  });
  afterAll(async () => { await cleanupDb(); });

  function admin(tenantId: string, userId: string) {
    return { authorization: `Bearer ${app.jwt.sign({ userId, tenantId, role: 'admin' })}` };
  }

  it('cuenta trabajos totales y abiertos por contacto', async () => {
    const { tenantId, userId } = await seedTenant();
    const contact = await seedContact(tenantId, 'Ana');
    await seedJob(tenantId, contact.id, 'OPEN_INTAKE');
    await seedJob(tenantId, contact.id, 'READY_FOR_REVIEW');
    await seedJob(tenantId, contact.id, 'CLOSED');

    const body = (await app.inject({ method: 'GET', url: '/contacts', headers: admin(tenantId, userId) })).json();
    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0]).toMatchObject({ displayName: 'Ana', jobCount: 3, openJobCount: 2 });
  });

  it('los trabajos archivados no se cuentan', async () => {
    const { tenantId, userId } = await seedTenant();
    const contact = await seedContact(tenantId, 'Ana');
    await seedJob(tenantId, contact.id, 'OPEN_INTAKE');
    await seedJob(tenantId, contact.id, 'OPEN_INTAKE', { archived: true });

    const body = (await app.inject({ method: 'GET', url: '/contacts', headers: admin(tenantId, userId) })).json();
    expect(body.contacts[0].jobCount).toBe(1);
    expect(body.contacts[0].openJobCount).toBe(1);
  });

  it('expone la última actividad y el trabajo más reciente', async () => {
    const { tenantId, userId } = await seedTenant();
    const contact = await seedContact(tenantId, 'Ana');
    const viejo = await seedJob(tenantId, contact.id, 'CLOSED', { openedAt: hoursAgo(72) });
    const reciente = await seedJob(tenantId, contact.id, 'OPEN_INTAKE', { openedAt: hoursAgo(2) });
    await testPrisma.message.create({
      data: { tenantId, jobId: viejo.id, contactId: contact.id, direction: 'inbound', kind: 'text', body: 'hola', createdAt: hoursAgo(70) },
    });
    await testPrisma.message.create({
      data: { tenantId, jobId: reciente.id, contactId: contact.id, direction: 'outbound', kind: 'text', body: 'te leo', createdAt: hoursAgo(1) },
    });

    const body = (await app.inject({ method: 'GET', url: '/contacts', headers: admin(tenantId, userId) })).json();
    const c = body.contacts[0];
    expect(c.lastJobId).toBe(reciente.id);
    // El último mensaje es el más nuevo, sin importar la dirección.
    expect(new Date(c.lastMessageAt).getTime()).toBeCloseTo(hoursAgo(1).getTime(), -3);
  });

  it('un contacto sin trabajos ni mensajes viene en ceros, no roto', async () => {
    const { tenantId, userId } = await seedTenant();
    await seedContact(tenantId, 'Nuevo');

    const body = (await app.inject({ method: 'GET', url: '/contacts', headers: admin(tenantId, userId) })).json();
    expect(body.contacts[0]).toMatchObject({
      jobCount: 0,
      openJobCount: 0,
      lastMessageAt: null,
      lastJobId: null,
    });
  });

  it('oculta archivados salvo que se pidan', async () => {
    const { tenantId, userId } = await seedTenant();
    await seedContact(tenantId, 'Activo');
    await seedContact(tenantId, 'Viejo', { archived: true });

    const sin = (await app.inject({ method: 'GET', url: '/contacts', headers: admin(tenantId, userId) })).json();
    expect(sin.contacts.map((c: any) => c.displayName)).toEqual(['Activo']);

    const con = (await app.inject({ method: 'GET', url: '/contacts?includeArchived=true', headers: admin(tenantId, userId) })).json();
    expect(con.contacts.map((c: any) => c.displayName).sort()).toEqual(['Activo', 'Viejo']);
  });

  it('no mezcla los conteos de otro tenant', async () => {
    const mine = await seedTenant();
    const other = await seedTenant();
    const mineContact = await seedContact(mine.tenantId, 'Mío');
    const otherContact = await seedContact(other.tenantId, 'Ajeno');
    await seedJob(other.tenantId, otherContact.id);

    const body = (await app.inject({ method: 'GET', url: '/contacts', headers: admin(mine.tenantId, mine.userId) })).json();
    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0]).toMatchObject({ id: mineContact.id, jobCount: 0 });
  });

  it('sin contactos devuelve una lista vacía sin consultar de más', async () => {
    const { tenantId, userId } = await seedTenant();
    const res = await app.inject({ method: 'GET', url: '/contacts', headers: admin(tenantId, userId) });
    expect(res.statusCode).toBe(200);
    expect(res.json().contacts).toEqual([]);
  });
});
