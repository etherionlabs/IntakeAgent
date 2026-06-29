import { describe, it, expect, vi } from 'vitest';
import { mapWAMessageToRaw } from '../../../src/adapters/whatsapp/mapMessage';

const baseKey = {
  remoteJid: '5215555555555@s.whatsapp.net',
  fromMe: false,
  id: 'WAID_1',
};

describe('mapWAMessageToRaw', () => {
  it('mensaje de texto plano', async () => {
    const wam = {
      key: baseKey,
      messageTimestamp: 1748000000,
      message: { conversation: 'Hola, tengo un sillón' },
    };
    const out = await mapWAMessageToRaw(wam as any, async () => Buffer.alloc(0));
    expect(out).not.toBeNull();
    expect(out!.kind).toBe('text');
    expect(out!.text).toBe('Hola, tengo un sillón');
    expect(out!.fromPhoneE164).toBe('+5215555555555');
    expect(out!.externalMsgId).toBe('WAID_1');
    expect(out!.chatKind).toBe('individual');
    expect(out!.fromMe).toBe(false);
    expect(out!.media).toBeNull();
  });

  it('mensaje de extendedTextMessage también se trata como texto', async () => {
    const wam = {
      key: baseKey,
      messageTimestamp: 1748000000,
      message: { extendedTextMessage: { text: 'con cita' } },
    };
    const out = await mapWAMessageToRaw(wam as any, async () => Buffer.alloc(0));
    expect(out!.kind).toBe('text');
    expect(out!.text).toBe('con cita');
  });

  it('grupo: chatKind=group', async () => {
    const wam = {
      key: { ...baseKey, remoteJid: '120363000000000000@g.us' },
      messageTimestamp: 1748000000,
      message: { conversation: 'hola grupo' },
    };
    const out = await mapWAMessageToRaw(wam as any, async () => Buffer.alloc(0));
    expect(out!.chatKind).toBe('group');
  });

  it('status broadcast', async () => {
    const wam = {
      key: { ...baseKey, remoteJid: 'status@broadcast' },
      messageTimestamp: 1748000000,
      message: { conversation: 'x' },
    };
    const out = await mapWAMessageToRaw(wam as any, async () => Buffer.alloc(0));
    expect(out!.chatKind).toBe('status');
  });

  it('imagen: llama al downloader y devuelve media + mimetype', async () => {
    const wam = {
      key: baseKey,
      messageTimestamp: 1748000000,
      message: {
        imageMessage: {
          mimetype: 'image/jpeg',
          caption: 'mira mi sillón',
        },
      },
    };
    const downloader = vi.fn().mockResolvedValue(Buffer.from('FAKE_JPEG'));
    const out = await mapWAMessageToRaw(wam as any, downloader);
    expect(out!.kind).toBe('image');
    expect(out!.text).toBe('mira mi sillón');
    expect(out!.media).not.toBeNull();
    expect(out!.media!.buffer.toString()).toBe('FAKE_JPEG');
    expect(out!.media!.mimetype).toBe('image/jpeg');
    expect(downloader).toHaveBeenCalledTimes(1);
  });

  it('audio: kind=audio, media + mimetype, text=null', async () => {
    const wam = {
      key: baseKey,
      messageTimestamp: 1748000000,
      message: {
        audioMessage: { mimetype: 'audio/ogg; codecs=opus' },
      },
    };
    const out = await mapWAMessageToRaw(
      wam as any,
      async () => Buffer.from('OGG_OPUS'),
    );
    expect(out!.kind).toBe('audio');
    expect(out!.media!.mimetype).toContain('ogg');
    expect(out!.text).toBeNull();
  });

  it('sticker → kind=sticker, media=null', async () => {
    const wam = {
      key: baseKey,
      messageTimestamp: 1748000000,
      message: { stickerMessage: {} },
    };
    const out = await mapWAMessageToRaw(wam as any, async () => Buffer.alloc(0));
    expect(out!.kind).toBe('sticker');
    expect(out!.media).toBeNull();
  });

  it('mensaje vacío o sin contenido reconocible → null', async () => {
    const wam = { key: baseKey, messageTimestamp: 1748000000, message: null };
    const out = await mapWAMessageToRaw(wam as any, async () => Buffer.alloc(0));
    expect(out).toBeNull();
  });

  it('fromMe=true se preserva', async () => {
    const wam = {
      key: { ...baseKey, fromMe: true },
      messageTimestamp: 1748000000,
      message: { conversation: 'yo' },
    };
    const out = await mapWAMessageToRaw(wam as any, async () => Buffer.alloc(0));
    expect(out!.fromMe).toBe(true);
  });

  it('receivedAt usa messageTimestamp si está presente', async () => {
    const wam = {
      key: baseKey,
      messageTimestamp: 1748000000,
      message: { conversation: 'x' },
    };
    const out = await mapWAMessageToRaw(wam as any, async () => Buffer.alloc(0));
    expect(out!.receivedAt).toMatch(/^2025-05-23T/);
  });
});
