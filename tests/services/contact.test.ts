import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma as prisma, cleanupDb as cleanup, seedTestTenant, TEST_TENANT_ID } from '../helpers/db';
import { upsertContactByPhone, setBotActive, flagNonIntake } from '../../src/services/contact';

const T = TEST_TENANT_ID;

describe('contact service', () => {
  beforeEach(async () => {
    await cleanup();
    await seedTestTenant();
  });
  afterAll(() => prisma.$disconnect());

  it('upsertContactByPhone crea contacto con tenantId y defaults', async () => {
    const c = await upsertContactByPhone(prisma, T, '+5215555555555');
    expect(c.phoneE164).toBe('+5215555555555');
    expect(c.tenantId).toBe(T);
    expect(c.botActive).toBe(true);
    expect(c.flaggedNonIntake).toBe(false);
  });

  it('upsertContactByPhone es idempotente por tenant', async () => {
    const a = await upsertContactByPhone(prisma, T, '+5215555555555');
    const b = await upsertContactByPhone(prisma, T, '+5215555555555');
    expect(a.id).toBe(b.id);
  });

  it('setBotActive cambia el flag', async () => {
    const c = await upsertContactByPhone(prisma, T, '+5215555555555');
    const updated = await setBotActive(prisma, T, c.id, false);
    expect(updated.botActive).toBe(false);
  });

  it('flagNonIntake marca con razón', async () => {
    const c = await upsertContactByPhone(prisma, T, '+5215555555555');
    const updated = await flagNonIntake(prisma, T, c.id, 'spam recurrente');
    expect(updated.flaggedNonIntake).toBe(true);
    expect(updated.flaggedReason).toBe('spam recurrente');
  });
});
