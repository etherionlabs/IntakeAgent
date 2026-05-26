import type { RawInboundMessage } from '../../pipeline/types';

export interface WAMessageLike {
  key: {
    remoteJid?: string | null;
    fromMe?: boolean | null;
    id?: string | null;
    participant?: string | null;
  };
  messageTimestamp?: number | Long | null;
  message?: {
    conversation?: string | null;
    extendedTextMessage?: { text?: string | null } | null;
    imageMessage?: { mimetype?: string | null; caption?: string | null } | null;
    audioMessage?: { mimetype?: string | null } | null;
    videoMessage?: { mimetype?: string | null; caption?: string | null } | null;
    stickerMessage?: unknown;
    locationMessage?: unknown;
    documentMessage?: { mimetype?: string | null; caption?: string | null } | null;
  } | null;
}

interface Long {
  toNumber(): number;
}

export type Downloader = (wam: WAMessageLike) => Promise<Buffer>;

export async function mapWAMessageToRaw(
  wam: WAMessageLike,
  downloader: Downloader,
): Promise<RawInboundMessage | null> {
  const message = wam.message;
  if (!message) return null;

  const remoteJid = wam.key.remoteJid ?? '';
  const chatKind = inferChatKind(remoteJid);
  const fromPhoneE164 = jidToE164(remoteJid, wam.key.participant ?? null);
  const whatsappMsgId = wam.key.id ?? `unknown_${Date.now()}`;
  const fromMe = wam.key.fromMe === true;
  const receivedAt = timestampToIso(wam.messageTimestamp);

  if (typeof message.conversation === 'string' && message.conversation.length > 0) {
    return base('text', message.conversation, null);
  }
  if (message.extendedTextMessage?.text) {
    return base('text', message.extendedTextMessage.text, null);
  }

  if (message.imageMessage) {
    const buffer = await downloader(wam);
    return base(
      'image',
      message.imageMessage.caption ?? null,
      { buffer, mimetype: message.imageMessage.mimetype ?? 'image/jpeg' },
    );
  }

  if (message.audioMessage) {
    const buffer = await downloader(wam);
    return base(
      'audio',
      null,
      { buffer, mimetype: message.audioMessage.mimetype ?? 'audio/ogg' },
    );
  }

  if (message.videoMessage) {
    return base('other', message.videoMessage.caption ?? null, null);
  }
  if (message.documentMessage) {
    return base('other', message.documentMessage.caption ?? null, null);
  }

  if (message.stickerMessage) return base('sticker', null, null);
  if (message.locationMessage) return base('location', null, null);

  return null;

  function base(
    kind: RawInboundMessage['kind'],
    text: string | null,
    media: RawInboundMessage['media'],
  ): RawInboundMessage {
    return {
      whatsappMsgId,
      fromPhoneE164,
      chatKind,
      fromMe,
      kind,
      text,
      media,
      raw: wam,
      receivedAt,
    };
  }
}

function inferChatKind(jid: string): RawInboundMessage['chatKind'] {
  if (!jid) return 'other';
  if (jid.endsWith('@g.us')) return 'group';
  if (jid === 'status@broadcast' || jid.endsWith('@broadcast')) return 'status';
  if (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@c.us')) return 'individual';
  return 'other';
}

function jidToE164(jid: string, participant: string | null): string {
  const source = participant ?? jid;
  const at = source.indexOf('@');
  const num = at >= 0 ? source.slice(0, at) : source;
  return num.startsWith('+') ? num : `+${num}`;
}

function timestampToIso(ts: number | Long | null | undefined): string {
  if (!ts) return new Date().toISOString();
  const seconds = typeof ts === 'number' ? ts : ts.toNumber();
  return new Date(seconds * 1000).toISOString();
}
