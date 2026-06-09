import type { FastifyInstance } from 'fastify';
import type { PrismaClient, Job, Contact } from '@prisma/client';
import { parseJobIntake } from '../../services/job';
import { getUrgencyBadge } from '../services/urgency';
import type { ConnectionStateProvider } from '../adapter-state';

export interface KanbanCard {
  id: string;
  vehicleMake: string;
  vehicleModel: string;
  clientName: string;
  workType: string;
  photoCount: number;
  hoursAgo: number;
  urgency: {
    icon: string;
    label: string;
    color: string;
  };
}

export interface KanbanColumn {
  title: string;
  count: number;
  jobs: KanbanCard[];
}

async function buildKanbanCard(
  job: Job & { contact: Contact; _count: { messages: number } },
): Promise<KanbanCard> {
  const intake = parseJobIntake(job);
  const vehicle = intake.vehicle as any;
  const work = intake.work as any;

  const vehicleMake = vehicle?.make?.value ?? 'Sin especificar';
  const vehicleModel = vehicle?.model?.value ?? '';
  const clientName = ((intake.client as any)?.name?.value as string) || job.contact.displayName || job.contact.phoneE164;
  const workType = (work?.type?.value as string) || 'No especificado';

  // Count image messages as photos
  const photoCount = job._count.messages; // Simplified: we'll use message count

  const hoursAgo = Math.floor((Date.now() - job.openedAt.getTime()) / (1000 * 60 * 60));
  const urgency = getUrgencyBadge(job.openedAt);

  return {
    id: job.id,
    vehicleMake,
    vehicleModel,
    clientName,
    workType,
    photoCount,
    hoursAgo,
    urgency,
  };
}

async function loadKanbanData(prisma: PrismaClient): Promise<KanbanColumn[]> {
  const baseInclude = {
    contact: true,
    _count: { select: { messages: true } },
  } as const;

  // Define kanban stages mapping status to column
  const stages = [
    { title: 'Intake incompleto', statuses: ['OPEN_INTAKE'] },
    { title: 'Listo para revisión', statuses: ['READY_FOR_REVIEW'] },
    { title: 'En revisión', statuses: ['IN_PROGRESS'] },
    { title: 'Listo para presupuesto', statuses: [] }, // Not currently in use
    { title: 'Presupuesto enviado', statuses: [] }, // Not currently in use
    { title: 'Completado', statuses: ['CLOSED'] },
  ];

  const columns: KanbanColumn[] = [];

  for (const stage of stages) {
    const jobs = await prisma.job.findMany({
      where: stage.statuses.length > 0
        ? { status: { in: stage.statuses } }
        : { id: 'nonexistent' }, // Empty query if no statuses
      orderBy: { openedAt: 'desc' },
      include: baseInclude,
      take: 50,
    });

    const cards = await Promise.all(jobs.map((j) => buildKanbanCard(j)));

    columns.push({
      title: stage.title,
      count: cards.length,
      jobs: cards,
    });
  }

  return columns;
}

export function registerIncomingRoute(
  app: FastifyInstance,
  prisma: PrismaClient,
  adapterState: ConnectionStateProvider,
): void {
  app.get('/panel/incoming', async (req, reply) => {
    if (!(req as any).panelUser) {
      reply.redirect('/panel/login', 303);
      return;
    }
    const kanbanColumns = await loadKanbanData(prisma);
    const username = (req as any).panelUser;
    const userInitials = username
      .split(/\s+/)
      .map((n: string) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || 'YM';
    return reply.view('incoming.hbs', {
      title: 'Incoming',
      username,
      currentPage: 'incoming',
      userInitials,
      kanbanColumns,
      adapter: adapterState.state(),
    }, { layout: 'layouts/base.handlebars' });
  });
}
