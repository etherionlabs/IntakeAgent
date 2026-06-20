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
import {
  NoopDescriber,
  VisionDescriber,
  type Describer,
} from './media/describer';
import { InboundCoordinator } from './pipeline/coordinator';
import { WhatsAppSender } from './adapters/whatsapp/sender';
import { WhatsAppNotifier } from './adapters/whatsapp/notifier';
import { BaileysAdapter } from './adapters/whatsapp/adapter';
import { defaultAgentFactory } from './agent/sdk-factory';
import { startInternalServer } from './internal/server';
import { logger } from './lib/logger';

async function main() {
  const tenantId = process.env.TENANT_ID;
  if (!tenantId) {
    throw new Error(
      'TENANT_ID no está definido. Cada worker atiende exactamente un tenant; ' +
        'define TENANT_ID=<uuid del Tenant> en el entorno del contenedor.',
    );
  }

  const config = await loadConfig('./config.json');
  const profile = await loadProfile(config.profile);
  const prisma = getPrisma();

  logger.info({ tenantId, profile: config.profile }, 'bootstrap.config_loaded');

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

  // Describer de imágenes vía modelo de visión de OpenRouter. Genera una
  // descripción textual de cada foto (guiada por el contexto del negocio) que el
  // agente lee en vez de los bytes. Configurable en config.media.{describeImages,visionModel}.
  const describer: Describer =
    config.media.describeImages && apiKey
      ? new VisionDescriber(apiKey, config.media.visionModel)
      : new NoopDescriber();
  if (config.media.describeImages && !apiKey) {
    logger.warn(
      'describeImages=true pero OPENROUTER_API_KEY no está configurada. ' +
        'Las imágenes no se describirán.',
    );
  }

  // Lazy getter para evitar referencia circular: el sender se crea antes
  // que el adapter, pero el adapter es quien provee el socket.
  let adapter: BaileysAdapter | null = null;
  const sender = new WhatsAppSender(() => adapter?.asSocket() ?? null);
  const notifier = new WhatsAppNotifier(sender, config.owner.phoneE164);

  const coordinator = new InboundCoordinator({
    prisma,
    tenantId,
    config,
    profile,
    notifier,
    sender,
    transcriber,
    describer,
    mediaStore,
    agentFactory: defaultAgentFactory,
    now: () => new Date(),
  });

  adapter = new BaileysAdapter({
    sessionDir: './data/baileys-session',
    coordinator,
    notifier,
    tenantId,
    notifyOwner: config.owner.notifyOnDisconnect,
  });

  // Endpoint interno de status (solo red Docker, protegido con INTERNAL_API_TOKEN).
  // El adapter expone `AdapterStateSnapshot` ({ status, qr, lastError,
  // lastConnectedAt }); aquí lo mapeamos a la forma `{ connected, qr, phone }`
  // que consume el proxy wa-status de la API central, sin tocar el adapter.
  const internalServer = await startInternalServer({
    adapterState: {
      state: () => {
        const snap = adapter!.state();
        return {
          connected: snap.status === 'connected',
          qr: snap.qr,
          phone: snap.phone ?? '',
          status: snap.status,
          lastConnectedAt: snap.lastConnectedAt,
          lastError: snap.lastError,
        };
      },
    },
    actions: {
      logout: () => adapter!.logout(),
      reconnect: () => adapter!.reconnect(),
    },
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'bootstrap.shutdown');
    await internalServer.close();
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
