import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { getCorsOrigin, requireEnv } from './env';
import { getPrisma } from './db';
import { isTenantActive } from './billing/access';
import { SESSION_COOKIE, CSRF_COOKIE, CSRF_HEADER } from './lib/auth-cookies';
import { authRoutes } from './routes/auth';
import { profileRoutes } from './routes/profile';
import { jobsRoutes } from './routes/jobs';
import { contactsRoutes } from './routes/contacts';
import { usageRoutes } from './routes/usage';
import { waStatusRoutes } from './routes/wa-status';
import { settingsRoutes } from './routes/settings';
import { billingRoutes } from './routes/billing';
import { onboardingRoutes } from './routes/onboarding';
import { provisionTenant, workerAddTenant } from './onboarding/provision';
import type { StripeLike } from './billing/stripe';
import type { EmailSender } from './lib/email';

export interface BuildOptions {
  jwtSecret?: string;
  fetcher?: typeof fetch;
  stripe?: StripeLike;
  emailSender?: EmailSender;
  /** Provisioning del tenant (inyectable en tests). Default: TemplateLoader + worker. */
  provision?: (tenantId: string) => Promise<void>;
}

// Rutas mutadoras exentas de CSRF: no pueden tener cookie CSRF aún (login/recuperación)
// o no la requieren (logout, health).
const CSRF_EXEMPT = new Set([
  '/auth/login',
  '/auth/logout',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/billing/webhook',
  '/health',
]);
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const isTest = process.env.NODE_ENV === 'test';

export async function buildServer(opts: BuildOptions = {}): Promise<FastifyInstance> {
  // bodyLimit: la media va por el worker, no por la API; 256 KB cubre los JSON.
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024 });

  // Parser de application/json que conserva el Buffer crudo (request.rawBody) y
  // además parsea JSON normal. La verificación de firma de Stripe (webhook) exige
  // el cuerpo crudo exacto; el resto de rutas siguen recibiendo el objeto parseado.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    (req as any).rawBody = body;
    const text = (body as Buffer).toString('utf8');
    if (!text) return done(null, undefined);
    try { done(null, JSON.parse(text)); } catch (e) { done(e as Error, undefined); }
  });

  await app.register(cookie);
  await app.register(helmet, { contentSecurityPolicy: false }); // API JSON: sin CSP de HTML

  // Rate-limit global por IP. En test el umbral es alto para no romper la suite;
  // el override estricto de /auth/login (5/15min) se mantiene en cualquier entorno.
  await app.register(rateLimit, {
    global: true,
    max: isTest ? 100000 : 100,
    timeWindow: '1 minute',
  });

  const corsOrigin = getCorsOrigin();
  // Con cookies cross-site se exige credentials; combinar `*` con credentials es
  // inválido, así que solo cuando hay origin(s) concretos (prod prohíbe `*`).
  const allowCredentials = corsOrigin !== '*';
  await app.register(cors, {
    origin: corsOrigin,
    credentials: allowCredentials,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // JWT desde cookie de sesión; se mantiene el fallback al header Authorization
  // (server-to-server / tests). La cookie no va firmada por @fastify/cookie:
  // su integridad la garantiza la firma del propio JWT.
  await app.register(jwt, {
    secret: opts.jwtSecret ?? requireEnv('JWT_SECRET'),
    cookie: { cookieName: SESSION_COOKIE, signed: false },
  });

  // CSRF double-submit: solo cuando la petición autentica por COOKIE de sesión
  // (contexto navegador). Las peticiones con Bearer no las adjunta el navegador
  // automáticamente, así que no son vulnerables a CSRF y quedan exentas.
  app.addHook('onRequest', async (request, reply) => {
    if (!MUTATING.has(request.method)) return;
    if (CSRF_EXEMPT.has(request.routeOptions?.url ?? request.url.split('?')[0])) return;
    const hasSessionCookie = Boolean((request.cookies as any)?.[SESSION_COOKIE]);
    if (!hasSessionCookie) return; // auth por Bearer u origen no-navegador
    const cookieToken = (request.cookies as any)?.[CSRF_COOKIE];
    const headerToken = request.headers[CSRF_HEADER];
    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      return reply.code(403).send({ error: 'csrf token inválido' });
    }
  });

  // Decorator: protege rutas, expone request.tenantId / request.authUser, e
  // invalida sesiones emitidas antes de un cambio de contraseña.
  app.decorate('authenticate', async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
      request.tenantId = request.user.tenantId;
      request.authUser = request.user;
      // Invalidación por passwordChangedAt: un JWT con iat anterior al último
      // cambio de contraseña queda invalidado.
      const iatMs = (request.user.iat ?? 0) * 1000;
      const user = await getPrisma().panelUser.findUnique({
        where: { id: request.user.userId },
        select: { passwordChangedAt: true },
      });
      if (!user) return reply.code(401).send({ error: 'unauthorized' });
      if (user.passwordChangedAt && iatMs < user.passwordChangedAt.getTime()) {
        return reply.code(401).send({ error: 'sesión expirada' });
      }
      // Enforcement de suscripción (402) en rutas de negocio. Exentas: /auth/*,
      // /billing/* (para poder pagar) y /health.
      const url = request.routeOptions?.url ?? '';
      if (!url.startsWith('/auth') && !url.startsWith('/billing') && !url.startsWith('/onboarding') && !url.startsWith('/health')) {
        const sub = await getPrisma().subscription.findUnique({
          where: { tenantId: request.tenantId },
          select: { status: true, gracePeriodEndsAt: true },
        });
        if (!isTenantActive(request.tenantId, sub)) {
          return reply.code(402).send({ error: 'subscription_inactive', portalHint: true });
        }
      }
    } catch {
      reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.get('/health', async () => ({ ok: true }));

  // Provisioning por defecto: siembra TenantSettings desde plantilla + alta en el
  // worker. Inyectable en tests para no pegarle al worker real.
  const provision = opts.provision ??
    ((tenantId: string) => provisionTenant(getPrisma(), tenantId, { addTenant: workerAddTenant(opts.fetcher ?? fetch) }).then(() => {}));

  await app.register(authRoutes, { emailSender: opts.emailSender, provision });
  await app.register(profileRoutes);
  await app.register(jobsRoutes);
  await app.register(contactsRoutes);
  await app.register(usageRoutes);
  await app.register(waStatusRoutes, { fetcher: opts.fetcher });
  await app.register(settingsRoutes);
  await app.register(billingRoutes, { stripe: opts.stripe, fetcher: opts.fetcher, provision });
  await app.register(onboardingRoutes);

  return app;
}
