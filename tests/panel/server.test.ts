import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { createPanelServer } from '../../src/panel/server';
import { hashPassword, COOKIE_NAME } from '../../src/panel/auth';
import { NullConnectionStateProvider } from '../../src/panel/adapter-state';
import type { Profile, Config } from '../../src/config/schema';
import type { FastifyInstance } from 'fastify';
import { upsertContactByPhone } from '../../src/services/contact';
import { openJob } from '../../src/services/job';
import { createEmptyIntakeFromSchema } from '../../src/services/intake';

const adapter = new PrismaBetterSqlite3({ url: 'file:./data/intake.db' });
const prisma = new PrismaClient({ adapter });

const profile: Profile = {
  intakeSchema: {
    $businessName: 'Tapicería Demo',
    $businessDomain: 'tapicería',
    $language: 'es-MX',
    sections: [
      {
        key: 'client',
        label: 'Cliente',
        fields: [{ key: 'name', label: 'Nombre', type: 'string', required: true }],
      },
    ],
  },
  promptVars: { promptTemplate: 'x', vars: {} },
  businessFacts: { facts: [], freeContext: '' },
  welcome: 'hola',
  hash: 'h',
};

const baseConfig = (passwordHash: string): Config =>
  ({
    profile: './profiles/tapiceria',
    model: 'x',
    maxSteps: 6,
    temperature: 0.4,
    debounceMs: 1000,
    fallbackOnError: 'x',
    outOfScopeNudge: '',
    hours: { enabled: false, timezone: 'UTC', schedule: {}, outOfHoursNotice: '' },
    owner: { phoneE164: '+1', notifyOnReady: false, notifyOnDisconnect: false, panelUrl: 'http://localhost' },
    panel: { users: [{ username: 'duenio', passwordHashEnv: 'TEST_PANEL_HASH' }] },
    media: { storeDir: './media', transcribeAudio: false, whisperModel: 'x' },
    limits: { monthlyCostUsd: 50, alertOnCostUsd: 40, maxConsecutiveErrors: 3 },
  }) as Config;

let server: FastifyInstance;
let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashPassword('secret');
  process.env.TEST_PANEL_HASH = passwordHash;
  process.env.PANEL_SESSION_SECRET = 'test-session-secret';
  server = await createPanelServer({
    prisma,
    config: baseConfig(passwordHash),
    profile,
    adapterState: new NullConnectionStateProvider(),
  });
});

afterAll(async () => {
  await server.close();
  await prisma.$disconnect();
});

describe('panel server', () => {
  it('GET /panel/login muestra formulario', async () => {
    const res = await server.inject({ method: 'GET', url: '/panel/login' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Usuario');
    expect(res.body).toContain('Contraseña');
  });

  it('GET /panel/dashboard sin sesión redirige a login', async () => {
    const res = await server.inject({ method: 'GET', url: '/panel/dashboard' });
    expect([302, 303]).toContain(res.statusCode);
    expect(res.headers.location).toBe('/panel/login');
  });

  it('POST /panel/login con credenciales correctas crea sesión y redirige', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/panel/login',
      payload: 'username=duenio&password=secret',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect([302, 303]).toContain(res.statusCode);
    expect(res.headers.location).toBe('/panel/dashboard');
    expect(res.headers['set-cookie']).toContain(COOKIE_NAME);
  });

  it('POST /panel/login con credenciales incorrectas devuelve 401', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/panel/login',
      payload: 'username=duenio&password=mala',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.body).toContain('Credenciales');
  });

  it('GET / redirige a dashboard si está logueado', async () => {
    const login = await server.inject({
      method: 'POST',
      url: '/panel/login',
      payload: 'username=duenio&password=secret',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    const cookie = login.headers['set-cookie'] as string;
    const res = await server.inject({
      method: 'GET',
      url: '/',
      headers: { cookie },
    });
    expect([302, 303]).toContain(res.statusCode);
    expect(res.headers.location).toBe('/panel/dashboard');
  });
});

describe('panel job detail', () => {
  it('GET /panel/jobs/:id muestra la conversación', async () => {
    const c = await upsertContactByPhone(prisma, '+5219999');
    const j = await openJob(prisma, c.id, createEmptyIntakeFromSchema(profile.intakeSchema));
    await prisma.message.create({
      data: {
        contactId: c.id,
        jobId: j.id,
        direction: 'inbound',
        kind: 'text',
        body: 'Hola test',
        whatsappMsgId: `t_${Date.now()}`,
      },
    });
    const login = await server.inject({
      method: 'POST',
      url: '/panel/login',
      payload: 'username=duenio&password=secret',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    const cookie = login.headers['set-cookie'] as string;
    const res = await server.inject({
      method: 'GET',
      url: `/panel/jobs/${j.id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Hola test');
    expect(res.body).toContain(c.phoneE164);
  });
});
