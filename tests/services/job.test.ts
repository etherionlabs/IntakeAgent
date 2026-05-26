import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { upsertContactByPhone } from '../../src/services/contact';
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
      fields: [{ key: 'name', label: 'N', type: 'string', required: true }],
    },
  ],
};

async function cleanup() {
  await prisma.message.deleteMany();
  await prisma.agentRun.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.job.deleteMany();
  await prisma.contact.deleteMany();
}

describe('job service', () => {
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('openJob crea job en OPEN_INTAKE con intake vacío', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const job = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
    expect(job.status).toBe('OPEN_INTAKE');
    expect(JSON.parse(job.intake).client.name.value).toBeNull();
  });

  it('markReadyForReview transiciona OPEN_INTAKE → READY_FOR_REVIEW', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const job = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
    const ready = await markReadyForReview(prisma, job.id, 'Resumen del trabajo');
    expect(ready.status).toBe('READY_FOR_REVIEW');
    expect(ready.summary).toBe('Resumen del trabajo');
    expect(ready.readyAt).not.toBeNull();
  });

  it('markReadyForReview rechaza desde estado no permitido', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const job = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
    await markReadyForReview(prisma, job.id, 'R');
    await expect(markReadyForReview(prisma, job.id, 'R')).rejects.toThrow();
  });

  it('markInProgress transiciona READY → IN_PROGRESS', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const job = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
    await markReadyForReview(prisma, job.id, 'R');
    const inProg = await markInProgress(prisma, job.id);
    expect(inProg.status).toBe('IN_PROGRESS');
  });

  it('closeJob cierra desde OPEN_INTAKE o READY pero no IN_PROGRESS', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const job = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
    const closed = await closeJob(prisma, job.id);
    expect(closed.status).toBe('CLOSED');
    expect(closed.closedAt).not.toBeNull();
    await expect(closeJob(prisma, job.id)).rejects.toThrow();
  });

  it('closeJob desde IN_PROGRESS falla', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const job = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
    await markReadyForReview(prisma, job.id, 'R');
    await markInProgress(prisma, job.id);
    await expect(closeJob(prisma, job.id)).rejects.toThrow();
  });

  it('reopenJob lleva un cerrado de vuelta a OPEN_INTAKE', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const job = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
    await closeJob(prisma, job.id);
    const reopened = await reopenJob(prisma, job.id);
    expect(reopened.status).toBe('OPEN_INTAKE');
  });

  it('findOpenJobsForContact devuelve OPEN_INTAKE + READY_FOR_REVIEW, ignora IN_PROGRESS y CLOSED', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const j1 = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
    const j2 = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
    await markReadyForReview(prisma, j2.id, 'R');
    const j3 = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
    await markReadyForReview(prisma, j3.id, 'R');
    await markInProgress(prisma, j3.id);
    const j4 = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
    await closeJob(prisma, j4.id);
    const open = await findOpenJobsForContact(prisma, c.id);
    expect(open.map((j) => j.id).sort()).toEqual([j1.id, j2.id].sort());
  });
});
