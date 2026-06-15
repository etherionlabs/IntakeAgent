import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildTestApp, seedTenantAndUser, authHeader, cleanupDb, testPrisma, TEST_TENANT_ID } from './helpers/app';

const OTHER_TENANT_ID = '00000000-0000-0000-0000-000000000002';

describe('usage', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let userId: string;

  beforeEach(async () => {
    userId = await seedTenantAndUser();
    app = await buildTestApp();

    const contact = await testPrisma.contact.create({
      data: { tenantId: TEST_TENANT_ID, phoneE164: '+34600000001', displayName: 'Cliente A' },
    });
    const job = await testPrisma.job.create({
      data: { tenantId: TEST_TENANT_ID, contactId: contact.id, status: 'OPEN_INTAKE', intake: '{}' },
    });

    await testPrisma.agentRun.create({
      data: {
        tenantId: TEST_TENANT_ID,
        jobId: job.id,
        triggerMessageIds: '[]',
        model: 'x',
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.01,
        toolCalls: '[]',
      },
    });
    await testPrisma.agentRun.create({
      data: {
        tenantId: TEST_TENANT_ID,
        jobId: job.id,
        triggerMessageIds: '[]',
        model: 'x',
        inputTokens: 200,
        outputTokens: 70,
        costUsd: 0.02,
        toolCalls: '[]',
      },
    });

    // Otro tenant + su propio job/contact + 1 AgentRun que NO debe aparecer.
    await testPrisma.tenant.create({
      data: { id: OTHER_TENANT_ID, slug: 'other-tenant', name: 'Other', industry: 'test', profileDir: './profiles/tapiceria' },
    });
    const otherContact = await testPrisma.contact.create({
      data: { tenantId: OTHER_TENANT_ID, phoneE164: '+34600000099', displayName: 'Otro' },
    });
    const otherJob = await testPrisma.job.create({
      data: { tenantId: OTHER_TENANT_ID, contactId: otherContact.id, status: 'OPEN_INTAKE', intake: '{}' },
    });
    await testPrisma.agentRun.create({
      data: {
        tenantId: OTHER_TENANT_ID,
        jobId: otherJob.id,
        triggerMessageIds: '[]',
        model: 'x',
        inputTokens: 999,
        outputTokens: 999,
        costUsd: 9.99,
        toolCalls: '[]',
      },
    });
  });

  afterAll(async () => { await cleanupDb(); });

  it('GET /usage devuelve totales y recent solo del tenant', async () => {
    const res = await app.inject({ method: 'GET', url: '/usage', headers: await authHeader(app, userId) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals.runs).toBe(2);
    expect(body.totals.costUsd).toBeCloseTo(0.03);
    expect(body.totals.inputTokens).toBe(300);
    expect(body.totals.outputTokens).toBe(120);
    expect(body.recent.length).toBe(2);
    for (const r of body.recent) expect(r.tenantId).toBe(TEST_TENANT_ID);
  });

  it('GET /usage sin token → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/usage' });
    expect(res.statusCode).toBe(401);
  });
});
