import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  testPrisma as prisma,
  cleanupDb as cleanup,
  seedTestTenant,
  TEST_TENANT_ID,
} from '../helpers/db';
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
  beforeEach(async () => {
    await cleanup();
    await seedTestTenant();
  });
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('false cuando whatsappMsgId no está en DB', async () => {
    const seen = await alreadySeen(prisma, TEST_TENANT_ID, 'never_seen');
    expect(seen).toBe(false);
  });

  it('true cuando el mensaje ya fue persistido', async () => {
    const c = await upsertContactByPhone(prisma, TEST_TENANT_ID, '+5215555555555');
    await prisma.message.create({
      data: {
        tenantId: TEST_TENANT_ID,
        contactId: c.id,
        direction: 'inbound',
        kind: 'text',
        body: 'hola',
        whatsappMsgId: 'wa_existing',
      },
    });
    const seen = await alreadySeen(prisma, TEST_TENANT_ID, 'wa_existing');
    expect(seen).toBe(true);
  });

  it('un mensaje de OTRO tenant con el mismo whatsappMsgId no cuenta como visto', async () => {
    await prisma.tenant.create({
      data: {
        id: '00000000-0000-0000-0000-0000000000ff',
        slug: 'other',
        name: 'Other',
        industry: 'test',
        profileDir: './x',
      },
    });
    await prisma.contact.create({
      data: {
        id: 'c-other',
        phoneE164: '+1999',
        tenantId: '00000000-0000-0000-0000-0000000000ff',
      },
    });
    await prisma.message.create({
      data: {
        tenantId: '00000000-0000-0000-0000-0000000000ff',
        contactId: 'c-other',
        direction: 'inbound',
        kind: 'text',
        body: 'x',
        whatsappMsgId: 'WID-SHARED',
      },
    });
    expect(await alreadySeen(prisma, TEST_TENANT_ID, 'WID-SHARED')).toBe(false);
  });
});
