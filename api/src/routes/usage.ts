import type { FastifyInstance } from 'fastify';
import { getPrisma } from '../db';

export async function usageRoutes(app: FastifyInstance) {
  app.get('/usage', { preHandler: app.authenticate }, async (request) => {
    const prisma = getPrisma();
    const where = { tenantId: request.tenantId };
    const agg = await prisma.agentRun.aggregate({
      where,
      _sum: { costUsd: true, inputTokens: true, outputTokens: true },
      _count: true,
    });
    const recent = await prisma.agentRun.findMany({ where, orderBy: { createdAt: 'desc' }, take: 30 });
    return {
      totals: {
        runs: agg._count,
        costUsd: agg._sum.costUsd ?? 0,
        inputTokens: agg._sum.inputTokens ?? 0,
        outputTokens: agg._sum.outputTokens ?? 0,
      },
      recent,
    };
  });
}
