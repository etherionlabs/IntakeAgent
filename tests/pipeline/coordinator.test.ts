import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { testPrisma as prisma, cleanupDb as cleanup, seedTestTenant, TEST_TENANT_ID } from '../helpers/db';
import { mkdtemp, rm } from 'node:fs/promises';
import { setTimeout as realDelay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilesystemMediaStore } from '../../src/media/store';
import { NoopTranscriber, ScriptedTranscriber } from '../../src/media/transcriber';
import { ScriptedDescriber } from '../../src/media/describer';
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
  imageFocus: '',
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

  it('primer mensaje solo-saludo → envía welcome pero NO corre el agente', async () => {
    let calls = 0;
    const factory: AgentFactory = () => ({
      on: () => {},
      sendSync: async () => {
        calls++;
        return { text: 'no debería correr', usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 } };
      },
    });
    const deps = await makeDeps({ agentFactory: factory });
    const coord = new InboundCoordinator(deps);
    await coord.handleInbound(rawMsg({ text: 'Hola' }));
    await vi.advanceTimersByTimeAsync(100);
    await vi.runAllTimersAsync();
    await flushAsyncIO();
    const sender = deps.sender as MemorySender;
    expect(sender.sent).toHaveLength(1); // solo el welcome, sin segundo mensaje del agente
    expect(sender.sent[0].text).toContain('Hola');
    expect(calls).toBe(0); // el agente no corrió
  });

  it('primer mensaje CON contenido sí corre el agente (welcome + respuesta)', async () => {
    const deps = await makeDeps();
    const coord = new InboundCoordinator(deps);
    await coord.handleInbound(rawMsg({ text: 'Hola, quiero retapizar un sillón' }));
    await vi.advanceTimersByTimeAsync(100);
    await vi.runAllTimersAsync();
    await flushAsyncIO();
    const sender = deps.sender as MemorySender;
    expect(sender.sent.length).toBeGreaterThanOrEqual(2); // welcome + agente
  });

  it('reloadConfig: usa el perfil recargado (welcome del dominio nuevo) sin reconstruir el coordinator', async () => {
    // Simula que el dueño cambió en el panel businessDomain tapicería → mecánica.
    // El worker no se reinicia: reloadConfig debe entregar el perfil fresco.
    const reloaded: Profile = {
      ...profile,
      intakeSchema: { ...schema, $businessDomain: 'mecánica' },
      welcome: 'Bienvenido al taller de {{businessDomain}}.',
    };
    const deps = await makeDeps({ reloadConfig: async () => ({ config, profile: reloaded }) });
    const coord = new InboundCoordinator(deps);
    // Saludo pelón → solo se envía el welcome (no corre el agente).
    await coord.handleInbound(rawMsg({ text: 'Hola' }));
    await vi.advanceTimersByTimeAsync(100);
    await vi.runAllTimersAsync();
    await flushAsyncIO();
    const sender = deps.sender as MemorySender;
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].text).toBe('Bienvenido al taller de mecánica.');
    // No quedó rastro del perfil estático viejo.
    expect(sender.sent[0].text).not.toContain('asistente');
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

  it('describe una imagen entrante, la persiste y se la pasa al agente', async () => {
    let seenUserMessage = '';
    const captureFactory: AgentFactory = () => ({
      on: () => {},
      sendSync: async (userMessage: string) => {
        seenUserMessage = userMessage;
        return { text: 'gracias por la foto', usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 } };
      },
    });
    const deps = await makeDeps({
      agentFactory: captureFactory,
      describer: new ScriptedDescriber(['Sillón de 3 plazas, tela azul desgastada y una rotura en el brazo.']),
    });
    const coord = new InboundCoordinator(deps);
    await coord.handleInbound(
      rawMsg({
        whatsappMsgId: 'wa_img',
        kind: 'image',
        text: 'mi sillón',
        media: { buffer: Buffer.from('fake-jpeg'), mimetype: 'image/jpeg' },
      }),
    );
    await vi.advanceTimersByTimeAsync(100);
    await vi.runAllTimersAsync();
    await flushAsyncIO();

    // El agente vio la descripción (no solo el path).
    expect(seenUserMessage).toContain('Descripción de la imagen: Sillón de 3 plazas');
    expect(seenUserMessage).toContain('Caption del cliente: mi sillón');

    // Se persistió en la DB y se contó la foto.
    const msg = await prisma.message.findFirst({ where: { whatsappMsgId: 'wa_img' } });
    expect(msg!.mediaDescription).toContain('Sillón de 3 plazas');
    const job = await prisma.job.findFirst();
    const intake = parseJobIntake(job!);
    expect(intake.media.photo_count).toBe(1);
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
