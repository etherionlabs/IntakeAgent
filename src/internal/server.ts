import Fastify, { type FastifyInstance } from 'fastify';
import { logger } from '../lib/logger';

/**
 * Forma del estado que expone el endpoint interno de status.
 *
 * El `BaileysAdapter.state()` devuelve `AdapterStateSnapshot`
 * (`{ status, qr, lastError, lastConnectedAt }`), que NO coincide con esta
 * forma. El mapeo a `{ connected, qr, phone }` se hace en el bootstrap
 * (`src/index.ts`) antes de inyectar `adapterState`, sin tocar el adapter.
 */
export interface AdapterStatus {
  connected: boolean;
  qr: string | null;
  phone: string;
}

export interface InternalServerDeps {
  adapterState: { state: () => AdapterStatus };
}

export interface InternalServer {
  app: FastifyInstance;
  close: () => Promise<void>;
}

export async function startInternalServer(deps: InternalServerDeps): Promise<InternalServer> {
  const token = process.env.INTERNAL_API_TOKEN;
  if (!token) {
    throw new Error(
      'INTERNAL_API_TOKEN no está definido. El endpoint interno de status exige ' +
        'autenticación por bearer token aunque viva en la red interna de Docker.',
    );
  }

  const app = Fastify({ logger: false });

  app.addHook('onRequest', async (request, reply) => {
    const header = request.headers.authorization ?? '';
    const expected = `Bearer ${token}`;
    if (header !== expected) {
      reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.get('/internal/wa-status', async () => {
    return deps.adapterState.state();
  });

  const port = Number(process.env.INTERNAL_PORT ?? 3002);
  // Railway enruta la red privada por IPv6 → set HOST=:: en el worker para que la
  // API lo alcance vía <worker>.railway.internal. Local/Docker: 0.0.0.0.
  const host = process.env.HOST ?? '0.0.0.0';
  await app.listen({ port, host });
  const addr = app.server.address();
  const boundPort = typeof addr === 'object' && addr ? addr.port : port;
  logger.info({ port: boundPort }, 'internal.listening');

  return {
    app,
    close: () => app.close(),
  };
}
