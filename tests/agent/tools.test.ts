import { describe, it, expect, afterAll } from 'vitest';
import { testPrisma as prisma } from '../helpers/db';
import { upsertContactByPhone } from '../../src/services/contact';
import { openJob } from '../../src/services/job';
import {
  createEmptyIntakeFromSchema,
  bulkUpdate,
  type IntakeState,
} from '../../src/services/intake';
import { buildUpdateIntakeTool, buildMarkReadyTool } from '../../src/agent/tools';
import type { IntakeSchema } from '../../src/config/intake-schema';
import { NoopNotifier } from '../../src/services/notification';

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
  const ctx: import('../../src/agent/types').TurnContext = {
    job: j,
    contact: c,
    intake,
    batchMessages: [{ id: 'm1', kind: 'text', body: 'hola' }],
    otherOpenJobs: [],
    now: '2026-05-25T10:00:00Z',
  };
  return ctx;
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

describe('tool mark_ready_for_review', () => {
  it('rechaza si faltan campos requeridos', async () => {
    const ctx = await setupCtx();
    const profile = { intakeSchema: schema, hash: 'h' } as any;
    const notifier = new NoopNotifier();
    const tool = buildMarkReadyTool(ctx, { prisma, profile, notifier, config: { owner: { phoneE164: '+5215', notifyOnReady: true, notifyOnDisconnect: true, panelUrl: 'http://x' } } } as any);
    const out = await tool.execute({ summary: 'Trabajo de retapizado para sillón' });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toMatch(/requerido/i);
  });

  it('cuando los requeridos están satisfechos transiciona el job a READY y dispara notifier', async () => {
    const ctx = await setupCtx();
    const profile = { intakeSchema: schema, hash: 'h' } as any;
    // Llenar required
    const filled = bulkUpdate(schema, ctx.intake, [{ path: 'client.name', value: 'María' }], {
      now: ctx.now,
      source_message_id: 'm1',
    });
    if (!filled.ok) throw new Error('fail');
    ctx.intake = filled.intake;
    await prisma.job.update({ where: { id: ctx.job.id }, data: { intake: JSON.stringify(filled.intake) } });

    const notifier = new NoopNotifier();
    const tool = buildMarkReadyTool(ctx, {
      prisma,
      profile,
      notifier,
      config: {
        owner: { phoneE164: '+5215', notifyOnReady: true, notifyOnDisconnect: true, panelUrl: 'http://x' },
      },
    } as any);

    const out = await tool.execute({ summary: 'Retapizado de sillón 3 plazas para María en Polanco.' });
    expect(out.ok).toBe(true);
    const reload = await prisma.job.findUnique({ where: { id: ctx.job.id } });
    expect(reload!.status).toBe('READY_FOR_REVIEW');
    expect(reload!.summary).toContain('Retapizado');
    expect(notifier.history).toHaveLength(1);
    expect(notifier.history[0].kind).toBe('owner_ready');
  });

  it('rechaza summary demasiado corto', async () => {
    const ctx = await setupCtx();
    const profile = { intakeSchema: schema, hash: 'h' } as any;
    const tool = buildMarkReadyTool(ctx, { prisma, profile, notifier: new NoopNotifier(), config: { owner: { phoneE164: '+5215', notifyOnReady: false, notifyOnDisconnect: false, panelUrl: 'x' } } } as any);
    const out = await tool.execute({ summary: 'corto' });
    expect(out.ok).toBe(false);
  });

  it('no notifica si owner.notifyOnReady=false (pero sí transiciona el job)', async () => {
    const ctx = await setupCtx();
    const profile = { intakeSchema: schema, hash: 'h' } as any;
    const filled = bulkUpdate(schema, ctx.intake, [{ path: 'client.name', value: 'X' }], { now: ctx.now, source_message_id: 'm1' });
    if (!filled.ok) throw new Error('fail');
    ctx.intake = filled.intake;
    await prisma.job.update({ where: { id: ctx.job.id }, data: { intake: JSON.stringify(filled.intake) } });

    const notifier = new NoopNotifier();
    const tool = buildMarkReadyTool(ctx, {
      prisma, profile, notifier,
      config: { owner: { phoneE164: '+5215', notifyOnReady: false, notifyOnDisconnect: true, panelUrl: 'x' } },
    } as any);

    const out = await tool.execute({ summary: 'Resumen largo para revisión del dueño.' });
    expect(out.ok).toBe(true);
    expect(notifier.history).toHaveLength(0);
  });
});

import { buildCloseJobTool, buildFlagNonIntakeTool, buildRequestPhotoTool } from '../../src/agent/tools';

describe('tool close_job', () => {
  it('cierra desde OPEN_INTAKE', async () => {
    const ctx = await setupCtx();
    const tool = buildCloseJobTool(ctx, { prisma } as any);
    const out = await tool.execute({});
    expect(out.ok).toBe(true);
    const reload = await prisma.job.findUnique({ where: { id: ctx.job.id } });
    expect(reload!.status).toBe('CLOSED');
  });

  it('rechaza desde IN_PROGRESS', async () => {
    const ctx = await setupCtx();
    await prisma.job.update({ where: { id: ctx.job.id }, data: { status: 'IN_PROGRESS' } });
    ctx.job.status = 'IN_PROGRESS';
    const tool = buildCloseJobTool(ctx, { prisma } as any);
    const out = await tool.execute({});
    expect(out.ok).toBe(false);
  });
});

describe('tool flag_non_intake', () => {
  it('marca el contacto y devuelve ok', async () => {
    const ctx = await setupCtx();
    const tool = buildFlagNonIntakeTool(ctx, { prisma } as any);
    const out = await tool.execute({ reason: 'cliente sólo manda promociones' });
    expect(out.ok).toBe(true);
    const reload = await prisma.contact.findUnique({ where: { id: ctx.contact.id } });
    expect(reload!.flaggedNonIntake).toBe(true);
    expect(reload!.flaggedReason).toBe('cliente sólo manda promociones');
  });

  it('rechaza reason demasiado corto', async () => {
    const ctx = await setupCtx();
    const tool = buildFlagNonIntakeTool(ctx, { prisma } as any);
    const out = await tool.execute({ reason: 'x' });
    expect(out.ok).toBe(false);
  });
});

describe('tool request_photo', () => {
  it('siempre devuelve ok con purpose válido', async () => {
    const ctx = await setupCtx();
    const tool = buildRequestPhotoTool(ctx);
    const out = await tool.execute({ purpose: 'vista frontal del sillón' });
    expect(out.ok).toBe(true);
  });

  it('rechaza purpose vacío', async () => {
    const ctx = await setupCtx();
    const tool = buildRequestPhotoTool(ctx);
    const out = await tool.execute({ purpose: '' });
    expect(out.ok).toBe(false);
  });
});

import { buildSelectOrOpenJobTool } from '../../src/agent/tools';

describe('tool select_or_open_job', () => {
  it('valida use_existing con id de la lista de otherOpenJobs', async () => {
    const ctx = await setupCtx();
    ctx.otherOpenJobs = [
      { id: 'job-a', summary: null, openedAt: new Date() },
      { id: 'job-b', summary: null, openedAt: new Date() },
    ];
    const tool = buildSelectOrOpenJobTool(ctx);
    const out = await tool.execute({ action: 'use_existing', existing_job_id: 'job-a' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.selected_job_id).toBe('job-a');
  });

  it('rechaza use_existing con id no listado', async () => {
    const ctx = await setupCtx();
    ctx.otherOpenJobs = [{ id: 'job-a', summary: null, openedAt: new Date() }];
    const tool = buildSelectOrOpenJobTool(ctx);
    const out = await tool.execute({ action: 'use_existing', existing_job_id: 'fake' });
    expect(out.ok).toBe(false);
  });

  it('acepta open_new sin id', async () => {
    const ctx = await setupCtx();
    const tool = buildSelectOrOpenJobTool(ctx);
    const out = await tool.execute({ action: 'open_new' });
    expect(out.ok).toBe(true);
  });

  it('rechaza use_existing sin id', async () => {
    const ctx = await setupCtx();
    ctx.otherOpenJobs = [{ id: 'job-a', summary: null, openedAt: new Date() }];
    const tool = buildSelectOrOpenJobTool(ctx);
    const out = await tool.execute({ action: 'use_existing' });
    expect(out.ok).toBe(false);
  });
});

import { buildTools } from '../../src/agent/tools';

describe('buildTools', () => {
  it('expone 5 tools cuando otherOpenJobs.length < 2', async () => {
    const ctx = await setupCtx();
    const tools = buildTools(ctx, {
      prisma,
      profile: { intakeSchema: schema, hash: 'h' } as any,
      notifier: new NoopNotifier(),
      config: { owner: { phoneE164: '+5215', notifyOnReady: true, notifyOnDisconnect: true, panelUrl: 'x' } } as any,
    } as any);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'close_job',
      'flag_non_intake',
      'mark_ready_for_review',
      'request_photo',
      'update_intake',
    ]);
  });

  it('agrega select_or_open_job cuando hay 2+ otherOpenJobs', async () => {
    const ctx = await setupCtx();
    ctx.otherOpenJobs = [
      { id: 'a', summary: null, openedAt: new Date() },
      { id: 'b', summary: null, openedAt: new Date() },
    ];
    const tools = buildTools(ctx, {
      prisma,
      profile: { intakeSchema: schema, hash: 'h' } as any,
      notifier: new NoopNotifier(),
      config: { owner: { phoneE164: '+5215', notifyOnReady: true, notifyOnDisconnect: true, panelUrl: 'x' } } as any,
    } as any);
    expect(tools.map((t) => t.name)).toContain('select_or_open_job');
    expect(tools).toHaveLength(6);
  });
});
