import type { FastifyInstance } from 'fastify';
import type { Config, Profile } from '../../config/schema';

export function registerConfigRoutes(
  app: FastifyInstance,
  config: Config,
  profile: Profile,
): void {
  app.get('/panel/config', (req, reply) => {
    if (!(req as any).panelUser) {
      reply.redirect('/panel/login', 303);
      return;
    }
    const safeConfig = JSON.parse(JSON.stringify(config));
    return reply.view('config.hbs', {
      title: 'Configuración',
      username: (req as any).panelUser,
      config: safeConfig,
      schema: profile.intakeSchema,
      facts: profile.businessFacts,
      promptVars: profile.promptVars,
      welcome: profile.welcome,
    });
  });
}
