import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildTestApp, testPrisma, cleanupDb } from './helpers/app';
import { seedTestPlan, TEST_PLAN_ID } from '../../tests/helpers/db';
import { clearTenantProfileCache } from '../src/lib/tenant-profile';

const BASE_SCHEMA = {
  $businessName: 'Taller Demo',
  $businessDomain: 'tapicería',
  $language: 'es-MX',
  sections: [
    { key: 'client', label: 'Cliente', fields: [{ key: 'name', label: 'Nombre', type: 'string', required: true }] },
  ],
};

async function seedTenant(schema: unknown = BASE_SCHEMA) {
  const tenant = await testPrisma.tenant.create({
    data: { slug: `s-${Date.now()}-${Math.random()}`, name: 'T', industry: 'tapiceria', profileDir: './profiles/tapiceria', approvalStatus: 'approved' },
  });
  const admin = await testPrisma.panelUser.create({
    data: { tenantId: tenant.id, username: `a-${Date.now()}-${Math.random()}`, passwordHash: 'x', role: 'admin' },
  });
  const viewer = await testPrisma.panelUser.create({
    data: { tenantId: tenant.id, username: `v-${Date.now()}-${Math.random()}`, passwordHash: 'x', role: 'viewer' },
  });
  await seedTestPlan();
  await testPrisma.subscription.create({
    data: { tenantId: tenant.id, planId: TEST_PLAN_ID, stripeCustomerId: `cus_${tenant.id}`, status: 'active' },
  });
  await testPrisma.tenantSettings.create({
    data: {
      tenantId: tenant.id,
      industry: 'tapiceria',
      businessName: 'Taller Demo',
      businessDomain: 'tapicería',
      ownerPhoneE164: '',
      welcomeTemplate: 'hola',
      intakeSchema: schema as object,
    },
  });
  clearTenantProfileCache(tenant.id);
  return { tenantId: tenant.id, adminId: admin.id, viewerId: viewer.id };
}

describe('campos del intake (qué pregunta el asistente)', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    await cleanupDb();
    clearTenantProfileCache();
    app = await buildTestApp();
  });
  afterAll(async () => { await cleanupDb(); });

  const auth = (tenantId: string, userId: string, role = 'admin') => ({
    authorization: `Bearer ${app.jwt.sign({ userId, tenantId, role })}`,
  });

  it('GET /settings devuelve los campos del TENANT, no la plantilla del giro', async () => {
    // El schema del tenant tiene una sola sección; el archivo de tapicería tiene cuatro.
    const { tenantId, adminId } = await seedTenant();
    const body = (await app.inject({ method: 'GET', url: '/settings', headers: auth(tenantId, adminId) })).json();
    expect(body.fields.map((s: any) => s.key)).toEqual(['client']);
  });

  it('guarda campos nuevos y el bot los ve (misma fila que lee el worker)', async () => {
    const { tenantId, adminId } = await seedTenant();
    const sections = [
      {
        key: 'client',
        label: 'Cliente',
        fields: [
          { key: 'name', label: 'Nombre', type: 'string', required: true },
          { key: 'city', label: 'Ciudad', type: 'string', required: false },
        ],
      },
    ];
    const res = await app.inject({ method: 'PUT', url: '/settings/fields', headers: auth(tenantId, adminId), payload: { sections } });
    expect(res.statusCode).toBe(200);
    expect(res.json().fields[0].fields).toHaveLength(2);

    const row = await testPrisma.tenantSettings.findUnique({ where: { tenantId } });
    const saved = row!.intakeSchema as any;
    expect(saved.sections[0].fields.map((f: any) => f.key)).toEqual(['name', 'city']);
    // La identidad del negocio no se toca al editar campos.
    expect(saved.$businessName).toBe('Taller Demo');
    expect(saved.$language).toBe('es-MX');
  });

  it('rechaza un schema inválido sin tocar lo guardado', async () => {
    const { tenantId, adminId } = await seedTenant();
    const malo = [
      { key: 'work', label: 'Trabajo', fields: [{ key: 'tipo', label: 'Tipo', type: 'enum' }] }, // enum sin options
    ];
    const res = await app.inject({ method: 'PUT', url: '/settings/fields', headers: auth(tenantId, adminId), payload: { sections: malo } });
    expect(res.statusCode).toBe(400);

    const row = await testPrisma.tenantSettings.findUnique({ where: { tenantId } });
    expect((row!.intakeSchema as any).sections[0].fields[0].key).toBe('name');
  });

  it('rechaza claves duplicadas dentro de una sección', async () => {
    const { tenantId, adminId } = await seedTenant();
    const dup = [
      {
        key: 'client',
        label: 'Cliente',
        fields: [
          { key: 'name', label: 'Nombre', type: 'string' },
          { key: 'name', label: 'Otro nombre', type: 'string' },
        ],
      },
    ];
    const res = await app.inject({ method: 'PUT', url: '/settings/fields', headers: auth(tenantId, adminId), payload: { sections: dup } });
    expect(res.statusCode).toBe(400);
  });

  it('exige al menos una sección', async () => {
    const { tenantId, adminId } = await seedTenant();
    const res = await app.inject({ method: 'PUT', url: '/settings/fields', headers: auth(tenantId, adminId), payload: { sections: [] } });
    expect(res.statusCode).toBe(400);
  });

  it('un viewer no puede cambiar los campos', async () => {
    const { tenantId, viewerId } = await seedTenant();
    const res = await app.inject({
      method: 'PUT', url: '/settings/fields',
      headers: auth(tenantId, viewerId, 'viewer'),
      payload: { sections: BASE_SCHEMA.sections },
    });
    expect(res.statusCode).toBe(403);
  });

  it('sin sesión → 401', async () => {
    const res = await app.inject({ method: 'PUT', url: '/settings/fields', payload: { sections: BASE_SCHEMA.sections } });
    expect(res.statusCode).toBe(401);
  });

  it('tras guardar, el siguiente GET ya devuelve lo nuevo (caché invalidada)', async () => {
    const { tenantId, adminId } = await seedTenant();
    // Calienta la caché.
    await app.inject({ method: 'GET', url: '/settings', headers: auth(tenantId, adminId) });

    const sections = [
      { key: 'client', label: 'Cliente', fields: [{ key: 'name', label: 'Nombre', type: 'string', required: true }] },
      { key: 'work', label: 'Trabajo', fields: [{ key: 'detalle', label: 'Detalle', type: 'text', required: true }] },
    ];
    await app.inject({ method: 'PUT', url: '/settings/fields', headers: auth(tenantId, adminId), payload: { sections } });

    const body = (await app.inject({ method: 'GET', url: '/settings', headers: auth(tenantId, adminId) })).json();
    expect(body.fields.map((s: any) => s.key)).toEqual(['client', 'work']);
  });

  it('si el schema guardado es inválido, el panel cae a los archivos en vez de romperse', async () => {
    const { tenantId, adminId } = await seedTenant({ roto: true });
    const res = await app.inject({ method: 'GET', url: '/settings', headers: auth(tenantId, adminId) });
    expect(res.statusCode).toBe(200);
    // Las secciones del perfil de tapicería.
    expect(res.json().fields.length).toBeGreaterThan(0);
  });
});
