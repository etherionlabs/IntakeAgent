import type { FastifyInstance } from 'fastify';
import type { ConnectionStateProvider } from '../adapter-state';

export function registerWhatsappRoutes(
  app: FastifyInstance,
  adapterState: ConnectionStateProvider,
): void {
  app.get('/panel/whatsapp', async (req, reply) => {
    if (!(req as any).panelUser) {
      reply.redirect('/panel/login', 303);
      return;
    }
    return reply.view('whatsapp.hbs', {
      title: 'WhatsApp',
      username: (req as any).panelUser,
      adapter: adapterState.state(),
    });
  });

  app.get('/panel/api/whatsapp/state', (req, reply) => {
    if (!(req as any).panelUser) {
      reply.code(401);
      return { error: 'unauthorized' };
    }
    return adapterState.state();
  });
}
