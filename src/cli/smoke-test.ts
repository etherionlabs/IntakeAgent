#!/usr/bin/env tsx
/**
 * Smoke test profundo del agente.
 *
 * Ejecuta varios escenarios de conversación contra el modelo REAL (consume
 * tokens) sin necesidad de WhatsApp. Cada escenario usa un teléfono simulado
 * único y termina reportando el resultado.
 *
 * Uso:
 *   npm run cli:smoke 2>&1 | tee smoke.log
 */
import 'dotenv/config';
import { loadConfig, loadProfile } from '../config/loader';
import { getPrisma, disconnectPrisma } from '../storage/client';
import { NoopNotifier } from '../services/notification';
import { resolveContact } from '../pipeline/resolveContact';
import { resolveJobForMessage } from '../pipeline/resolveJob';
import {
  parseJobIntake,
  closeJob,
  findOpenJobsForContact,
} from '../services/job';
import { upsertContactByPhone } from '../services/contact';
import { runAgentTurn } from '../agent/runner';
import { defaultAgentFactory } from '../agent/sdk-factory';
import { renderIntakeForModel } from '../services/intake';
import { ensureDevTenant } from './dev-tenant';

interface Scenario {
  name: string;
  phone: string;
  messages: string[];
  expect: {
    /** Si true, el job debería terminar en READY_FOR_REVIEW. */
    readyForReview?: boolean;
    /** Si true, el contacto debería terminar flagged_non_intake. */
    flaggedNonIntake?: boolean;
  };
}

const SCENARIOS: Scenario[] = [
  {
    name: 'happy_path',
    phone: '+52551000001',
    messages: [
      'hola',
      'mi nombre es María González',
      'vivo en Polanco, CDMX',
      'quiero retapizar un sillón de 3 plazas, es un solo mueble',
      'la tela preferida es lino color beige',
      'no tengo medidas exactas pero es un sillón estándar',
      'sí, todo correcto',
    ],
    expect: { readyForReview: true },
  },
  {
    name: 'info_dumping',
    phone: '+52551000002',
    messages: [
      'hola, soy Juan Pérez de Guadalajara y necesito reparar 2 sillas de comedor de madera, tela bordada azul',
      'no tengo medidas',
      'sí confirmo',
    ],
    expect: { readyForReview: true },
  },
  {
    name: 'declines_optional',
    phone: '+52551000003',
    messages: [
      'hola buenas',
      'soy Pedro y vivo en Monterrey',
      'tengo una cabecera matrimonial que necesito retapizar, una sola',
      'no sé qué tela quiero, decide el técnico',
      'no tengo color preferido',
      'no tengo medidas exactas',
      'ya confirmo todo',
    ],
    expect: { readyForReview: true },
  },
  {
    name: 'off_topic_spam',
    phone: '+52551000004',
    messages: [
      'hola',
      'me interesa vender productos en su tienda',
      'ofrezco distribución de telas al por mayor con descuento',
      'solo vendo telas, ¿les interesa?',
      'es una oferta única',
    ],
    expect: { flaggedNonIntake: true },
  },
];

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  bold: '\x1b[1m',
};
const c = (color: keyof typeof COLORS, s: string) =>
  `${COLORS[color]}${s}${COLORS.reset}`;

interface ScenarioResult {
  name: string;
  phone: string;
  messagesSent: number;
  responsesReceived: number;
  toolCallsTotal: number;
  toolCallsFailed: number;
  tokensIn: number;
  tokensOut: number;
  finalStatus: string;
  intakeComplete: boolean;
  flaggedNonIntake: boolean;
  passedExpectations: boolean;
  errors: string[];
  durationMs: number;
}

async function resetContact(prisma: any, tenantId: string, phone: string): Promise<void> {
  const contact = await upsertContactByPhone(prisma, tenantId, phone);
  const open = await findOpenJobsForContact(prisma, tenantId, contact.id);
  for (const j of open) {
    try {
      await closeJob(prisma, tenantId, j.id);
    } catch {}
  }
  await prisma.message.deleteMany({ where: { tenantId, contactId: contact.id } });
  await prisma.contact.update({
    where: { id: contact.id, tenantId },
    data: { botActive: true, flaggedNonIntake: false, flaggedReason: null },
  });
}

async function runScenario(
  scenario: Scenario,
  prisma: any,
  tenantId: string,
  config: any,
  profile: any,
): Promise<ScenarioResult> {
  const start = Date.now();
  console.log(c('cyan', `\n━━━ Escenario: ${scenario.name} (${scenario.phone}) ━━━`));

  await resetContact(prisma, tenantId, scenario.phone);

  let responsesReceived = 0;
  let toolCallsTotal = 0;
  let toolCallsFailed = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  const errors: string[] = [];

  for (let i = 0; i < scenario.messages.length; i++) {
    const userText = scenario.messages[i];
    console.log(c('green', `[${i + 1}] cliente: `) + userText);

    try {
      const contactRes = await resolveContact(prisma, tenantId, scenario.phone);
      if (!contactRes.shouldRespond) {
        console.log(
          c('yellow', `  (bot pausado/flagged: ${(contactRes as any).reason}) — fin del escenario`),
        );
        break;
      }
      const jobRes = await resolveJobForMessage(
        prisma,
        tenantId,
        profile.intakeSchema,
        contactRes.contact.id,
        'smoke',
      );

      const message = await prisma.message.create({
        data: {
          tenantId,
          contactId: contactRes.contact.id,
          jobId: jobRes.job.id,
          direction: 'inbound',
          kind: 'text',
          body: userText,
          externalMsgId: `smoke_${scenario.name}_${i}_${Date.now()}`,
          raw: JSON.stringify({ source: 'smoke-test', scenario: scenario.name }),
        },
      });

      // Welcome solo en el primer mensaje del job
      if (jobRes.isFirstMessage) {
        const welcome = profile.welcome
          .replace(/\{\{businessName\}\}/g, profile.intakeSchema.$businessName)
          .replace(/\{\{businessDomain\}\}/g, profile.intakeSchema.$businessDomain);
        console.log(c('magenta', '  bot (welcome): ') + welcome.slice(0, 120));
        await prisma.message.create({
          data: {
            tenantId,
            jobId: jobRes.job.id,
            contactId: contactRes.contact.id,
            direction: 'outbound',
            kind: 'text',
            body: welcome,
          },
        });
        responsesReceived++;
      }

      const historyRaw = await prisma.message.findMany({
        where: { jobId: jobRes.job.id, id: { not: message.id } },
        orderBy: { createdAt: 'desc' },
        take: 12,
      });
      const recentHistory = historyRaw.reverse().map((m: any) => ({
        direction: m.direction,
        kind: m.kind,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
      }));

      const allOpen = await prisma.job.findMany({
        where: {
          tenantId,
          contactId: contactRes.contact.id,
          status: { in: ['OPEN_INTAKE', 'READY_FOR_REVIEW'] },
          NOT: { id: jobRes.job.id },
        },
      });

      const result = await runAgentTurn(
        {
          job: jobRes.job,
          contact: contactRes.contact,
          intake: parseJobIntake(jobRes.job),
          batchMessages: [
            { id: message.id, kind: 'text', body: userText, mediaPath: null },
          ],
          otherOpenJobs: allOpen.map((j: any) => ({
            id: j.id,
            summary: j.summary,
            openedAt: j.openedAt,
          })),
          now: new Date().toISOString(),
          recentHistory,
        },
        {
          prisma,
          tenantId,
          config,
          profile,
          notifier: new NoopNotifier(),
          createAgent: defaultAgentFactory,
        },
      );

      tokensIn += result.inputTokens;
      tokensOut += result.outputTokens;
      toolCallsTotal += result.toolCalls.length;
      const failed = result.toolCalls.filter((t) => t.error);
      toolCallsFailed += failed.length;

      if (result.error) {
        errors.push(`turn ${i + 1}: ${result.error}`);
        console.log(c('red', `  error: ${result.error}`));
      }
      if (result.responseText) {
        const truncated =
          result.responseText.length > 200
            ? result.responseText.slice(0, 197) + '…'
            : result.responseText;
        console.log(c('magenta', '  bot: ') + truncated);
        await prisma.message.create({
          data: {
            jobId: jobRes.job.id,
            contactId: contactRes.contact.id,
            direction: 'outbound',
            kind: 'text',
            body: result.responseText,
          },
        });
        responsesReceived++;
      } else {
        console.log(c('yellow', '  (sin respuesta de texto)'));
      }
      if (result.toolCalls.length > 0) {
        const summary = result.toolCalls
          .map((t) => `${t.name}${t.error ? '✗' : '✓'}`)
          .join(' ');
        console.log(c('dim', `  [tools] ${summary}`));
        for (const t of failed) {
          console.log(
            c('red', `    ✗ ${t.name}: ${t.error?.slice(0, 100)}`),
          );
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`turn ${i + 1} exception: ${msg}`);
      console.log(c('red', `  EXCEPCIÓN: ${msg}`));
    }

    // Pequeña pausa para no rate-limit-ear
    await new Promise((r) => setTimeout(r, 500));
  }

  // Estado final
  const contact = await prisma.contact.findFirst({
    where: { tenantId, phoneE164: scenario.phone },
  });
  const job = await prisma.job.findFirst({
    where: { tenantId, contactId: contact?.id },
    orderBy: { openedAt: 'desc' },
  });
  const finalStatus = job?.status ?? 'NO_JOB';
  const intakeComplete = job?.intakeComplete ?? false;
  const flaggedNonIntake = contact?.flaggedNonIntake ?? false;

  let passedExpectations = true;
  if (scenario.expect.readyForReview && finalStatus !== 'READY_FOR_REVIEW') {
    passedExpectations = false;
  }
  if (scenario.expect.flaggedNonIntake && !flaggedNonIntake) {
    passedExpectations = false;
  }

  return {
    name: scenario.name,
    phone: scenario.phone,
    messagesSent: scenario.messages.length,
    responsesReceived,
    toolCallsTotal,
    toolCallsFailed,
    tokensIn,
    tokensOut,
    finalStatus,
    intakeComplete,
    flaggedNonIntake,
    passedExpectations,
    errors,
    durationMs: Date.now() - start,
  };
}

async function main() {
  const config = await loadConfig('./config.json');
  const profile = await loadProfile(config.profile);
  const prisma = getPrisma();
  const tenantId = await ensureDevTenant(prisma);

  console.log(c('bold', `\n╔══ Smoke test profundo ══╗`));
  console.log(c('dim', `Modelo: ${config.model}`));
  console.log(c('dim', `Perfil: ${profile.intakeSchema.$businessName}`));
  console.log(c('dim', `Escenarios: ${SCENARIOS.length}`));
  console.log(c('dim', `Mensajes totales: ${SCENARIOS.reduce((s, x) => s + x.messages.length, 0)}\n`));

  const results: ScenarioResult[] = [];
  for (const scenario of SCENARIOS) {
    const r = await runScenario(scenario, prisma, tenantId, config, profile);
    results.push(r);
  }

  // Resumen final
  console.log(c('bold', '\n\n╔══ RESUMEN ══╗\n'));
  const passed = results.filter((r) => r.passedExpectations).length;
  const totalTokensIn = results.reduce((s, r) => s + r.tokensIn, 0);
  const totalTokensOut = results.reduce((s, r) => s + r.tokensOut, 0);
  const totalToolCalls = results.reduce((s, r) => s + r.toolCallsTotal, 0);
  const totalToolFailures = results.reduce((s, r) => s + r.toolCallsFailed, 0);
  const totalErrors = results.reduce((s, r) => s + r.errors.length, 0);

  console.log(`Escenarios: ${passed}/${results.length} pasaron expectativas`);
  console.log(`Tokens: ${totalTokensIn} in / ${totalTokensOut} out`);
  console.log(
    `Tool calls: ${totalToolCalls} total, ${totalToolFailures} fallidas (${
      totalToolCalls > 0
        ? ((totalToolFailures / totalToolCalls) * 100).toFixed(1)
        : 0
    }%)`,
  );
  console.log(`Errores del agente: ${totalErrors}\n`);

  for (const r of results) {
    const mark = r.passedExpectations ? c('green', '✓') : c('red', '✗');
    console.log(
      `${mark} ${r.name.padEnd(20)} status=${r.finalStatus.padEnd(20)} ` +
        `complete=${String(r.intakeComplete).padEnd(5)} ` +
        `flagged=${String(r.flaggedNonIntake).padEnd(5)} ` +
        `tools=${r.toolCallsTotal}(${r.toolCallsFailed}✗) ` +
        `tokens=${r.tokensIn}/${r.tokensOut} ` +
        `${(r.durationMs / 1000).toFixed(1)}s`,
    );
    if (r.errors.length > 0) {
      for (const e of r.errors.slice(0, 3)) {
        console.log(c('red', `    ↳ ${e.slice(0, 150)}`));
      }
    }
  }

  // Estado final de los intakes
  console.log(c('bold', '\n\n╔══ INTAKES FINALES ══╗\n'));
  for (const r of results) {
    const contact = await prisma.contact.findFirst({
      where: { tenantId, phoneE164: r.phone },
    });
    const job = await prisma.job.findFirst({
      where: { tenantId, contactId: contact?.id },
      orderBy: { openedAt: 'desc' },
    });
    if (job) {
      console.log(c('cyan', `--- ${r.name} ---`));
      console.log(
        renderIntakeForModel(profile.intakeSchema, parseJobIntake(job), {
          jobId: job.id,
          status: job.status,
        }),
      );
      console.log();
    }
  }

  await disconnectPrisma();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
