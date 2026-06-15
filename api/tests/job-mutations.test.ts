import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildTestApp, seedTenantAndUser, authHeader, cleanupDb, testPrisma, TEST_TENANT_ID } from './helpers/app';
import { createEmptyIntakeFromSchema } from '../../src/services/intake';
import { loadProfile } from '../../src/config/loader';

const OTHER_TENANT_ID = '00000000-0000-0000-0000-000000000002';

describe('job mutations', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let userId: string;
  let openJobId: string;
  let otherTenantJobId: string;

  beforeEach(async () => {
    userId = await seedTenantAndUser();
    app = await buildTestApp();

    // Job del tenant de test con un intake vacío completo (estructura por secciones),
    // así PATCH puede escribir cualquier campo del schema.
    const profile = await loadProfile('./profiles/tapiceria');
    const emptyIntake = createEmptyIntakeFromSchema(profile.intakeSchema);

    const contact = await testPrisma.contact.create({
      data: { tenantId: TEST_TENANT_ID, phoneE164: '+34600000001', displayName: 'Cliente A' },
    });
    const openJob = await testPrisma.job.create({
      data: {
        tenantId: TEST_TENANT_ID,
        contactId: contact.id,
        status: 'OPEN_INTAKE',
        intake: JSON.stringify(emptyIntake),
      },
    });
    openJobId = openJob.id;

    // Segundo tenant + su propio job: NUNCA debe ser mutable desde el tenant de test.
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
        intake: JSON.stringify(createEmptyIntakeFromSchema(profile.intakeSchema)),
      },
    });
    otherTenantJobId = otherJob.id;
  });

  afterAll(async () => { await cleanupDb(); });

  it('PATCH /jobs/:id/intake actualiza y persiste', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/jobs/${openJobId}/intake`,
      headers: await authHeader(app, userId),
      payload: { path: 'client.name', value: 'Ana' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);

    // Re-GET muestra el valor persistido (bulkUpdate guarda field objects).
    const get = await app.inject({ method: 'GET', url: `/jobs/${openJobId}`, headers: await authHeader(app, userId) });
    expect(get.statusCode).toBe(200);
    expect(get.json().intake.client.name.value).toBe('Ana');
  });

  it('PATCH /jobs/:id/intake con path inválido → 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/jobs/${openJobId}/intake`,
      headers: await authHeader(app, userId),
      payload: { path: 'nope.bad', value: 'x' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /jobs/:id/actions { action: close } → 200 CLOSED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/jobs/${openJobId}/actions`,
      headers: await authHeader(app, userId),
      payload: { action: 'close' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('CLOSED');
  });

  it('POST /jobs/:id/actions { action: mark_ready } con summary corto → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/jobs/${openJobId}/actions`,
      headers: await authHeader(app, userId),
      payload: { action: 'mark_ready', summary: 'corto' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /jobs/:id/actions { action: mark_ready } sobre job ya cerrado → 400 (transición inválida)', async () => {
    const headers = await authHeader(app, userId);
    // Cerrar primero; markReadyForReview exige status OPEN_INTAKE → debe fallar con 400.
    await app.inject({ method: 'POST', url: `/jobs/${openJobId}/actions`, headers, payload: { action: 'close' } });
    const res = await app.inject({
      method: 'POST',
      url: `/jobs/${openJobId}/actions`,
      headers,
      payload: { action: 'mark_ready', summary: 'Resumen suficientemente largo para superar el mínimo de 20 chars.' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /jobs/:id/actions { action: mark_ready } con intake completo → 200 READY_FOR_REVIEW', async () => {
    const headers = await authHeader(app, userId);
    // Satisface los campos requeridos del schema tapicería vía PATCH.
    const required: Array<{ path: string; value: string | number }> = [
      { path: 'client.name', value: 'Ana' },
      { path: 'client.city_or_zone', value: 'CDMX' },
      { path: 'work.item_type', value: 'sillón 3 plazas' },
      { path: 'work.service_type', value: 'retapizar' },
      { path: 'work.quantity', value: 1 },
    ];
    for (const u of required) {
      const r = await app.inject({ method: 'PATCH', url: `/jobs/${openJobId}/intake`, headers, payload: u });
      expect(r.statusCode).toBe(200);
    }
    const res = await app.inject({
      method: 'POST',
      url: `/jobs/${openJobId}/actions`,
      headers,
      payload: { action: 'mark_ready', summary: 'Cliente Ana en CDMX, retapizar 1 sillón de 3 plazas.' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('READY_FOR_REVIEW');
  });

  it('mutaciones sobre el job de otro tenant → 404', async () => {
    const headers = await authHeader(app, userId);
    const patch = await app.inject({
      method: 'PATCH',
      url: `/jobs/${otherTenantJobId}/intake`,
      headers,
      payload: { path: 'client.name', value: 'X' },
    });
    expect(patch.statusCode).toBe(404);

    const action = await app.inject({
      method: 'POST',
      url: `/jobs/${otherTenantJobId}/actions`,
      headers,
      payload: { action: 'close' },
    });
    expect(action.statusCode).toBe(404);
  });
});
