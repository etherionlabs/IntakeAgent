import type { PrismaClient, Message } from '@prisma/client';
import type { RawInboundMessage } from './types';
import type { MediaStore } from '../media/store';
import type { Transcriber } from '../media/transcriber';

export async function normalizeAndPersistMessage(
  prisma: PrismaClient,
  mediaStore: MediaStore,
  transcriber: Transcriber,
  raw: RawInboundMessage,
  contactId: string,
): Promise<Message> {
  const message = await prisma.message.create({
    data: {
      contactId,
      direction: 'inbound',
      kind: raw.kind,
      body: raw.text,
      whatsappMsgId: raw.whatsappMsgId,
      raw: JSON.stringify(raw.raw ?? {}),
    },
  });

  if (!raw.media) return message;

  const mediaPath = await mediaStore.save({
    buffer: raw.media.buffer,
    mimetype: raw.media.mimetype,
    contactId,
    jobId: 'unassigned',
    messageId: message.id,
  });

  let body: string | null = raw.text;
  if (raw.kind === 'audio') {
    const transcription = await transcriber.transcribe(raw.media.buffer, raw.media.mimetype);
    if (transcription && transcription.length > 0) {
      body = transcription;
    }
  }

  return prisma.message.update({
    where: { id: message.id },
    data: { mediaPath, body },
  });
}
