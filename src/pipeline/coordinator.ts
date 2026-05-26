import type { Message } from '@prisma/client';
import type { PipelineDeps, RawInboundMessage } from './types';
import { prefilter, alreadySeen } from './idempotency';
import { normalizeAndPersistMessage } from './normalize';
import { resolveContact } from './resolveContact';
import { resolveJobForMessage } from './resolveJob';
import { InboundDebouncer } from './debouncer';
import { parseJobIntake } from '../services/job';
import { runAgentTurn } from '../agent/runner';
import { logger } from '../lib/logger';
import type { BatchMessage } from '../agent/types';

export class InboundCoordinator {
  private readonly debouncer: InboundDebouncer;

  constructor(private readonly deps: PipelineDeps) {
    this.debouncer = new InboundDebouncer({
      debounceMs: deps.config.debounceMs,
      onFlush: (contactId, messageIds) => this.flushBatch(contactId, messageIds),
    });
  }

  async handleInbound(raw: RawInboundMessage): Promise<void> {
    logger.info(
      {
        whatsappMsgId: raw.whatsappMsgId,
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
      logger.info({ reason: pf.reason, whatsappMsgId: raw.whatsappMsgId }, 'inbound.prefiltered');
      return;
    }

    if (await alreadySeen(this.deps.prisma, raw.whatsappMsgId)) {
      logger.info({ whatsappMsgId: raw.whatsappMsgId }, 'inbound.duplicate');
      return;
    }

    const contactRes = await resolveContact(this.deps.prisma, raw.fromPhoneE164);

    const jobRes = await resolveJobForMessage(
      this.deps.prisma,
      this.deps.profile.intakeSchema,
      contactRes.contact.id,
      raw.whatsappMsgId,
    );

    const messageWithoutJob = await normalizeAndPersistMessage(
      this.deps.prisma,
      this.deps.mediaStore,
      this.deps.transcriber,
      raw,
      contactRes.contact.id,
    );
    const message = await this.deps.prisma.message.update({
      where: { id: messageWithoutJob.id },
      data: { jobId: jobRes.job.id },
    });

    if (message.kind === 'image' || message.kind === 'audio') {
      const intake = parseJobIntake(jobRes.job);
      if (message.kind === 'image') intake.media.photo_count += 1;
      else intake.media.audio_count += 1;
      await this.deps.prisma.job.update({
        where: { id: jobRes.job.id },
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
      const welcome = applyTemplate(this.deps.profile.welcome, {
        businessName: this.deps.profile.intakeSchema.$businessName,
        businessDomain: this.deps.profile.intakeSchema.$businessDomain,
      });
      await this.deps.sender.sendText(contactRes.contact.phoneE164, welcome);
    }

    this.debouncer.enqueue(contactRes.contact.id, message.id);
  }

  private async flushBatch(contactId: string, messageIds: string[]): Promise<void> {
    logger.debug({ contactId, count: messageIds.length }, 'inbound.flush');
    const contact = await this.deps.prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact) return;
    if (!contact.botActive || contact.flaggedNonIntake) return;

    const messages = await this.deps.prisma.message.findMany({
      where: { id: { in: messageIds } },
      orderBy: { createdAt: 'asc' },
    });
    if (messages.length === 0) return;
    const jobId = messages[messages.length - 1].jobId;
    if (!jobId) return;
    const job = await this.deps.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return;

    const allOpen = await this.deps.prisma.job.findMany({
      where: {
        contactId,
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
    }));

    const intake = parseJobIntake(job);

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
      },
      {
        prisma: this.deps.prisma,
        config: this.deps.config,
        profile: this.deps.profile,
        notifier: this.deps.notifier,
        createAgent: this.deps.agentFactory,
      },
    );

    if (result.responseText && result.responseText.trim().length > 0) {
      await this.deps.sender.sendText(contact.phoneE164, result.responseText);
      await this.deps.prisma.message.create({
        data: {
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
