import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { buildTestApp, testPrisma, cleanupDb } from './helpers/app';
import { seedTestPlan, TEST_PLAN_ID } from '../../tests/helpers/db';
import { clearTenantProfileCache } from '../src/lib/tenant-profile';
import { configChat, type ConfigSnapshot } from '../src/services/assist';

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

function fakeLlm(content: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 }),
  ) as unknown as typeof fetch;
}

const SNAPSHOT: ConfigSnapshot = {
  businessName: 'Taller Demo',
  businessDomain: 'tapicería',
  welcome: '',
  tone: '',
  freeContext: '',
  facts: [],
  sections: [],
};

describe('asistente conversacional de configuración (servicio)', () => {
  it('sin API key no llama a nadie', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const out = await configChat([{ role: 'user', content: 'hola' }], SNAPSHOT, { apiKey: undefined, fetcher });
    expect(out).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('devuelve la respuesta y el cambio propuesto', async () => {
    const fetcher = fakeLlm({
      reply: '¿Qué te preguntan más tus clientes?',
      patch: { businessName: 'Tapicería El Roble', facts: [{ topic: 'horarios', answer: 'De 9 a 7.' }] },
      done: false,
    });
    const out = await configChat([{ role: 'user', content: 'me llamo Tapicería El Roble' }], SNAPSHOT, { apiKey: 'k', fetcher });
    expect(out!.reply).toContain('preguntan');
    expect(out!.patch!.businessName).toBe('Tapicería El Roble');
    expect(out!.patch!.facts).toHaveLength(1);
    expect(out!.done).toBe(false);
  });

  it('manda el historial y lo que hay en el formulario al modelo', async () => {
    const fetcher = fakeLlm({ reply: 'ok', patch: null, done: false });
    await configChat(
      [
        { role: 'user', content: 'hola' },
        { role: 'assistant', content: '¿a qué te dedicas?' },
        { role: 'user', content: 'tapicería' },
      ],
      { ...SNAPSHOT, welcome: 'Buenas, ¿en qué te ayudo?' },
      { apiKey: 'k', fetcher },
    );
    const body = JSON.parse((fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    // system (instrucciones) + system (estado del panel) + los 3 turnos.
    expect(body.messages).toHaveLength(5);
    expect(body.messages[1].content).toContain('Buenas, ¿en qué te ayudo?');
    expect(body.messages[4]).toEqual({ role: 'user', content: 'tapicería' });
  });

  it('un turno que solo pregunta no trae cambios', async () => {
    const fetcher = fakeLlm({ reply: '¿Cobras anticipo?', done: false });
    const out = await configChat([{ role: 'user', content: 'hola' }], SNAPSHOT, { apiKey: 'k', fetcher });
    expect(out!.patch).toBeNull();
  });

  it('descarta las listas de opciones que vienen vacías', async () => {
    const fetcher = fakeLlm({
      reply: 'te propongo esto',
      patch: {
        sections: [
          {
            label: 'Trabajo',
            fields: [
              { label: 'Tipo de mueble', type: 'enum', required: true }, // sin options
              { label: 'Medidas', type: 'string', required: false },
            ],
          },
        ],
      },
      done: false,
    });
    const out = await configChat([{ role: 'user', content: 'x' }], SNAPSHOT, { apiKey: 'k', fetcher });
    expect(out!.patch!.sections![0].fields.map((f) => f.label)).toEqual(['Medidas']);
  });

  it('si al limpiar no queda nada, no anuncia un cambio que no existe', async () => {
    const fetcher = fakeLlm({
      reply: 'te propongo esto',
      patch: { sections: [{ label: 'Trabajo', fields: [{ label: 'Tipo', type: 'enum' }] }] },
      done: false,
    });
    const out = await configChat([{ role: 'user', content: 'x' }], SNAPSHOT, { apiKey: 'k', fetcher });
    expect(out!.patch).toBeNull();
  });

  it('una respuesta con forma inesperada se descarta entera', async () => {
    const fetcher = fakeLlm({ respuesta: 'hola' });
    expect(await configChat([{ role: 'user', content: 'x' }], SNAPSHOT, { apiKey: 'k', fetcher })).toBeNull();
  });

  it('un error de red no revienta', async () => {
    const fetcher = vi.fn(async () => { throw new Error('sin red'); }) as unknown as typeof fetch;
    expect(await configChat([{ role: 'user', content: 'x' }], SNAPSHOT, { apiKey: 'k', fetcher })).toBeNull();
  });
});

describe('POST /settings/assist/chat', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    await cleanupDb();
    clearTenantProfileCache();
  });
  afterAll(async () => { await cleanupDb(); });

  const auth = (tenantId: string, userId: string, role = 'admin') => ({
    authorization: `Bearer ${app.jwt.sign({ userId, tenantId, role })}`,
  });

  const payload = (content = 'nos dedicamos a tapizar sillones') => ({
    messages: [{ role: 'user', content }],
    snapshot: SNAPSHOT,
  });

  it('responde y NO guarda nada en la configuración del tenant', async () => {
    app = await buildTestApp({
      assistDeps: {
        apiKey: 'k',
        fetcher: fakeLlm({
          reply: 'Listo, ¿qué necesitas saber de cada cliente?',
          patch: { businessDomain: 'tapicería de sillones' },
          done: false,
        }),
      },
    });
    const { tenantId, adminId } = await seedTenant();
    const res = await app.inject({
      method: 'POST', url: '/settings/assist/chat', headers: auth(tenantId, adminId), payload: payload(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().patch.businessDomain).toBe('tapicería de sillones');

    const row = await testPrisma.tenantSettings.findUnique({ where: { tenantId } });
    expect(row!.businessDomain).toBe('tapicería');
    expect((row!.intakeSchema as any).sections).toHaveLength(1);
  });

  it('funciona sin snapshot: el panel puede no mandarlo', async () => {
    app = await buildTestApp({ assistDeps: { apiKey: 'k', fetcher: fakeLlm({ reply: 'hola', done: false }) } });
    const { tenantId, adminId } = await seedTenant();
    const res = await app.inject({
      method: 'POST', url: '/settings/assist/chat', headers: auth(tenantId, adminId),
      payload: { messages: [{ role: 'user', content: 'hola' }] },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rechaza que el asistente hable dos veces seguidas', async () => {
    app = await buildTestApp({ assistDeps: { apiKey: 'k', fetcher: fakeLlm({ reply: 'x', done: false }) } });
    const { tenantId, adminId } = await seedTenant();
    const res = await app.inject({
      method: 'POST', url: '/settings/assist/chat', headers: auth(tenantId, adminId),
      payload: { messages: [{ role: 'assistant', content: 'hola' }], snapshot: SNAPSHOT },
    });
    expect(res.statusCode).toBe(400);
  });

  it('acota el hilo: un historial desmedido se rechaza', async () => {
    app = await buildTestApp({ assistDeps: { apiKey: 'k', fetcher: fakeLlm({ reply: 'x', done: false }) } });
    const { tenantId, adminId } = await seedTenant();
    const messages = Array.from({ length: 31 }, () => ({ role: 'user', content: 'hola' }));
    const res = await app.inject({
      method: 'POST', url: '/settings/assist/chat', headers: auth(tenantId, adminId),
      payload: { messages, snapshot: SNAPSHOT },
    });
    expect(res.statusCode).toBe(400);
  });

  it('sin modelo configurado responde 503', async () => {
    app = await buildTestApp({ assistDeps: { apiKey: undefined } });
    const { tenantId, adminId } = await seedTenant();
    const res = await app.inject({
      method: 'POST', url: '/settings/assist/chat', headers: auth(tenantId, adminId), payload: payload(),
    });
    expect(res.statusCode).toBe(503);
  });

  it('si el modelo falla lo dice en vez de devolver basura', async () => {
    const fetcher = vi.fn(async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    app = await buildTestApp({ assistDeps: { apiKey: 'k', fetcher } });
    const { tenantId, adminId } = await seedTenant();
    const res = await app.inject({
      method: 'POST', url: '/settings/assist/chat', headers: auth(tenantId, adminId), payload: payload(),
    });
    expect(res.statusCode).toBe(502);
  });

  it('un viewer no puede gastar llamadas al modelo', async () => {
    app = await buildTestApp({ assistDeps: { apiKey: 'k', fetcher: fakeLlm({ reply: 'x', done: false }) } });
    const { tenantId, adminId } = await seedTenant();
    const res = await app.inject({
      method: 'POST', url: '/settings/assist/chat', headers: auth(tenantId, adminId, 'viewer'), payload: payload(),
    });
    expect(res.statusCode).toBe(403);
  });

  it('sin sesión → 401', async () => {
    app = await buildTestApp({ assistDeps: { apiKey: 'k' } });
    const res = await app.inject({ method: 'POST', url: '/settings/assist/chat', payload: payload() });
    expect(res.statusCode).toBe(401);
  });
});
