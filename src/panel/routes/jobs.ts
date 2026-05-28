import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Profile } from '../../config/schema';
import { parseJobIntake } from '../../services/job';

export interface JobDetailDeps {
  prisma: PrismaClient;
  profile: Profile;
}

export function registerJobRoutes(app: FastifyInstance, deps: JobDetailDeps): void {
  app.get<{ Params: { id: string } }>('/panel/jobs/:id', async (req, reply) => {
    if (!(req as any).panelUser) {
      reply.redirect('/panel/login', 303);
      return;
    }
    const job = await deps.prisma.job.findUnique({
      where: { id: req.params.id },
      include: {
        contact: true,
        messages: { orderBy: { createdAt: 'asc' } },
        agentRuns: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });
    if (!job) {
      reply.code(404);
      return reply.view('job-detail.hbs', {
        title: 'Job no encontrado',
        username: (req as any).panelUser,
        notFound: true,
      });
    }
    const intake = parseJobIntake(job);
    const otherJobs = await deps.prisma.job.findMany({
      where: { contactId: job.contactId, NOT: { id: job.id } },
      orderBy: { openedAt: 'desc' },
      take: 10,
    });
    return reply.view('job-detail.hbs', {
      title: `Job ${job.id.slice(0, 8)}`,
      username: (req as any).panelUser,
      job,
      contact: job.contact,
      intake,
      schema: deps.profile.intakeSchema,
      messages: job.messages,
      agentRuns: job.agentRuns,
      otherJobs,
    });
  });
}
