import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma as prisma, cleanupDb as cleanup } from '../helpers/db';
import { upsertContactByPhone } from '../../src/services/contact';
import { openJob, markReadyForReview, markInProgress, closeJob } from '../../src/services/job';
import { createEmptyIntakeFromSchema } from '../../src/services/intake';
import { resolveJobForMessage } from '../../src/pipeline/resolveJob';
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

describe('resolveJobForMessage', () => {
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('crea un job nuevo cuando el contacto no tiene jobs abiertos (primer mensaje)', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const r = await resolveJobForMessage(prisma, schema, c.id, 'msg_1');
    expect(r.job.status).toBe('OPEN_INTAKE');
    expect(r.isFirstMessage).toBe(true);
    expect(r.otherOpenJobs).toHaveLength(0);
  });

  it('reutiliza el único job abierto (OPEN_INTAKE)', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const existing = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
    const r = await resolveJobForMessage(prisma, schema, c.id, 'msg_1');
    expect(r.job.id).toBe(existing.id);
    expect(r.isFirstMessage).toBe(false);
  });

  it('reutiliza el único job READY_FOR_REVIEW', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const j = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
    await markReadyForReview(prisma, j.id, 'Resumen del trabajo de tapicería');
    const r = await resolveJobForMessage(prisma, schema, c.id, 'msg_1');
    expect(r.job.id).toBe(j.id);
    expect(r.job.status).toBe('READY_FOR_REVIEW');
  });

  it('crea job nuevo cuando todos los previos están IN_PROGRESS o CLOSED', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const j1 = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
    await markReadyForReview(prisma, j1.id, 'R');
    await markInProgress(prisma, j1.id);
    const j2 = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
    await closeJob(prisma, j2.id);

    const r = await resolveJobForMessage(prisma, schema, c.id, 'msg_1');
    expect(r.job.id).not.toBe(j1.id);
    expect(r.job.id).not.toBe(j2.id);
    expect(r.job.status).toBe('OPEN_INTAKE');
    expect(r.isFirstMessage).toBe(false);
  });

  it('cuando hay múltiples abiertos elige el más reciente y reporta los otros', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const j1 = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
    await new Promise((r) => setTimeout(r, 5));
    const j2 = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));

    const r = await resolveJobForMessage(prisma, schema, c.id, 'msg_1');
    expect(r.job.id).toBe(j2.id);
    expect(r.otherOpenJobs.map((j) => j.id)).toEqual([j1.id]);
  });
});
