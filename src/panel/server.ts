import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import view from '@fastify/view';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import staticPlugin from '@fastify/static';
import Handlebars from 'handlebars';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { Config, Profile } from '../config/schema';
import {
  COOKIE_NAME,
  encodeSession,
  decodeSession,
  resolveUser,
  type PanelUser,
} from './auth';
import { handlebarsHelpers } from './helpers';
import type { ConnectionStateProvider } from './adapter-state';
import { registerDashboardRoute } from './routes/dashboard';
import { registerJobRoutes } from './routes/jobs';
import { registerContactRoutes } from './routes/contacts';
import { registerWhatsappRoutes } from './routes/whatsapp';
import { registerUsageRoutes } from './routes/usage';
import { registerConfigRoutes } from './routes/config';
import { registerInboxRoute } from './routes/inbox';
import { registerIncomingRoute } from './routes/incoming';
import { registerSettingsRoute } from './routes/settings';

export interface PanelServerDeps {
  prisma: PrismaClient;
  config: Config;
  profile: Profile;
  adapterState: ConnectionStateProvider;
  sessionSecret?: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolvePanelUsers(config: Config): PanelUser[] {
  return config.panel.users.map((u) => ({
    username: u.username,
    passwordHash: process.env[u.passwordHashEnv] ?? '',
  }));
}

export async function createPanelServer(
  deps: PanelServerDeps,
): Promise<FastifyInstance> {
  const sessionSecret =
    deps.sessionSecret ??
    process.env.PANEL_SESSION_SECRET ??
    `dev-${Math.random().toString(36).slice(2)}`;

  for (const [name, fn] of Object.entries(handlebarsHelpers)) {
    Handlebars.registerHelper(name, fn as Handlebars.HelperDelegate);
  }

  Handlebars.registerPartial(
    'jobsTable',
    `
<section class="bg-white rounded shadow p-4 mb-6">
  <h2 class="font-semibold mb-3">{{title}}</h2>
  {{#if rows.length}}
    <table class="w-full text-sm">
      <thead class="text-left text-gray-500">
        <tr>
          <th class="py-1">Cliente</th>
          <th class="py-1">Estado</th>
          <th class="py-1">Resumen</th>
          <th class="py-1 text-right">Hace</th>
          <th class="py-1"></th>
        </tr>
      </thead>
      <tbody>
        {{#each rows}}
        <tr class="border-t hover:bg-gray-50">
          <td class="py-2">
            <div class="font-medium">{{#if this.clientNameFromIntake}}{{this.clientNameFromIntake}}{{else}}<span class="text-gray-500">{{this.contactPhone}}</span>{{/if}}</div>
            <div class="text-xs text-gray-500">{{this.contactPhone}} · {{this.messageCount}} msgs</div>
          </td>
          <td class="py-2"><span class="px-2 py-0.5 rounded text-xs {{statusClass this.status}}">{{statusLabel this.status}}</span></td>
          <td class="py-2 text-gray-700">{{truncate this.summary 80}}</td>
          <td class="py-2 text-right text-gray-500">{{ago this.openedAt}}</td>
          <td class="py-2 text-right">
            <a href="/panel/jobs/{{this.id}}" class="text-blue-600 hover:underline">abrir →</a>
          </td>
        </tr>
        {{/each}}
      </tbody>
    </table>
  {{else}}
    <div class="text-gray-500 text-sm">{{emptyMessage}}</div>
  {{/if}}
</section>
    `,
  );

  const app = Fastify({ logger: false });

  await app.register(cookie);
  await app.register(formbody);
  await app.register(staticPlugin, {
    root: join(__dirname, '../design'),
    prefix: '/panel/static/',
  });
  await app.register(view, {
    engine: { handlebars: Handlebars },
    root: join(__dirname, 'views'),
    layout: 'layout.hbs',
    options: { partials: {} },
    defaultContext: {
      businessName: deps.profile.intakeSchema.$businessName,
    },
  });

  app.decorateRequest('panelUser', null);
  app.addHook('preHandler', async (req) => {
    const token = (req.cookies?.[COOKIE_NAME] as string | undefined) ?? '';
    if (!token) return;
    const username = decodeSession(token, sessionSecret);
    if (username) (req as any).panelUser = username;
  });

  const requireAuth = (req: FastifyRequest, reply: FastifyReply): boolean => {
    if (!(req as any).panelUser) {
      reply.redirect('/panel/login', 303);
      return false;
    }
    return true;
  };

  app.get('/', (req, reply) => {
    if ((req as any).panelUser) reply.redirect('/panel/dashboard', 303);
    else reply.redirect('/panel/login', 303);
  });

  app.get('/panel/login', (_req, reply) => {
    return reply.view('login.hbs', {}, { layout: '' });
  });

  app.post('/panel/login', async (req, reply) => {
    const body = (req.body ?? {}) as { username?: string; password?: string };
    const users = resolvePanelUsers(deps.config);
    const user = await resolveUser(users, body.username ?? '', body.password ?? '');
    if (!user) {
      reply.code(401);
      return reply.view('login.hbs', { error: 'Credenciales inválidas' }, { layout: '' });
    }
    const token = encodeSession(user.username, sessionSecret);
    reply.setCookie(COOKIE_NAME, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
    });
    reply.redirect('/panel/dashboard', 303);
  });

  app.post('/panel/logout', (_req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    reply.redirect('/panel/login', 303);
  });

  registerDashboardRoute(app, deps.prisma, deps.adapterState);
  registerJobRoutes(app, { prisma: deps.prisma, profile: deps.profile });
  registerContactRoutes(app, deps.prisma);
  registerWhatsappRoutes(app, deps.adapterState);
  registerUsageRoutes(app, deps.prisma);
  registerConfigRoutes(app, deps.config, deps.profile);
  registerInboxRoute(app, deps.prisma, deps.adapterState);
  registerIncomingRoute(app, deps.prisma, deps.adapterState);
  registerSettingsRoute(app, deps.prisma, deps.config, deps.profile, deps.adapterState);

  return app;
}
