import Fastify, { type FastifyInstance } from 'fastify';
import { logger } from '../lib/logger';
import { setBotsConnected, renderMetrics } from '../lib/metrics';
import type { TenantStatus } from '../tenant/types';

/**
 * Dispatcher por tenant que el endpoint interno consulta. El `TenantManager` lo
 * satisface directamente (getStatus/logout/reconnect por tenantId).
 */
export interface TenantDispatcher {
  getStatus(tenantId: string): TenantStatus | null;
  logout(tenantId: string): Promise<void>;
  reconnect(tenantId: string): Promise<void>;
  suspendTenant(tenantId: string): Promise<void>;
  resumeTenant(tenantId: string): Promise<void>;
  addTenant(tenantId: string): Promise<void>;
}

export interface InternalServerDeps {
  dispatcher: TenantDispatcher;
  /** Número de bots conectados (para la métrica). Opcional. */
  connectedCount?: () => number;
}

export interface InternalServer {
  app: FastifyInstance;
  close: () => Promise<void>;
}

function tenantIdOf(source: unknown): string | null {
  if (source && typeof source === 'object' && 'tenantId' in source) {
    const v = (source as Record<string, unknown>).tenantId;
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
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
    if (header !== `Bearer ${token}`) {
      reply.code(401).send({ error: 'unauthorized' });
    }
  });

  // El tenantId SIEMPRE lo provee la API (resuelto del JWT), nunca el cliente final.
  app.get('/internal/wa-status', async (request, reply) => {
    const tenantId = tenantIdOf(request.query);
    if (!tenantId) return reply.code(400).send({ error: 'tenantId requerido' });
    const status = deps.dispatcher.getStatus(tenantId);
    if (!status) return reply.code(404).send({ error: 'tenant sin conexión activa' });
    return status;
  });

  app.post('/internal/wa-logout', async (request, reply) => {
    const tenantId = tenantIdOf(request.body);
    if (!tenantId) return reply.code(400).send({ ok: false, error: 'tenantId requerido' });
    try {
      await deps.dispatcher.logout(tenantId);
      return { ok: true };
    } catch (e) {
      return reply.code(500).send({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post('/internal/wa-reconnect', async (request, reply) => {
    const tenantId = tenantIdOf(request.body);
    if (!tenantId) return reply.code(400).send({ ok: false, error: 'tenantId requerido' });
    try {
      await deps.dispatcher.reconnect(tenantId);
      return { ok: true };
    } catch (e) {
      return reply.code(500).send({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // Enforcement de billing (Fase 3): suspender/reactivar el bot del tenant.
  app.post('/internal/tenant/suspend', async (request, reply) => {
    const tenantId = tenantIdOf(request.body);
    if (!tenantId) return reply.code(400).send({ ok: false, error: 'tenantId requerido' });
    try { await deps.dispatcher.suspendTenant(tenantId); return { ok: true }; }
    catch (e) { return reply.code(500).send({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
  });

  app.post('/internal/tenant/resume', async (request, reply) => {
    const tenantId = tenantIdOf(request.body);
    if (!tenantId) return reply.code(400).send({ ok: false, error: 'tenantId requerido' });
    try { await deps.dispatcher.resumeTenant(tenantId); return { ok: true }; }
    catch (e) { return reply.code(500).send({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
  });

  // Métricas (Prometheus text), protegidas por el mismo bearer. Observabilidad Fase 5.
  app.get('/internal/metrics', async (_request, reply) => {
    if (deps.connectedCount) setBotsConnected(deps.connectedCount());
    reply.header('content-type', 'text/plain; version=0.0.4');
    return renderMetrics();
  });

  // Aprovisionamiento self-service (Fase 4): alta del tenant en caliente.
  app.post('/internal/tenant/add', async (request, reply) => {
    const tenantId = tenantIdOf(request.body);
    if (!tenantId) return reply.code(400).send({ ok: false, error: 'tenantId requerido' });
    try { await deps.dispatcher.addTenant(tenantId); return { ok: true }; }
    catch (e) { return reply.code(500).send({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
  });

  const port = Number(process.env.INTERNAL_PORT ?? 3002);
  const host = process.env.HOST ?? '0.0.0.0';
  await app.listen({ port, host });
  const addr = app.server.address();
  const boundPort = typeof addr === 'object' && addr ? addr.port : port;
  logger.info({ port: boundPort }, 'internal.listening');

  return { app, close: () => app.close() };
}
