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
  // Baileys 7 puede usar nuevos sufijos (@lid, @newsletter, etc.) además de los
  // tradicionales. Tratamos como individual cualquier JID que no sea grupo ni
  // status — el contenido y el número los decide el pipeline después.
  return 'individual';
}

/**
 * Devuelve un identificador estable del remitente.
 *
 * Baileys 7 con cuentas LID usa JIDs como "166137958535379@lid" en vez de
 * "+5215...@s.whatsapp.net". Para poder responderles, debemos preservar el
 * JID completo (con su sufijo) como identificador, NO un E.164 inventado.
 *
 * El campo se llama `fromPhoneE164` por compatibilidad histórica, pero el
 * sender acepta tanto E.164 (+...) como JID directo (...@...).
 */
function jidToE164(jid: string, participant: string | null): string {
  // participant puede llegar como "" en Baileys 7 — ?? no lo descarta.
  const source = participant && participant.length > 0 ? participant : jid;
  if (!source) return '';
  // Si el JID viene de un sufijo distinto a @s.whatsapp.net o @c.us, lo
  // preservamos completo (LID, newsletter, etc.) — el sender lo usa tal cual.
  if (
    source.includes('@') &&
    !source.endsWith('@s.whatsapp.net') &&
    !source.endsWith('@c.us')
  ) {
    return source;
  }
  // Para JIDs tradicionales o números sueltos, extraer la parte numérica y
  // prefijar con "+".
  const at = source.indexOf('@');
  const num = at >= 0 ? source.slice(0, at) : source;
  // Algunos JIDs incluyen device suffix como "13058799511:15" — quitar el :N.
  const cleaned = num.split(':')[0];
  if (!cleaned) return source; // fallback al JID original si quedó vacío
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
}

function timestampToIso(ts: number | Long | null | undefined): string {
  if (!ts) return new Date().toISOString();
  const seconds = typeof ts === 'number' ? ts : ts.toNumber();
  return new Date(seconds * 1000).toISOString();
}
