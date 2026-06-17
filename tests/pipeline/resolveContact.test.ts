import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  testPrisma as prisma,
  cleanupDb as cleanup,
  seedTestTenant,
  TEST_TENANT_ID,
} from '../helpers/db';
import { resolveContact } from '../../src/pipeline/resolveContact';
import { setBotActive, flagNonIntake, upsertContactByPhone } from '../../src/services/contact';

const T = TEST_TENANT_ID;

describe('resolveContact', () => {
  beforeEach(async () => {
    await cleanup();
    await seedTestTenant();
  });
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('crea contacto si no existe y devuelve shouldRespond=true', async () => {
    const r = await resolveContact(prisma, T, '+5215555555555');
    expect(r.shouldRespond).toBe(true);
    if (r.shouldRespond) {
      expect(r.contact.phoneE164).toBe('+5215555555555');
      expect(r.contact.botActive).toBe(true);
    }
  });

  it('reusa contacto existente', async () => {
    const c1 = await upsertContactByPhone(prisma, T, '+521');
    const r = await resolveContact(prisma, T, '+521');
    expect(r.shouldRespond).toBe(true);
    if (r.shouldRespond) expect(r.contact.id).toBe(c1.id);
  });

  it('shouldRespond=false si bot_active=false', async () => {
    const c = await upsertContactByPhone(prisma, T, '+521');
    await setBotActive(prisma, T, c.id, false);
    const r = await resolveContact(prisma, T, '+521');
    expect(r.shouldRespond).toBe(false);
    if (!r.shouldRespond) expect(r.reason).toBe('bot_paused');
  });

  it('shouldRespond=false si flagged_non_intake', async () => {
    const c = await upsertContactByPhone(prisma, T, '+521');
    await flagNonIntake(prisma, T, c.id, 'spam');
    const r = await resolveContact(prisma, T, '+521');
    expect(r.shouldRespond).toBe(false);
    if (!r.shouldRespond) expect(r.reason).toBe('flagged_non_intake');
  });

  it('resucita (archivedAt=null) un contacto archivado al recibir inbound', async () => {
    const created = await prisma.contact.create({
      data: { tenantId: T, phoneE164: '+5215550000030', archivedAt: new Date(), botActive: true },
    });
    const r = await resolveContact(prisma, T, '+5215550000030');
    expect(r.contact.id).toBe(created.id);
    expect(r.contact.archivedAt).toBeNull();
    const reloaded = await prisma.contact.findFirst({ where: { id: created.id } });
    expect(reloaded?.archivedAt).toBeNull();
  });
});
