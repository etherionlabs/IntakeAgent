import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import view from '@fastify/view';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
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

  const app = Fastify({ logger: false });

  await app.register(cookie);
  await app.register(formbody);
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

  app.get('/panel/dashboard', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    return reply.view('dashboard.hbs', {
      title: 'Dashboard',
      username: (req as any).panelUser,
      ready: [],
      open: [],
      inProgress: [],
      closed: [],
      adapterStatus: deps.adapterState.state().status,
    });
  });

  return app;
}
