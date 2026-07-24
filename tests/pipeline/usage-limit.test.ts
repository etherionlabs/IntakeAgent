import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { testPrisma as prisma, cleanupDb as cleanup, seedTestTenant, TEST_TENANT_ID } from '../helpers/db';
import { mkdtemp, rm } from 'node:fs/promises';
import { setTimeout as realDelay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilesystemMediaStore } from '../../src/media/store';
import { NoopTranscriber } from '../../src/media/transcriber';
import { NoopNotifier } from '../../src/services/notification';
import { MemorySender } from '../../src/services/outbound';
import { InboundCoordinator } from '../../src/pipeline/coordinator';
import { monthlyRunLimitFor, checkMonthlyLimit, startOfMonthUtc } from '../../src/pipeline/usageLimit';
import type { RawInboundMessage, PipelineDeps } from '../../src/pipeline/types';
import type { AgentFactory, AgentLike } from '../../src/agent/types';
import type { Config, Profile } from '../../src/config/schema';
import type { IntakeSchema } from '../../src/config/intake-schema';

const schema: IntakeSchema = {
  $businessName: 'Tapicería',
  $businessDomain: 'tapicería',
  $language: 'es-MX',
  sections: [
    { key: 'client', label: 'Cliente', fields: [{ key: 'name', label: 'Nombre', type: 'string', required: true }] },
  ],
};

const profile: Profile = {
  intakeSchema: schema,
  promptVars: { promptTemplate: 'X', vars: {} },
  businessFacts: { facts: [], freeContext: '' },
  welcome: '¡Hola! Soy el asistente.',
  imageFocus: '',
  imageEditGuidance: '',
  hash: 'h',
};

const config: Config = {
  profile: './profiles/tapiceria',
  model: 'm', maxSteps: 6, temperature: 0.4, debounceMs: 50,
  fallbackOnError: 'oops', outOfScopeNudge: '',
  hours: { enabled: false, timezone: 'UTC', schedule: {}, outOfHoursNotice: '' },
  owner: { phoneE164: '+5215', notifyOnReady: true, notifyOnDisconnect: true, panelUrl: 'http://x' },
  panel: { users: [] },
  media: { storeDir: './media', transcribeAudio: false, whisperModel: 'openai/whisper-1', describeImages: false, visionModel: 'openai/gpt-4o-mini', editImages: false, imageEditModel: 'google/gemini-2.5-flash-image-preview' },
  limits: { monthlyCostUsd: 50, alertOnCostUsd: 40, maxConsecutiveErrors: 3 },
} as Config;

let mediaRoot: string;

function rawMsg(overrides: Partial<RawInboundMessage> = {}): RawInboundMessage {
  return {
    externalMsgId: 'wa_' + Math.random().toString(36).slice(2),
    channel: 'whatsapp',
    fromPhoneE164: '+5215555',
    chatKind: 'individual',
    fromMe: false,
    kind: 'text',
    text: 'Hola, tengo un sillón roto',
    media: null,
    raw: {},
    receivedAt: '2026-05-25T10:00:00Z',
    ...overrides,
  };
}

async function flushAsyncIO(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await realDelay(5);
}

describe('límite mensual del plan gratuito (worker)', () => {
  let agentCalls: number;
  const countingFactory: AgentFactory = () => {
    const agent: AgentLike = {
      on: () => {},
      sendSync: async () => {
        agentCalls += 1;
        return { text: 'Respuesta del agente', usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.0001 } };
      },
    };
    return agent;
  };

  async function makeDeps(extra: Partial<PipelineDeps> = {}): Promise<PipelineDeps> {
    mediaRoot = await mkdtemp(join(tmpdir(), 'intake-limit-'));
    return {
      prisma,
      tenantId: TEST_TENANT_ID,
      config, profile,
      notifier: new NoopNotifier(),
      sender: new MemorySender(),
      transcriber: new NoopTranscriber(),
      mediaStore: new FilesystemMediaStore(mediaRoot),
      agentFactory: countingFactory,
      now: () => new Date('2026-05-25T10:00:00Z'),
      ...extra,
    };
  }

  beforeEach(async () => {
    agentCalls = 0;
    delete process.env.ACCESS_MODE;
    delete process.env.FREE_MONTHLY_RUN_LIMIT;
    await cleanup();
    await seedTestTenant();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  });
  afterEach(async () => {
    vi.useRealTimers();
    if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
  });

  it('límite agotado: no corre el agente, notifica al dueño UNA vez y sigue registrando mensajes', async () => {
    await prisma.tenant.update({ where: { id: TEST_TENANT_ID }, data: { monthlyRunLimit: 0 } });
    const deps = await makeDeps();
    const coord = new InboundCoordinator(deps);

    await coord.handleInbound(rawMsg());
    await vi.advanceTimersByTimeAsync(100);
    await vi.runAllTimersAsync();
    await flushAsyncIO();

    // El agente NO corre; solo salió el welcome (plantilla, sin costo LLM).
    expect(agentCalls).toBe(0);
    const sender = deps.sender as MemorySender;
    expect(sender.sent.every((s) => !s.text.includes('Respuesta del agente'))).toBe(true);

    // El mensaje entrante sí quedó registrado.
    expect(await prisma.message.count({ where: { tenantId: TEST_TENANT_ID, direction: 'inbound' } })).toBe(1);

    // Aviso al dueño: evento en el notifier + marca Notification (una sola).
    const notifier = deps.notifier as NoopNotifier;
    expect(notifier.history.filter((e) => e.kind === 'usage_limit')).toHaveLength(1);
    expect(await prisma.notification.count({ where: { tenantId: TEST_TENANT_ID, kind: 'usage_limit' } })).toBe(1);

    // Segundo mensaje del mes: sigue cortado y NO duplica el aviso.
    await coord.handleInbound(rawMsg({ text: 'Sigo esperando respuesta' }));
    await vi.advanceTimersByTimeAsync(100);
    await vi.runAllTimersAsync();
    await flushAsyncIO();
    expect(agentCalls).toBe(0);
    expect(notifier.history.filter((e) => e.kind === 'usage_limit')).toHaveLength(1);
    expect(await prisma.notification.count({ where: { tenantId: TEST_TENANT_ID, kind: 'usage_limit' } })).toBe(1);
  });

  it('con cupo disponible el agente corre normal', async () => {
    await prisma.tenant.update({ where: { id: TEST_TENANT_ID }, data: { monthlyRunLimit: 100 } });
    const deps = await makeDeps();
    const coord = new InboundCoordinator(deps);
    await coord.handleInbound(rawMsg());
    await vi.advanceTimersByTimeAsync(100);
    await vi.runAllTimersAsync();
    await flushAsyncIO();
    expect(agentCalls).toBe(1);
  });

  it('monthlyRunLimitFor: override por tenant > env > default; subscription = sin límite', async () => {
    expect(await monthlyRunLimitFor(prisma, TEST_TENANT_ID)).toBe(300); // default

    process.env.FREE_MONTHLY_RUN_LIMIT = '50';
    expect(await monthlyRunLimitFor(prisma, TEST_TENANT_ID)).toBe(50); // env

    await prisma.tenant.update({ where: { id: TEST_TENANT_ID }, data: { monthlyRunLimit: 7 } });
    expect(await monthlyRunLimitFor(prisma, TEST_TENANT_ID)).toBe(7); // override

    process.env.ACCESS_MODE = 'subscription';
    expect(await monthlyRunLimitFor(prisma, TEST_TENANT_ID)).toBeNull(); // Stripe cobra, sin límite
    delete process.env.ACCESS_MODE;
    delete process.env.FREE_MONTHLY_RUN_LIMIT;
  });

  it('checkMonthlyLimit cuenta solo los AgentRun del mes en curso', async () => {
    await prisma.tenant.update({ where: { id: TEST_TENANT_ID }, data: { monthlyRunLimit: 2 } });
    const now = new Date('2026-05-25T10:00:00Z');
    const contact = await prisma.contact.create({
      data: { tenantId: TEST_TENANT_ID, phoneE164: '+5215559', displayName: 'X' },
    });
    const job = await prisma.job.create({
      data: { tenantId: TEST_TENANT_ID, contactId: contact.id, status: 'OPEN_INTAKE', intake: '{}', openedAt: now },
    });
    const mkRun = (createdAt: Date) => prisma.agentRun.create({
      data: {
        tenantId: TEST_TENANT_ID, jobId: job.id, triggerMessageIds: '[]',
        model: 'm', toolCalls: '[]', createdAt,
      },
    });
    await mkRun(new Date('2026-04-30T23:00:00Z')); // mes anterior: no cuenta
    await mkRun(new Date('2026-05-02T10:00:00Z'));
    expect((await checkMonthlyLimit(prisma, TEST_TENANT_ID, now)).limited).toBe(false);
    await mkRun(new Date('2026-05-20T10:00:00Z'));
    const res = await checkMonthlyLimit(prisma, TEST_TENANT_ID, now);
    expect(res).toMatchObject({ limited: true, used: 2, limit: 2 });
    expect(startOfMonthUtc(now).toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });
});
