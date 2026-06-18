import type { FastifyInstance } from 'fastify';

type Fetcher = typeof fetch;

export async function waStatusRoutes(app: FastifyInstance, opts: { fetcher?: Fetcher } = {}) {
  const doFetch: Fetcher = opts.fetcher ?? fetch;
  app.get('/wa-status', { preHandler: app.authenticate }, async (_request, reply) => {
    const base = process.env.WORKER_INTERNAL_URL;
    const token = process.env.INTERNAL_API_TOKEN;
    if (!base || !token) return reply.code(503).send({ error: 'worker no configurado' });
    try {
      const res = await doFetch(`${base}/internal/wa-status`, { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) return reply.code(502).send({ error: `worker respondió ${res.status}` });
      return await res.json();
    } catch {
      return reply.code(502).send({ error: 'worker inalcanzable' });
    }
  });

  async function proxyAction(path: string, reply: import('fastify').FastifyReply) {
    const base = process.env.WORKER_INTERNAL_URL;
    const token = process.env.INTERNAL_API_TOKEN;
    if (!base || !token) return reply.code(503).send({ error: 'worker no configurado' });
    try {
      const res = await doFetch(`${base}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) return reply.code(502).send({ error: `worker respondió ${res.status}` });
      return await res.json();
    } catch {
      return reply.code(502).send({ error: 'worker inalcanzable' });
    }
  }

  app.post('/wa-status/logout', { preHandler: app.authenticate }, async (_request, reply) =>
    proxyAction('/internal/wa-logout', reply),
  );
  app.post('/wa-status/reconnect', { preHandler: app.authenticate }, async (_request, reply) =>
    proxyAction('/internal/wa-reconnect', reply),
  );
}
