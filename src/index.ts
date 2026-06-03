#!/usr/bin/env tsx
import 'dotenv/config';
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

  // Whisper STT vía OpenRouter (endpoint /audio/transcriptions del SDK).
  // Modelo configurable en config.media.whisperModel (ej. "openai/whisper-1").
  const apiKey = process.env.OPENROUTER_API_KEY ?? '';
  const transcriber: Transcriber =
    config.media.transcribeAudio && apiKey
      ? new WhisperTranscriber(apiKey, config.media.whisperModel)
      : new NoopTranscriber();
  if (config.media.transcribeAudio && !apiKey) {
    logger.warn(
      'transcribeAudio=true pero OPENROUTER_API_KEY no está configurada. ' +
        'Los audios no se transcribirán.',
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

  // Panel web (Plan 5)
  const { createPanelServer } = await import('./panel/server');
  const panelServer = await createPanelServer({
    prisma,
    config,
    profile,
    adapterState: { state: () => adapter!.state() },
  });
  const panelPort = Number(process.env.PANEL_PORT ?? 3000);
  await panelServer.listen({ port: panelPort, host: '0.0.0.0' });
  logger.info({ port: panelPort, url: config.owner.panelUrl }, 'panel.listening');

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'bootstrap.shutdown');
    await panelServer.close();
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
