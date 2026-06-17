import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildTestApp, seedTenantAndUser, authHeader, cleanupDb, testPrisma, TEST_TENANT_ID } from './helpers/app';

const OTHER_TENANT_ID = '00000000-0000-0000-0000-000000000002';

describe('contacts', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let userId: string;
  let contactId: string;
  let otherContactId: string;

  beforeEach(async () => {
    userId = await seedTenantAndUser();
    app = await buildTestApp();

    const contact = await testPrisma.contact.create({
      data: { tenantId: TEST_TENANT_ID, phoneE164: '+34600000001', displayName: 'Cliente A', botActive: true },
    });
    contactId = contact.id;

    await testPrisma.tenant.create({
      data: { id: OTHER_TENANT_ID, slug: 'other-tenant', name: 'Other', industry: 'test', profileDir: './profiles/tapiceria' },
    });
    const otherContact = await testPrisma.contact.create({
      data: { tenantId: OTHER_TENANT_ID, phoneE164: '+34600000099', displayName: 'Otro' },
    });
    otherContactId = otherContact.id;
  });

  afterAll(async () => { await cleanupDb(); });

  it('GET /contacts devuelve solo los contactos del tenant', async () => {
    const res = await app.inject({ method: 'GET', url: '/contacts', headers: await authHeader(app, userId) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.contacts.length).toBe(1);
    const ids = body.contacts.map((c: any) => c.id);
    expect(ids).toContain(contactId);
    expect(ids).not.toContain(otherContactId);
    for (const c of body.contacts) expect(c.tenantId).toBe(TEST_TENANT_ID);
  });

  it('PATCH /contacts/:id { botPaused: true } → botActive false', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/contacts/${contactId}`,
      headers: await authHeader(app, userId),
      payload: { botPaused: true },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.contact.botActive).toBe(false);
  });

  it('PATCH /contacts/:id { botPaused: false } → botActive true', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/contacts/${contactId}`,
      headers: await authHeader(app, userId),
      payload: { botPaused: false },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.contact.botActive).toBe(true);
  });

  it('PATCH /contacts/:otherTenantId → 404 (aislamiento)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/contacts/${otherContactId}`,
      headers: await authHeader(app, userId),
      payload: { botPaused: true },
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /contacts sin token → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/contacts' });
    expect(res.statusCode).toBe(401);
  });

  it('PATCH /contacts/:id { displayName, unflag } edita y des-marca', async () => {
    await testPrisma.contact.update({ where: { id: contactId }, data: { flaggedNonIntake: true, flaggedReason: 'x' } });
    const res = await app.inject({ method: 'PATCH', url: `/contacts/${contactId}`, headers: await authHeader(app, userId), payload: { displayName: 'Nuevo Nombre', unflag: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json().contact.displayName).toBe('Nuevo Nombre');
    expect(res.json().contact.flaggedNonIntake).toBe(false);
  });

  it('POST /contacts/:id/archive y restore alternan archivedAt y filtran el listado', async () => {
    const arch = await app.inject({ method: 'POST', url: `/contacts/${contactId}/archive`, headers: await authHeader(app, userId) });
    expect(arch.statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: '/contacts', headers: await authHeader(app, userId) });
    expect(list.json().contacts.map((c: any) => c.id)).not.toContain(contactId);
    const listArch = await app.inject({ method: 'GET', url: '/contacts?includeArchived=true', headers: await authHeader(app, userId) });
    expect(listArch.json().contacts.map((c: any) => c.id)).toContain(contactId);
    const res = await app.inject({ method: 'POST', url: `/contacts/${contactId}/restore`, headers: await authHeader(app, userId) });
    expect(res.json().contact.archivedAt).toBeNull();
  });

  it('DELETE /contacts/:id borra el contacto', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/contacts/${contactId}`, headers: await authHeader(app, userId) });
    expect(res.statusCode).toBe(200);
    expect(await testPrisma.contact.findFirst({ where: { id: contactId } })).toBeNull();
  });

  it('DELETE /contacts/:otherTenant → 404', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/contacts/${otherContactId}`, headers: await authHeader(app, userId) });
    expect(res.statusCode).toBe(404);
  });
});
