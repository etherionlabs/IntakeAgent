import type { PrismaClient, Contact } from '@prisma/client';

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
