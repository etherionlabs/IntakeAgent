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
    const username = (req as any).panelUser;
    const userInitials = username
      .split(/\s+/)
      .map((n: string) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || 'YM';
    return reply.view('inbox.hbs', {
      title: 'Inbox',
      username,
      currentPage: 'inbox',
      userInitials,
      ...data,
      adapter: adapterState.state(),
    }, { layout: 'layouts/base.handlebars' });
  });
}
