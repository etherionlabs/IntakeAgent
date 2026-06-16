#!/usr/bin/env tsx
/**
 * Pruebas E2E de cliente contra el InboundCoordinator REAL.
 *
 * A diferencia de `smoke-test.ts` (que replica el pipeline a mano), este arnés
 * conduce `InboundCoordinator.handleInbound()` — el MISMO código que corre en
 * producción: welcome, debouncer, gate de envío (línea ~192), persistencia y
 * notificaciones. Usa el agente REAL (OpenRouter) y la DB real.
 *
 * Objetivo: reproducir y detectar fallos como los vistos en producción:
 *   - el bot "deja de responder" (turno sin texto → silent drop)
 *   - cierra/avanza la orden sin guardar datos que el cliente acaba de dar
 *   - doble saludo, tools fallidas, campos perdidos.
 *
 * Señal de "turno completado": aparece una fila nueva en AgentRun para el
 * contacto. Si esa fila tiene responseText vacío, el coordinator NO envía nada
 * → SILENT DROP (el cliente queda esperando).
 *
 * Uso:
 *   DATABASE_URL="postgres://intake:intake@localhost:5433/intake" npm run cli:e2e 2>&1 | tee e2e.log
 */
import 'dotenv/config';
import { loadConfig, loadProfile } from '../config/loader';
import { getPrisma, disconnectPrisma } from '../storage/client';
import { InboundCoordinator, isBareGreeting } from '../pipeline/coordinator';
import { MemorySender } from '../services/outbound';
import { defaultAgentFactory } from '../agent/sdk-factory';
import { FilesystemMediaStore } from '../media/store';
import type { Transcriber } from '../media/transcriber';
import type { Notifier, OwnerReadyPayload, DisconnectPayload } from '../services/notification';
import type { RawInboundMessage } from '../pipeline/types';
import { parseJobIntake, closeJob, findOpenJobsForContact } from '../services/job';
import { upsertContactByPhone } from '../services/contact';
import { getByPath } from '../lib/path';
import { renderIntakeForModel, type FieldState } from '../services/intake';
import type { Profile } from '../config/schema';
import { ensureDevTenant } from './dev-tenant';

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m',
  magenta: '\x1b[35m', red: '\x1b[31m', blue: '\x1b[34m',
};
const c = (k: keyof typeof C, s: string) => `${C[k]}${s}${C.reset}`;

// ── Transcriber con cola: empujamos la transcripción antes de cada audio ──
class QueueTranscriber implements Transcriber {
  private q: string[] = [];
  push(t: string) { this.q.push(t); }
  async transcribe(): Promise<string | null> {
    return this.q.shift() ?? null;
  }
}

// ── Notifier que captura notificaciones al dueño ──
class CapturingNotifier implements Notifier {
  readonly ownerReady: OwnerReadyPayload[] = [];
  readonly disconnects: DisconnectPayload[] = [];
  async notifyOwnerReady(p: OwnerReadyPayload): Promise<void> { this.ownerReady.push(p); }
  async notifyDisconnect(p: DisconnectPayload): Promise<void> { this.disconnects.push(p); }
}

type Turn =
  | { kind: 'text'; text: string }
  | { kind: 'audio'; transcript: string }
  | { kind: 'image' };

interface TurnLog {
  index: number;
  input: string;
  responseText: string;
  toolCalls: { name: string; error: string | null }[];
  agentError: string | null;
  silentDrop: boolean;
  durationMs: number;
}

interface Scenario {
  name: string;
  phone: string;
  description: string;
  turns: Turn[];
  /** Aserciones sobre el estado final + log de turnos. Devuelve lista de fallos. */
  check?: (ctx: ScenarioCtx) => string[];
}

interface ScenarioCtx {
  finalStatus: string;
  flaggedNonIntake: boolean;
  intake: ReturnType<typeof parseJobIntake>;
  field: (path: string) => FieldState | undefined;
  turns: TurnLog[];
  ownerNotified: number;
  sent: string[];
}

// Helper para aserciones de campo
const has = (ctx: ScenarioCtx, path: string): boolean => {
  const f = ctx.field(path);
  return !!f && (f.value !== null || f.declined === true);
};
const valueContains = (ctx: ScenarioCtx, path: string, sub: string): boolean => {
  const f = ctx.field(path);
  return !!f && typeof f.value === 'string' && f.value.toLowerCase().includes(sub.toLowerCase());
};

const SCENARIOS: Scenario[] = [
  {
    name: 'happy_path',
    phone: '+52e2e000001',
    description: 'Intake completo paso a paso hasta READY_FOR_REVIEW.',
    turns: [
      { kind: 'text', text: 'Hola' },
      { kind: 'text', text: 'Me llamo Laura Martínez' },
      { kind: 'text', text: 'Vivo en Coyoacán, CDMX' },
      { kind: 'text', text: 'Quiero retapizar un sillón de 2 plazas, es uno solo' },
      { kind: 'text', text: 'No tengo fotos a la mano ahorita' },
      { kind: 'text', text: 'Sí, todo correcto, gracias' },
    ],
    check: (ctx) => {
      const f: string[] = [];
      if (!has(ctx, 'client.name')) f.push('nombre no guardado');
      if (!has(ctx, 'client.city_or_zone')) f.push('ciudad no guardada');
      if (!has(ctx, 'work.item_type')) f.push('mueble no guardado');
      if (!has(ctx, 'work.service_type')) f.push('tipo de trabajo no guardado');
      if (!has(ctx, 'work.quantity')) f.push('cantidad no guardada');
      if (ctx.finalStatus !== 'READY_FOR_REVIEW')
        f.push(`status final ${ctx.finalStatus}, esperado READY_FOR_REVIEW`);
      if (ctx.ownerNotified < 1) f.push('dueño NO fue notificado al marcar ready');
      return f;
    },
  },
  {
    name: 'prod_replica_pickup_address',
    phone: '+52e2e000002',
    description:
      'Réplica del caso de producción: nombre+ciudad+color, sofá, declina foto, ' +
      'pide cita, acepta recolección y da dirección. La dirección DEBE guardarse ' +
      'y NO debe haber turnos en silencio.',
    turns: [
      { kind: 'text', text: 'Hola' },
      {
        kind: 'audio',
        transcript:
          'Hola, estoy interesado en reparar unos muebles para mi casa. Quisiera cambiarle ' +
          'el tapiz, ponérselo de un color rojo. Vivo en Chicago, Illinois, y mi nombre es Pepe. ' +
          '¿Están disponibles para ese tipo de trabajo?',
      },
      {
        kind: 'audio',
        transcript:
          'Ahora mismo no tengo fotos porque ando conduciendo. Es un sofá para tres personas ' +
          'de sala, color beige, y quiero cambiarle el tapiz a rojo vino.',
      },
      { kind: 'audio', transcript: '¿Es necesario mandar la foto o puede ser solo con la descripción?' },
      {
        kind: 'audio',
        transcript:
          'No, por ahora está bien. Me gustaría agendar una cita en persona. Dígame qué horarios ' +
          'tiene disponibles y agéndeme.',
      },
      { kind: 'audio', transcript: 'Sí, necesito que vengan a recoger los muebles a Chicago, Illinois.' },
      { kind: 'audio', transcript: 'La dirección es 409 West Colfax Street, Palatine, Illinois.' },
      { kind: 'text', text: '¿Quedó registrado todo?' },
    ],
    check: (ctx) => {
      const f: string[] = [];
      if (!has(ctx, 'client.name')) f.push('nombre (Pepe) no guardado');
      if (!has(ctx, 'work.item_type')) f.push('mueble (sofá) no guardado');
      if (!has(ctx, 'logistics.pickup_needed')) f.push('pickup_needed no guardado');
      // El bug de producción: la dirección se perdió.
      if (!has(ctx, 'logistics.address'))
        f.push('⚠️ DIRECCIÓN NO GUARDADA (bug de producción reproducido)');
      else if (!valueContains(ctx, 'logistics.address', 'colfax') && !valueContains(ctx, 'logistics.address', 'palatine'))
        f.push('dirección guardada pero no coincide con lo dicho');
      if (ctx.finalStatus === 'CLOSED')
        f.push('⚠️ orden CERRADA — el cliente nunca dijo que terminó');
      return f;
    },
  },
  {
    name: 'info_dump_oneshot',
    phone: '+52e2e000003',
    description: 'Cliente vuelca toda la info en un mensaje. No re-preguntar lo ya dado.',
    turns: [
      {
        kind: 'text',
        text:
          'Hola, soy Roberto Díaz de Guadalajara, necesito reparar 3 sillas de comedor de ' +
          'madera, la tela está rota, color vino. No tengo fotos.',
      },
      { kind: 'text', text: 'Sí confirmo, está todo bien' },
    ],
    check: (ctx) => {
      const f: string[] = [];
      if (!has(ctx, 'client.name')) f.push('nombre no guardado');
      if (!has(ctx, 'work.item_type')) f.push('mueble no guardado');
      if (!has(ctx, 'work.quantity')) f.push('cantidad no guardada');
      // 3 sillas → quantity debería ser 3
      const q = ctx.field('work.quantity');
      if (q && q.value !== null && Number(q.value) !== 3)
        f.push(`cantidad=${q.value}, esperado 3`);
      return f;
    },
  },
  {
    name: 'declines_optionals',
    phone: '+52e2e000004',
    description: 'Cliente declina opcionales; no debe insistir en datos declinados.',
    turns: [
      { kind: 'text', text: 'hola buenas' },
      { kind: 'text', text: 'soy Ana y vivo en Puebla' },
      { kind: 'text', text: 'tengo una cabecera matrimonial para retapizar, una sola' },
      { kind: 'text', text: 'no sé de telas, que decida el técnico' },
      { kind: 'text', text: 'no tengo fotos ni quiero mandar' },
      { kind: 'text', text: 'ya, confirmo todo' },
    ],
    check: (ctx) => {
      const f: string[] = [];
      if (ctx.finalStatus !== 'READY_FOR_REVIEW')
        f.push(`status final ${ctx.finalStatus}, esperado READY_FOR_REVIEW`);
      return f;
    },
  },
  {
    name: 'spam_non_intake',
    phone: '+52e2e000005',
    description: 'Vendedor insistente — debe terminar flagged_non_intake.',
    turns: [
      { kind: 'text', text: 'hola' },
      { kind: 'text', text: 'le ofrezco distribución de telas al por mayor con descuento' },
      { kind: 'text', text: 'solo vendo telas, ¿les interesa comprar?' },
      { kind: 'text', text: 'es una oferta única, compren ya' },
      { kind: 'text', text: 'última oportunidad, telas baratas' },
    ],
    check: (ctx) => {
      const f: string[] = [];
      if (!ctx.flaggedNonIntake) f.push('contacto NO fue marcado como non-intake');
      return f;
    },
  },
  {
    name: 'changes_mind',
    phone: '+52e2e000006',
    description: 'Cliente corrige un dato; debe quedar el valor corregido.',
    turns: [
      { kind: 'text', text: 'Hola, soy Carmen' },
      { kind: 'text', text: 'vivo en Querétaro' },
      { kind: 'text', text: 'quiero retapizar un sofá, color azul' },
      { kind: 'text', text: 'perdón, mejor que sea color verde, no azul' },
      { kind: 'text', text: 'es un solo sofá, no tengo fotos' },
    ],
    check: (ctx) => {
      const f: string[] = [];
      if (has(ctx, 'specs.color_preference') && !valueContains(ctx, 'specs.color_preference', 'verde'))
        f.push('color no se corrigió a verde (quedó valor viejo)');
      return f;
    },
  },
  {
    name: 'only_greetings',
    phone: '+52e2e000007',
    description: 'Cliente solo saluda y manda signos; medir doble-saludo y turnos vacíos.',
    turns: [
      { kind: 'text', text: 'Hola' },
      { kind: 'text', text: '?' },
      { kind: 'text', text: 'buenas' },
    ],
    check: () => [],
  },
  {
    name: 'english_message',
    phone: '+52e2e000008',
    description: 'Cliente escribe en inglés; el bot debe responder y no romperse.',
    turns: [
      { kind: 'text', text: 'Hi, do you reupholster sofas?' },
      { kind: 'text', text: 'My name is John, I live in Houston, one 3-seat sofa, reupholster it' },
      { kind: 'text', text: 'no photos right now' },
    ],
    check: (ctx) => {
      const f: string[] = [];
      // Un cliente legítimo que escribe en inglés NO debe marcarse como spam.
      if (ctx.flaggedNonIntake) f.push('⚠️ cliente en inglés marcado como non-intake (falso spam)');
      return f;
    },
  },
  {
    name: 'greeting_then_info',
    phone: '+52e2e000009',
    description: 'Saluda, no recibe nada útil, luego da datos. Verifica fix de doble saludo.',
    turns: [
      { kind: 'text', text: 'Hola' },
      { kind: 'text', text: 'Soy Diego, vivo en Toluca' },
      { kind: 'text', text: 'quiero reparar un sofá cama, uno solo, no tengo fotos' },
    ],
    check: (ctx) => {
      const f: string[] = [];
      if (!has(ctx, 'client.name')) f.push('nombre no guardado');
      if (!has(ctx, 'work.item_type')) f.push('mueble no guardado');
      // Tras "Hola", el primer turno NO debe haber corrido el agente (welcome only)
      if (ctx.turns[0] && ctx.turns[0].responseText.trim().length > 0)
        f.push('el agente respondió al saludo inicial (doble saludo no corregido)');
      return f;
    },
  },
  {
    name: 'asks_price',
    phone: '+52e2e000010',
    description: 'Cliente pide precio/tiempo. El bot NO debe inventar precios (regla dura).',
    turns: [
      { kind: 'text', text: 'Hola, ¿cuánto cuesta retapizar un sillón?' },
      { kind: 'text', text: 'pero dame un estimado aunque sea aproximado en pesos' },
      { kind: 'text', text: 'soy Marta de León, un sillón de 1 plaza, no tengo fotos' },
    ],
    check: (ctx) => {
      const f: string[] = [];
      // Heurística: el bot no debería dar una cifra monetaria concreta inventada.
      const moneyRe = /\$\s?\d|\d+\s?(pesos|mxn|usd|dólares|dolares)/i;
      const invented = ctx.turns.find((t) => moneyRe.test(t.responseText));
      if (invented) f.push(`⚠️ posible precio inventado en turno #${invented.index}: "${invented.responseText.slice(0, 80)}"`);
      return f;
    },
  },
  {
    name: 'vague_uncertain',
    phone: '+52e2e000011',
    description: 'Respuestas vagas ("no sé", "tal vez"); el bot debe reconducir sin trabarse.',
    turns: [
      { kind: 'text', text: 'hola' },
      { kind: 'text', text: 'pues no sé bien, algo de un mueble' },
      { kind: 'text', text: 'soy Luis' },
      { kind: 'text', text: 'tal vez un sillón, no estoy seguro' },
      { kind: 'text', text: 'vivo en Mérida, es uno, retapizar, sin fotos' },
    ],
    check: (ctx) => {
      const f: string[] = [];
      if (!has(ctx, 'client.name')) f.push('nombre no guardado pese a darlo');
      return f;
    },
  },
  {
    name: 'multi_furniture',
    phone: '+52e2e000012',
    description: 'Cliente menciona 2 muebles distintos; no debe perder info ni romperse.',
    turns: [
      { kind: 'text', text: 'Hola, soy Sofía de Cancún' },
      { kind: 'text', text: 'tengo un sillón para retapizar y también 4 sillas de comedor para reparar' },
      { kind: 'text', text: 'no tengo fotos por ahora' },
      { kind: 'text', text: '¿quedó anotado todo?' },
    ],
    check: (ctx) => {
      const f: string[] = [];
      if (!has(ctx, 'client.name')) f.push('nombre no guardado');
      if (!has(ctx, 'work.item_type')) f.push('mueble no guardado');
      return f;
    },
  },
  {
    name: 'extra_after_ready',
    phone: '+52e2e000013',
    description: 'Tras completar y confirmar, el cliente agrega un dato más. No debe romperse.',
    turns: [
      { kind: 'text', text: 'Hola, soy Pablo de Tijuana' },
      { kind: 'text', text: 'un sillón de 3 plazas para retapizar, uno solo, sin fotos' },
      { kind: 'text', text: 'sí, confirmo todo' },
      { kind: 'text', text: 'ah, se me olvidó: quiero la tela en color gris' },
    ],
    check: (ctx) => {
      const f: string[] = [];
      // El color agregado al final debería poder registrarse aunque ya esté ready.
      if (has(ctx, 'specs.color_preference') && !valueContains(ctx, 'specs.color_preference', 'gris'))
        f.push('color gris no se registró tras la confirmación');
      return f;
    },
  },
  {
    name: 'rambling_audio',
    phone: '+52e2e000014',
    description: 'Audio largo y desordenado con varios datos mezclados; debe extraerlos.',
    turns: [
      { kind: 'text', text: 'Hola' },
      {
        kind: 'audio',
        transcript:
          'Eh, mira, qué tal, fíjate que tengo aquí en la casa un sillón viejo de mi abuela, ' +
          'bien bonito pero está todo gastado, eh, me llamo Gabriela por cierto, vivo allá por ' +
          'la zona de Satélite en el Estado de México, y pues quiero que me lo retapicen, es nada ' +
          'más ese uno, eh, no tengo fotos ahorita pero luego te mando.',
      },
      { kind: 'text', text: 'sí, todo bien, gracias' },
    ],
    check: (ctx) => {
      const f: string[] = [];
      if (!has(ctx, 'client.name')) f.push('nombre (Gabriela) no extraído del audio');
      if (!has(ctx, 'work.item_type')) f.push('mueble (sillón) no extraído del audio');
      if (!has(ctx, 'client.city_or_zone')) f.push('zona (Satélite) no extraída del audio');
      return f;
    },
  },
];

// ── Espera a que aparezca una nueva fila AgentRun para el contacto ──
async function waitForAgentRun(
  prisma: ReturnType<typeof getPrisma>,
  tenantId: string,
  contactId: string,
  beforeCount: number,
  timeoutMs = 60000,
): Promise<{ responseText: string; toolCalls: { name: string; error: string | null }[]; error: string | null } | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await prisma.agentRun.count({ where: { tenantId, job: { contactId } } });
    if (count > beforeCount) {
      const latest = await prisma.agentRun.findFirst({
        where: { tenantId, job: { contactId } },
        orderBy: { createdAt: 'desc' },
      });
      if (latest) {
        let tools: { name: string; error: string | null }[] = [];
        try {
          tools = (JSON.parse(latest.toolCalls) as any[]).map((t) => ({ name: t.name, error: t.error ?? null }));
        } catch { /* ignore */ }
        return { responseText: latest.responseText ?? '', toolCalls: tools, error: latest.error };
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

async function resetContact(prisma: ReturnType<typeof getPrisma>, tenantId: string, phone: string): Promise<void> {
  const contact = await upsertContactByPhone(prisma, tenantId, phone);
  const open = await findOpenJobsForContact(prisma, tenantId, contact.id);
  for (const j of open) {
    try { await closeJob(prisma, tenantId, j.id); } catch { /* IN_PROGRESS */ }
  }
  await prisma.agentRun.deleteMany({ where: { tenantId, job: { contactId: contact.id } } });
  await prisma.message.deleteMany({ where: { tenantId, contactId: contact.id } });
  await prisma.job.deleteMany({ where: { tenantId, contactId: contact.id } });
  await prisma.contact.update({
    where: { id: contact.id, tenantId },
    data: { botActive: true, flaggedNonIntake: false, flaggedReason: null },
  });
}

async function runScenario(
  s: Scenario,
  deps: {
    prisma: ReturnType<typeof getPrisma>;
    tenantId: string;
    coordinator: InboundCoordinator;
    sender: MemorySender;
    notifier: CapturingNotifier;
    transcriber: QueueTranscriber;
    profile: Profile;
  },
): Promise<{ name: string; failures: string[]; turns: TurnLog[]; description: string }> {
  const { prisma, tenantId, coordinator, sender, notifier, transcriber, profile } = deps;
  console.log(c('cyan', `\n━━━ ${s.name} (${s.phone}) ━━━`));
  console.log(c('dim', s.description));

  await resetContact(prisma, tenantId, s.phone);
  sender.clear();
  notifier.ownerReady.length = 0;

  const contact = await upsertContactByPhone(prisma, tenantId, s.phone);
  const turns: TurnLog[] = [];

  for (let i = 0; i < s.turns.length; i++) {
    const turn = s.turns[i];
    const inputLabel =
      turn.kind === 'text' ? turn.text : turn.kind === 'audio' ? `🎤 ${turn.transcript}` : '📷 (foto)';
    console.log(c('green', `[${i + 1}] cliente: `) + inputLabel);

    if (turn.kind === 'audio') transcriber.push(turn.transcript);

    const raw: RawInboundMessage = {
      whatsappMsgId: `e2e_${s.name}_${i}_${Date.now()}`,
      fromPhoneE164: s.phone,
      chatKind: 'individual',
      fromMe: false,
      kind: turn.kind === 'image' ? 'image' : turn.kind === 'audio' ? 'audio' : 'text',
      text: turn.kind === 'text' ? turn.text : null,
      media:
        turn.kind === 'text'
          ? null
          : { buffer: Buffer.from('dummy-media'), mimetype: turn.kind === 'audio' ? 'audio/ogg' : 'image/jpeg' },
      raw: { source: 'e2e' },
      receivedAt: new Date().toISOString(),
    };

    const beforeRuns = await prisma.agentRun.count({ where: { tenantId, job: { contactId: contact.id } } });
    const beforeSent = sender.sent.length;
    const t0 = Date.now();

    // Primer mensaje solo-saludo: el coordinator envía welcome y NO corre el
    // agente (fix anti doble-saludo). No esperamos AgentRun en ese caso.
    const expectWelcomeOnly = i === 0 && turn.kind === 'text' && isBareGreeting(turn.text);

    await coordinator.handleInbound(raw);
    const run = expectWelcomeOnly ? null : await waitForAgentRun(prisma, tenantId, contact.id, beforeRuns);
    const durationMs = Date.now() - t0;

    // Casos donde NO correr el agente es lo esperado (no un timeout-bug):
    //  - welcome-only en el primer saludo
    //  - contacto flagged/pausado (el bot deja de responder a propósito)
    const cNow = await prisma.contact.findFirst({ where: { tenantId, id: contact.id } });
    const expectedSilent = expectWelcomeOnly || (run === null && (!cNow?.botActive || cNow?.flaggedNonIntake));

    const sentThisTurn = sender.sent.slice(beforeSent).map((m) => m.text);
    // welcome se envía sync; lo separamos del texto del agente
    const agentText = run?.responseText ?? '';
    const silentDrop = run !== null && agentText.trim().length === 0;

    turns.push({
      index: i + 1,
      input: inputLabel,
      responseText: agentText,
      toolCalls: run?.toolCalls ?? [],
      agentError: run?.error ?? (run === null && !expectedSilent ? 'TIMEOUT esperando AgentRun' : null),
      silentDrop,
      durationMs,
    });

    for (const t of sentThisTurn) console.log(c('magenta', '    bot: ') + t.slice(0, 220));
    if (run) {
      const toolSummary = run.toolCalls.map((t) => `${t.name}${t.error ? '✗' : '✓'}`).join(' ') || '—';
      console.log(c('dim', `    [tools] ${toolSummary} · ${(durationMs / 1000).toFixed(1)}s`));
      for (const t of run.toolCalls.filter((t) => t.error)) console.log(c('red', `      ✗ ${t.name}: ${t.error}`));
      if (run.error) console.log(c('red', `    error agente: ${run.error}`));
      if (silentDrop) console.log(c('red', '    ⚠️ SILENT DROP: turno sin texto → cliente NO recibe nada'));
    } else if (expectWelcomeOnly) {
      console.log(c('dim', '    (solo welcome — no se corre el agente para evitar doble saludo, esperado)'));
    } else if (expectedSilent) {
      console.log(c('dim', '    (bot en silencio — contacto flagged/pausado, esperado)'));
    } else {
      console.log(c('red', '    ⚠️ TIMEOUT: no se registró AgentRun'));
    }
  }

  // Estado final
  const job = await prisma.job.findFirst({
    where: { tenantId, contactId: contact.id },
    orderBy: { openedAt: 'desc' },
  });
  const freshContact = await prisma.contact.findFirst({ where: { tenantId, id: contact.id } });
  const intake = job ? parseJobIntake(job) : (parseJobIntake as any)({ intake: '{}' });

  // Volcado del intake final: verdad de campo para distinguir bug de artefacto.
  if (job) {
    console.log(c('blue', '    ── intake final ──'));
    for (const line of renderIntakeForModel(profile.intakeSchema, intake, { jobId: job.id.slice(0, 8), status: job.status }).split('\n')) {
      console.log(c('dim', '    ' + line));
    }
  }

  const ctx: ScenarioCtx = {
    finalStatus: job?.status ?? 'NO_JOB',
    flaggedNonIntake: freshContact?.flaggedNonIntake ?? false,
    intake,
    field: (path: string) => getByPath(intake, path) as FieldState | undefined,
    turns,
    ownerNotified: notifier.ownerReady.length,
    sent: sender.sent.map((m) => m.text),
  };

  // Aserciones automáticas (todos los escenarios) + específicas
  const failures: string[] = [];
  const silent = turns.filter((t) => t.silentDrop);
  if (silent.length > 0) failures.push(`${silent.length} turno(s) en SILENCIO (silent drop): #${silent.map((t) => t.index).join(', ')}`);
  const timeouts = turns.filter((t) => t.agentError === 'TIMEOUT esperando AgentRun');
  if (timeouts.length > 0) failures.push(`${timeouts.length} turno(s) con TIMEOUT`);
  const errored = turns.filter((t) => t.agentError && t.agentError !== 'TIMEOUT esperando AgentRun');
  if (errored.length > 0) failures.push(`${errored.length} turno(s) con error de agente`);
  // El rechazo de mark_ready_for_review por intake incompleto es defensa-en-
  // profundidad sana (el agente reintenta y completa), no un bug. Solo contamos
  // como falla los errores de OTRAS tools (ej. update_intake con path/enum malo).
  const toolFails = turns.reduce(
    (n, t) => n + t.toolCalls.filter((x) => x.error && x.name !== 'mark_ready_for_review').length,
    0,
  );
  if (toolFails > 0) failures.push(`${toolFails} llamada(s) a tools fallidas (no-guard)`);

  if (s.check) failures.push(...s.check(ctx));

  return { name: s.name, failures, turns, description: s.description };
}

async function main() {
  const config = await loadConfig('./config.json');
  // Bajar el debounce para que los flushes ocurran rápido en pruebas.
  (config as any).debounceMs = 300;
  const profile = await loadProfile(config.profile);
  const prisma = getPrisma();
  const tenantId = await ensureDevTenant(prisma);

  const sender = new MemorySender();
  const notifier = new CapturingNotifier();
  const transcriber = new QueueTranscriber();
  const mediaStore = new FilesystemMediaStore(config.media.storeDir);

  const coordinator = new InboundCoordinator({
    prisma,
    tenantId,
    config,
    profile,
    notifier,
    sender,
    transcriber,
    mediaStore,
    agentFactory: defaultAgentFactory,
    now: () => new Date(),
  });

  console.log(c('bold', '\n╔══ Pruebas E2E de cliente (coordinator real) ══╗'));
  console.log(c('dim', `Modelo: ${config.model} · Perfil: ${profile.intakeSchema.$businessName}`));
  console.log(c('dim', `Escenarios: ${SCENARIOS.length} · debounceMs=${(config as any).debounceMs}`));

  const results: Awaited<ReturnType<typeof runScenario>>[] = [];
  for (const s of SCENARIOS) {
    try {
      results.push(await runScenario(s, { prisma, tenantId, coordinator, sender, notifier, transcriber, profile }));
    } catch (err) {
      results.push({
        name: s.name,
        description: s.description,
        failures: [`EXCEPCIÓN: ${err instanceof Error ? err.message : String(err)}`],
        turns: [],
      });
    }
  }

  // ── Resumen ──
  console.log(c('bold', '\n\n╔══════════════ RESUMEN ══════════════╗\n'));
  let passed = 0;
  for (const r of results) {
    const ok = r.failures.length === 0;
    if (ok) passed++;
    console.log(`${ok ? c('green', '✓') : c('red', '✗')} ${r.name}`);
    for (const f of r.failures) console.log(c('red', `    ↳ ${f}`));
  }
  console.log(c('bold', `\n${passed}/${results.length} escenarios sin fallos.\n`));

  // Bugs agregados a nivel de turno
  const totalSilent = results.reduce((n, r) => n + r.turns.filter((t) => t.silentDrop).length, 0);
  const totalTimeout = results.reduce((n, r) => n + r.turns.filter((t) => t.agentError === 'TIMEOUT esperando AgentRun').length, 0);
  const totalToolFail = results.reduce((n, r) => n + r.turns.reduce((m, t) => m + t.toolCalls.filter((x) => x.error).length, 0), 0);
  console.log(c('bold', '── Diagnóstico agregado ──'));
  console.log(`Silent drops (cliente sin respuesta): ${totalSilent > 0 ? c('red', String(totalSilent)) : c('green', '0')}`);
  console.log(`Timeouts: ${totalTimeout > 0 ? c('red', String(totalTimeout)) : c('green', '0')}`);
  console.log(`Tool calls fallidas: ${totalToolFail > 0 ? c('yellow', String(totalToolFail)) : c('green', '0')}`);

  await disconnectPrisma();
  process.exit(results.every((r) => r.failures.length === 0) ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
