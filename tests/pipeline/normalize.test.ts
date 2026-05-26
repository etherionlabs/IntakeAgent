import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upsertContactByPhone } from '../../src/services/contact';
import { normalizeAndPersistMessage } from '../../src/pipeline/normalize';
import { FilesystemMediaStore } from '../../src/media/store';
import { NoopTranscriber, ScriptedTranscriber } from '../../src/media/transcriber';
import type { RawInboundMessage } from '../../src/pipeline/types';

const adapter = new PrismaBetterSqlite3({ url: 'file:./data/intake.db' });
const prisma = new PrismaClient({ adapter });

let mediaRoot: string;

async function cleanup() {
  await prisma.message.deleteMany();
  await prisma.agentRun.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.job.deleteMany();
  await prisma.contact.deleteMany();
}

function rawMsg(overrides: Partial<RawInboundMessage> = {}): RawInboundMessage {
  return {
    whatsappMsgId: 'wa_1',
    fromPhoneE164: '+5215555555555',
    chatKind: 'individual',
    fromMe: false,
    kind: 'text',
    text: 'hola',
    media: null,
    raw: {},
    receivedAt: '2026-05-25T10:00:00Z',
    ...overrides,
  };
}

describe('normalizeAndPersistMessage', () => {
  beforeEach(async () => {
    await cleanup();
    mediaRoot = await mkdtemp(join(tmpdir(), 'intake-norm-'));
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
  });

  it('persiste texto plano sin tocar filesystem', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const store = new FilesystemMediaStore(mediaRoot);
    const msg = await normalizeAndPersistMessage(
      prisma,
      store,
      new NoopTranscriber(),
      rawMsg({ kind: 'text', text: 'Hola, tengo un sillón' }),
      c.id,
    );
    expect(msg.kind).toBe('text');
    expect(msg.body).toBe('Hola, tengo un sillón');
    expect(msg.mediaPath).toBeNull();
    const reload = await prisma.message.findUnique({ where: { id: msg.id } });
    expect(reload!.body).toBe('Hola, tengo un sillón');
  });

  it('persiste imagen al filesystem y guarda mediaPath', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const store = new FilesystemMediaStore(mediaRoot);
    const msg = await normalizeAndPersistMessage(
      prisma,
      store,
      new NoopTranscriber(),
      rawMsg({
        whatsappMsgId: 'wa_img',
        kind: 'image',
        text: null,
        media: { buffer: Buffer.from('FAKEJPEG'), mimetype: 'image/jpeg' },
      }),
      c.id,
    );
    expect(msg.kind).toBe('image');
    expect(msg.mediaPath).toMatch(/\.jpe?g$/);
    expect(msg.body).toBeNull();
  });

  it('persiste audio + transcribe (transcriber devuelve cadena)', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const store = new FilesystemMediaStore(mediaRoot);
    const transcriber = new ScriptedTranscriber(['me llamo Juan']);
    const msg = await normalizeAndPersistMessage(
      prisma,
      store,
      transcriber,
      rawMsg({
        whatsappMsgId: 'wa_audio',
        kind: 'audio',
        text: null,
        media: { buffer: Buffer.from('OGG'), mimetype: 'audio/ogg' },
      }),
      c.id,
    );
    expect(msg.kind).toBe('audio');
    expect(msg.mediaPath).toMatch(/\.ogg$/);
    expect(msg.body).toBe('me llamo Juan');
  });

  it('audio sin transcripción guarda body=null', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const store = new FilesystemMediaStore(mediaRoot);
    const msg = await normalizeAndPersistMessage(
      prisma,
      store,
      new NoopTranscriber(),
      rawMsg({
        whatsappMsgId: 'wa_audio2',
        kind: 'audio',
        text: null,
        media: { buffer: Buffer.from('OGG'), mimetype: 'audio/ogg' },
      }),
      c.id,
    );
    expect(msg.body).toBeNull();
    expect(msg.mediaPath).toMatch(/\.ogg$/);
  });

  it('sticker/location/other se persisten con kind correspondiente y body null', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const store = new FilesystemMediaStore(mediaRoot);
    const msg = await normalizeAndPersistMessage(
      prisma,
      store,
      new NoopTranscriber(),
      rawMsg({ whatsappMsgId: 'wa_sticker', kind: 'sticker', text: null, media: null }),
      c.id,
    );
    expect(msg.kind).toBe('sticker');
    expect(msg.body).toBeNull();
    expect(msg.mediaPath).toBeNull();
  });

  it('guarda raw payload serializado para auditoría', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const store = new FilesystemMediaStore(mediaRoot);
    const msg = await normalizeAndPersistMessage(
      prisma,
      store,
      new NoopTranscriber(),
      rawMsg({ raw: { weird: 'payload', n: 42 } }),
      c.id,
    );
    const reload = await prisma.message.findUnique({ where: { id: msg.id } });
    expect(reload!.raw).toBeTruthy();
    const parsed = JSON.parse(reload!.raw!);
    expect(parsed.weird).toBe('payload');
    expect(parsed.n).toBe(42);
  });
});
