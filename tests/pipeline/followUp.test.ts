import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { testPrisma as prisma, cleanupDb as cleanup, seedTestTenant, TEST_TENANT_ID } from '../helpers/db';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilesystemMediaStore } from '../../src/media/store';
import { NoopTranscriber } from '../../src/media/transcriber';
import { NoopNotifier } from '../../src/services/notification';
import { MemorySender } from '../../src/services/outbound';
import { FollowUpCoordinator } from '../../src/pipeline/followUp';
import { upsertContactByPhone } from '../../src/services/contact';
import { openJob } from '../../src/services/job';
import { createEmptyIntakeFromSchema, upsertOpportunities } from '../../src/services/intake';
import type { PipelineDeps } from '../../src/pipeline/types';
import type { AgentFactory, AgentLike } from '../../src/agent/types';
import type { Config, Profile } from '../../src/config/schema';
import type { IntakeSchema } from '../../src/config/intake-schema';

const schema: IntakeSchema = {
  $businessName: 'Taller',
  $businessDomain: 'wrapping',
  $language: 'es-MX',
  sections: [
    { key: 'client', label: 'Cliente', fields: [{ key: 'name', label: 'Nombre', type: 'string', required: true }] },
  ],
};

const profile: Profile = {
  intakeSchema: schema,
  promptVars: { promptTemplate: 'X', vars: {}, skills: [], modules: ['intake', 'ventas'] },
  businessFacts: { facts: [], freeContext: '' },
  welcome: '¡Hola!',
  imageFocus: '',
  imageEditGuidance: '',
  skills: [],
  modules: ['intake', 'ventas'],
  aiDisclosure: false,
  hash: 'h',
};

const NOW = new Date('2026-07-29T15:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);

function makeConfig(over: Partial<Config['followUp']> = {}, hours?: Config['hours']): Config {
  return {
    profile: './profiles/wrapping',
    model: 'm', maxSteps: 6, temperature: 0.4, debounceMs: 50,
    fallbackOnError: 'oops', outOfScopeNudge: '',
    hours: hours ?? { enabled: false, timezone: 'UTC', schedule: {}, outOfHoursNotice: '' },
    owner: { phoneE164: '+5215', notifyOnReady: true, notifyOnDisconnect: true, panelUrl: 'http://x' },
    panel: { users: [] },
    media: { storeDir: './media', transcribeAudio: false, whisperModel: 'w', describeImages: false, visionModel: 'v', editImages: false, imageEditModel: 'i' },
    disclosure: { text: 'Te atiende un asistente automatizado.', translations: { en: 'Automated assistant.' } },
  followUp: { enabled: true, afterHours: 24, maxFollowUps: 2, minHoursBetween: 24, sweepMinutes: 30, ...over },
    limits: { monthlyCostUsd: 50, alertOnCostUsd: 40, maxConsecutiveErrors: 3 },
  } as Config;
}

let mediaRoot: string;
let sentPrompts: string[];

/** Agente falso: guarda la instrucción recibida y responde un texto fijo. */
function fakeAgent(text = '¿Seguimos con el polarizado?'): AgentFactory {
  return () => {
    const agent: AgentLike = {
      on: () => {},
      sendSync: async (msg: string) => {
        sentPrompts.push(msg);
        return { text, usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.0001 } };
      },
    };
    return agent;
  };
}

async function makeDeps(over: Partial<PipelineDeps> = {}): Promise<PipelineDeps> {
  mediaRoot = await mkdtemp(join(tmpdir(), 'intake-followup-'));
  return {
    prisma,
    tenantId: TEST_TENANT_ID,
    config: makeConfig(),
    profile,
    notifier: new NoopNotifier(),
    sender: new MemorySender(),
    transcriber: new NoopTranscriber(),
    mediaStore: new FilesystemMediaStore(mediaRoot),
    agentFactory: fakeAgent(),
    now: () => NOW,
    ...over,
  };
}

/** Job con una oferta sin responder y nuestro último mensaje hace 30 h. */
async function seedSilentJobWithOffer(over: { followUpCount?: number; lastFollowUpAt?: Date } = {}) {
  const contact = await upsertContactByPhone(prisma, TEST_TENANT_ID, '+5215555');
  const intake = upsertOpportunities(
    createEmptyIntakeFromSchema(schema),
    [{ service: 'polarizado 20%', status: 'offered' }],
    NOW.toISOString(),
    null,
  );
  const job = await openJob(prisma, TEST_TENANT_ID, contact.id, intake);
  await prisma.job.update({
    where: { id: job.id },
    data: {
      followUpCount: over.followUpCount ?? 0,
      lastFollowUpAt: over.lastFollowUpAt ?? null,
    },
  });
  await prisma.message.create({
    data: {
      tenantId: TEST_TENANT_ID,
      jobId: job.id,
      contactId: contact.id,
      direction: 'outbound',
      kind: 'text',
      body: '¿Te interesa el polarizado?',
      createdAt: hoursAgo(30),
    },
  });
  return { contact, job };
}

describe('FollowUpCoordinator', () => {
  beforeEach(async () => {
    sentPrompts = [];
    delete process.env.ACCESS_MODE;
    delete process.env.FREE_MONTHLY_RUN_LIMIT;
    await cleanup();
    await seedTestTenant();
  });
  afterEach(async () => {
    if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
  });

  it('escribe al cliente callado, persiste el mensaje y cuenta el seguimiento', async () => {
    const { job, contact } = await seedSilentJobWithOffer();
    const sender = new MemorySender();
    const deps = await makeDeps({ sender });

    const result = await new FollowUpCoordinator(deps).sweep();
    expect(result.sent).toBe(1);

    // Salió por el canal, al teléfono del cliente.
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].to).toBe(contact.phoneE164);
    expect(sender.sent[0].text).toContain('polarizado');

    // Quedó en el historial como outbound (el agente lo verá en el próximo turno).
    const persisted = await prisma.message.findMany({
      where: { jobId: job.id, direction: 'outbound' },
      orderBy: { createdAt: 'asc' },
    });
    expect(persisted).toHaveLength(2);
    expect(persisted[1].body).toContain('polarizado');

    // Y el job lleva la cuenta, que es lo que frena la insistencia.
    const reloaded = await prisma.job.findUnique({ where: { id: job.id } });
    expect(reloaded!.followUpCount).toBe(1);
    expect(reloaded!.lastFollowUpAt?.toISOString()).toBe(NOW.toISOString());
  });

  it('el turno lleva la directiva de seguimiento, no un mensaje del cliente', async () => {
    await seedSilentJobWithOffer();
    await new FollowUpCoordinator(await makeDeps()).sweep();
    expect(sentPrompts).toHaveLength(1);
    expect(sentPrompts[0]).toContain('SEGUIMIENTO PROACTIVO');
    expect(sentPrompts[0]).toContain('polarizado 20%');
  });

  it('registra el AgentRun del seguimiento sin mensajes disparadores', async () => {
    const { job } = await seedSilentJobWithOffer();
    await new FollowUpCoordinator(await makeDeps()).sweep();
    const runs = await prisma.agentRun.findMany({ where: { jobId: job.id } });
    expect(runs).toHaveLength(1);
    expect(JSON.parse(runs[0].triggerMessageIds)).toEqual([]);
  });

  it('no hace nada con el seguimiento apagado (opt-in del tenant)', async () => {
    await seedSilentJobWithOffer();
    const sender = new MemorySender();
    const deps = await makeDeps({ sender, config: makeConfig({ enabled: false }) });
    const result = await new FollowUpCoordinator(deps).sweep();
    expect(result.skipped).toBe('disabled');
    expect(sender.sent).toHaveLength(0);
  });

  it('no escribe fuera del horario de atención', async () => {
    await seedSilentJobWithOffer();
    const sender = new MemorySender();
    // NOW es miércoles 15:00 UTC; la ventana del día termina a las 10:00.
    const deps = await makeDeps({
      sender,
      config: makeConfig({}, {
        enabled: true,
        timezone: 'UTC',
        schedule: { wed: ['09:00', '10:00'] },
        outOfHoursNotice: '',
      }),
    });
    const result = await new FollowUpCoordinator(deps).sweep();
    expect(result.skipped).toBe('out_of_hours');
    expect(sender.sent).toHaveLength(0);
  });

  it('no escribe si el tenant agotó su cuota mensual', async () => {
    await seedSilentJobWithOffer();
    process.env.FREE_MONTHLY_RUN_LIMIT = '1';
    // Un AgentRun previo del mes agota el límite de 1.
    const existing = await prisma.job.findFirst({ where: { tenantId: TEST_TENANT_ID } });
    await prisma.agentRun.create({
      data: {
        tenantId: TEST_TENANT_ID,
        jobId: existing!.id,
        triggerMessageIds: '[]',
        model: 'm',
        inputTokens: 1,
        outputTokens: 1,
        toolCalls: '[]',
        responseText: 'x',
        configHash: 'h',
        createdAt: NOW,
      },
    });
    const sender = new MemorySender();
    const result = await new FollowUpCoordinator(await makeDeps({ sender })).sweep();
    expect(result.skipped).toBe('usage_limit');
    expect(sender.sent).toHaveLength(0);
  });

  it('no manda el fallback de error como seguimiento', async () => {
    await seedSilentJobWithOffer();
    const sender = new MemorySender();
    const failing: AgentFactory = () => ({
      on: () => {},
      sendSync: async () => { throw new Error('LLM caído'); },
    });
    const deps = await makeDeps({ sender, agentFactory: failing });
    const result = await new FollowUpCoordinator(deps).sweep();
    expect(result.sent).toBe(0);
    expect(sender.sent).toHaveLength(0);
    // Y el job NO gasta su seguimiento por un fallo nuestro.
    const job = await prisma.job.findFirst({ where: { tenantId: TEST_TENANT_ID } });
    expect(job!.followUpCount).toBe(0);
  });

  it('deja de insistir al agotar el tope', async () => {
    await seedSilentJobWithOffer({ followUpCount: 2, lastFollowUpAt: hoursAgo(48) });
    const sender = new MemorySender();
    const result = await new FollowUpCoordinator(await makeDeps({ sender })).sweep();
    expect(result.skipped).toBe('no_candidates');
    expect(sender.sent).toHaveLength(0);
  });

  it('no escribe dos veces al mismo job en un mismo barrido ni en el siguiente inmediato', async () => {
    await seedSilentJobWithOffer();
    const sender = new MemorySender();
    const deps = await makeDeps({ sender });
    const coordinator = new FollowUpCoordinator(deps);

    expect((await coordinator.sweep()).sent).toBe(1);
    // El segundo barrido ocurre "ya mismo": la espera mínima entre seguimientos
    // lo frena aunque el cliente siga callado.
    expect((await coordinator.sweep()).skipped).toBe('no_candidates');
    expect(sender.sent).toHaveLength(1);
  });
});
