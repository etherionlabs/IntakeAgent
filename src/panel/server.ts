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
<style>
  .jobs-table-section {
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: var(--spacing-lg);
    margin-bottom: var(--spacing-2xl);
  }

  .jobs-table-title {
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
    margin-bottom: var(--spacing-md);
    font-size: var(--font-size-body);
  }

  .jobs-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-size-small);
  }

  .jobs-table thead {
    border-bottom: 1px solid var(--border-color);
  }

  .jobs-table th {
    padding: var(--spacing-md);
    text-align: left;
    font-weight: var(--font-weight-semibold);
    color: var(--text-secondary);
    font-size: var(--font-size-tiny);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .jobs-table th.text-right {
    text-align: right;
  }

  .jobs-table tbody tr {
    border-top: 1px solid var(--border-light);
    transition: var(--transition-normal);
  }

  .jobs-table tbody tr:hover {
    background: var(--bg-secondary);
  }

  .jobs-table td {
    padding: var(--spacing-md);
    color: var(--text-primary);
  }

  .jobs-table td.text-right {
    text-align: right;
  }

  .jobs-table-client-name {
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
  }

  .jobs-table-client-meta {
    font-size: var(--font-size-tiny);
    color: var(--text-secondary);
    margin-top: var(--spacing-xs);
  }

  .jobs-table-status-badge {
    display: inline-block;
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-tiny);
    font-weight: var(--font-weight-semibold);
  }

  .jobs-table-summary {
    color: var(--text-secondary);
  }

  .jobs-table-time {
    color: var(--text-tertiary);
    font-size: var(--font-size-tiny);
  }

  .jobs-table-link {
    color: var(--accent);
    text-decoration: none;
    font-weight: var(--font-weight-semibold);
    transition: var(--transition-normal);
  }

  .jobs-table-link:hover {
    opacity: 0.8;
    text-decoration: underline;
  }

  .jobs-table-empty {
    color: var(--text-tertiary);
    font-size: var(--font-size-small);
    padding: var(--spacing-lg);
    text-align: center;
  }
</style>
<section class="jobs-table-section">
  <h2 class="jobs-table-title">{{title}}</h2>
  {{#if rows.length}}
    <table class="jobs-table">
      <thead>
        <tr>
          <th>Cliente</th>
          <th>Estado</th>
          <th>Resumen</th>
          <th class="text-right">Hace</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {{#each rows}}
        <tr>
          <td>
            <div class="jobs-table-client-name">{{#if this.clientNameFromIntake}}{{this.clientNameFromIntake}}{{else}}<span style="color: var(--text-tertiary);">{{this.contactPhone}}</span>{{/if}}</div>
            <div class="jobs-table-client-meta">{{this.contactPhone}} · {{this.messageCount}} msgs</div>
          </td>
          <td><span class="jobs-table-status-badge {{statusClass this.status}}">{{statusLabel this.status}}</span></td>
          <td class="jobs-table-summary">{{truncate this.summary 80}}</td>
          <td class="jobs-table-time text-right">{{ago this.openedAt}}</td>
          <td class="text-right">
            <a href="/panel/jobs/{{this.id}}" class="jobs-table-link">abrir →</a>
          </td>
        </tr>
        {{/each}}
      </tbody>
    </table>
  {{else}}
    <div class="jobs-table-empty">{{emptyMessage}}</div>
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
