import type { FastifyInstance } from 'fastify';
import type { PrismaClient, Job, Contact } from '@prisma/client';
import { parseJobIntake } from '../../services/job';
import type { ConnectionStateProvider } from '../adapter-state';

export interface DashboardJobRow {
  id: string;
  status: string;
  openedAt: Date;
  readyAt: Date | null;
  contactPhone: string;
  contactDisplayName: string | null;
  contactBotActive: boolean;
  contactFlaggedNonIntake: boolean;
  clientNameFromIntake: string | null;
  summary: string | null;
  messageCount: number;
}

async function buildRow(
  _prisma: PrismaClient,
  job: Job & { contact: Contact; _count: { messages: number } },
): Promise<DashboardJobRow> {
  const intake = parseJobIntake(job);
  const name = (intake.client as any)?.name?.value as string | null | undefined;
  return {
    id: job.id,
    status: job.status,
    openedAt: job.openedAt,
    readyAt: job.readyAt,
    contactPhone: job.contact.phoneE164,
    contactDisplayName: job.contact.displayName,
    contactBotActive: job.contact.botActive,
    contactFlaggedNonIntake: job.contact.flaggedNonIntake,
    clientNameFromIntake: name ?? null,
    summary: job.summary,
    messageCount: job._count.messages,
  };
}

export async function loadDashboardData(prisma: PrismaClient): Promise<{
  ready: DashboardJobRow[];
  open: DashboardJobRow[];
  inProgress: DashboardJobRow[];
  closed: DashboardJobRow[];
  nonIntake: { phone: string; reason: string | null; count: number }[];
}> {
  const baseInclude = {
    contact: true,
    _count: { select: { messages: true } },
  } as const;

  const [ready, open, inProgress, closed] = await Promise.all([
    prisma.job.findMany({
      where: { status: 'READY_FOR_REVIEW' },
      orderBy: { readyAt: 'desc' },
      include: baseInclude,
      take: 50,
    }),
    prisma.job.findMany({
      where: { status: 'OPEN_INTAKE' },
      orderBy: { openedAt: 'desc' },
      include: baseInclude,
      take: 50,
    }),
    prisma.job.findMany({
      where: { status: 'IN_PROGRESS' },
      orderBy: { readyAt: 'desc' },
      include: baseInclude,
      take: 50,
    }),
    prisma.job.findMany({
      where: { status: 'CLOSED' },
      orderBy: { closedAt: 'desc' },
      include: baseInclude,
      take: 20,
    }),
  ]);

  const nonIntakeContacts = await prisma.contact.findMany({
    where: { flaggedNonIntake: true },
    include: { _count: { select: { messages: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 20,
  });

  return {
    ready: await Promise.all(ready.map((j) => buildRow(prisma, j))),
    open: await Promise.all(open.map((j) => buildRow(prisma, j))),
    inProgress: await Promise.all(inProgress.map((j) => buildRow(prisma, j))),
    closed: await Promise.all(closed.map((j) => buildRow(prisma, j))),
    nonIntake: nonIntakeContacts.map((c) => ({
      phone: c.phoneE164,
      reason: c.flaggedReason,
      count: c._count.messages,
    })),
  };
}

export function registerDashboardRoute(
  app: FastifyInstance,
  prisma: PrismaClient,
  adapterState: ConnectionStateProvider,
): void {
  app.get('/panel/dashboard', async (req, reply) => {
    if (!(req as any).panelUser) {
      reply.redirect('/panel/login', 303);
      return;
    }
    const data = await loadDashboardData(prisma);
    return reply.view('dashboard.hbs', {
      title: 'Dashboard',
      username: (req as any).panelUser,
      ...data,
      adapter: adapterState.state(),
    });
  });
}
