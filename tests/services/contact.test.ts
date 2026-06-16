import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma as prisma, cleanupDb as cleanup, seedTestTenant, TEST_TENANT_ID } from '../helpers/db';
import { upsertContactByPhone, setBotActive, flagNonIntake, archiveContact, restoreContact, updateContact, hardDeleteContact } from '../../src/services/contact';

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

describe('archivado, edición y borrado de contacto', () => {
  beforeEach(async () => { await cleanup(); await seedTestTenant(); });
  afterAll(() => prisma.$disconnect());

  it('archiveContact/restoreContact alternan archivedAt', async () => {
    const c = await prisma.contact.create({ data: { tenantId: T, phoneE164: '+5215550000020' } });
    const a = await archiveContact(prisma, T, c.id);
    expect(a.archivedAt).toBeInstanceOf(Date);
    const r = await restoreContact(prisma, T, c.id);
    expect(r.archivedAt).toBeNull();
  });

  it('updateContact cambia displayName y des-marca spam', async () => {
    const c = await prisma.contact.create({ data: { tenantId: T, phoneE164: '+5215550000021', flaggedNonIntake: true, flaggedReason: 'spam' } });
    const u = await updateContact(prisma, T, c.id, { displayName: 'Doña Tere', unflag: true });
    expect(u.displayName).toBe('Doña Tere');
    expect(u.flaggedNonIntake).toBe(false);
    expect(u.flaggedReason).toBeNull();
  });

  it('hardDeleteContact borra el contacto, sus jobs y todo lo asociado', async () => {
    const c = await prisma.contact.create({ data: { tenantId: T, phoneE164: '+5215550000022' } });
    const job = await prisma.job.create({ data: { tenantId: T, contactId: c.id, status: 'OPEN_INTAKE', intake: '{}' } });
    await prisma.message.create({ data: { tenantId: T, contactId: c.id, jobId: job.id, direction: 'inbound', kind: 'text', body: 'x' } });
    await prisma.agentRun.create({ data: { tenantId: T, jobId: job.id, triggerMessageIds: '[]', model: 'm', toolCalls: '[]' } });

    await hardDeleteContact(prisma, T, c.id);

    expect(await prisma.contact.findFirst({ where: { id: c.id } })).toBeNull();
    expect(await prisma.job.count({ where: { contactId: c.id } })).toBe(0);
    expect(await prisma.message.count({ where: { contactId: c.id } })).toBe(0);
    expect(await prisma.agentRun.count({ where: { jobId: job.id } })).toBe(0);
  });

  it('hardDeleteContact de otro tenant lanza error y no borra', async () => {
    const c = await prisma.contact.create({ data: { tenantId: T, phoneE164: '+5215550000023' } });
    await expect(hardDeleteContact(prisma, 'tenant-ajeno', c.id)).rejects.toThrow(/no existe/i);
    expect(await prisma.contact.findFirst({ where: { id: c.id } })).not.toBeNull();
  });
});
