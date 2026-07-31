import type { PrismaClient } from '@prisma/client';
import { parseJobIntake } from '../../../src/services/job';
import { listOpportunities } from '../../../src/services/intake';

/**
 * Resumen para la pantalla principal del dueño. Responde dos preguntas —"¿qué
 * tengo que hacer ahora?" y "¿me está funcionando esto?"— que el tablero de
 * trabajos no contesta: ahí todo pesa igual y la venta no se ve por ningún lado.
 *
 * Las oportunidades viven dentro del JSON de `Job.intake`, así que no se pueden
 * agregar en SQL: se acota en la consulta y se cuenta en memoria.
 */

const OPEN_STATUSES = ['OPEN_INTAKE', 'READY_FOR_REVIEW', 'IN_PROGRESS'];

export interface PendingQuote {
  jobId: string;
  contactName: string;
  status: string;
  /** Extras que el cliente aceptó y que hay que incluir en la cotización. */
  services: string[];
  updatedAt: string | null;
}

export interface WaitingJob {
  jobId: string;
  contactName: string;
  /** Por qué el bot no contestó, para que el dueño sepa si debe entrar él. */
  reason: 'bot_paused' | 'flagged' | 'no_reply';
  since: string;
}

export interface Overview {
  attention: {
    pendingQuotes: PendingQuote[];
    readyForReview: number;
    waiting: WaitingJob[];
  };
  funnel: {
    windowDays: number;
    jobs: number;
    withOffer: number;
    withAccepted: number;
    won: number;
    lost: number;
    followUps: number;
  };
}

export interface OverviewOptions {
  windowDays?: number;
  /** Tope de trabajos abiertos que se inspeccionan (protege paneles con volumen). */
  maxOpenJobs?: number;
}

export async function buildOverview(
  prisma: PrismaClient,
  tenantId: string,
  now: Date,
  opts: OverviewOptions = {},
): Promise<Overview> {
  const windowDays = opts.windowDays ?? 30;
  const maxOpenJobs = opts.maxOpenJobs ?? 200;
  const since = new Date(now.getTime() - windowDays * 24 * 3600_000);

  const [openJobs, windowJobs] = await Promise.all([
    prisma.job.findMany({
      where: { tenantId, archivedAt: null, status: { in: OPEN_STATUSES } },
      include: { contact: true },
      orderBy: { openedAt: 'desc' },
      take: maxOpenJobs,
    }),
    prisma.job.findMany({
      where: { tenantId, archivedAt: null, openedAt: { gte: since } },
      select: { id: true, intake: true, outcome: true, followUpCount: true },
    }),
  ]);

  // --- Necesita tu atención -------------------------------------------------
  const pendingQuotes: PendingQuote[] = [];
  const waiting: WaitingJob[] = [];
  let readyForReview = 0;

  for (const job of openJobs) {
    if (job.status === 'READY_FOR_REVIEW') readyForReview += 1;

    const accepted = listOpportunities(parseJobIntake(job))
      .filter((o) => o.status === 'accepted')
      .map((o) => o.service);
    if (accepted.length > 0) {
      pendingQuotes.push({
        jobId: job.id,
        contactName: job.contact.displayName ?? job.contact.phoneE164,
        status: job.status,
        services: accepted,
        updatedAt: (job.readyAt ?? job.openedAt)?.toISOString() ?? null,
      });
    }

    // Cliente esperando: escribió al final y el bot no le contestó (pausado,
    // marcado como spam, cuota agotada o un fallo). Es lo único que exige que
    // el dueño entre a la conversación en persona.
    const last = await prisma.message.findFirst({
      where: { jobId: job.id, tenantId },
      orderBy: { createdAt: 'desc' },
      select: { direction: true, createdAt: true },
    });
    if (last && last.direction === 'inbound') {
      const reason: WaitingJob['reason'] = job.contact.flaggedNonIntake
        ? 'flagged'
        : !job.contact.botActive
          ? 'bot_paused'
          : 'no_reply';
      waiting.push({
        jobId: job.id,
        contactName: job.contact.displayName ?? job.contact.phoneE164,
        reason,
        since: last.createdAt.toISOString(),
      });
    }
  }

  // --- ¿Está vendiendo? -----------------------------------------------------
  let withOffer = 0;
  let withAccepted = 0;
  let won = 0;
  let lost = 0;
  let followUps = 0;

  for (const job of windowJobs) {
    const opportunities = listOpportunities(parseJobIntake(job));
    if (opportunities.length > 0) withOffer += 1;
    if (opportunities.some((o) => o.status === 'accepted')) withAccepted += 1;
    if (job.outcome === 'WON') won += 1;
    if (job.outcome === 'LOST') lost += 1;
    followUps += job.followUpCount;
  }

  return {
    attention: {
      // Lo más valioso primero: el extra aceptado es la parte de la orden que
      // más margen deja y la que se pasa por alto al cotizar.
      pendingQuotes: pendingQuotes.sort((a, b) => b.services.length - a.services.length),
      readyForReview,
      waiting: waiting.sort((a, b) => a.since.localeCompare(b.since)),
    },
    funnel: { windowDays, jobs: windowJobs.length, withOffer, withAccepted, won, lost, followUps },
  };
}
