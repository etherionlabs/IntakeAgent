import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  testPrisma as prisma,
  cleanupDb as cleanup,
  seedTestTenant,
  TEST_TENANT_ID,
} from '../helpers/db';
import { upsertContactByPhone } from '../../src/services/contact';
import { openJob, markReadyForReview, markInProgress, closeJob } from '../../src/services/job';
import { createEmptyIntakeFromSchema } from '../../src/services/intake';
import { resolveJobForMessage } from '../../src/pipeline/resolveJob';
import type { IntakeSchema } from '../../src/config/intake-schema';

const T = TEST_TENANT_ID;

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

describe('resolveJobForMessage', () => {
  beforeEach(async () => {
    await cleanup();
    await seedTestTenant();
  });
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('crea un job nuevo cuando el contacto no tiene jobs abiertos (primer mensaje)', async () => {
    const c = await upsertContactByPhone(prisma, T, '+521');
    const r = await resolveJobForMessage(prisma, T, schema, c.id, 'msg_1');
    expect(r.job.status).toBe('OPEN_INTAKE');
    expect(r.isFirstMessage).toBe(true);
    expect(r.otherOpenJobs).toHaveLength(0);
  });

  it('reutiliza el único job abierto (OPEN_INTAKE)', async () => {
    const c = await upsertContactByPhone(prisma, T, '+521');
    const existing = await openJob(prisma, T, c.id, createEmptyIntakeFromSchema(schema));
    const r = await resolveJobForMessage(prisma, T, schema, c.id, 'msg_1');
    expect(r.job.id).toBe(existing.id);
    expect(r.isFirstMessage).toBe(false);
  });

  it('reutiliza el único job READY_FOR_REVIEW', async () => {
    const c = await upsertContactByPhone(prisma, T, '+521');
    const j = await openJob(prisma, T, c.id, createEmptyIntakeFromSchema(schema));
    await markReadyForReview(prisma, T, j.id, 'Resumen del trabajo de tapicería');
    const r = await resolveJobForMessage(prisma, T, schema, c.id, 'msg_1');
    expect(r.job.id).toBe(j.id);
    expect(r.job.status).toBe('READY_FOR_REVIEW');
  });

  it('crea job nuevo cuando todos los previos están IN_PROGRESS o CLOSED', async () => {
    const c = await upsertContactByPhone(prisma, T, '+521');
    const j1 = await openJob(prisma, T, c.id, createEmptyIntakeFromSchema(schema));
    await markReadyForReview(prisma, T, j1.id, 'R');
    await markInProgress(prisma, T, j1.id);
    const j2 = await openJob(prisma, T, c.id, createEmptyIntakeFromSchema(schema));
    await closeJob(prisma, T, j2.id);

    const r = await resolveJobForMessage(prisma, T, schema, c.id, 'msg_1');
    expect(r.job.id).not.toBe(j1.id);
    expect(r.job.id).not.toBe(j2.id);
    expect(r.job.status).toBe('OPEN_INTAKE');
    expect(r.isFirstMessage).toBe(false);
  });

  it('cuando hay múltiples abiertos y no hay historia, elige el más reciente', async () => {
    const c = await upsertContactByPhone(prisma, T, '+521');
    const j1 = await openJob(prisma, T, c.id, createEmptyIntakeFromSchema(schema));
    await new Promise((r) => setTimeout(r, 5));
    const j2 = await openJob(prisma, T, c.id, createEmptyIntakeFromSchema(schema));

    const r = await resolveJobForMessage(prisma, T, schema, c.id, 'msg_1');
    expect(r.job.id).toBe(j2.id);
    expect(r.otherOpenJobs.map((j) => j.id)).toEqual([j1.id]);
  });

  it('sigue la conversación en curso, no el trabajo más nuevo', async () => {
    // El cliente estaba hablando del trabajo viejo. Antes, cada mensaje volvía
    // solo al más reciente: el agente lo cambiaba al correcto y el mensaje
    // siguiente lo deshacía.
    const c = await upsertContactByPhone(prisma, T, '+521');
    const viejo = await openJob(prisma, T, c.id, createEmptyIntakeFromSchema(schema));
    await new Promise((r) => setTimeout(r, 5));
    const nuevo = await openJob(prisma, T, c.id, createEmptyIntakeFromSchema(schema));

    await prisma.message.create({
      data: {
        tenantId: T, jobId: viejo.id, contactId: c.id,
        direction: 'inbound', kind: 'text', body: 'te hablo del sillón',
      },
    });

    const r = await resolveJobForMessage(prisma, T, schema, c.id, 'msg_2');
    expect(r.job.id).toBe(viejo.id);
    expect(r.otherOpenJobs.map((j) => j.id)).toEqual([nuevo.id]);
  });

  it('el mensaje que se está procesando no se cuenta a sí mismo', async () => {
    // Se le asigna jobId DESPUÉS de resolver: si contara, siempre se elegiría a
    // sí mismo y la continuidad no valdría de nada.
    const c = await upsertContactByPhone(prisma, T, '+521');
    const viejo = await openJob(prisma, T, c.id, createEmptyIntakeFromSchema(schema));
    await new Promise((r) => setTimeout(r, 5));
    await openJob(prisma, T, c.id, createEmptyIntakeFromSchema(schema));
    await prisma.message.create({
      data: {
        tenantId: T, jobId: viejo.id, contactId: c.id,
        direction: 'inbound', kind: 'text', body: 'anterior',
      },
    });
    // Mensaje entrante todavía sin job (como lo crea normalizeAndPersistMessage).
    await prisma.message.create({
      data: { tenantId: T, contactId: c.id, direction: 'inbound', kind: 'text', body: 'nuevo' },
    });

    const r = await resolveJobForMessage(prisma, T, schema, c.id, 'msg_3');
    expect(r.job.id).toBe(viejo.id);
  });
});
