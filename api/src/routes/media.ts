import type { FastifyInstance } from 'fastify';
import { getPrisma } from '../db';
import { resolveManagerUrl } from '../lib/manager-url';

type Fetcher = typeof fetch;

/**
 * Sirve al panel las imágenes (fotos entrantes y previsualizaciones) de un tenant.
 *
 * La API AUTORIZA (busca el mensaje por tenant + kind='image') pero NO tiene el
 * volumen de media: el worker es su dueño. Así que proxya el archivo al servidor
 * interno del worker (`/internal/media`), igual que wa-status. Esto funciona tanto
 * en docker-compose como en Railway (donde un volumen no se comparte entre
 * servicios), sin necesidad de object storage externo.
 */
export async function mediaRoutes(app: FastifyInstance, opts: { fetcher?: Fetcher } = {}) {
  const doFetch: Fetcher = opts.fetcher ?? fetch;

  app.get('/messages/:id/media', { preHandler: app.authenticate }, async (request: any, reply) => {
    const prisma = getPrisma();
    const id = (request.params as any).id as string;
    const tenantId = request.tenantId as string;

    const msg = await prisma.message.findFirst({
      where: { id, tenantId, kind: 'image' },
      select: { mediaPath: true },
    });
    if (!msg || !msg.mediaPath) return reply.code(404).send({ error: 'imagen no encontrada' });

    const base = resolveManagerUrl(tenantId);
    const token = process.env.INTERNAL_API_TOKEN;
    if (!base || !token) return reply.code(503).send({ error: 'worker no configurado' });

    try {
      const url = `${base}/internal/media?tenantId=${encodeURIComponent(tenantId)}&path=${encodeURIComponent(msg.mediaPath)}`;
      const res = await doFetch(url, { headers: { authorization: `Bearer ${token}` } });
      if (res.status === 404) return reply.code(404).send({ error: 'archivo no disponible' });
      if (!res.ok) return reply.code(502).send({ error: `worker respondió ${res.status}` });
      const buf = Buffer.from(await res.arrayBuffer());
      return reply
        .type(res.headers.get('content-type') ?? 'application/octet-stream')
        .header('cache-control', 'private, max-age=300')
        .send(buf);
    } catch {
      return reply.code(502).send({ error: 'worker inalcanzable' });
    }
  });
}
