#!/usr/bin/env tsx
/**
 * Chat por consola — simula un cliente conversando con el agente, sin WhatsApp.
 *
 * Reusa toda la pila (config, perfil, intake, agente, tools, persistencia) pero
 * salta el adapter Baileys y el debouncer. Cada línea que tipeas es un mensaje
 * inbound que dispara `runAgentTurn` inmediatamente; la respuesta se imprime.
 *
 * Uso:
 *   npm run cli:chat                       # contacto por defecto +15550009999
 *   npm run cli:chat -- +5215551234567     # contacto custom (cualquier identificador)
 *
 * Comandos especiales en el prompt:
 *   /quit          → salir
 *   /state         → muestra el intake actual del job
 *   /history       → muestra los últimos 10 mensajes
 *   /reset         → cierra el job actual y empieza uno nuevo
 *   /flush         → recarga config.json (hot-reload)
 */
// Carga .env antes que cualquier otro import lea process.env.
import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { loadProfile, ConfigCache } from '../config/loader';
import { getPrisma, disconnectPrisma } from '../storage/client';
import { FilesystemMediaStore } from '../media/store';
import { NoopTranscriber } from '../media/transcriber';
import { NoopNotifier } from '../services/notification';
import { resolveContact } from '../pipeline/resolveContact';
import { resolveJobForMessage } from '../pipeline/resolveJob';
import {
  parseJobIntake,
  closeJob,
  findOpenJobsForContact,
} from '../services/job';
import { runAgentTurn } from '../agent/runner';
import { defaultAgentFactory } from '../agent/sdk-factory';
import { renderIntakeForModel } from '../services/intake';
import { upsertContactByPhone } from '../services/contact';

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
};

const c = (color: keyof typeof COLORS, s: string) => `${COLORS[color]}${s}${COLORS.reset}`;

async function main() {
  const phone = process.argv[2] || '+15550009999';
  const cache = new ConfigCache('./config.json', { warn: (m) => console.warn(m) });
  let { config, profile } = await cache.refresh();
  const prisma = getPrisma();

  const mediaStore = new FilesystemMediaStore(config.media.storeDir);
  const transcriber = new NoopTranscriber();
  const notifier = new NoopNotifier();

  console.log(c('cyan', `\n=== Chat simulado · ${profile.intakeSchema.$businessName} ===`));
  console.log(c('dim', `Contacto simulado: ${phone}`));
  console.log(c('dim', 'Comandos: /quit · /state · /history · /reset · /flush · /help'));
  console.log(c('dim', 'Tipea cualquier otra cosa y será tratada como mensaje del cliente.\n'));

  const rl = readline.createInterface({ input, output });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(c('dim', '\nCerrando…'));
    rl.close();
    await disconnectPrisma();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());

  // Welcome del perfil si es el primer mensaje (lo replicamos manualmente).
  let welcomeSent = false;

  while (!shuttingDown) {
    let userText: string;
    try {
      userText = (await rl.question(c('green', '> '))).trim();
    } catch {
      break; // EOF
    }
    if (!userText) continue;

    // Comandos
    if (userText === '/quit' || userText === '/exit') break;
    if (userText === '/help') {
      console.log(c('dim', 'Comandos: /quit · /state · /history · /reset · /flush · /help'));
      continue;
    }
    if (userText === '/state') {
      await showState(prisma, phone, profile);
      continue;
    }
    if (userText === '/history') {
      await showHistory(prisma, phone);
      continue;
    }
    if (userText === '/reset') {
      await resetContact(prisma, phone);
      welcomeSent = false;
      console.log(c('yellow', '✓ jobs abiertos cerrados — empezando de cero'));
      continue;
    }
    if (userText === '/flush') {
      const r = await cache.refresh();
      config = r.config;
      profile = r.profile;
      console.log(c('yellow', '✓ config recargado'));
      continue;
    }

    try {
      // 1. Resolver contacto + job
      const contactRes = await resolveContact(prisma, phone);
      if (!contactRes.shouldRespond) {
        console.log(c('red', `bot pausado/flagged (${(contactRes as any).reason}). Usa /reset.`));
        continue;
      }
      const jobRes = await resolveJobForMessage(
        prisma,
        profile.intakeSchema,
        contactRes.contact.id,
        'cli',
      );

      // 2. Persistir el mensaje inbound
      const message = await prisma.message.create({
        data: {
          contactId: contactRes.contact.id,
          jobId: jobRes.job.id,
          direction: 'inbound',
          kind: 'text',
          body: userText,
          whatsappMsgId: `cli_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          raw: JSON.stringify({ source: 'cli-chat' }),
        },
      });

      // 3. Si es primer mensaje, mostrar welcome
      if (jobRes.isFirstMessage && !welcomeSent) {
        const welcome = applyTemplate(profile.welcome, {
          businessName: profile.intakeSchema.$businessName,
          businessDomain: profile.intakeSchema.$businessDomain,
        });
        console.log(c('magenta', `bot: `) + welcome);
        await prisma.message.create({
          data: {
            jobId: jobRes.job.id,
            contactId: contactRes.contact.id,
            direction: 'outbound',
            kind: 'text',
            body: welcome,
          },
        });
        welcomeSent = true;
      }

      // 4. Cargar historial reciente (excluyendo el mensaje recién creado)
      const historyRaw = await prisma.message.findMany({
        where: { jobId: jobRes.job.id, id: { not: message.id } },
        orderBy: { createdAt: 'desc' },
        take: 12,
      });
      const recentHistory = historyRaw.reverse().map((m) => ({
        direction: m.direction as 'inbound' | 'outbound',
        kind: m.kind as 'text' | 'image' | 'audio' | 'sticker' | 'location' | 'other',
        body: m.body,
        createdAt: m.createdAt.toISOString(),
      }));

      // 5. Listar otros jobs abiertos (para multi-job)
      const allOpen = await prisma.job.findMany({
        where: {
          contactId: contactRes.contact.id,
          status: { in: ['OPEN_INTAKE', 'READY_FOR_REVIEW'] },
          NOT: { id: jobRes.job.id },
        },
        orderBy: { openedAt: 'asc' },
      });

      // 6. Ejecutar agente
      console.log(c('dim', '(pensando…)'));
      const result = await runAgentTurn(
        {
          job: jobRes.job,
          contact: contactRes.contact,
          intake: parseJobIntake(jobRes.job),
          batchMessages: [
            { id: message.id, kind: 'text', body: userText, mediaPath: null },
          ],
          otherOpenJobs: allOpen.map((j) => ({
            id: j.id,
            summary: j.summary,
            openedAt: j.openedAt,
          })),
          now: new Date().toISOString(),
          recentHistory,
        },
        {
          prisma,
          config,
          profile,
          notifier,
          createAgent: defaultAgentFactory,
        },
      );

      if (result.error) {
        console.log(c('red', `error: ${result.error}`));
      }

      // 7. Imprimir respuesta + persistirla como outbound
      if (result.responseText) {
        console.log(c('magenta', `bot: `) + result.responseText);
        await prisma.message.create({
          data: {
            jobId: jobRes.job.id,
            contactId: contactRes.contact.id,
            direction: 'outbound',
            kind: 'text',
            body: result.responseText,
          },
        });
      }
      // 8. Mostrar tool calls. Si alguna falló, muestra args + error para debug.
      if (result.toolCalls.length > 0) {
        const hasFailures = result.toolCalls.some((t) => t.error);
        const summary = result.toolCalls
          .map((t) => `${t.name}${t.error ? '✗' : '✓'}`)
          .join(' · ');
        console.log(
          c('dim', `[tools] ${summary} · tokens ${result.inputTokens}/${result.outputTokens}`),
        );
        if (hasFailures) {
          for (const t of result.toolCalls) {
            if (t.error) {
              const argsStr = JSON.stringify(t.args).slice(0, 200);
              console.log(c('red', `  ✗ ${t.name}: ${t.error}`));
              console.log(c('dim', `    args: ${argsStr}`));
            }
          }
        }
      }
      if (!result.responseText) {
        console.log(c('yellow', '(agente terminó sin responder texto)'));
      }
    } catch (err) {
      console.log(c('red', `excepción: ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  await shutdown();
}

async function showState(
  prisma: ReturnType<typeof getPrisma>,
  phone: string,
  profile: Awaited<ReturnType<typeof loadProfile>>,
): Promise<void> {
  const contact = await prisma.contact.findUnique({ where: { phoneE164: phone } });
  if (!contact) {
    console.log(c('dim', 'sin contacto aún'));
    return;
  }
  const job = await prisma.job.findFirst({
    where: { contactId: contact.id, status: { in: ['OPEN_INTAKE', 'READY_FOR_REVIEW'] } },
    orderBy: { openedAt: 'desc' },
  });
  if (!job) {
    console.log(c('dim', 'sin job abierto'));
    return;
  }
  console.log(
    c(
      'cyan',
      renderIntakeForModel(profile.intakeSchema, parseJobIntake(job), {
        jobId: job.id,
        status: job.status,
      }),
    ),
  );
}

async function showHistory(
  prisma: ReturnType<typeof getPrisma>,
  phone: string,
): Promise<void> {
  const contact = await prisma.contact.findUnique({ where: { phoneE164: phone } });
  if (!contact) {
    console.log(c('dim', 'sin contacto aún'));
    return;
  }
  const msgs = await prisma.message.findMany({
    where: { contactId: contact.id },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  for (const m of msgs.reverse()) {
    const prefix = m.direction === 'inbound' ? c('green', 'cliente: ') : c('magenta', 'bot:     ');
    console.log(prefix + (m.body ?? `(${m.kind})`));
  }
}

async function resetContact(
  prisma: ReturnType<typeof getPrisma>,
  phone: string,
): Promise<void> {
  const contact = await upsertContactByPhone(prisma, phone);
  const open = await findOpenJobsForContact(prisma, contact.id);
  for (const j of open) {
    try {
      await closeJob(prisma, j.id);
    } catch {
      // Job en estado IN_PROGRESS — no se puede cerrar desde aquí, lo dejamos.
    }
  }
  // Reactivar bot si estaba pausado o flagged.
  await prisma.contact.update({
    where: { id: contact.id },
    data: { botActive: true, flaggedNonIntake: false, flaggedReason: null },
  });
}

function applyTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
