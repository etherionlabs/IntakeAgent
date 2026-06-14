import type { PrismaClient } from '@prisma/client';
import type { Config, Profile } from '../config/schema';
import type { Notifier } from '../services/notification';
import type { OutboundSender } from '../services/outbound';
import type { Transcriber } from '../media/transcriber';
import type { MediaStore } from '../media/store';
import type { AgentFactory } from '../agent/types';

export interface RawInboundMessage {
  whatsappMsgId: string;
  fromPhoneE164: string;
  chatKind: 'individual' | 'group' | 'status' | 'other';
  fromMe: boolean;
  kind: 'text' | 'image' | 'audio' | 'sticker' | 'location' | 'other';
  text: string | null;
  media: { buffer: Buffer; mimetype: string } | null;
  raw: unknown;
  receivedAt: string;
}

export interface PipelineDeps {
  prisma: PrismaClient;
  tenantId: string;
  config: Config;
  profile: Profile;
  notifier: Notifier;
  sender: OutboundSender;
  transcriber: Transcriber;
  mediaStore: MediaStore;
  agentFactory: AgentFactory;
  now: () => Date;
}

export type PrefilterResult =
  | { rejected: false }
  | { rejected: true; reason: 'group' | 'from_me' | 'status' | 'other_kind' };
