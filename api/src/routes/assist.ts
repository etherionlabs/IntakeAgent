import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getTenantProfile } from '../lib/tenant-profile';
import {
  assistAvailable,
  configChat,
  suggestFacts,
  suggestFields,
  suggestWelcome,
  ChatTurnZ,
  ConfigSnapshotZ,
  type AssistDeps,
} from '../services/assist';

const BodyZ = z.object({
  action: z.enum(['facts', 'fields', 'welcome']),
  text: z.string().max(4000).default(''),
});

/**
 * El hilo lo lleva el panel y lo manda entero en cada turno. Se acota a 30
 * mensajes porque cada uno viaja al modelo: sin tope, una conversación larga
 * encarece el turno sin límite. El panel recorta por su lado.
 */
const ChatBodyZ = z.object({
  messages: z.array(ChatTurnZ).min(1).max(30),
  // Opcional: si el panel no lo manda, el asistente arranca con el formulario vacío.
  snapshot: ConfigSnapshotZ.optional(),
});

const EMPTY_SNAPSHOT = ConfigSnapshotZ.parse({});

function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.authUser?.role !== 'admin') {
    reply.code(403).send({ error: 'requiere rol admin' });
    return false;
  }
  return true;
}

export async function assistRoutes(app: FastifyInstance, opts: { assistDeps?: AssistDeps } = {}) {
  const deps = opts.assistDeps ?? {};

  /**
   * Propone configuración a partir de lo que el dueño escribe en sus palabras.
   * NO guarda nada: devuelve una sugerencia para revisar en el panel.
   * Limitado por tenant porque cada llamada cuesta dinero real.
   */
  app.post('/settings/assist', {
    preHandler: app.authenticate,
    config: { rateLimit: { max: 20, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parse = BodyZ.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: parse.error.message });
    if (!assistAvailable(deps)) {
      return reply.code(503).send({ error: 'el asistente de configuración no está disponible' });
    }

    const profile = await getTenantProfile(request.tenantId);
    const ctx = {
      businessName: profile.intakeSchema.$businessName,
      businessDomain: profile.intakeSchema.$businessDomain,
    };
    const { action, text } = parse.data;

    if (action !== 'welcome' && text.trim().length < 10) {
      return reply.code(400).send({ error: 'escribe un poco más para poder proponerte algo' });
    }

    const result =
      action === 'facts' ? await suggestFacts(text, ctx, deps)
      : action === 'fields' ? await suggestFields(text, ctx, deps)
      : await suggestWelcome(text, ctx, deps);

    // null = el modelo no respondió o devolvió algo que no se puede usar. Es un
    // fallo esperable: el panel lo dice y el dueño sigue a mano.
    if (!result) {
      return reply.code(502).send({ error: 'no se pudo generar una propuesta, inténtalo de nuevo' });
    }
    return { ok: true, suggestion: result };
  });

  /**
   * Un turno del asistente conversacional que acompaña TODA la configuración.
   * Igual que /settings/assist: propone, no guarda. La diferencia es que aquí
   * hay hilo, así que el asistente sabe qué falta por cubrir y pregunta por ello.
   */
  app.post('/settings/assist/chat', {
    preHandler: app.authenticate,
    config: { rateLimit: { max: 40, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parse = ChatBodyZ.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: parse.error.message });
    if (!assistAvailable(deps)) {
      return reply.code(503).send({ error: 'el asistente de configuración no está disponible' });
    }

    // El último mensaje tiene que ser del dueño: si no, el panel estaría pidiendo
    // que el asistente hable dos veces seguidas.
    const messages = parse.data.messages;
    if (messages[messages.length - 1].role !== 'user') {
      return reply.code(400).send({ error: 'el último mensaje debe ser del usuario' });
    }

    const result = await configChat(messages, parse.data.snapshot ?? EMPTY_SNAPSHOT, deps);
    if (!result) {
      return reply.code(502).send({ error: 'no se pudo continuar la conversación, inténtalo de nuevo' });
    }
    return { ok: true, ...result };
  });

  /** Le dice al panel si puede ofrecer los botones de sugerencia. */
  app.get('/settings/assist/status', { preHandler: app.authenticate }, async () => ({
    available: assistAvailable(deps),
  }));
}
