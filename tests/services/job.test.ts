import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  testPrisma as prisma,
  cleanupDb as cleanup,
  seedTestTenant,
  TEST_TENANT_ID,
} from '../helpers/db';
import {
  openJob,
  markReadyForReview,
  markInProgress,
  closeJob,
  reopenJob,
  findOpenJobsForContact,
} from '../../src/services/job';
import { createEmptyIntakeFromSchema } from '../../src/services/intake';
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

async function createContact(phone = '+5215550000001') {
  return prisma.contact.create({ data: { phoneE164: phone, tenantId: T } });
}

describe('job service', () => {
  beforeEach(async () => {
    await cleanup();
    await seedTestTenant();
  });
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('openJob crea job en OPEN_INTAKE con intake vacío', async () => {
    const c = await createContact();
    const job = await openJob(prisma, T, c.id, createEmptyIntakeFromSchema(schema));
    expect(job.status).toBe('OPEN_INTAKE');
    expect(JSON.parse(job.intake).client.name.value).toBeNull();
  });

  it('markReadyForReview transiciona OPEN_INTAKE → READY_FOR_REVIEW', async () => {
    const c = await createContact();
    const job = await openJob(prisma, T, c.id, createEmptyIntakeFromSchema(schema));
    const ready = await markReadyForReview(prisma, T, job.id, 'Resumen del trabajo');
    expect(ready.status).toBe('READY_FOR_REVIEW');
    expect(ready.summary).toBe('Resumen del trabajo');
    expect(ready.readyAt).not.toBeNull();
  });

  it('markReadyForReview rechaza desde estado no permitido', async () => {
    const c = await createContact();
    const job = await openJob(prisma, T, c.id, createEmptyIntakeFromSchema(schema));
    await markReadyForReview(prisma, T, job.id, 'R');
    await expect(markReadyForReview(prisma, T, job.id, 'R')).rejects.toThrow();
  });

  it('markInProgress transiciona READY → IN_PROGRESS', async () => {
    const c = await createContact();
    const job = await openJob(prisma, T, c.id, createEmptyIntakeFromSchema(schema));
    await markReadyForReview(prisma, T, job.id, 'R');
    const inProg = await markInProgress(prisma, T, job.id);
    expect(inProg.status).toBe('IN_PROGRESS');
  });

  it('closeJob cierra desde OPEN_INTAKE o READY pero no IN_PROGRESS', async () => {
    const c = await createContact();
    const job = await openJob(prisma, T, c.id, createEmptyIntakeFromSchema(schema));
    const closed = await closeJob(prisma, T, job.id);
    expect(closed.status).toBe('CLOSED');
    expect(closed.closedAt).not.toBeNull();
    await expect(closeJob(prisma, T, job.id)).rejects.toThrow();
  });

  it('closeJob desde IN_PROGRESS falla', async () => {
    const c = await createContact();
    const job = await openJob(prisma, T, c.id, createEmptyIntakeFromSchema(schema));
    await markReadyForReview(prisma, T, job.id, 'R');
    await markInProgress(prisma, T, job.id);
    await expect(closeJob(prisma, T, job.id)).rejects.toThrow();
  });

  it('reopenJob lleva un cerrado de vuelta a OPEN_INTAKE', async () => {
    const c = await createContact();
    const job = await openJob(prisma, T, c.id, createEmptyIntakeFromSchema(schema));
    await closeJob(prisma, T, job.id);
    const reopened = await reopenJob(prisma, T, job.id);
    expect(reopened.status).toBe('OPEN_INTAKE');
  });

  it('findOpenJobsForContact devuelve OPEN_INTAKE + READY_FOR_REVIEW, ignora IN_PROGRESS y CLOSED', async () => {
    const c = await createContact();
    const j1 = await openJob(prisma, T, c.id, createEmptyIntakeFromSchema(schema));
    const j2 = await openJob(prisma, T, c.id, createEmptyIntakeFromSchema(schema));
    await markReadyForReview(prisma, T, j2.id, 'R');
    const j3 = await openJob(prisma, T, c.id, createEmptyIntakeFromSchema(schema));
    await markReadyForReview(prisma, T, j3.id, 'R');
    await markInProgress(prisma, T, j3.id);
    const j4 = await openJob(prisma, T, c.id, createEmptyIntakeFromSchema(schema));
    await closeJob(prisma, T, j4.id);
    const open = await findOpenJobsForContact(prisma, T, c.id);
    expect(open.map((j) => j.id).sort()).toEqual([j1.id, j2.id].sort());
  });
});
