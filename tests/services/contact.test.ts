import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma as prisma, cleanupDb as cleanup } from '../helpers/db';
import {
  upsertContactByPhone,
  setBotActive,
  flagNonIntake,
} from '../../src/services/contact';

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
