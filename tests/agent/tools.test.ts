import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { upsertContactByPhone } from '../../src/services/contact';
import { openJob } from '../../src/services/job';
import {
  createEmptyIntakeFromSchema,
  type IntakeState,
} from '../../src/services/intake';
import { buildUpdateIntakeTool } from '../../src/agent/tools';
import type { IntakeSchema } from '../../src/config/intake-schema';
import { NoopNotifier } from '../../src/services/notification';

const adapter = new PrismaBetterSqlite3({ url: 'file:./data/intake.db' });
const prisma = new PrismaClient({ adapter });

const schema: IntakeSchema = {
  $businessName: 'X',
  $businessDomain: 'y',
  $language: 'es-MX',
  sections: [
    {
      key: 'client',
      label: 'C',
      fields: [
        { key: 'name', label: 'Nombre', type: 'string', required: true },
        { key: 'phone', label: 'Tel', type: 'phone', required: false },
      ],
    },
  ],
};

async function setupCtx() {
  await prisma.message.deleteMany();
  await prisma.agentRun.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.job.deleteMany();
  await prisma.contact.deleteMany();
  const c = await upsertContactByPhone(prisma, '+521');
  const j = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
  const intake: IntakeState = createEmptyIntakeFromSchema(schema);
  return {
    job: j,
    contact: c,
    intake,
    batchMessages: [{ id: 'm1', kind: 'text' as const, body: 'hola' }],
    otherOpenJobs: [],
    now: '2026-05-25T10:00:00Z',
  };
}

afterAll(async () => {
  await prisma.message.deleteMany();
  await prisma.agentRun.deleteMany();
  await prisma.job.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.$disconnect();
});

describe('tool update_intake', () => {
  it('actualiza un campo válido y persiste en la DB', async () => {
    const ctx = await setupCtx();
    const profile = { intakeSchema: schema } as any;
    const tool = buildUpdateIntakeTool(ctx, { prisma, profile, notifier: new NoopNotifier() } as any);
    const out = await tool.execute({ fields: [{ path: 'client.name', value: 'María' }] });
    expect(out.ok).toBe(true);
    const reload = await prisma.job.findUnique({ where: { id: ctx.job.id } });
    const intake = JSON.parse(reload!.intake);
    expect(intake.client.name.value).toBe('María');
    expect(intake.client.name.source_message_id).toBe('m1');
  });

  it('agrega notas libres', async () => {
    const ctx = await setupCtx();
    const profile = { intakeSchema: schema } as any;
    const tool = buildUpdateIntakeTool(ctx, { prisma, profile, notifier: new NoopNotifier() } as any);
    const out = await tool.execute({
      fields: [{ path: 'client.name', value: 'X' }],
      notes_to_add: ['cliente vive en zona alta'],
    });
    expect(out.ok).toBe(true);
    const reload = await prisma.job.findUnique({ where: { id: ctx.job.id } });
    const intake = JSON.parse(reload!.intake);
    expect(intake.free_notes).toHaveLength(1);
    expect(intake.free_notes[0].text).toBe('cliente vive en zona alta');
  });

  it('retorna error sin persistir si el path es inválido', async () => {
    const ctx = await setupCtx();
    const profile = { intakeSchema: schema } as any;
    const tool = buildUpdateIntakeTool(ctx, { prisma, profile, notifier: new NoopNotifier() } as any);
    const out = await tool.execute({ fields: [{ path: 'nope.x', value: 'y' }] });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toMatch(/no existe/i);
    const reload = await prisma.job.findUnique({ where: { id: ctx.job.id } });
    const intake = JSON.parse(reload!.intake);
    expect(intake.client.name.value).toBeNull();
  });

  it('acepta declined con motivo', async () => {
    const ctx = await setupCtx();
    const profile = { intakeSchema: schema } as any;
    const tool = buildUpdateIntakeTool(ctx, { prisma, profile, notifier: new NoopNotifier() } as any);
    const out = await tool.execute({
      fields: [{ path: 'client.phone', declined: true, declined_reason: 'no tiene fijo' }],
    });
    expect(out.ok).toBe(true);
    const reload = await prisma.job.findUnique({ where: { id: ctx.job.id } });
    const intake = JSON.parse(reload!.intake);
    expect(intake.client.phone.declined).toBe(true);
  });
});
