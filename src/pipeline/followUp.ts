import type { PipelineDeps } from './types';
import type { Config, Profile } from '../config/schema';
import { parseJobIntake } from '../services/job';
import {
  findFollowUpCandidates,
  buildFollowUpDirective,
  policyFromConfig,
  type FollowUpCandidate,
} from '../services/followUp';
import { runAgentTurn } from '../agent/runner';
import { checkMonthlyLimit } from './usageLimit';
import { isWithinBusinessHours } from '../agent/prompt';
import { logger } from '../lib/logger';
import { incFollowUp } from '../lib/metrics';
import { captureError } from '../lib/observability';

export interface SweepResult {
  /** Por qué no se envió nada, cuando el barrido termina sin actuar. */
  skipped?: 'disabled' | 'out_of_hours' | 'usage_limit' | 'no_candidates';
  sent: number;
}

/**
 * Barrido de seguimiento proactivo: el único camino por el que el agente habla
 * sin que el cliente haya escrito.
 *
 * Se apoya en las mismas dependencias que el InboundCoordinator (mismo sender,
 * mismo agente, misma config recargable), pero entra por otro lado: en vez de
 * un batch de mensajes, el turno lleva una instrucción del sistema.
 */
export class FollowUpCoordinator {
  constructor(private readonly deps: PipelineDeps) {}

  private async current(): Promise<{ config: Config; profile: Profile }> {
    if (this.deps.reloadConfig) {
      try {
        return await this.deps.reloadConfig();
      } catch (e) {
        logger.warn(
          { err: e instanceof Error ? e.message : String(e) },
          'followup.config_reload_failed',
        );
      }
    }
    return { config: this.deps.config, profile: this.deps.profile };
  }

  /**
   * Una pasada completa. Nunca lanza: un fallo en un job no debe tumbar el
   * barrido ni el worker. Devuelve cuántos seguimientos se enviaron.
   */
  async sweep(): Promise<SweepResult> {
    const tenantId = this.deps.tenantId;
    const now = this.deps.now();
    const { config, profile } = await this.current();

    // Doble llave: el interruptor global del deployment y el opt-in del tenant
    // (que llega en la config recargada desde TenantSettings).
    if (!config.followUp.enabled) return { skipped: 'disabled', sent: 0 };

    // Mensajes no solicitados solo en horario de atención: uno a medianoche es
    // una molestia y desgasta el número de WhatsApp del negocio.
    if (!isWithinBusinessHours(config, now)) return { skipped: 'out_of_hours', sent: 0 };

    // Un seguimiento consume cuota igual que una respuesta: si el tenant agotó
    // su mes, las respuestas al cliente valen más que nuestra iniciativa.
    const usage = await checkMonthlyLimit(this.deps.prisma, tenantId, now);
    if (usage.limited && usage.limit !== null) return { skipped: 'usage_limit', sent: 0 };

    const policy = policyFromConfig(config);
    const candidates = await findFollowUpCandidates(
      this.deps.prisma,
      tenantId,
      profile.intakeSchema,
      policy,
      now,
    );
    if (candidates.length === 0) return { skipped: 'no_candidates', sent: 0 };

    let sent = 0;
    for (const candidate of candidates) {
      try {
        if (await this.sendFollowUp(candidate, config, profile, now)) sent += 1;
      } catch (e) {
        captureError(e, {
          tenantId,
          service: 'worker',
          extra: { jobId: candidate.job.id, kind: 'followup' },
        });
        logger.error(
          { tenantId, jobId: candidate.job.id, err: e instanceof Error ? e.message : String(e) },
          'followup.failed',
        );
      }
    }
    return { sent };
  }

  private async sendFollowUp(
    candidate: FollowUpCandidate,
    config: Config,
    profile: Profile,
    now: Date,
  ): Promise<boolean> {
    const tenantId = this.deps.tenantId;
    const { job, contact } = candidate;

    const historyRaw = await this.deps.prisma.message.findMany({
      where: { jobId: job.id, tenantId },
      orderBy: { createdAt: 'desc' },
      take: 12,
    });
    const recentHistory = historyRaw.reverse().map((m) => ({
      direction: m.direction as 'inbound' | 'outbound',
      kind: m.kind as 'text' | 'image' | 'audio' | 'sticker' | 'location' | 'other',
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    }));

    const result = await runAgentTurn(
      {
        job,
        contact,
        intake: parseJobIntake(job),
        // Sin mensajes del cliente: este turno lo dispara la directiva.
        batchMessages: [],
        systemDirective: buildFollowUpDirective({
          silentHours: candidate.silentHours,
          previousFollowUps: job.followUpCount,
          context: candidate.context,
          body: candidate.body,
        }),
        otherOpenJobs: [],
        now: now.toISOString(),
        recentHistory,
      },
      {
        prisma: this.deps.prisma,
        tenantId,
        config,
        profile,
        notifier: this.deps.notifier,
        createAgent: this.deps.agentFactory,
        mediaStore: this.deps.mediaStore,
        // Un seguimiento es texto: no re-analizamos ni generamos imágenes por
        // iniciativa propia (costo y ruido para el cliente).
      },
    );

    const text = result.responseText?.trim() ?? '';
    // Si el turno falló, el runner devuelve el fallback ("tuve un problema,
    // ¿me lo repites?"): mandárselo a alguien que no escribió no tiene sentido.
    if (text.length === 0 || result.error) {
      logger.warn({ tenantId, jobId: job.id, err: result.error }, 'followup.no_message');
      return false;
    }

    await this.deps.sender.sendText(contact.phoneE164, text);
    await this.deps.prisma.message.create({
      data: {
        tenantId,
        jobId: job.id,
        contactId: contact.id,
        direction: 'outbound',
        kind: 'text',
        body: text,
      },
    });
    // El contador se guarda DESPUÉS del envío: si algo falla antes, el job sigue
    // siendo candidato en el próximo barrido en vez de perder su seguimiento.
    await this.deps.prisma.job.update({
      where: { id: job.id, tenantId },
      data: { followUpCount: { increment: 1 }, lastFollowUpAt: now },
    });

    incFollowUp(candidate.reason);
    logger.info(
      { tenantId, jobId: job.id, reason: candidate.reason, attempt: job.followUpCount + 1 },
      'followup.sent',
    );
    return true;
  }
}
