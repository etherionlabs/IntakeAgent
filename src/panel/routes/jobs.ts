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

  app.patch<{ Params: { id: string }; Body: Record<string, string> }>(
    '/panel/api/jobs/:id/intake',
    async (req, reply) => {
      if (!(req as any).panelUser) {
        reply.code(401);
        return { error: 'unauthorized' };
      }
      const job = await deps.prisma.job.findUnique({ where: { id: req.params.id } });
      if (!job) {
        reply.code(404);
        return { error: 'not_found' };
      }
      const intake = parseJobIntake(job);
      for (const [path, raw] of Object.entries(req.body ?? {})) {
        const [sectionKey, fieldKey] = path.split('.');
        if (!sectionKey || !fieldKey) continue;
        const section = (intake as any)[sectionKey] as Record<string, any> | undefined;
        if (!section) continue;
        const field = section[fieldKey];
        if (!field) continue;
        const trimmed = String(raw).trim();
        if (trimmed === '') {
          field.value = null;
        } else if (trimmed === 'true') {
          field.value = true;
        } else if (trimmed === 'false') {
          field.value = false;
        } else if (!isNaN(Number(trimmed)) && /^-?\d+(\.\d+)?$/.test(trimmed)) {
          field.value = Number(trimmed);
        } else {
          field.value = trimmed;
        }
        if (field.declined && field.value !== null) {
          field.declined = false;
          field.declined_reason = undefined;
        }
      }
      await deps.prisma.job.update({
        where: { id: job.id },
        data: { intake: JSON.stringify(intake) },
      });
      reply.header('HX-Redirect', `/panel/jobs/${job.id}`);
      return '';
    },
  );
}
