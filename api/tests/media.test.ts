import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildTestApp, seedTenantAndUser, authHeader, cleanupDb, testPrisma, TEST_TENANT_ID } from './helpers/app';

const OTHER_TENANT_ID = '00000000-0000-0000-0000-000000000003';

describe('GET /messages/:id/media (proxy al worker)', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let userId: string;
  let contactId: string;
  let fetchCalls: string[];

  // Fetcher falso que simula al servidor interno del worker sirviendo el archivo.
  const fakeFetcher = (async (url: string) => {
    fetchCalls.push(String(url));
    return new Response('PNGDATA', { status: 200, headers: { 'content-type': 'image/png' } });
  }) as unknown as typeof fetch;

  beforeEach(async () => {
    fetchCalls = [];
    process.env.INTERNAL_API_TOKEN = 'test-internal-token';
    process.env.TENANT_MANAGER_URL = 'http://worker-test:3002';
    userId = await seedTenantAndUser();
    app = await buildTestApp({ fetcher: fakeFetcher });
    const contact = await testPrisma.contact.create({
      data: { tenantId: TEST_TENANT_ID, phoneE164: '+34600000001', displayName: 'A' },
    });
    contactId = contact.id;
  });

  afterAll(async () => {
    await cleanupDb();
    delete process.env.TENANT_MANAGER_URL;
  });

  async function seedImageMessage(tenantId: string, cId: string, mediaPath: string): Promise<string> {
    const job = await testPrisma.job.create({
      data: { tenantId, contactId: cId, status: 'OPEN_INTAKE', intake: '{}' },
    });
    const msg = await testPrisma.message.create({
      data: { tenantId, contactId: cId, jobId: job.id, direction: 'outbound', kind: 'image', mediaPath, body: 'preview' },
    });
    return msg.id;
  }

  it('autoriza por tenant y proxya el archivo del worker (200 + bytes)', async () => {
    const id = await seedImageMessage(TEST_TENANT_ID, contactId, `${contactId}/j/m.png`);
    const res = await app.inject({ method: 'GET', url: `/messages/${id}/media`, headers: await authHeader(app, userId) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.body).toBe('PNGDATA');
    // Proxyó al worker con el tenantId y el path correctos.
    expect(fetchCalls[0]).toContain('/internal/media');
    expect(fetchCalls[0]).toContain(`tenantId=${TEST_TENANT_ID}`);
    expect(fetchCalls[0]).toContain(encodeURIComponent(`${contactId}/j/m.png`));
  });

  it('sin auth → 401 (sin tocar al worker)', async () => {
    const id = await seedImageMessage(TEST_TENANT_ID, contactId, `${contactId}/j/m.png`);
    const res = await app.inject({ method: 'GET', url: `/messages/${id}/media` });
    expect(res.statusCode).toBe(401);
    expect(fetchCalls).toHaveLength(0);
  });

  it('mensaje de otro tenant → 404 (no autoriza, no proxya)', async () => {
    await testPrisma.tenant.create({
      data: { id: OTHER_TENANT_ID, slug: 'other-media', name: 'O', industry: 'test', profileDir: './profiles/tapiceria' },
    });
    const otherContact = await testPrisma.contact.create({
      data: { tenantId: OTHER_TENANT_ID, phoneE164: '+34600000099', displayName: 'O' },
    });
    const id = await seedImageMessage(OTHER_TENANT_ID, otherContact.id, `${otherContact.id}/j/m.png`);
    const res = await app.inject({ method: 'GET', url: `/messages/${id}/media`, headers: await authHeader(app, userId) });
    expect(res.statusCode).toBe(404);
    expect(fetchCalls).toHaveLength(0);
  });

  it('mensaje inexistente → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/messages/no-existe/media', headers: await authHeader(app, userId) });
    expect(res.statusCode).toBe(404);
  });

  it('worker no configurado → 503', async () => {
    delete process.env.TENANT_MANAGER_URL;
    const id = await seedImageMessage(TEST_TENANT_ID, contactId, `${contactId}/j/m.png`);
    const res = await app.inject({ method: 'GET', url: `/messages/${id}/media`, headers: await authHeader(app, userId) });
    expect(res.statusCode).toBe(503);
  });

  it('worker responde 404 (archivo no disponible) → 404', async () => {
    const notFoundFetcher = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    app = await buildTestApp({ fetcher: notFoundFetcher });
    const id = await seedImageMessage(TEST_TENANT_ID, contactId, `${contactId}/j/m.png`);
    const res = await app.inject({ method: 'GET', url: `/messages/${id}/media`, headers: await authHeader(app, userId) });
    expect(res.statusCode).toBe(404);
  });
});
