import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { buildTestApp, seedTenantAndUser, authHeader, cleanupDb, testPrisma, TEST_TENANT_ID } from './helpers/app';

const OTHER_TENANT_ID = '00000000-0000-0000-0000-000000000003';

describe('GET /messages/:id/media', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let userId: string;
  let mediaRoot: string;
  let contactId: string;

  beforeEach(async () => {
    userId = await seedTenantAndUser();
    app = await buildTestApp();
    mediaRoot = await mkdtemp(join(tmpdir(), 'intake-media-'));
    process.env.MEDIA_DIR = mediaRoot;
    const contact = await testPrisma.contact.create({
      data: { tenantId: TEST_TENANT_ID, phoneE164: '+34600000001', displayName: 'A' },
    });
    contactId = contact.id;
  });

  afterAll(async () => {
    await cleanupDb();
    delete process.env.MEDIA_DIR;
  });

  /** Crea un mensaje-imagen con su archivo en disco bajo la raíz del tenant. */
  async function seedImageMessage(tenantId: string, mediaPath: string, bytes = 'PNGDATA'): Promise<string> {
    const job = await testPrisma.job.create({
      data: { tenantId, contactId, status: 'OPEN_INTAKE', intake: '{}' },
    });
    const msg = await testPrisma.message.create({
      data: { tenantId, contactId, jobId: job.id, direction: 'outbound', kind: 'image', mediaPath, body: 'preview' },
    });
    const abs = join(mediaRoot, tenantId, mediaPath);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, bytes);
    return msg.id;
  }

  it('sirve la imagen del tenant (200 + content-type image)', async () => {
    const id = await seedImageMessage(TEST_TENANT_ID, `${contactId}/j/m.png`);
    const res = await app.inject({ method: 'GET', url: `/messages/${id}/media`, headers: await authHeader(app, userId) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.body).toBe('PNGDATA');
  });

  it('sin auth → 401', async () => {
    const id = await seedImageMessage(TEST_TENANT_ID, `${contactId}/j/m.png`);
    const res = await app.inject({ method: 'GET', url: `/messages/${id}/media` });
    expect(res.statusCode).toBe(401);
  });

  it('mensaje de otro tenant → 404 (aislamiento)', async () => {
    await testPrisma.tenant.create({
      data: { id: OTHER_TENANT_ID, slug: 'other-media', name: 'O', industry: 'test', profileDir: './profiles/tapiceria' },
    });
    const otherContact = await testPrisma.contact.create({
      data: { tenantId: OTHER_TENANT_ID, phoneE164: '+34600000099', displayName: 'O' },
    });
    const prevContact = contactId;
    contactId = otherContact.id;
    const id = await seedImageMessage(OTHER_TENANT_ID, `${otherContact.id}/j/m.png`);
    contactId = prevContact;
    const res = await app.inject({ method: 'GET', url: `/messages/${id}/media`, headers: await authHeader(app, userId) });
    expect(res.statusCode).toBe(404);
  });

  it('mensaje inexistente → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/messages/no-existe/media', headers: await authHeader(app, userId) });
    expect(res.statusCode).toBe(404);
  });

  it('rechaza path traversal en mediaPath → 400', async () => {
    // mediaPath malicioso (no lo generaría nuestro código, pero la guarda debe cortarlo).
    const job = await testPrisma.job.create({
      data: { tenantId: TEST_TENANT_ID, contactId, status: 'OPEN_INTAKE', intake: '{}' },
    });
    const msg = await testPrisma.message.create({
      data: { tenantId: TEST_TENANT_ID, contactId, jobId: job.id, direction: 'outbound', kind: 'image', mediaPath: '../../../../etc/passwd', body: 'x' },
    });
    const res = await app.inject({ method: 'GET', url: `/messages/${msg.id}/media`, headers: await authHeader(app, userId) });
    expect(res.statusCode).toBe(400);
  });
});
