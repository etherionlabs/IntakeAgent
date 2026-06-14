import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  testPrisma as prisma,
  cleanupDb as cleanup,
  seedTestTenant,
  TEST_TENANT_ID,
} from '../helpers/db';
import { upsertContactByPhone } from '../../src/services/contact';
import { openJob } from '../../src/services/job';
import { createEmptyIntakeFromSchema } from '../../src/services/intake';
import { recordAgentRun } from '../../src/agent/audit';
import type { IntakeSchema } from '../../src/config/intake-schema';

const schema: IntakeSchema = {
  $businessName: 'X',
  $businessDomain: 'y',
  $language: 'es-MX',
  sections: [
    {
      key: 'client',
      label: 'C',
      fields: [{ key: 'name', label: 'N', type: 'string', required: true }],
    },
  ],
};

describe('recordAgentRun', () => {
  beforeEach(async () => {
    await cleanup();
    await seedTestTenant();
  });
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('persiste un agent run con tool calls y uso', async () => {
    const c = await upsertContactByPhone(prisma, TEST_TENANT_ID, '+521');
    const j = await openJob(prisma, TEST_TENANT_ID, c.id, createEmptyIntakeFromSchema(schema));
    const run = await recordAgentRun(prisma, TEST_TENANT_ID, {
      jobId: j.id,
      triggerMessageIds: ['m1', 'm2'],
      model: 'anthropic/claude-sonnet-4-6',
      inputTokens: 1234,
      outputTokens: 56,
      costUsd: 0.0042,
      toolCalls: [{ name: 'update_intake', args: { fields: [] }, result: { ok: true }, error: null }],
      responseText: 'Hola, dime tu nombre.',
      configHash: 'abc123',
      error: null,
    });
    expect(run.id).toBeDefined();
    expect(run.tenantId).toBe(TEST_TENANT_ID);
    expect(run.inputTokens).toBe(1234);
    const parsed = JSON.parse(run.toolCalls);
    expect(parsed[0].name).toBe('update_intake');
  });

  it('acepta error string y ningún tool call', async () => {
    const c = await upsertContactByPhone(prisma, TEST_TENANT_ID, '+521');
    const j = await openJob(prisma, TEST_TENANT_ID, c.id, createEmptyIntakeFromSchema(schema));
    const run = await recordAgentRun(prisma, TEST_TENANT_ID, {
      jobId: j.id,
      triggerMessageIds: ['m1'],
      model: 'anthropic/claude-sonnet-4-6',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: null,
      toolCalls: [],
      responseText: null,
      configHash: 'abc',
      error: 'rate limit',
    });
    expect(run.tenantId).toBe(TEST_TENANT_ID);
    expect(run.error).toBe('rate limit');
    expect(run.responseText).toBeNull();
  });
});
