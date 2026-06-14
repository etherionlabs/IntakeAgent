import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma as prisma, cleanupDb as cleanup } from '../helpers/db';
import { upsertContactByPhone } from '../../src/services/contact';
import { prefilter, alreadySeen } from '../../src/pipeline/idempotency';
import type { RawInboundMessage } from '../../src/pipeline/types';

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

describe('prefilter', () => {
  it('acepta mensaje individual entrante de texto', () => {
    const r = prefilter(rawMsg());
    expect(r.rejected).toBe(false);
  });

  it('rechaza grupos', () => {
    const r = prefilter(rawMsg({ chatKind: 'group' }));
    expect(r.rejected).toBe(true);
    if (r.rejected) expect(r.reason).toBe('group');
  });

  it('rechaza fromMe=true', () => {
    const r = prefilter(rawMsg({ fromMe: true }));
    expect(r.rejected).toBe(true);
    if (r.rejected) expect(r.reason).toBe('from_me');
  });

  it('rechaza status broadcast', () => {
    const r = prefilter(rawMsg({ chatKind: 'status' }));
    expect(r.rejected).toBe(true);
    if (r.rejected) expect(r.reason).toBe('status');
  });
});

describe('alreadySeen', () => {
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('false cuando whatsappMsgId no está en DB', async () => {
    const seen = await alreadySeen(prisma, 'never_seen');
    expect(seen).toBe(false);
  });

  it('true cuando el mensaje ya fue persistido', async () => {
    const c = await upsertContactByPhone(prisma, '+5215555555555');
    await prisma.message.create({
      data: {
        contactId: c.id,
        direction: 'inbound',
        kind: 'text',
        body: 'hola',
        whatsappMsgId: 'wa_existing',
      },
    });
    const seen = await alreadySeen(prisma, 'wa_existing');
    expect(seen).toBe(true);
  });
});
