import { describe, it, expect, afterAll } from 'vitest';
import { testPrisma as prisma, seedTestTenant, TEST_TENANT_ID } from '../helpers/db';
import { runAgentTurn } from '../../src/agent/runner';
import { upsertContactByPhone } from '../../src/services/contact';
import { openJob, parseJobIntake } from '../../src/services/job';
import { createEmptyIntakeFromSchema } from '../../src/services/intake';
import { NoopNotifier } from '../../src/services/notification';
import type { AgentFactory, AgentLike, TurnContext } from '../../src/agent/types';
import type { Profile, Config } from '../../src/config/schema';
import type { IntakeSchema } from '../../src/config/intake-schema';

const schema: IntakeSchema = {
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
};

const profile: Profile = {
  intakeSchema: schema,
  promptVars: {
    promptTemplate: 'Asistente de **{{businessName}}**. {{tone}}',
    vars: { tone: 'Cercano.' },
  },
  businessFacts: { facts: [], freeContext: '' },
  welcome: 'hola',
  imageFocus: '',
  hash: 'h1',
};

const config: Config = {
  profile: './profiles/tapiceria',
  model: 'anthropic/claude-sonnet-4-6',
  maxSteps: 6,
  temperature: 0.4,
  debounceMs: 5000,
  fallbackOnError: 'oops',
  outOfScopeNudge: '',
  hours: { enabled: false, timezone: 'America/Mexico_City', schedule: {}, outOfHoursNotice: '' },
  owner: { phoneE164: '+5215', notifyOnReady: true, notifyOnDisconnect: true, panelUrl: 'http://x' },
  panel: { users: [] },
  media: { storeDir: './media', transcribeAudio: true, whisperModel: 'openai/whisper-1', describeImages: true, visionModel: 'openai/gpt-4o-mini' },
  limits: { monthlyCostUsd: 50, alertOnCostUsd: 40, maxConsecutiveErrors: 3 },
} as Config;

async function setupCtx(): Promise<TurnContext> {
  await prisma.message.deleteMany();
  await prisma.agentRun.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.job.deleteMany();
  await prisma.contact.deleteMany();
  await seedTestTenant();
  const c = await upsertContactByPhone(prisma, TEST_TENANT_ID, '+521');
  const j = await openJob(prisma, TEST_TENANT_ID, c.id, createEmptyIntakeFromSchema(schema));
  return {
    job: j,
    contact: c,
    intake: createEmptyIntakeFromSchema(schema),
    batchMessages: [{ id: 'm1', kind: 'text', body: 'Hola, soy María' }],
    otherOpenJobs: [],
    now: '2026-05-25T10:00:00Z',
  };
}

afterAll(async () => {
  await prisma.agentRun.deleteMany();
  await prisma.message.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.job.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.$disconnect();
});

/** Stub del SDK que simula un agente: ejecuta una callback "scripted" sobre los tools. */
function makeStubFactory(script: (tools: any[]) => Promise<{ text: string; usage?: any }>): AgentFactory {
  return (cfg) => {
    const agent: AgentLike = {
      on: () => {},
      sendSync: async () => {
        const result = await script(cfg.tools as any[]);
        return { text: result.text, usage: result.usage };
      },
    };
    return agent;
  };
}

describe('runAgentTurn', () => {
  it('respuesta sin tools devuelve texto y persiste agent_run', async () => {
    const ctx = await setupCtx();
    const factory = makeStubFactory(async () => ({
      text: 'Hola María, ¿qué necesitas?',
      usage: { inputTokens: 100, outputTokens: 20, costUsd: 0.001 },
    }));
    const result = await runAgentTurn(ctx, {
      prisma,
      tenantId: TEST_TENANT_ID,
      config,
      profile,
      notifier: new NoopNotifier(),
      createAgent: factory,
    });
    expect(result.responseText).toBe('Hola María, ¿qué necesitas?');
    expect(result.toolCalls).toHaveLength(0);
    expect(result.inputTokens).toBe(100);
    const runs = await prisma.agentRun.findMany({ where: { jobId: ctx.job.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0].responseText).toBe('Hola María, ¿qué necesitas?');
  });

  it('si la script llama una tool, la ejecución persiste el cambio', async () => {
    const ctx = await setupCtx();
    const factory = makeStubFactory(async (tools) => {
      const updateIntake = tools.find((t) => t.name === 'update_intake')!;
      await updateIntake.execute({ fields: [{ path: 'client.name', value: 'María' }] });
      return { text: 'Listo, registré tu nombre.' };
    });
    const result = await runAgentTurn(ctx, {
      prisma,
      tenantId: TEST_TENANT_ID,
      config,
      profile,
      notifier: new NoopNotifier(),
      createAgent: factory,
    });
    expect(result.responseText).toBe('Listo, registré tu nombre.');
    const reload = await prisma.job.findUnique({ where: { id: ctx.job.id } });
    const intake = parseJobIntake(reload!);
    expect((intake.client as any).name.value).toBe('María');
  });

  it('errores del SDK se capturan y se devuelve fallback con error guardado', async () => {
    const ctx = await setupCtx();
    const factory: AgentFactory = () => ({
      on: () => {},
      sendSync: async () => {
        throw new Error('network down');
      },
    });
    const result = await runAgentTurn(ctx, {
      prisma,
      tenantId: TEST_TENANT_ID,
      config,
      profile,
      notifier: new NoopNotifier(),
      createAgent: factory,
    });
    expect(result.error).toMatch(/network down/);
    expect(result.responseText).toBe(config.fallbackOnError);
    const runs = await prisma.agentRun.findMany({ where: { jobId: ctx.job.id } });
    expect(runs[0].error).toMatch(/network down/);
  });
});
