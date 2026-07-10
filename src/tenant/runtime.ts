import type { PrismaClient } from '@prisma/client';
import { loadConfig, loadProfile, applyProfileOverride } from '../config/loader';
import { readProfileOverride } from '../config/overrides';
import { validateIntakeSchema } from '../config/intake-schema';
import type { Config, Profile } from '../config/schema';
import { FilesystemMediaStore } from '../media/store';
import { NoopTranscriber, WhisperTranscriber, type Transcriber } from '../media/transcriber';
import { NoopDescriber, VisionDescriber, type Describer } from '../media/describer';
import { InboundCoordinator } from '../pipeline/coordinator';
import { WhatsAppSender } from '../adapters/whatsapp/sender';
import { WhatsAppNotifier } from '../adapters/whatsapp/notifier';
import { BaileysAdapter } from '../adapters/whatsapp/adapter';
import { defaultAgentFactory } from '../agent/sdk-factory';
import { reconnectDelay } from '../adapters/whatsapp/reconnect';
import { logger } from '../lib/logger';
import type { InboundSource, ConnectionControl } from '../channels/types';
import type { TenantRuntime, TenantStatus } from './types';

type Source = InboundSource & ConnectionControl;

export interface BuildSourceArgs {
  tenantId: string;
  sessionDir: string;
  coordinator: InboundCoordinator;
  notifier: WhatsAppNotifier;
  notifyOwner: boolean;
}

export interface RuntimeDeps {
  prisma: PrismaClient;
  configPath?: string;
  /** Construye la InboundSource. Default: BaileysAdapter. Inyectable en tests. */
  buildSource?: (args: BuildSourceArgs) => Source;
  /** Reloj para los reintentos de supervisión (tests). */
  scheduler?: (fn: () => void, ms: number) => void;
}

const defaultBuildSource = (a: BuildSourceArgs): Source =>
  new BaileysAdapter({
    sessionDir: a.sessionDir,
    coordinator: a.coordinator,
    notifier: a.notifier,
    tenantId: a.tenantId,
    notifyOwner: a.notifyOwner,
  });

/** Carga el perfil del giro del tenant (`profiles/<industry>`), con fallback al
 *  perfil por defecto del deployment si ese giro no tiene plantilla. De aquí salen
 *  businessFacts / promptVars (tono, reglas) / imageFocus, propios de cada oficio. */
async function loadIndustryProfile(industry: string, fallbackDir: string): Promise<Profile> {
  try {
    return await loadProfile(`./profiles/${industry}`);
  } catch {
    return await loadProfile(fallbackDir);
  }
}

/** Deriva la config efectiva del tenant: global config.json + overrides de TenantSettings. */
export async function buildTenantConfig(prisma: PrismaClient, tenantId: string, configPath: string): Promise<{ config: Config; profile: Profile }> {
  const settings = await prisma.tenantSettings.findUnique({ where: { tenantId } });
  if (!settings) throw new Error(`TenantSettings ausente para tenant ${tenantId}`);

  const base = await loadConfig(configPath);
  // businessFacts / promptVars / imageFocus vienen del perfil del GIRO del tenant
  // (profiles/<industry>), con fallback al perfil por defecto del deployment.
  const industryProfile = await loadIndustryProfile(settings.industry, base.profile);
  // Override del panel (tabla Setting, per-tenant): si el dueño editó datos del
  // negocio (facts, tono/vars, nombre/dominio, welcome) desde /settings, esos
  // cambios GANAN sobre el archivo del giro. Así el bot usa lo que edita el dueño.
  const profileOverride = await readProfileOverride(prisma, tenantId);
  const baseProfile = profileOverride ? applyProfileOverride(industryProfile, profileOverride) : industryProfile;

  const schemaResult = validateIntakeSchema(settings.intakeSchema);
  if (!schemaResult.ok) throw new Error(`intakeSchema inválido en TenantSettings de ${tenantId}: ${schemaResult.error}`);

  const config: Config = {
    ...base,
    debounceMs: settings.debounceMs,
    owner: {
      ...base.owner,
      phoneE164: settings.ownerPhoneE164,
      panelUrl: settings.panelUrl ?? base.owner.panelUrl,
    },
    media: {
      ...base.media,
      storeDir: `./media/${tenantId}`,
      transcribeAudio: settings.transcribeAudio,
      describeImages: settings.describeImages,
      whisperModel: settings.whisperModel ?? base.media.whisperModel,
      visionModel: settings.visionModel ?? base.media.visionModel,
    },
  };
  const profile: Profile = {
    ...baseProfile,
    // La estructura del intake (secciones/campos) es siempre la del tenant.
    intakeSchema: schemaResult.schema,
    // El welcome editado en el panel (override) gana; si no, el de TenantSettings.
    welcome: profileOverride?.welcome ?? settings.welcomeTemplate,
  };
  return { config, profile };
}

class TenantRuntimeImpl implements TenantRuntime {
  private startError: string | null = null;
  private reconnectAttempts = 0;
  private stopped = false;
  private suspended = false;

  constructor(
    private readonly tenantId: string,
    private readonly source: Source,
    private readonly schedule: (fn: () => void, ms: number) => void,
  ) {}

  async start(): Promise<void> {
    await this.attempt();
  }

  /** Pausa el bot (enforcement de billing): cierra la conexión, conserva la sesión. */
  async suspend(): Promise<void> {
    this.suspended = true;
    await this.source.stop();
  }

  /** Reactiva el bot tras un pago. */
  async resume(): Promise<void> {
    if (!this.suspended) return;
    this.suspended = false;
    this.reconnectAttempts = 0;
    await this.attempt();
  }

  /** Arranca la fuente; ante fallo catastrófico programa un reintento aislado (no lanza). */
  private async attempt(): Promise<void> {
    if (this.stopped || this.suspended) return;
    try {
      await this.source.start();
      this.startError = null;
      this.reconnectAttempts = 0;
    } catch (e) {
      this.startError = e instanceof Error ? e.message : String(e);
      const delay = reconnectDelay(this.reconnectAttempts);
      this.reconnectAttempts += 1;
      logger.error({ tenantId: this.tenantId, error: this.startError, attempt: this.reconnectAttempts, delayMs: delay }, 'tenant_runtime.start_failed');
      this.schedule(() => void this.attempt(), delay);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.source.stop();
  }

  async logout(): Promise<void> { await this.source.logout(); }
  async reconnect(): Promise<void> { this.reconnectAttempts = 0; await this.source.reconnect(); }

  getStatus(): TenantStatus {
    const s = this.source.state();
    const errored = this.startError !== null && s.status !== 'connected';
    return {
      tenantId: this.tenantId,
      connected: s.status === 'connected',
      qr: s.qr,
      phone: s.phone ?? '',
      status: errored ? 'error' : s.status,
      lastConnectedAt: s.lastConnectedAt,
      lastError: s.lastError ?? this.startError,
    };
  }
}

/** Factory de TenantRuntime para inyectar en el TenantManager. */
export async function createTenantRuntime(tenantId: string, deps: RuntimeDeps): Promise<TenantRuntime> {
  const configPath = deps.configPath ?? './config.json';
  const schedule = deps.scheduler ?? ((fn, ms) => setTimeout(fn, ms).unref?.());
  const buildSource = deps.buildSource ?? defaultBuildSource;

  const { config, profile } = await buildTenantConfig(deps.prisma, tenantId, configPath);
  const apiKey = process.env.OPENROUTER_API_KEY ?? '';

  const mediaStore = new FilesystemMediaStore(config.media.storeDir);
  // Instancias reales siempre que haya API key: los toggles del panel
  // (TenantSettings.describeImages/transcribeAudio) se aplican POR TURNO en el
  // coordinator vía reloadConfig, así encender/apagar no exige reiniciar el tenant.
  const transcriber: Transcriber = apiKey
    ? new WhisperTranscriber(apiKey, config.media.whisperModel) : new NoopTranscriber();
  const describer: Describer = apiKey
    ? new VisionDescriber(apiKey, config.media.visionModel) : new NoopDescriber();

  // Lazy getter para el socket (igual que main() hoy): el sender se crea antes que el adapter.
  let source: Source | null = null;
  const sender = new WhatsAppSender(() => (source as any)?.asSocket?.() ?? null);
  const notifier = new WhatsAppNotifier(sender, config.owner.phoneE164);

  const coordinator = new InboundCoordinator({
    prisma: deps.prisma, tenantId, config, profile, notifier, sender,
    transcriber, describer, mediaStore, agentFactory: defaultAgentFactory, now: () => new Date(),
    // Hot-reload por turno: relee TenantSettings (panel ↔ worker comparten Postgres),
    // así editar la config aplica sin reiniciar el tenant. Conserva la última válida.
    reloadConfig: () => buildTenantConfig(deps.prisma, tenantId, configPath),
  });

  source = buildSource({
    tenantId,
    sessionDir: `./data/baileys-session/${tenantId}`,
    coordinator,
    notifier,
    notifyOwner: config.owner.notifyOnDisconnect,
  });

  return new TenantRuntimeImpl(tenantId, source, schedule);
}
