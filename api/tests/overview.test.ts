import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildTestApp, testPrisma, cleanupDb } from './helpers/app';
import { seedTestPlan, TEST_PLAN_ID } from '../../tests/helpers/db';
import { createEmptyIntakeFromSchema, upsertOpportunities } from '../../src/services/intake';
import type { IntakeSchema } from '../../src/config/intake-schema';

const schema: IntakeSchema = {
  $businessName: 'X',
  $businessDomain: 'y',
  $language: 'es-MX',
  sections: [
    { key: 'client', label: 'Cliente', fields: [{ key: 'name', label: 'Nombre', type: 'string', required: true }] },
  ],
};

const NOW = new Date();
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 3600_000);

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

async function seedContact(tenantId: string, over: { displayName?: string; botActive?: boolean; flagged?: boolean } = {}) {
  return testPrisma.contact.create({
    data: {
      tenantId,
      phoneE164: `+521${Math.floor(Math.random() * 1e9)}`,
      displayName: over.displayName ?? null,
      botActive: over.botActive ?? true,
      flaggedNonIntake: over.flagged ?? false,
    },
  });
}

async function seedJob(
  tenantId: string,
  contactId: string,
  over: {
    status?: string;
    accepted?: string[];
    offered?: string[];
    outcome?: string | null;
    followUpCount?: number;
    openedAt?: Date;
  } = {},
) {
  let intake = createEmptyIntakeFromSchema(schema);
  const items = [
    ...(over.offered ?? []).map((s) => ({ service: s, status: 'offered' as const })),
    ...(over.accepted ?? []).map((s) => ({ service: s, status: 'accepted' as const })),
  ];
  if (items.length > 0) intake = upsertOpportunities(intake, items, NOW.toISOString(), null);
  return testPrisma.job.create({
    data: {
      tenantId,
      contactId,
      status: over.status ?? 'OPEN_INTAKE',
      intake: JSON.stringify(intake),
      outcome: over.outcome ?? null,
      followUpCount: over.followUpCount ?? 0,
      openedAt: over.openedAt ?? hoursAgo(2),
    },
  });
}

describe('GET /overview', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    await cleanupDb();
    app = await buildTestApp();
  });
  afterAll(async () => { await cleanupDb(); });

  function admin(tenantId: string, userId: string) {
    return { authorization: `Bearer ${app.jwt.sign({ userId, tenantId, role: 'admin' })}` };
  }

  it('sin auth → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/overview' });
    expect(res.statusCode).toBe(401);
  });

  it('lista los trabajos con extras aceptados por cotizar', async () => {
    const { tenantId, userId } = await seedTenant();
    const contact = await seedContact(tenantId, { displayName: 'Ana' });
    const job = await seedJob(tenantId, contact.id, {
      status: 'READY_FOR_REVIEW',
      accepted: ['polarizado 20%', 'PPF'],
    });
    // Un trabajo sin extras no debe aparecer en la lista.
    await seedJob(tenantId, contact.id);

    const res = await app.inject({ method: 'GET', url: '/overview', headers: admin(tenantId, userId) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.attention.pendingQuotes).toHaveLength(1);
    expect(body.attention.pendingQuotes[0]).toMatchObject({
      jobId: job.id,
      contactName: 'Ana',
      services: ['polarizado 20%', 'PPF'],
    });
    expect(body.attention.readyForReview).toBe(1);
  });

  it('un extra solo ofrecido no cuenta como pendiente de cotizar', async () => {
    const { tenantId, userId } = await seedTenant();
    const contact = await seedContact(tenantId);
    await seedJob(tenantId, contact.id, { offered: ['cerámica'] });

    const body = (await app.inject({ method: 'GET', url: '/overview', headers: admin(tenantId, userId) })).json();
    expect(body.attention.pendingQuotes).toHaveLength(0);
    // Pero sí cuenta en el embudo como trabajo con oferta.
    expect(body.funnel.withOffer).toBe(1);
    expect(body.funnel.withAccepted).toBe(0);
  });

  it('detecta clientes que escribieron y nadie contestó, con el motivo', async () => {
    const { tenantId, userId } = await seedTenant();
    const contact = await seedContact(tenantId, { displayName: 'Luis', botActive: false });
    const job = await seedJob(tenantId, contact.id);
    await testPrisma.message.create({
      data: { tenantId, jobId: job.id, contactId: contact.id, direction: 'inbound', kind: 'text', body: '¿hola?', createdAt: hoursAgo(1) },
    });

    const body = (await app.inject({ method: 'GET', url: '/overview', headers: admin(tenantId, userId) })).json();
    expect(body.attention.waiting).toHaveLength(1);
    expect(body.attention.waiting[0]).toMatchObject({ jobId: job.id, contactName: 'Luis', reason: 'bot_paused' });
  });

  it('si el último mensaje es nuestro, el cliente no está esperando', async () => {
    const { tenantId, userId } = await seedTenant();
    const contact = await seedContact(tenantId);
    const job = await seedJob(tenantId, contact.id);
    await testPrisma.message.create({
      data: { tenantId, jobId: job.id, contactId: contact.id, direction: 'inbound', kind: 'text', body: 'hola', createdAt: hoursAgo(3) },
    });
    await testPrisma.message.create({
      data: { tenantId, jobId: job.id, contactId: contact.id, direction: 'outbound', kind: 'text', body: 'te leo', createdAt: hoursAgo(2) },
    });

    const body = (await app.inject({ method: 'GET', url: '/overview', headers: admin(tenantId, userId) })).json();
    expect(body.attention.waiting).toHaveLength(0);
  });

  it('resume el embudo de venta y los seguimientos', async () => {
    const { tenantId, userId } = await seedTenant();
    const contact = await seedContact(tenantId);
    await seedJob(tenantId, contact.id, { offered: ['a'], status: 'CLOSED', outcome: 'LOST' });
    await seedJob(tenantId, contact.id, { accepted: ['b'], status: 'CLOSED', outcome: 'WON', followUpCount: 2 });
    await seedJob(tenantId, contact.id, { followUpCount: 1 });

    const body = (await app.inject({ method: 'GET', url: '/overview', headers: admin(tenantId, userId) })).json();
    expect(body.funnel).toMatchObject({
      windowDays: 30,
      jobs: 3,
      withOffer: 2,
      withAccepted: 1,
      won: 1,
      lost: 1,
      followUps: 3,
    });
  });

  it('el embudo ignora lo anterior a la ventana', async () => {
    const { tenantId, userId } = await seedTenant();
    const contact = await seedContact(tenantId);
    await seedJob(tenantId, contact.id, { accepted: ['viejo'], status: 'CLOSED', outcome: 'WON', openedAt: daysAgo(60) });

    const body = (await app.inject({ method: 'GET', url: '/overview', headers: admin(tenantId, userId) })).json();
    expect(body.funnel.jobs).toBe(0);
    expect(body.funnel.won).toBe(0);
  });

  it('no filtra datos de otro tenant', async () => {
    const mine = await seedTenant();
    const other = await seedTenant();
    const otherContact = await seedContact(other.tenantId, { displayName: 'Ajeno' });
    await seedJob(other.tenantId, otherContact.id, { accepted: ['no debe verse'], status: 'READY_FOR_REVIEW' });

    const body = (await app.inject({ method: 'GET', url: '/overview', headers: admin(mine.tenantId, mine.userId) })).json();
    expect(body.attention.pendingQuotes).toHaveLength(0);
    expect(body.attention.readyForReview).toBe(0);
    expect(body.funnel.jobs).toBe(0);
  });

  it('los trabajos archivados no cuentan', async () => {
    const { tenantId, userId } = await seedTenant();
    const contact = await seedContact(tenantId);
    const job = await seedJob(tenantId, contact.id, { accepted: ['x'], status: 'READY_FOR_REVIEW' });
    await testPrisma.job.update({ where: { id: job.id }, data: { archivedAt: NOW } });

    const body = (await app.inject({ method: 'GET', url: '/overview', headers: admin(tenantId, userId) })).json();
    expect(body.attention.pendingQuotes).toHaveLength(0);
    expect(body.funnel.jobs).toBe(0);
  });
});
