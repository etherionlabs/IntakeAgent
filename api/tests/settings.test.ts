import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtemp, copyFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTestApp, testPrisma, cleanupDb } from './helpers/app';
import { seedTestPlan, TEST_PLAN_ID } from '../../tests/helpers/db';

const TEST_JWT_SECRET = 'test-jwt-secret';

/** Crea un tenant con un profileDir temporal (copia del perfil real) + un admin. */
async function seedTenantWithTempProfile() {
  const dir = await mkdtemp(join(tmpdir(), 'intake-profile-'));
  for (const f of ['intake-schema.json', 'prompt-vars.json', 'business-facts.json', 'welcome.txt']) {
    await copyFile(join('./profiles/tapiceria', f), join(dir, f));
  }
  const tenant = await testPrisma.tenant.create({
    // approved: espejo del backfill (v1 free) para que el enforcement no dé 403.
    data: { slug: `s-${Date.now()}`, name: 'T', industry: 'test', profileDir: dir, approvalStatus: 'approved' },
  });
  const user = await testPrisma.panelUser.create({
    data: { tenantId: tenant.id, username: `u-${Date.now()}`, passwordHash: 'x', role: 'admin' },
  });
  await seedTestPlan();
  await testPrisma.subscription.create({
    data: { tenantId: tenant.id, planId: TEST_PLAN_ID, stripeCustomerId: `cus_${tenant.id}`, status: 'active' },
  });
  return { tenantId: tenant.id, userId: user.id, profileDir: dir };
}

/** Copia config.json a un archivo temporal y apunta CONFIG_PATH ahí. */
async function useTempConfig() {
  const dir = await mkdtemp(join(tmpdir(), 'intake-config-'));
  const path = join(dir, 'config.json');
  await copyFile('./config.json', path);
  process.env.CONFIG_PATH = path;
  return path;
}

describe('settings', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    await cleanupDb();
    app = await buildTestApp();
  });
  afterAll(async () => {
    await cleanupDb();
    delete process.env.CONFIG_PATH;
  });

  function admin(tenantId: string, userId: string) {
    const token = app.jwt.sign({ userId, tenantId, role: 'admin' });
    return { authorization: `Bearer ${token}` };
  }
  function viewer(tenantId: string, userId: string) {
    const token = app.jwt.sign({ userId, tenantId, role: 'viewer' });
    return { authorization: `Bearer ${token}` };
  }

  it('GET /settings devuelve perfil pero config null (config global no se expone al tenant)', async () => {
    const { tenantId, userId } = await seedTenantWithTempProfile();
    await useTempConfig();
    const res = await app.inject({ method: 'GET', url: '/settings', headers: admin(tenantId, userId) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.profile.businessName).toBeTruthy();
    expect(body.profile.vars.tone).toBeTruthy();
    expect(Array.isArray(body.profile.businessFacts.facts)).toBe(true);
    expect(body.config).toBeNull();
  });

  it('GET /settings sin auth → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/settings' });
    expect(res.statusCode).toBe(401);
  });

  it('PUT /settings/profile persiste en DB (compartida con el worker) sin tocar archivos', async () => {
    const { tenantId, userId, profileDir } = await seedTenantWithTempProfile();
    const current = (await app.inject({ method: 'GET', url: '/settings', headers: admin(tenantId, userId) })).json();
    const payload = {
      ...current.profile,
      businessName: 'Mecánica Nueva',
      businessDomain: 'mecánica automotriz',
      welcome: '¡Bienvenido al taller!',
      vars: { ...current.profile.vars, tone: 'Tono actualizado' },
      businessFacts: {
        facts: [{ topic: 'envíos', aliases: [], answer: 'Hacemos envíos a todo el país.' }],
        freeContext: 'Contexto nuevo.',
      },
    };
    const res = await app.inject({ method: 'PUT', url: '/settings/profile', headers: admin(tenantId, userId), payload });
    expect(res.statusCode).toBe(200);
    expect(res.json().profile.businessName).toBe('Mecánica Nueva');

    // Un GET posterior (lo que vería el worker al releer la DB) refleja el cambio.
    const after = (await app.inject({ method: 'GET', url: '/settings', headers: admin(tenantId, userId) })).json();
    expect(after.profile.businessName).toBe('Mecánica Nueva');
    expect(after.profile.businessDomain).toBe('mecánica automotriz');
    expect(after.profile.welcome).toBe('¡Bienvenido al taller!');
    expect(after.profile.vars.tone).toBe('Tono actualizado');
    expect(after.profile.businessFacts.facts[0].topic).toBe('envíos');

    // El override se guardó en la tabla Setting (recurso compartido con el worker).
    const row = await testPrisma.setting.findUnique({ where: { key: `profile:${tenantId}` } });
    expect(row).not.toBeNull();
    expect(JSON.parse(row!.value).businessDomain).toBe('mecánica automotriz');

    // Los archivos base NO se mutan (defaults intactos; el override vive en DB).
    const schema = JSON.parse(await readFile(join(profileDir, 'intake-schema.json'), 'utf-8'));
    expect(schema.$businessName).toBe('Tapicería Demo');
    expect(Array.isArray(schema.sections)).toBe(true);
  });

  it('PUT /settings/profile rechaza payload inválido → 400', async () => {
    const { tenantId, userId } = await seedTenantWithTempProfile();
    const res = await app.inject({
      method: 'PUT',
      url: '/settings/profile',
      headers: admin(tenantId, userId),
      payload: { businessName: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PUT /settings/profile con rol viewer → 403', async () => {
    const { tenantId, userId } = await seedTenantWithTempProfile();
    const res = await app.inject({
      method: 'PUT',
      url: '/settings/profile',
      headers: viewer(tenantId, userId),
      payload: { businessName: 'x', businessDomain: 'y', welcome: 'z', vars: {}, businessFacts: { facts: [], freeContext: '' } },
    });
    expect(res.statusCode).toBe(403);
  });

  it('PUT /settings/config → 403 (config global, no editable desde el panel del tenant) y NO escribe el override', async () => {
    const { tenantId, userId } = await seedTenantWithTempProfile();
    await useTempConfig();
    const res = await app.inject({
      method: 'PUT',
      url: '/settings/config',
      headers: admin(tenantId, userId),
      payload: { model: 'openai/gpt-4o', temperature: 0.7, maxSteps: 6, hours: { enabled: false, timezone: 'x', schedule: {}, outOfHoursNotice: '' }, owner: { phoneE164: '+10000000000', notifyOnReady: true, notifyOnDisconnect: true, panelUrl: 'http://x' }, limits: { monthlyCostUsd: 99, alertOnCostUsd: 40, maxConsecutiveErrors: 3 } },
    });
    expect(res.statusCode).toBe(403);
    // No se creó/modificó el override global.
    const row = await testPrisma.setting.findUnique({ where: { key: 'config' } });
    expect(row).toBeNull();
  });

  /** Crea la fila TenantSettings del tenant (los tenants provisionados siempre la tienen). */
  async function seedTenantSettings(tenantId: string, over: Partial<{ describeImages: boolean; transcribeAudio: boolean }> = {}) {
    await testPrisma.tenantSettings.create({
      data: {
        tenantId,
        industry: 'tapiceria',
        businessName: 'T',
        businessDomain: 'tapicería de muebles',
        ownerPhoneE164: '',
        welcomeTemplate: 'hola',
        intakeSchema: {},
        describeImages: over.describeImages ?? false,
        transcribeAudio: over.transcribeAudio ?? false,
      },
    });
  }

  it('GET /settings incluye media desde TenantSettings', async () => {
    const { tenantId, userId } = await seedTenantWithTempProfile();
    await seedTenantSettings(tenantId, { describeImages: true });
    await useTempConfig();
    const res = await app.inject({ method: 'GET', url: '/settings', headers: admin(tenantId, userId) });
    expect(res.statusCode).toBe(200);
    // skills null en la fila → hereda las referenciadas por el perfil. Todos los
    // giros adoptan la venta consultiva, así que tapicería hereda ['ventas'].
    expect(res.json().media).toEqual({ describeImages: true, transcribeAudio: false, editImages: false, skills: ['ventas'] });
  });

  it('GET /settings sin fila TenantSettings → media null (tenant legado)', async () => {
    const { tenantId, userId } = await seedTenantWithTempProfile();
    await useTempConfig();
    const res = await app.inject({ method: 'GET', url: '/settings', headers: admin(tenantId, userId) });
    expect(res.statusCode).toBe(200);
    expect(res.json().media).toBeNull();
  });

  it('PUT /settings/media persiste los toggles en TenantSettings', async () => {
    const { tenantId, userId } = await seedTenantWithTempProfile();
    await seedTenantSettings(tenantId);
    const res = await app.inject({
      method: 'PUT',
      url: '/settings/media',
      headers: admin(tenantId, userId),
      payload: { describeImages: true, transcribeAudio: true, editImages: true, skills: [] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().media).toEqual({ describeImages: true, transcribeAudio: true, editImages: true, skills: [] });
    const row = await testPrisma.tenantSettings.findUnique({ where: { tenantId } });
    expect(row!.describeImages).toBe(true);
    expect(row!.transcribeAudio).toBe(true);
    expect(row!.editImages).toBe(true);
  });

  it('PUT /settings/media guarda skills válidas y descarta las desconocidas', async () => {
    const { tenantId, userId } = await seedTenantWithTempProfile();
    await seedTenantSettings(tenantId);
    const res = await app.inject({
      method: 'PUT',
      url: '/settings/media',
      headers: admin(tenantId, userId),
      payload: { describeImages: false, transcribeAudio: false, editImages: false, skills: ['ventas', 'no-existe-xyz'] },
    });
    expect(res.statusCode).toBe(200);
    // 'ventas' existe en el catálogo; 'no-existe-xyz' se descarta.
    expect(res.json().media.skills).toEqual(['ventas']);
    const row = await testPrisma.tenantSettings.findUnique({ where: { tenantId } });
    expect(row!.skills).toEqual(['ventas']);
  });

  it('PUT /settings/media con payload inválido → 400', async () => {
    const { tenantId, userId } = await seedTenantWithTempProfile();
    await seedTenantSettings(tenantId);
    const res = await app.inject({
      method: 'PUT',
      url: '/settings/media',
      headers: admin(tenantId, userId),
      payload: { describeImages: 'sí' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PUT /settings/media con rol viewer → 403', async () => {
    const { tenantId, userId } = await seedTenantWithTempProfile();
    await seedTenantSettings(tenantId);
    const res = await app.inject({
      method: 'PUT',
      url: '/settings/media',
      headers: viewer(tenantId, userId),
      payload: { describeImages: true, transcribeAudio: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it('PUT /settings/media sin fila TenantSettings → 404', async () => {
    const { tenantId, userId } = await seedTenantWithTempProfile();
    const res = await app.inject({
      method: 'PUT',
      url: '/settings/media',
      headers: admin(tenantId, userId),
      payload: { describeImages: true, transcribeAudio: true, editImages: false, skills: [] },
    });
    expect(res.statusCode).toBe(404);
  });
});
