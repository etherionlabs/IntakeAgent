#!/usr/bin/env tsx
/**
 * Smoke test del pipeline end-to-end con un AgentFactory stub y sin red.
 *
 * Simula 3 mensajes consecutivos de un cliente y muestra mensajes enviados
 * por MemorySender + estado final del intake.
 */
import { loadConfig, loadProfile } from '../config/loader';
import { getPrisma, disconnectPrisma } from '../storage/client';
import { FilesystemMediaStore } from '../media/store';
import { NoopTranscriber } from '../media/transcriber';
import { NoopNotifier } from '../services/notification';
import { MemorySender } from '../services/outbound';
import { InboundCoordinator } from '../pipeline/coordinator';
import { parseJobIntake } from '../services/job';
import type { AgentFactory, AgentLike } from '../agent/types';
import type { RawInboundMessage } from '../pipeline/types';

const stubFactory: AgentFactory = (cfg) => {
  const tools = cfg.tools as any[];
  const agent: AgentLike = {
    on: () => {},
    sendSync: async () => {
      const updateIntake = tools.find((t) => t.name === 'update_intake');
      if (updateIntake) {
        await updateIntake.execute({
          fields: [{ path: 'client.name', value: 'María González' }],
        });
      }
      return {
        text: 'Genial María, ya anoté tu nombre. ¿Qué mueble quieres atender?',
        usage: { inputTokens: 200, outputTokens: 25, costUsd: 0.0015 },
      };
    },
  };
  return agent;
};

function msg(idx: number, body: string): RawInboundMessage {
  return {
    whatsappMsgId: `demo_msg_${Date.now()}_${idx}`,
    fromPhoneE164: '+5210000000088',
    chatKind: 'individual',
    fromMe: false,
    kind: 'text',
    text: body,
    media: null,
    raw: {},
    receivedAt: new Date().toISOString(),
  };
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const config = await loadConfig('./config.json');
  const profile = await loadProfile(config.profile);
  const prisma = getPrisma();
  const sender = new MemorySender();

  const coord = new InboundCoordinator({
    prisma,
    config,
    profile,
    notifier: new NoopNotifier(),
    sender,
    transcriber: new NoopTranscriber(),
    mediaStore: new FilesystemMediaStore('./media'),
    agentFactory: stubFactory,
    now: () => new Date(),
  });

  console.log('Enviando 3 mensajes consecutivos…');
  await coord.handleInbound(msg(1, 'Hola'));
  await coord.handleInbound(msg(2, 'Soy María González'));
  await coord.handleInbound(msg(3, 'Quiero retapizar un sillón'));

  console.log(`Esperando ${config.debounceMs}ms para que el debouncer dispare…`);
  await sleep(config.debounceMs + 500);

  console.log('\n=== Mensajes enviados por MemorySender ===');
  for (const s of sender.sent) {
    console.log(`→ ${s.to}: ${s.text}`);
  }

  const contact = await prisma.contact.findUnique({ where: { phoneE164: '+5210000000088' } });
  if (contact) {
    const job = await prisma.job.findFirst({ where: { contactId: contact.id } });
    if (job) {
      console.log('\n=== Intake final ===');
      console.log(JSON.stringify(parseJobIntake(job), null, 2).slice(0, 500), '...');
    }
  }

  await disconnectPrisma();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
