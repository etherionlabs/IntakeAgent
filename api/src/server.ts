import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { CORS_ORIGIN, requireEnv } from './env';

export interface BuildOptions {
  jwtSecret?: string;
}

export async function buildServer(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: CORS_ORIGIN, credentials: true });
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

  // Las rutas se registran en tasks siguientes:
  // await app.register(authRoutes); await app.register(jobsRoutes); etc.

  return app;
}
