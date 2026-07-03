import type { FastifyInstance, FastifyReply } from 'fastify';
import { resolveManagerUrl } from '../lib/manager-url';

type Fetcher = typeof fetch;

export async function waStatusRoutes(app: FastifyInstance, opts: { fetcher?: Fetcher } = {}) {
  const doFetch: Fetcher = opts.fetcher ?? fetch;

  // El tenantId SIEMPRE sale del JWT (request.tenantId), nunca del cliente.
  app.get('/wa-status', { preHandler: app.authenticate }, async (request: any, reply) => {
    const tenantId = request.tenantId as string;
    const base = resolveManagerUrl(tenantId);
    const token = process.env.INTERNAL_API_TOKEN;
    if (!base || !token) return reply.code(503).send({ error: 'worker no configurado' });
    try {
      const url = `${base}/internal/wa-status?tenantId=${encodeURIComponent(tenantId)}`;
      const res = await doFetch(url, { headers: { authorization: `Bearer ${token}` } });
      if (res.status === 404) return reply.code(404).send({ error: 'tenant sin conexión activa' });
      if (!res.ok) return reply.code(502).send({ error: `worker respondió ${res.status}` });
      return await res.json();
    } catch {
      return reply.code(502).send({ error: 'worker inalcanzable' });
    }
  });

  async function proxyAction(tenantId: string, path: string, reply: FastifyReply) {
    const base = resolveManagerUrl(tenantId);
    const token = process.env.INTERNAL_API_TOKEN;
    if (!base || !token) return reply.code(503).send({ error: 'worker no configurado' });
    try {
      const res = await doFetch(`${base}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      });
      if (!res.ok) return reply.code(502).send({ error: `worker respondió ${res.status}` });
      return await res.json();
    } catch {
      return reply.code(502).send({ error: 'worker inalcanzable' });
    }
  }

  app.post('/wa-status/logout', { preHandler: app.authenticate }, async (request: any, reply) =>
    proxyAction(request.tenantId, '/internal/wa-logout', reply),
  );
  app.post('/wa-status/reconnect', { preHandler: app.authenticate }, async (request: any, reply) =>
    proxyAction(request.tenantId, '/internal/wa-reconnect', reply),
  );
}
