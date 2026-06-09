import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { loadDashboardData } from './dashboard';
import type { ConnectionStateProvider } from '../adapter-state';

export function registerInboxRoute(
  app: FastifyInstance,
  prisma: PrismaClient,
  adapterState: ConnectionStateProvider,
): void {
  app.get('/panel/inbox', async (req, reply) => {
    if (!(req as any).panelUser) {
      reply.redirect('/panel/login', 303);
      return;
    }
    const data = await loadDashboardData(prisma);
    return reply.view('inbox.hbs', {
      title: 'Inbox',
      username: (req as any).panelUser,
      currentPage: 'inbox',
      userInitials: 'YM',
      ...data,
      adapter: adapterState.state(),
    }, { layout: 'layouts/base.handlebars' });
  });
}
