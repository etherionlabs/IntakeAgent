import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { CORS_ORIGIN, requireEnv } from './env';
import { authRoutes } from './routes/auth';
import { profileRoutes } from './routes/profile';
import { jobsRoutes } from './routes/jobs';
import { contactsRoutes } from './routes/contacts';
import { usageRoutes } from './routes/usage';
import { waStatusRoutes } from './routes/wa-status';
import { settingsRoutes } from './routes/settings';

export interface BuildOptions {
  jwtSecret?: string;
  fetcher?: typeof fetch;
}

export async function buildServer(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // `methods` explícito: el default de @fastify/cors no incluye PUT/PATCH/DELETE,
  // lo que hace fallar el preflight de los guardados (PUT /settings, PATCH /jobs…)
  // con "Failed to fetch" en el navegador. `credentials` solo cuando hay un origin
  // concreto: combinar `*` con credentials es inválido en CORS.
  const allowCredentials = CORS_ORIGIN !== '*';
  await app.register(cors, {
    origin: CORS_ORIGIN,
    credentials: allowCredentials,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(jwt, { secret: opts.jwtSecret ?? requireEnv('JWT_SECRET') });

  // Decorator: protege rutas y expone request.tenantId / request.authUser.
  app.decorate('authenticate', async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
      request.tenantId = request.user.tenantId;
      request.authUser = request.user;
    } catch {
      reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.get('/health', async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(profileRoutes);
  await app.register(jobsRoutes);
  await app.register(contactsRoutes);
  await app.register(usageRoutes);
  await app.register(waStatusRoutes, { fetcher: opts.fetcher });
  await app.register(settingsRoutes);

  return app;
}
