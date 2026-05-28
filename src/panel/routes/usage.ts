import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';

export function registerUsageRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
): void {
  app.get('/panel/usage', async (req, reply) => {
    if (!(req as any).panelUser) {
      reply.redirect('/panel/login', 303);
      return;
    }
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [monthRuns, todayRuns, recent] = await Promise.all([
      prisma.agentRun.findMany({
        where: { createdAt: { gte: startOfMonth } },
        select: { inputTokens: true, outputTokens: true, costUsd: true, error: true },
      }),
      prisma.agentRun.findMany({
        where: { createdAt: { gte: startOfToday } },
        select: { inputTokens: true, outputTokens: true, costUsd: true },
      }),
      prisma.agentRun.findMany({
        orderBy: { createdAt: 'desc' },
        take: 30,
        include: { job: { include: { contact: true } } },
      }),
    ]);

    const sum = (rows: Array<{ inputTokens: number; outputTokens: number; costUsd: number | null }>) => ({
      runs: rows.length,
      inputTokens: rows.reduce((s, r) => s + r.inputTokens, 0),
      outputTokens: rows.reduce((s, r) => s + r.outputTokens, 0),
      costUsd: rows.reduce((s, r) => s + (r.costUsd ?? 0), 0),
    });
    const errorsThisMonth = monthRuns.filter((r) => r.error).length;

    return reply.view('usage.hbs', {
      title: 'Costos',
      username: (req as any).panelUser,
      month: sum(monthRuns),
      today: sum(todayRuns),
      errorsThisMonth,
      recent,
    });
  });
}
