import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { testPrisma as prisma, cleanupDb as cleanup, seedTestTenant, TEST_TENANT_ID } from '../helpers/db';
import { mkdtemp, rm } from 'node:fs/promises';
import { setTimeout as realDelay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilesystemMediaStore } from '../../src/media/store';
import { NoopTranscriber, ScriptedTranscriber } from '../../src/media/transcriber';
import { NoopDescriber, type Describer, type DescribeContext } from '../../src/media/describer';
import { NoopNotifier } from '../../src/services/notification';
import { MemorySender } from '../../src/services/outbound';
import { InboundCoordinator } from '../../src/pipeline/coordinator';
import type { RawInboundMessage, PipelineDeps } from '../../src/pipeline/types';
import type { AgentFactory, AgentLike } from '../../src/agent/types';
import type { Config, Profile } from '../../src/config/schema';
import type { IntakeSchema } from '../../src/config/intake-schema';
import { parseJobIntake } from '../../src/services/job';

const schema: IntakeSchema = {
  $businessName: 'Tapicería',
  $businessDomain: 'tapicería',
  $language: 'es-MX',
  sections: [
    {
      key: 'client',
      label: 'Cliente',
      fields: [{ key: 'name', label: 'Nombre', type: 'string', required: true }],
    },
  ],
};

const profile: Profile = {
  intakeSchema: schema,
  promptVars: { promptTemplate: 'X', vars: {} },
  businessFacts: { facts: [], freeContext: '' },
  welcome: '¡Hola! Soy el asistente.',
  hash: 'h',
};

const config: Config = {
  profile: './profiles/tapiceria',
  model: 'm',
  maxSteps: 6,
  temperature: 0.4,
  debounceMs: 50,
  fallbackOnError: 'oops',
  outOfScopeNudge: '',
  hours: { enabled: false, timezone: 'UTC', schedule: {}, outOfHoursNotice: '' },
  owner: { phoneE164: '+5215', notifyOnReady: true, notifyOnDisconnect: true, panelUrl: 'http://x' },
  panel: { users: [] },
  media: { storeDir: './media', transcribeAudio: true, whisperModel: 'openai/whisper-1', describeImages: true, visionModel: 'openai/gpt-4o-mini' },
  limits: { monthlyCostUsd: 50, alertOnCostUsd: 40, maxConsecutiveErrors: 3 },
} as Config;

let mediaRoot: string;

function rawMsg(overrides: Partial<RawInboundMessage> = {}): RawInboundMessage {
  return {
    whatsappMsgId: 'wa_' + Math.random().toString(36).slice(2),
    fromPhoneE164: '+5215555',
    chatKind: 'individual',
    fromMe: false,
    kind: 'text',
    text: 'hola',
    media: null,
    raw: {},
    receivedAt: '2026-05-25T10:00:00Z',
    ...overrides,
  };
}

/**
 * El debouncer dispara `flushBatch` con fire-and-forget (`void this.flush(...)`),
 * así que avanzar los timers falsos no espera el I/O async de Postgres. Tras
 * avanzar el reloj, drenamos varias rondas del event loop real (`setImmediate`
 * sigue siendo real) para que el flush —y sus round-trips a pg— terminen antes
 * de las aserciones. Con better-sqlite3 esto era innecesario porque las queries
 * resolvían de forma síncrona en microtasks.
 */
async function flushAsyncIO(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    // `node:timers/promises.setTimeout` usa el timer REAL (no lo falsea vitest),
    // a diferencia del `setTimeout` global. Cada ronda espera tiempo de reloj
    // real para que el round-trip de socket de pg (fase poll) pueda completar.
    await realDelay(5);
  }
}

const stubFactory = (responseText: string): AgentFactory => () => {
  const agent: AgentLike = {
    on: () => {},
    sendSync: async () => ({
      text: responseText,
      usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.0001 },
    }),
  };
  return agent;
};

async function makeDeps(extra: Partial<PipelineDeps> = {}): Promise<PipelineDeps> {
  mediaRoot = await mkdtemp(join(tmpdir(), 'intake-coord-'));
  return {
    prisma,
    tenantId: TEST_TENANT_ID,
    config,
    profile,
    notifier: new NoopNotifier(),
    sender: new MemorySender(),
    transcriber: new NoopTranscriber(),
    describer: new NoopDescriber(),
    mediaStore: new FilesystemMediaStore(mediaRoot),
    agentFactory: stubFactory('Hola, ¿en qué te ayudo?'),
    now: () => new Date('2026-05-25T10:00:00Z'),
    ...extra,
  };
}

describe('InboundCoordinator', () => {
  beforeEach(async () => {
    await cleanup();
    await seedTestTenant();
    // Solo falsear los timers del debounce. `setImmediate`/`nextTick` deben
    // quedar reales para que el driver async de Postgres (pg) complete su I/O
    // de socket entre los avances de reloj (con better-sqlite3 esto era síncrono).
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  });
  afterEach(async () => {
    vi.useRealTimers();
    if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
  });

  it('procesa un mensaje de texto → debouncer → agent → sender', async () => {
    const deps = await makeDeps();
    const coord = new InboundCoordinator(deps);
    await coord.handleInbound(rawMsg({ text: 'Hola, tengo un sillón' }));
    await vi.advanceTimersByTimeAsync(100);
    await vi.runAllTimersAsync();
    await flushAsyncIO();
    const sender = deps.sender as MemorySender;
    expect(sender.sent.length).toBeGreaterThanOrEqual(2);
    expect(sender.sent[0].text).toContain('Hola');
    expect(sender.sent.at(-1)!.text).toContain('en qué te ayudo');
  });

  it('descarta mensajes de grupo sin tocar nada', async () => {
    const deps = await makeDeps();
    const coord = new InboundCoordinator(deps);
    await coord.handleInbound(rawMsg({ chatKind: 'group' }));
    await vi.advanceTimersByTimeAsync(100);
    const messageCount = await prisma.message.count();
    expect(messageCount).toBe(0);
    expect((deps.sender as MemorySender).sent).toHaveLength(0);
  });

  it('descarta duplicados por whatsappMsgId', async () => {
    const deps = await makeDeps();
    const coord = new InboundCoordinator(deps);
    const msg = rawMsg({ whatsappMsgId: 'wa_dup' });
    await coord.handleInbound(msg);
    await coord.handleInbound(msg);
    await vi.advanceTimersByTimeAsync(100);
    await vi.runAllTimersAsync();
    await flushAsyncIO();
    const count = await prisma.message.count({ where: { whatsappMsgId: 'wa_dup' } });
    expect(count).toBe(1);
  });

  it('cuando bot_active=false guarda el mensaje pero no responde', async () => {
    const deps = await makeDeps();
    const coord = new InboundCoordinator(deps);
    await coord.handleInbound(rawMsg({ whatsappMsgId: 'wa1', text: 'hola' }));
    await vi.advanceTimersByTimeAsync(100);
    await vi.runAllTimersAsync();
    await flushAsyncIO();
    await prisma.contact.updateMany({ data: { botActive: false } });
    (deps.sender as MemorySender).clear();
    await coord.handleInbound(rawMsg({ whatsappMsgId: 'wa2', text: 'sigues ahí?' }));
    await vi.advanceTimersByTimeAsync(100);
    await vi.runAllTimersAsync();
    await flushAsyncIO();
    const sender = deps.sender as MemorySender;
    expect(sender.sent).toHaveLength(0);
    const count = await prisma.message.count({ where: { whatsappMsgId: 'wa2' } });
    expect(count).toBe(1);
  });

  it('actualiza intake.media.audio_count cuando llega un audio transcrito', async () => {
    const deps = await makeDeps({ transcriber: new ScriptedTranscriber(['me llamo Juan']) });
    const coord = new InboundCoordinator(deps);
    await coord.handleInbound(
      rawMsg({
        kind: 'audio',
        text: null,
        media: { buffer: Buffer.from('ogg'), mimetype: 'audio/ogg' },
      }),
    );
    await vi.advanceTimersByTimeAsync(100);
    await vi.runAllTimersAsync();
    await flushAsyncIO();
    const job = await prisma.job.findFirst();
    const intake = parseJobIntake(job!);
    expect(intake.media.audio_count).toBe(1);
  });

  it('describe imágenes con contexto de negocio y de la sesión', async () => {
    const seen: DescribeContext[] = [];
    const spy: Describer = {
      describe: async (_buf, _mime, ctx) => {
        seen.push(ctx ?? {});
        return 'Sillón gris desgastado.';
      },
    };
    const deps = await makeDeps({ describer: spy });
    const coord = new InboundCoordinator(deps);
    await coord.handleInbound(
      rawMsg({
        kind: 'image',
        text: 'mira el sillón',
        media: { buffer: Buffer.from('JPG'), mimetype: 'image/jpeg' },
      }),
    );
    // La descripción ocurre dentro de normalize (await) antes del debounce.
    expect(seen).toHaveLength(1);
    expect(seen[0].businessName).toBe('Tapicería');
    expect(seen[0].collects).toContain('Nombre');
    expect(seen[0].sessionState).toContain('aún falta — Nombre');
    expect(seen[0].caption).toBe('mira el sillón');

    // Y la descripción queda en el body del mensaje.
    const msg = await prisma.message.findFirst({ where: { kind: 'image' } });
    expect(msg?.body).toContain('Sillón gris');
  });

  it('múltiples mensajes consecutivos se agrupan en un solo agent run', async () => {
    let calls = 0;
    const factory: AgentFactory = () => ({
      on: () => {},
      sendSync: async () => {
        calls++;
        return { text: 'ok', usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 } };
      },
    });
    const deps = await makeDeps({ agentFactory: factory });
    const coord = new InboundCoordinator(deps);
    await coord.handleInbound(rawMsg({ whatsappMsgId: 'a', text: 'uno' }));
    await coord.handleInbound(rawMsg({ whatsappMsgId: 'b', text: 'dos' }));
    await coord.handleInbound(rawMsg({ whatsappMsgId: 'c', text: 'tres' }));
    await vi.advanceTimersByTimeAsync(100);
    await vi.runAllTimersAsync();
    await flushAsyncIO();
    expect(calls).toBe(1);
  });
});
