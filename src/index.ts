#!/usr/bin/env tsx
/**
 * Punto de entrada del proceso Intake.
 *
 * Carga config + perfil, conecta WhatsApp vía Baileys, instancia el coordinator
 * con todas las deps reales (WhatsAppSender, WhatsAppNotifier, WhisperTranscriber
 * o Noop según haya OPENROUTER_API_KEY).
 *
 * Para arrancar:
 *   npm start
 *
 * Primera ejecución: imprime QR en terminal — escanea desde WhatsApp Web.
 * Reanudaciones: usa sesión persistida en ./data/baileys-session/.
 */
import { loadConfig, loadProfile } from './config/loader';
import { getPrisma, disconnectPrisma } from './storage/client';
import { FilesystemMediaStore } from './media/store';
import {
  NoopTranscriber,
  WhisperTranscriber,
  type Transcriber,
} from './media/transcriber';
import { InboundCoordinator } from './pipeline/coordinator';
import { WhatsAppSender } from './adapters/whatsapp/sender';
import { WhatsAppNotifier } from './adapters/whatsapp/notifier';
import { BaileysAdapter } from './adapters/whatsapp/adapter';
import { defaultAgentFactory } from './agent/sdk-factory';
import { logger } from './lib/logger';

async function main() {
  const config = await loadConfig('./config.json');
  const profile = await loadProfile(config.profile);
  const prisma = getPrisma();

  logger.info({ profile: config.profile }, 'bootstrap.config_loaded');

  const mediaStore = new FilesystemMediaStore(config.media.storeDir);

  // Whisper: OpenRouter NO ofrece modelos de transcripción de audio. Usamos
  // OpenAI directo si hay OPENAI_API_KEY. Sin ella, se desactiva la
  // transcripción (los audios llegan al agente con body=null; el agente
  // entonces pide al cliente que escriba el mensaje en texto).
  const openaiKey = process.env.OPENAI_API_KEY ?? '';
  const transcriber: Transcriber =
    config.media.transcribeAudio && openaiKey
      ? new WhisperTranscriber(
          openaiKey,
          config.media.whisperModel || 'whisper-1',
          'https://api.openai.com/v1',
        )
      : new NoopTranscriber();
  if (config.media.transcribeAudio && !openaiKey) {
    logger.warn(
      'transcribeAudio=true pero OPENAI_API_KEY no está configurada. ' +
        'OpenRouter no provee Whisper. Los audios no se transcribirán.',
    );
  }

  // Lazy getter para evitar referencia circular: el sender se crea antes
  // que el adapter, pero el adapter es quien provee el socket.
  let adapter: BaileysAdapter | null = null;
  const sender = new WhatsAppSender(() => adapter?.asSocket() ?? null);
  const notifier = new WhatsAppNotifier(sender, config.owner.phoneE164);

  const coordinator = new InboundCoordinator({
    prisma,
    config,
    profile,
    notifier,
    sender,
    transcriber,
    mediaStore,
    agentFactory: defaultAgentFactory,
    now: () => new Date(),
  });

  adapter = new BaileysAdapter({
    sessionDir: './data/baileys-session',
    coordinator,
    notifier,
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'bootstrap.shutdown');
    await adapter?.stop();
    await disconnectPrisma();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  logger.info('bootstrap.starting_baileys');
  await adapter.start();

  // Mantener proceso vivo.
  await new Promise(() => {});
}

main().catch((e) => {
  logger.error(
    { err: e instanceof Error ? e.stack : String(e) },
    'bootstrap.failed',
  );
  process.exit(1);
});
