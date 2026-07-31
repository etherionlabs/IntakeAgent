import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { buildTestApp, testPrisma, cleanupDb } from './helpers/app';
import { seedTestPlan, TEST_PLAN_ID } from '../../tests/helpers/db';
import { clearTenantProfileCache } from '../src/lib/tenant-profile';
import { suggestFields, suggestFacts, assistAvailable } from '../src/services/assist';

const SCHEMA = {
  $businessName: 'Taller Demo',
  $businessDomain: 'tapicería',
  $language: 'es-MX',
  sections: [
    { key: 'client', label: 'Cliente', fields: [{ key: 'name', label: 'Nombre', type: 'string', required: true }] },
  ],
};

async function seedTenant() {
  const tenant = await testPrisma.tenant.create({
    data: { slug: `s-${Date.now()}-${Math.random()}`, name: 'T', industry: 'tapiceria', profileDir: './profiles/tapiceria', approvalStatus: 'approved' },
  });
  const admin = await testPrisma.panelUser.create({
    data: { tenantId: tenant.id, username: `a-${Date.now()}-${Math.random()}`, passwordHash: 'x', role: 'admin' },
  });
  await seedTestPlan();
  await testPrisma.subscription.create({
    data: { tenantId: tenant.id, planId: TEST_PLAN_ID, stripeCustomerId: `cus_${tenant.id}`, status: 'active' },
  });
  await testPrisma.tenantSettings.create({
    data: {
      tenantId: tenant.id, industry: 'tapiceria', businessName: 'Taller Demo',
      businessDomain: 'tapicería', ownerPhoneE164: '', welcomeTemplate: 'hola',
      intakeSchema: SCHEMA as object,
    },
  });
  clearTenantProfileCache(tenant.id);
  return { tenantId: tenant.id, adminId: admin.id };
}

/** Falsea la respuesta de OpenRouter (choices[0].message.content = JSON). */
function fakeLlm(content: unknown, ok = true): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), {
      status: ok ? 200 : 500,
    }),
  ) as unknown as typeof fetch;
}

const CTX = { businessName: 'Taller Demo', businessDomain: 'tapicería' };

describe('asistente de configuración (servicio)', () => {
  it('sin API key no está disponible y no llama a nadie', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    expect(assistAvailable({ apiKey: undefined })).toBe(false);
    // `complete` corta antes de la llamada.
    expect(await suggestFacts('texto largo del negocio', CTX, { apiKey: undefined, fetcher })).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('convierte texto libre en datos estructurados', async () => {
    const fetcher = fakeLlm({ facts: [{ topic: 'horarios', answer: 'Lunes a viernes de 9 a 7.' }] });
    const out = await suggestFacts('abrimos de 9 a 7', CTX, { apiKey: 'k', fetcher });
    expect(out).toEqual({ facts: [{ topic: 'horarios', answer: 'Lunes a viernes de 9 a 7.' }] });
  });

  it('una respuesta que no encaja con lo esperado se descarta', async () => {
    const fetcher = fakeLlm({ facts: [{ tema: 'horarios' }] });
    expect(await suggestFacts('x'.repeat(20), CTX, { apiKey: 'k', fetcher })).toBeNull();
  });

  it('un error HTTP no revienta: devuelve null', async () => {
    const fetcher = vi.fn(async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;
    expect(await suggestFacts('x'.repeat(20), CTX, { apiKey: 'k', fetcher })).toBeNull();
  });

  it('una excepción de red tampoco revienta', async () => {
    const fetcher = vi.fn(async () => { throw new Error('sin red'); }) as unknown as typeof fetch;
    expect(await suggestFacts('x'.repeat(20), CTX, { apiKey: 'k', fetcher })).toBeNull();
  });

  it('descarta los campos de lista que vienen sin opciones (no pasarían la validación)', async () => {
    const fetcher = fakeLlm({
      sections: [
        {
          label: 'Trabajo',
          fields: [
            { label: 'Tipo de mueble', type: 'enum', required: true }, // sin options
            { label: 'Medidas', type: 'string', required: false },
          ],
        },
      ],
    });
    const out = await suggestFields('qué mueble y medidas', CTX, { apiKey: 'k', fetcher });
    expect(out!.sections[0].fields.map((f) => f.label)).toEqual(['Medidas']);
  });

  it('si al descartar no queda ningún campo, no devuelve una propuesta vacía', async () => {
    const fetcher = fakeLlm({
      sections: [{ label: 'Trabajo', fields: [{ label: 'Tipo', type: 'enum', required: true }] }],
    });
    expect(await suggestFields('x'.repeat(20), CTX, { apiKey: 'k', fetcher })).toBeNull();
  });
});

describe('POST /settings/assist', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    await cleanupDb();
    clearTenantProfileCache();
  });
  afterAll(async () => { await cleanupDb(); });

  const auth = (tenantId: string, userId: string, role = 'admin') => ({
    authorization: `Bearer ${app.jwt.sign({ userId, tenantId, role })}`,
  });

  it('devuelve la propuesta sin guardar nada', async () => {
    app = await buildTestApp({
      assistDeps: { apiKey: 'k', fetcher: fakeLlm({ facts: [{ topic: 'pago', answer: 'Aceptamos tarjeta.' }] }) },
    });
    const { tenantId, adminId } = await seedTenant();
    const res = await app.inject({
      method: 'POST', url: '/settings/assist', headers: auth(tenantId, adminId),
      payload: { action: 'facts', text: 'aceptamos tarjeta y transferencia' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().suggestion.facts[0].topic).toBe('pago');

    // Nada tocó la configuración del tenant.
    const row = await testPrisma.tenantSettings.findUnique({ where: { tenantId } });
    expect((row!.intakeSchema as any).sections).toHaveLength(1);
  });

  it('sin modelo configurado responde 503 y el panel lo oculta', async () => {
    app = await buildTestApp({ assistDeps: { apiKey: undefined } });
    const { tenantId, adminId } = await seedTenant();
    const status = await app.inject({ method: 'GET', url: '/settings/assist/status', headers: auth(tenantId, adminId) });
    expect(status.json().available).toBe(false);

    const res = await app.inject({
      method: 'POST', url: '/settings/assist', headers: auth(tenantId, adminId),
      payload: { action: 'facts', text: 'texto suficientemente largo' },
    });
    expect(res.statusCode).toBe(503);
  });

  it('pide un texto mínimo antes de gastar una llamada', async () => {
    app = await buildTestApp({ assistDeps: { apiKey: 'k', fetcher: fakeLlm({ facts: [] }) } });
    const { tenantId, adminId } = await seedTenant();
    const res = await app.inject({
      method: 'POST', url: '/settings/assist', headers: auth(tenantId, adminId),
      payload: { action: 'facts', text: 'poco' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('si el modelo falla, lo dice en vez de devolver basura', async () => {
    const fetcher = vi.fn(async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    app = await buildTestApp({ assistDeps: { apiKey: 'k', fetcher } });
    const { tenantId, adminId } = await seedTenant();
    const res = await app.inject({
      method: 'POST', url: '/settings/assist', headers: auth(tenantId, adminId),
      payload: { action: 'facts', text: 'texto suficientemente largo para pasar' },
    });
    expect(res.statusCode).toBe(502);
  });

  it('un viewer no puede gastar llamadas al modelo', async () => {
    app = await buildTestApp({ assistDeps: { apiKey: 'k', fetcher: fakeLlm({ facts: [] }) } });
    const { tenantId, adminId } = await seedTenant();
    const res = await app.inject({
      method: 'POST', url: '/settings/assist', headers: auth(tenantId, adminId, 'viewer'),
      payload: { action: 'facts', text: 'texto suficientemente largo' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('sin sesión → 401', async () => {
    app = await buildTestApp({ assistDeps: { apiKey: 'k' } });
    const res = await app.inject({ method: 'POST', url: '/settings/assist', payload: { action: 'facts', text: 'hola que tal' } });
    expect(res.statusCode).toBe(401);
  });
});
