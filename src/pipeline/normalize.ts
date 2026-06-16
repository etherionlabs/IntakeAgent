import type { PrismaClient, Message } from '@prisma/client';
import type { RawInboundMessage } from './types';
import type { MediaStore } from '../media/store';
import type { Transcriber } from '../media/transcriber';
import type { Describer, DescribeContext } from '../media/describer';

export async function normalizeAndPersistMessage(
  prisma: PrismaClient,
  tenantId: string,
  mediaStore: MediaStore,
  transcriber: Transcriber,
  describer: Describer,
  raw: RawInboundMessage,
  contactId: string,
  describeContext?: DescribeContext,
): Promise<Message> {
  const message = await prisma.message.create({
    data: {
      tenantId,
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
  } else if (raw.kind === 'image') {
    const description = await describer.describe(raw.media.buffer, raw.media.mimetype, {
      ...(describeContext ?? {}),
      caption: raw.text,
    });
    if (description && description.length > 0) {
      const caption = raw.text?.trim();
      // Conservamos el caption del cliente (si lo hay) y le anexamos la
      // descripción generada por visión, para que el agente razone sobre ambos.
      body = caption
        ? `${caption}\n\n[Descripción de la foto] ${description}`
        : `[Descripción de la foto] ${description}`;
    }
  }

  return prisma.message.update({
    where: { id: message.id, tenantId },
    data: { mediaPath, body },
  });
}
