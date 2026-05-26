import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import {
  upsertContactByPhone,
  setBotActive,
  flagNonIntake,
} from '../../src/services/contact';

const adapter = new PrismaBetterSqlite3({
  url: 'file:./data/intake.db',
});
const prisma = new PrismaClient({ adapter });

async function cleanup() {
  await prisma.message.deleteMany();
  await prisma.agentRun.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.job.deleteMany();
  await prisma.contact.deleteMany();
}

describe('contact service', () => {
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('upsertContactByPhone crea contacto nuevo con defaults', async () => {
    const c = await upsertContactByPhone(prisma, '+5215555555555');
    expect(c.phoneE164).toBe('+5215555555555');
    expect(c.botActive).toBe(true);
    expect(c.flaggedNonIntake).toBe(false);
  });

  it('upsertContactByPhone es idempotente', async () => {
    const a = await upsertContactByPhone(prisma, '+5215555555555');
    const b = await upsertContactByPhone(prisma, '+5215555555555');
    expect(a.id).toBe(b.id);
  });

  it('setBotActive cambia el flag', async () => {
    const c = await upsertContactByPhone(prisma, '+5215555555555');
    const updated = await setBotActive(prisma, c.id, false);
    expect(updated.botActive).toBe(false);
  });

  it('flagNonIntake marca con razón', async () => {
    const c = await upsertContactByPhone(prisma, '+5215555555555');
    const updated = await flagNonIntake(prisma, c.id, 'spam recurrente');
    expect(updated.flaggedNonIntake).toBe(true);
    expect(updated.flaggedReason).toBe('spam recurrente');
  });
});
