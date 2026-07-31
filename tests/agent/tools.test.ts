import { describe, it, expect, afterAll } from 'vitest';
import { testPrisma as prisma, seedTestTenant, TEST_TENANT_ID } from '../helpers/db';
import { upsertContactByPhone } from '../../src/services/contact';
import { openJob } from '../../src/services/job';
import {
  createEmptyIntakeFromSchema,
  bulkUpdate,
  upsertOpportunities,
  listOpportunities,
  getDiagnosis,
  openObjections,
  type IntakeState,
} from '../../src/services/intake';
import {
  buildUpdateIntakeTool,
  buildMarkReadyTool,
  buildRegisterOpportunityTool,
  buildRegisterDiscoveryTool,
} from '../../src/agent/tools';
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
  await seedTestTenant();
  const c = await upsertContactByPhone(prisma, TEST_TENANT_ID, '+521');
  const j = await openJob(prisma, TEST_TENANT_ID, c.id, createEmptyIntakeFromSchema(schema));
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
    const tool = buildUpdateIntakeTool(ctx, { prisma, tenantId: TEST_TENANT_ID, profile, notifier: new NoopNotifier() } as any);
    const out = await tool.execute({ fields: [{ path: 'client.name', value: 'María' }] });
    expect(out.ok).toBe(true);
    const reload = await prisma.job.findUnique({ where: { id: ctx.job.id } });
    const intake = JSON.parse(reload!.intake);
    expect(intake.client.name.value).toBe('María');
    expect(intake.client.name.source_message_id).toBe('m1');
  });

  it('tolera paths con corchetes (los normaliza) — defensa anti bracket-copy', async () => {
    const ctx = await setupCtx();
    const profile = { intakeSchema: schema } as any;
    const tool = buildUpdateIntakeTool(ctx, { prisma, tenantId: TEST_TENANT_ID, profile, notifier: new NoopNotifier() } as any);
    const out = await tool.execute({ fields: [{ path: '[client.name]', value: 'Gabriela' }] });
    expect(out.ok).toBe(true);
    const reload = await prisma.job.findUnique({ where: { id: ctx.job.id } });
    const intake = JSON.parse(reload!.intake);
    expect(intake.client.name.value).toBe('Gabriela');
  });

  it('agrega notas libres', async () => {
    const ctx = await setupCtx();
    const profile = { intakeSchema: schema } as any;
    const tool = buildUpdateIntakeTool(ctx, { prisma, tenantId: TEST_TENANT_ID, profile, notifier: new NoopNotifier() } as any);
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
    const tool = buildUpdateIntakeTool(ctx, { prisma, tenantId: TEST_TENANT_ID, profile, notifier: new NoopNotifier() } as any);
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
    const tool = buildUpdateIntakeTool(ctx, { prisma, tenantId: TEST_TENANT_ID, profile, notifier: new NoopNotifier() } as any);
    const out = await tool.execute({
      fields: [{ path: 'client.phone', declined: true, declined_reason: 'no tiene fijo' }],
    });
    expect(out.ok).toBe(true);
    const reload = await prisma.job.findUnique({ where: { id: ctx.job.id } });
    const intake = JSON.parse(reload!.intake);
    expect(intake.client.phone.declined).toBe(true);
  });
});

describe('tool register_opportunity', () => {
  const deps = { prisma, tenantId: TEST_TENANT_ID };

  it('registra extras ofrecidos y los persiste en el intake del job', async () => {
    const ctx = await setupCtx();
    const tool = buildRegisterOpportunityTool(ctx, deps as any);
    const out = await tool.execute({
      items: [
        { service: 'polarizado 20%', status: 'offered', note: 'se quejó del calor' },
        { service: 'PPF en el frente', status: 'accepted' },
      ],
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.registered).toBe(2);
    expect(out.accepted).toEqual(['PPF en el frente']);

    const reload = await prisma.job.findUnique({ where: { id: ctx.job.id } });
    const persisted = JSON.parse(reload!.intake);
    expect(persisted.opportunities).toHaveLength(2);
    expect(persisted.opportunities[0]).toMatchObject({
      service: 'polarizado 20%',
      status: 'offered',
      note: 'se quejó del calor',
      source_message_id: 'm1',
    });
    // El contexto del turno queda sincronizado para las siguientes tools.
    expect(listOpportunities(ctx.intake)).toHaveLength(2);
  });

  it('actualiza el estado de un extra ya registrado sin duplicarlo', async () => {
    const ctx = await setupCtx();
    const tool = buildRegisterOpportunityTool(ctx, deps as any);
    await tool.execute({ items: [{ service: 'protección cerámica', status: 'offered' }] });
    await tool.execute({ items: [{ service: 'protección cerámica', status: 'declined' }] });

    const reload = await prisma.job.findUnique({ where: { id: ctx.job.id } });
    const persisted = JSON.parse(reload!.intake);
    expect(persisted.opportunities).toHaveLength(1);
    expect(persisted.opportunities[0].status).toBe('declined');
  });

  it('no pisa los campos del intake ya capturados', async () => {
    const ctx = await setupCtx();
    const filled = bulkUpdate(schema, ctx.intake, [{ path: 'client.name', value: 'María' }], {
      now: ctx.now,
      source_message_id: 'm1',
    });
    if (!filled.ok) throw new Error('fail');
    ctx.intake = filled.intake;

    const tool = buildRegisterOpportunityTool(ctx, deps as any);
    await tool.execute({ items: [{ service: 'rotulación', status: 'accepted' }] });

    const reload = await prisma.job.findUnique({ where: { id: ctx.job.id } });
    const persisted = JSON.parse(reload!.intake);
    expect(persisted.client.name.value).toBe('María');
    expect(persisted.opportunities).toHaveLength(1);
  });

  it('rechaza status inválidos y listas vacías', async () => {
    const ctx = await setupCtx();
    const tool = buildRegisterOpportunityTool(ctx, deps as any);
    const bad = await tool.execute({ items: [{ service: 'x y z', status: 'quizás' }] });
    expect(bad.ok).toBe(false);
    const empty = await tool.execute({ items: [] });
    expect(empty.ok).toBe(false);
  });
});

describe('tool register_discovery', () => {
  const deps = { prisma, tenantId: TEST_TENANT_ID };

  it('guarda el diagnóstico y devuelve lo que sigue faltando', async () => {
    const ctx = await setupCtx();
    const tool = buildRegisterDiscoveryTool(ctx, deps as any);
    const out = await tool.execute({ pain: 'el sillón está hundido y ya no lo usan' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // El recordatorio de que todavía no toca proponer.
    expect(out.missing).toEqual(['implication', 'urgency']);

    const reload = await prisma.job.findUnique({ where: { id: ctx.job.id } });
    expect(JSON.parse(reload!.intake).diagnosis.pain).toContain('hundido');
  });

  it('acumula entre llamadas sin perder lo anterior', async () => {
    const ctx = await setupCtx();
    const tool = buildRegisterDiscoveryTool(ctx, deps as any);
    await tool.execute({ pain: 'la tela ya no da' });
    const out = await tool.execute({ implication: 'le da pena recibir visitas', urgency: 'alta' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.missing).toEqual([]);

    const diag = getDiagnosis(ctx.intake);
    expect(diag.pain).toBe('la tela ya no da');
    expect(diag.implication).toContain('visitas');
    expect(diag.urgency).toBe('alta');
  });

  it('registra una objeción abierta y la cuenta', async () => {
    const ctx = await setupCtx();
    const tool = buildRegisterDiscoveryTool(ctx, deps as any);
    const out = await tool.execute({
      objection: { type: 'precio', note: 'lo compara con otra cotización' },
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.open_objections).toBe(1);
    expect(openObjections(ctx.intake)[0].type).toBe('precio');
  });

  it('resolver una objeción la cierra sin duplicarla', async () => {
    const ctx = await setupCtx();
    const tool = buildRegisterDiscoveryTool(ctx, deps as any);
    await tool.execute({ objection: { type: 'precio', note: 'lo ve caro' } });
    const out = await tool.execute({
      objection: { type: 'precio', note: 'entendió el alcance', resolved: true },
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.open_objections).toBe(0);
    expect(getDiagnosis(ctx.intake).objections).toHaveLength(1);
  });

  it('rechaza una llamada vacía y una urgencia inventada', async () => {
    const ctx = await setupCtx();
    const tool = buildRegisterDiscoveryTool(ctx, deps as any);
    expect((await tool.execute({})).ok).toBe(false);
    expect((await tool.execute({ urgency: 'muchísima' })).ok).toBe(false);
  });

  it('no pisa los campos del intake ya capturados', async () => {
    const ctx = await setupCtx();
    const filled = bulkUpdate(schema, ctx.intake, [{ path: 'client.name', value: 'María' }], {
      now: ctx.now,
      source_message_id: 'm1',
    });
    if (!filled.ok) throw new Error('fail');
    ctx.intake = filled.intake;

    const tool = buildRegisterDiscoveryTool(ctx, deps as any);
    await tool.execute({ pain: 'algo' });

    const reload = await prisma.job.findUnique({ where: { id: ctx.job.id } });
    expect(JSON.parse(reload!.intake).client.name.value).toBe('María');
  });
});

describe('tool mark_ready_for_review', () => {
  it('rechaza si faltan campos requeridos', async () => {
    const ctx = await setupCtx();
    const profile = { intakeSchema: schema, hash: 'h' } as any;
    const notifier = new NoopNotifier();
    const tool = buildMarkReadyTool(ctx, { prisma, tenantId: TEST_TENANT_ID, profile, notifier, config: { owner: { phoneE164: '+5215', notifyOnReady: true, notifyOnDisconnect: true, panelUrl: 'http://x' } } } as any);
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
      tenantId: TEST_TENANT_ID,
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

  it('manda al dueño los extras aceptados junto al resumen', async () => {
    const ctx = await setupCtx();
    const profile = { intakeSchema: schema, hash: 'h' } as any;
    const filled = bulkUpdate(schema, ctx.intake, [{ path: 'client.name', value: 'María' }], {
      now: ctx.now,
      source_message_id: 'm1',
    });
    if (!filled.ok) throw new Error('fail');
    ctx.intake = upsertOpportunities(
      filled.intake,
      [
        { service: 'polarizado 20%', status: 'accepted' },
        { service: 'protección cerámica', status: 'declined' },
      ],
      ctx.now,
      'm1',
    );
    await prisma.job.update({
      where: { id: ctx.job.id },
      data: { intake: JSON.stringify(ctx.intake) },
    });

    const notifier = new NoopNotifier();
    const tool = buildMarkReadyTool(ctx, {
      prisma,
      tenantId: TEST_TENANT_ID,
      profile,
      notifier,
      config: {
        owner: { phoneE164: '+5215', notifyOnReady: true, notifyOnDisconnect: true, panelUrl: 'http://x' },
      },
    } as any);

    const out = await tool.execute({ summary: 'Wrap del cofre para María, más polarizado.' });
    expect(out.ok).toBe(true);
    const payload = notifier.history[0].payload as { extras?: string[] };
    // Solo los aceptados: lo rechazado no se le cotiza al cliente.
    expect(payload.extras).toEqual(['polarizado 20%']);
  });

  it('rechaza summary demasiado corto', async () => {
    const ctx = await setupCtx();
    const profile = { intakeSchema: schema, hash: 'h' } as any;
    const tool = buildMarkReadyTool(ctx, { prisma, tenantId: TEST_TENANT_ID, profile, notifier: new NoopNotifier(), config: { owner: { phoneE164: '+5215', notifyOnReady: false, notifyOnDisconnect: false, panelUrl: 'x' } } } as any);
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
      prisma, tenantId: TEST_TENANT_ID, profile, notifier,
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
    const tool = buildCloseJobTool(ctx, { prisma, tenantId: TEST_TENANT_ID } as any);
    const out = await tool.execute({});
    expect(out.ok).toBe(true);
    const reload = await prisma.job.findUnique({ where: { id: ctx.job.id } });
    expect(reload!.status).toBe('CLOSED');
  });

  it('rechaza desde IN_PROGRESS', async () => {
    const ctx = await setupCtx();
    await prisma.job.update({ where: { id: ctx.job.id }, data: { status: 'IN_PROGRESS' } });
    ctx.job.status = 'IN_PROGRESS';
    const tool = buildCloseJobTool(ctx, { prisma, tenantId: TEST_TENANT_ID } as any);
    const out = await tool.execute({});
    expect(out.ok).toBe(false);
  });
});

describe('tool flag_non_intake', () => {
  it('marca el contacto y devuelve ok', async () => {
    const ctx = await setupCtx();
    const tool = buildFlagNonIntakeTool(ctx, { prisma, tenantId: TEST_TENANT_ID } as any);
    const out = await tool.execute({ reason: 'cliente sólo manda promociones' });
    expect(out.ok).toBe(true);
    const reload = await prisma.contact.findUnique({ where: { id: ctx.contact.id } });
    expect(reload!.flaggedNonIntake).toBe(true);
    expect(reload!.flaggedReason).toBe('cliente sólo manda promociones');
  });

  it('rechaza reason demasiado corto', async () => {
    const ctx = await setupCtx();
    const tool = buildFlagNonIntakeTool(ctx, { prisma, tenantId: TEST_TENANT_ID } as any);
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

import { buildReanalyzeImageTool } from '../../src/agent/tools';
import { FilesystemMediaStore } from '../../src/media/store';
import { ScriptedDescriber } from '../../src/media/describer';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('tool reanalyze_image', () => {
  const profile = {
    intakeSchema: { $businessName: 'Tapicería', $businessDomain: 'tapicería' },
    imageFocus: 'tipo de mueble, daños',
  } as any;

  it('re-analiza una foto del job y persiste la nueva descripción', async () => {
    const ctx = await setupCtx();
    const mediaRoot = await mkdtemp(join(tmpdir(), 'intake-tool-'));
    try {
      const mediaStore = new FilesystemMediaStore(mediaRoot);
      const relPath = await mediaStore.save({
        buffer: Buffer.from('fake-jpeg'),
        mimetype: 'image/jpeg',
        contactId: ctx.contact.id,
        jobId: ctx.job.id,
        messageId: 'img-1',
      });
      const msg = await prisma.message.create({
        data: {
          id: 'img-1',
          tenantId: TEST_TENANT_ID,
          jobId: ctx.job.id,
          contactId: ctx.contact.id,
          direction: 'inbound',
          kind: 'image',
          body: 'foto del sillón',
          mediaPath: relPath,
        },
      });
      ctx.availablePhotos = [{ messageId: msg.id, caption: msg.body, description: null }];

      const tool = buildReanalyzeImageTool(ctx, {
        prisma,
        tenantId: TEST_TENANT_ID,
        profile,
        mediaStore,
        describer: new ScriptedDescriber(['El brazo derecho tiene una rotura de 10cm en la costura.']),
      });

      const out = await tool.execute({ photo_ref: 'img-1', focus: 'el daño exacto en el brazo' });
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(String(out.description)).toContain('rotura de 10cm');

      const reload = await prisma.message.findUnique({ where: { id: 'img-1' } });
      expect(reload!.mediaDescription).toContain('rotura de 10cm');
      // El contexto del turno también refleja la nueva descripción.
      expect(ctx.availablePhotos[0].description).toContain('rotura de 10cm');
    } finally {
      await rm(mediaRoot, { recursive: true, force: true });
    }
  });

  it('rechaza un photo_ref que no está en availablePhotos', async () => {
    const ctx = await setupCtx();
    ctx.availablePhotos = [];
    const tool = buildReanalyzeImageTool(ctx, {
      prisma,
      tenantId: TEST_TENANT_ID,
      profile,
      mediaStore: new FilesystemMediaStore('/tmp/none'),
      describer: new ScriptedDescriber(['x']),
    });
    const out = await tool.execute({ photo_ref: 'nope', focus: 'lo que sea' });
    expect(out.ok).toBe(false);
  });
});

import { buildTools } from '../../src/agent/tools';

describe('buildTools', () => {
  it('sin otros trabajos abiertos no ofrece select_or_open_job', async () => {
    const ctx = await setupCtx();
    const tools = buildTools(ctx, {
      prisma,
      tenantId: TEST_TENANT_ID,
      profile: { intakeSchema: schema, hash: 'h' } as any,
      notifier: new NoopNotifier(),
      config: { owner: { phoneE164: '+5215', notifyOnReady: true, notifyOnDisconnect: true, panelUrl: 'x' } } as any,
    } as any);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'close_job',
      'flag_non_intake',
      'mark_ready_for_review',
      'register_discovery',
      'register_opportunity',
      'request_photo',
      'update_intake',
    ]);
  });

  it('agrega select_or_open_job en cuanto hay UN otro trabajo abierto', async () => {
    const ctx = await setupCtx();
    // Dos trabajos en total (este + uno) ya es ambiguo: es el caso normal de un
    // cliente que vuelve, y antes se quedaba sin la tool.
    ctx.otherOpenJobs = [{ id: 'a', summary: null, openedAt: new Date() }];
    const tools = buildTools(ctx, {
      prisma,
      tenantId: TEST_TENANT_ID,
      profile: { intakeSchema: schema, hash: 'h' } as any,
      notifier: new NoopNotifier(),
      config: { owner: { phoneE164: '+5215', notifyOnReady: true, notifyOnDisconnect: true, panelUrl: 'x' } } as any,
    } as any);
    expect(tools.map((t) => t.name)).toContain('select_or_open_job');
    expect(tools).toHaveLength(8);
  });
});
