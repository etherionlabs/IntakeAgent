import type { PrismaClient, Contact } from '@prisma/client';
import { upsertContactByPhone } from '../services/contact';

export type ContactResolution =
  | { shouldRespond: true; contact: Contact }
  | { shouldRespond: false; contact: Contact; reason: 'bot_paused' | 'flagged_non_intake' };

export async function resolveContact(
  prisma: PrismaClient,
  tenantId: string,
  fromPhoneE164: string,
): Promise<ContactResolution> {
  const contact = await upsertContactByPhone(prisma, tenantId, fromPhoneE164);
  if (!contact.botActive) {
    return { shouldRespond: false, contact, reason: 'bot_paused' };
  }
  if (contact.flaggedNonIntake) {
    return { shouldRespond: false, contact, reason: 'flagged_non_intake' };
  }
  return { shouldRespond: true, contact };
}
