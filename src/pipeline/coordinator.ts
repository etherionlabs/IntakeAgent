import type { Message } from '@prisma/client';
import type { Config, Profile } from '../config/schema';
import type { PipelineDeps, RawInboundMessage } from './types';
import { prefilter, alreadySeen } from './idempotency';
import { normalizeAndPersistMessage } from './normalize';
import { resolveContact } from './resolveContact';
import { resolveJobForMessage } from './resolveJob';
import { InboundDebouncer } from './debouncer';
import { parseJobIntake } from '../services/job';
import { runAgentTurn } from '../agent/runner';
import { logger } from '../lib/logger';
import { incMessage } from '../lib/metrics';
import { captureError } from '../lib/observability';
import type { BatchMessage, AvailablePhoto } from '../agent/types';
import {
  buildDescribeBaseContext,
  ensureDescription,
} from '../services/imageDescription';
import { NoopDescriber } from '../media/describer';

export class InboundCoordinator {
  private readonly debouncer: InboundDebouncer;

  constructor(private readonly deps: PipelineDeps) {
    this.debouncer = new InboundDebouncer({
      debounceMs: deps.config.debounceMs,
      onFlush: (contactId, messageIds) =>
        this.flushBatch(contactId, messageIds).catch((e) => {
          captureError(e, { tenantId: this.deps.tenantId, service: 'worker', extra: { contactId } });
          logger.error({ tenantId: this.deps.tenantId, err: e instanceof Error ? e.message : String(e) }, 'pipeline.flush_failed');
        }),
    });
  }

  /**
   * Config+perfil vigentes para este turno. Si hay `reloadConfig`, los recarga
   * desde disco para reflejar cambios hechos en el panel sin reiniciar el worker;
   * si la recarga falla, cae a los estáticos del arranque.
   */
  private async current(): Promise<{ config: Config; profile: Profile }> {
    if (this.deps.reloadConfig) {
      try {
        return await this.deps.reloadConfig();
      } catch (e) {
        logger.warn(
          { err: e instanceof Error ? e.message : String(e) },
          'config.reload_failed',
        );
      }
    }
    return { config: this.deps.config, profile: this.deps.profile };
  }

  async handleInbound(raw: RawInboundMessage): Promise<void> {
    logger.info(
      {
        externalMsgId: raw.externalMsgId,
        from: raw.fromPhoneE164,
        kind: raw.kind,
        chatKind: raw.chatKind,
        fromMe: raw.fromMe,
        textPreview: raw.text?.slice(0, 60) ?? null,
      },
      'inbound.received',
    );

    const pf = prefilter(raw);
    if (pf.rejected) {
      logger.info({ reason: pf.reason, externalMsgId: raw.externalMsgId }, 'inbound.prefiltered');
      return;
    }

    const tenantId = this.deps.tenantId;

    if (await alreadySeen(this.deps.prisma, tenantId, raw.externalMsgId)) {
      logger.info({ externalMsgId: raw.externalMsgId }, 'inbound.duplicate');
      return;
    }

    const { profile } = await this.current();

    const contactRes = await resolveContact(this.deps.prisma, tenantId, raw.fromPhoneE164);

    const jobRes = await resolveJobForMessage(
      this.deps.prisma,
      tenantId,
      profile.intakeSchema,
      contactRes.contact.id,
      raw.externalMsgId,
    );

    const messageWithoutJob = await normalizeAndPersistMessage(
      this.deps.prisma,
      tenantId,
      this.deps.mediaStore,
      this.deps.transcriber,
      raw,
      contactRes.contact.id,
    );
    const message = await this.deps.prisma.message.update({
      where: { id: messageWithoutJob.id, tenantId },
      data: { jobId: jobRes.job.id },
    });
    incMessage(tenantId);

    if (message.kind === 'image' || message.kind === 'audio') {
      const intake = parseJobIntake(jobRes.job);
      if (message.kind === 'image') intake.media.photo_count += 1;
      else intake.media.audio_count += 1;
      await this.deps.prisma.job.update({
        where: { id: jobRes.job.id, tenantId },
        data: { intake: JSON.stringify(intake) },
      });
    }

    if (!contactRes.shouldRespond) {
      logger.info(
        { contactId: contactRes.contact.id, reason: contactRes.reason },
        'inbound.no_response',
      );
      return;
    }

    if (jobRes.isFirstMessage) {
      const welcome = applyTemplate(profile.welcome, {
        businessName: profile.intakeSchema.$businessName,
        businessDomain: profile.intakeSchema.$businessDomain,
      });
      await this.deps.sender.sendText(contactRes.contact.phoneE164, welcome);
      // Persistirlo como mensaje outbound: el agente lo verá en el historial
      // reciente y evitará saludar de nuevo.
      await this.deps.prisma.message.create({
        data: {
          tenantId,
          jobId: jobRes.job.id,
          contactId: contactRes.contact.id,
          direction: 'outbound',
          kind: 'text',
          body: welcome,
        },
      });

      // El welcome YA hace la pregunta de apertura ("¿tu nombre y qué mueble?").
      // Si el primer mensaje es solo un saludo (sin datos), correr el agente
      // produciría un segundo mensaje redundante (doble saludo). Saltamos el
      // turno. Un primer mensaje CON contenido sí se procesa normalmente.
      if (raw.kind === 'text' && isBareGreeting(raw.text)) {
        logger.info({ contactId: contactRes.contact.id }, 'inbound.welcome_only');
        return;
      }
    }

    this.debouncer.enqueue(contactRes.contact.id, message.id);
  }

  private async flushBatch(contactId: string, messageIds: string[]): Promise<void> {
    logger.debug({ contactId, count: messageIds.length }, 'inbound.flush');
    const tenantId = this.deps.tenantId;
    const { config, profile } = await this.current();
    const contact = await this.deps.prisma.contact.findFirst({ where: { id: contactId, tenantId } });
    if (!contact) return;
    if (!contact.botActive || contact.flaggedNonIntake) return;

    const messages = await this.deps.prisma.message.findMany({
      where: { id: { in: messageIds }, tenantId },
      orderBy: { createdAt: 'asc' },
    });
    if (messages.length === 0) return;
    const jobId = messages[messages.length - 1].jobId;
    if (!jobId) return;
    const job = await this.deps.prisma.job.findFirst({ where: { id: jobId, tenantId } });
    if (!job) return;

    const allOpen = await this.deps.prisma.job.findMany({
      where: {
        contactId,
        tenantId,
        status: { in: ['OPEN_INTAKE', 'READY_FOR_REVIEW'] },
        NOT: { id: jobId },
      },
      orderBy: { openedAt: 'asc' },
    });

    const batchMessages: BatchMessage[] = messages.map((m): BatchMessage => ({
      id: m.id,
      kind: m.kind as BatchMessage['kind'],
      body: m.body,
      mediaPath: m.mediaPath,
      description: m.mediaDescription,
    }));

    const intake = parseJobIntake(job);

    // Cargar últimos 12 mensajes del job EXCLUYENDO los del batch actual,
    // ordenados cronológicamente. Le da al agente contexto de la conversación
    // (incluyendo welcome y respuestas previas) para evitar incoherencias.
    const batchIds = new Set(messageIds);
    const historyRaw = await this.deps.prisma.message.findMany({
      where: { jobId, tenantId, id: { notIn: messageIds } },
      orderBy: { createdAt: 'desc' },
      take: 12,
    });
    const recentHistory = historyRaw
      .reverse()
      .filter((m) => !batchIds.has(m.id))
      .map((m) => ({
        direction: m.direction as 'inbound' | 'outbound',
        kind: m.kind as 'text' | 'image' | 'audio' | 'sticker' | 'location' | 'other',
        body: m.body,
        createdAt: m.createdAt.toISOString(),
      }));

    // Describir (lazy) las imágenes del batch que aún no tengan descripción.
    // El contexto incluye historial reciente + texto del batch actual para que
    // el describer sepa en qué fijarse. Cacheamos en Message.mediaDescription.
    const describer = this.deps.describer ?? new NoopDescriber();
    const describeBase = buildDescribeBaseContext(
      profile,
      recentHistory,
      batchMessages,
    );
    for (const bm of batchMessages) {
      if (bm.kind !== 'image' || bm.description) continue;
      const src = messages.find((m) => m.id === bm.id);
      if (!src) continue;
      const desc = await ensureDescription(
        this.deps.prisma,
        tenantId,
        this.deps.mediaStore,
        describer,
        src,
        describeBase,
      );
      if (desc) bm.description = desc;
    }

    // Fotos del job (batch + turnos previos) que el agente puede re-analizar.
    const jobImages = await this.deps.prisma.message.findMany({
      where: { jobId, tenantId, kind: 'image' },
      orderBy: { createdAt: 'asc' },
    });
    const availablePhotos: AvailablePhoto[] = jobImages
      .filter((m) => m.mediaPath)
      .map((m) => ({
        messageId: m.id,
        caption: m.body,
        description:
          batchMessages.find((bm) => bm.id === m.id)?.description ?? m.mediaDescription,
      }));

    const result = await runAgentTurn(
      {
        job,
        contact,
        intake,
        batchMessages,
        otherOpenJobs: allOpen.map((j) => ({
          id: j.id,
          summary: j.summary,
          openedAt: j.openedAt,
        })),
        now: this.deps.now().toISOString(),
        recentHistory,
        availablePhotos,
      },
      {
        prisma: this.deps.prisma,
        tenantId,
        config,
        profile,
        notifier: this.deps.notifier,
        createAgent: this.deps.agentFactory,
        mediaStore: this.deps.mediaStore,
        describer,
      },
    );

    if (result.responseText && result.responseText.trim().length > 0) {
      await this.deps.sender.sendText(contact.phoneE164, result.responseText);
      await this.deps.prisma.message.create({
        data: {
          tenantId,
          jobId: job.id,
          contactId: contact.id,
          direction: 'outbound',
          kind: 'text',
          body: result.responseText,
        },
      });
    }
  }
}

function applyTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

const GREETING_TOKENS = new Set([
  'hola', 'ola', 'holaa', 'holi', 'ey', 'hello', 'hi', 'hey',
  'buenas', 'buenos', 'buen', 'dia', 'dias', 'tarde', 'tardes', 'noche', 'noches',
  'que', 'tal', 'saludos', 'hello', 'oa',
]);

/**
 * ¿El texto es SOLO un saludo, sin datos del intake? Conservador a propósito:
 * ante la duda devuelve false (deja correr el agente) para nunca perder
 * contenido. Quita acentos/puntuación/emojis y exige que TODOS los tokens sean
 * saludos. Mensajes largos (>40 chars) se consideran con contenido.
 */
export function isBareGreeting(text: string | null): boolean {
  if (!text) return true;
  if (text.length > 40) return false;
  const cleaned = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quitar acentos (marcas combinantes)
    .replace(/[^a-z\s]/g, ' ') // quitar puntuación, emojis, números
    .trim();
  if (cleaned.length === 0) return true; // "?", emojis sueltos
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  return tokens.every((t) => GREETING_TOKENS.has(t));
}
