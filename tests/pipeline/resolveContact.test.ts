import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma as prisma, cleanupDb as cleanup } from '../helpers/db';
import { resolveContact } from '../../src/pipeline/resolveContact';
import { setBotActive, flagNonIntake, upsertContactByPhone } from '../../src/services/contact';

describe('resolveContact', () => {
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('crea contacto si no existe y devuelve shouldRespond=true', async () => {
    const r = await resolveContact(prisma, '+5215555555555');
    expect(r.shouldRespond).toBe(true);
    if (r.shouldRespond) {
      expect(r.contact.phoneE164).toBe('+5215555555555');
      expect(r.contact.botActive).toBe(true);
    }
  });

  it('reusa contacto existente', async () => {
    const c1 = await upsertContactByPhone(prisma, '+521');
    const r = await resolveContact(prisma, '+521');
    expect(r.shouldRespond).toBe(true);
    if (r.shouldRespond) expect(r.contact.id).toBe(c1.id);
  });

  it('shouldRespond=false si bot_active=false', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    await setBotActive(prisma, c.id, false);
    const r = await resolveContact(prisma, '+521');
    expect(r.shouldRespond).toBe(false);
    if (!r.shouldRespond) expect(r.reason).toBe('bot_paused');
  });

  it('shouldRespond=false si flagged_non_intake', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    await flagNonIntake(prisma, c.id, 'spam');
    const r = await resolveContact(prisma, '+521');
    expect(r.shouldRespond).toBe(false);
    if (!r.shouldRespond) expect(r.reason).toBe('flagged_non_intake');
  });
});
