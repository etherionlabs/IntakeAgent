import type { PrismaClient, Contact } from '@prisma/client';

export async function upsertContactByPhone(
  prisma: PrismaClient,
  phoneE164: string,
): Promise<Contact> {
  return prisma.contact.upsert({
    where: { phoneE164 },
    update: {},
    create: { phoneE164 },
  });
}

export async function setBotActive(
  prisma: PrismaClient,
  contactId: string,
  active: boolean,
): Promise<Contact> {
  return prisma.contact.update({
    where: { id: contactId },
    data: { botActive: active },
  });
}

export async function flagNonIntake(
  prisma: PrismaClient,
  contactId: string,
  reason: string,
): Promise<Contact> {
  return prisma.contact.update({
    where: { id: contactId },
    data: { flaggedNonIntake: true, flaggedReason: reason },
  });
}

export async function setDisplayName(
  prisma: PrismaClient,
  contactId: string,
  name: string,
): Promise<Contact> {
  return prisma.contact.update({
    where: { id: contactId },
    data: { displayName: name },
  });
}
