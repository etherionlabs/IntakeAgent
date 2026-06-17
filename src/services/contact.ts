import type { PrismaClient, Contact } from '@prisma/client';
import { ServiceError } from './errors';

export async function upsertContactByPhone(
  prisma: PrismaClient,
  tenantId: string,
  phoneE164: string,
): Promise<Contact> {
  const existing = await prisma.contact.findFirst({ where: { tenantId, phoneE164 } });
  if (existing) return existing;
  return prisma.contact.create({ data: { tenantId, phoneE164 } });
}

export async function setBotActive(
  prisma: PrismaClient,
  tenantId: string,
  contactId: string,
  active: boolean,
): Promise<Contact> {
  return prisma.contact.update({
    where: { id: contactId, tenantId },
    data: { botActive: active },
  });
}

export async function flagNonIntake(
  prisma: PrismaClient,
  tenantId: string,
  contactId: string,
  reason: string,
): Promise<Contact> {
  return prisma.contact.update({
    where: { id: contactId, tenantId },
    data: { flaggedNonIntake: true, flaggedReason: reason },
  });
}

export async function setDisplayName(
  prisma: PrismaClient,
  tenantId: string,
  contactId: string,
  name: string,
): Promise<Contact> {
  return prisma.contact.update({
    where: { id: contactId, tenantId },
    data: { displayName: name },
  });
}

export async function archiveContact(prisma: PrismaClient, tenantId: string, contactId: string): Promise<Contact> {
  const c = await prisma.contact.findFirst({ where: { id: contactId, tenantId } });
  if (!c) throw new ServiceError(`contacto ${contactId} no existe`, 'CONTACT_NOT_FOUND');
  return prisma.contact.update({ where: { id: contactId, tenantId }, data: { archivedAt: new Date() } });
}

export async function restoreContact(prisma: PrismaClient, tenantId: string, contactId: string): Promise<Contact> {
  const c = await prisma.contact.findFirst({ where: { id: contactId, tenantId } });
  if (!c) throw new ServiceError(`contacto ${contactId} no existe`, 'CONTACT_NOT_FOUND');
  return prisma.contact.update({ where: { id: contactId, tenantId }, data: { archivedAt: null } });
}

export async function updateContact(
  prisma: PrismaClient,
  tenantId: string,
  contactId: string,
  opts: { displayName?: string; unflag?: boolean },
): Promise<Contact> {
  const c = await prisma.contact.findFirst({ where: { id: contactId, tenantId } });
  if (!c) throw new ServiceError(`contacto ${contactId} no existe`, 'CONTACT_NOT_FOUND');
  const data: { displayName?: string; flaggedNonIntake?: boolean; flaggedReason?: null } = {};
  if (opts.displayName !== undefined) data.displayName = opts.displayName;
  if (opts.unflag) { data.flaggedNonIntake = false; data.flaggedReason = null; }
  return prisma.contact.update({ where: { id: contactId, tenantId }, data });
}

export async function hardDeleteContact(prisma: PrismaClient, tenantId: string, contactId: string): Promise<void> {
  const c = await prisma.contact.findFirst({ where: { id: contactId, tenantId } });
  if (!c) throw new ServiceError(`contacto ${contactId} no existe`, 'CONTACT_NOT_FOUND');
  const jobs = await prisma.job.findMany({ where: { tenantId, contactId }, select: { id: true } });
  const jobIds = jobs.map((j) => j.id);
  await prisma.$transaction([
    prisma.notification.deleteMany({ where: { tenantId, jobId: { in: jobIds } } }),
    prisma.agentRun.deleteMany({ where: { tenantId, jobId: { in: jobIds } } }),
    prisma.message.deleteMany({ where: { tenantId, contactId } }),
    prisma.job.deleteMany({ where: { tenantId, contactId } }),
    prisma.contact.deleteMany({ where: { tenantId, id: contactId } }),
  ]);
}
