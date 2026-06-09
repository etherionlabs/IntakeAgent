import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Config, Profile } from '../../config/schema';
import type { ConnectionStateProvider } from '../adapter-state';

export function registerSettingsRoute(
  app: FastifyInstance,
  _prisma: PrismaClient,
  _config: Config,
  _profile: Profile,
  adapterState: ConnectionStateProvider,
): void {
  app.get('/panel/settings', async (req, reply) => {
    if (!(req as any).panelUser) {
      reply.redirect('/panel/login', 303);
      return;
    }
    const username = (req as any).panelUser;
    const userInitials = username
      .split(/\s+/)
      .map((n: string) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || 'YM';
    return reply.view('settings.hbs', {
      title: 'Settings',
      username,
      currentPage: 'settings',
      userInitials,
      adapter: adapterState.state(),
    }, { layout: 'layouts/base.handlebars' });
  });
}
