import type { PrismaClient } from '@prisma/client';
import type { RawInboundMessage, PrefilterResult } from './types';

export function prefilter(msg: RawInboundMessage): PrefilterResult {
  if (msg.fromMe) return { rejected: true, reason: 'from_me' };
  if (msg.chatKind === 'group') return { rejected: true, reason: 'group' };
  if (msg.chatKind === 'status') return { rejected: true, reason: 'status' };
  if (msg.chatKind === 'other') return { rejected: true, reason: 'other_kind' };
  return { rejected: false };
}

export async function alreadySeen(
  prisma: PrismaClient,
  whatsappMsgId: string,
): Promise<boolean> {
  const existing = await prisma.message.findUnique({
    where: { whatsappMsgId },
    select: { id: true },
  });
  return existing !== null;
}
