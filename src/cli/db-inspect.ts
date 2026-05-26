#!/usr/bin/env tsx
/**
 * Inspector rápido de la DB para uso manual.
 *
 * Reemplazo temporal de `prisma studio` mientras Prisma 7 tiene bugs con SQLite.
 * Plan 5 traerá un panel web completo.
 *
 * Uso:
 *   npm run db:inspect              → resumen general (conteos por tabla)
 *   npm run db:inspect contacts     → lista contactos
 *   npm run db:inspect jobs         → lista jobs con resumen del intake
 *   npm run db:inspect messages [n] → últimos n mensajes (default 20)
 *   npm run db:inspect job <id>     → detalle de un job + sus mensajes + intake
 *   npm run db:inspect runs [n]     → últimos n agent runs (default 10)
 */
import { getPrisma, disconnectPrisma } from '../storage/client';
import { parseJobIntake } from '../services/job';

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n - 1) + '…';
  return s + ' '.repeat(n - s.length);
}

function fmtDate(d: Date | null): string {
  if (!d) return '—';
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

async function summary() {
  const prisma = getPrisma();
  const [contacts, jobs, messages, agentRuns, notifications] = await Promise.all([
    prisma.contact.count(),
    prisma.job.count(),
    prisma.message.count(),
    prisma.agentRun.count(),
    prisma.notification.count(),
  ]);
  console.log('\n=== Resumen DB ===');
  console.log(`Contacts:       ${contacts}`);
  console.log(`Jobs:           ${jobs}`);
  console.log(`Messages:       ${messages}`);
  console.log(`Agent runs:     ${agentRuns}`);
  console.log(`Notifications:  ${notifications}\n`);

  const jobsByStatus = await prisma.job.groupBy({
    by: ['status'],
    _count: { _all: true },
  });
  if (jobsByStatus.length > 0) {
    console.log('Jobs por status:');
    for (const r of jobsByStatus) {
      console.log(`  ${pad(r.status, 22)} ${r._count._all}`);
    }
    console.log();
  }
}

async function listContacts() {
  const prisma = getPrisma();
  const contacts = await prisma.contact.findMany({
    orderBy: { updatedAt: 'desc' },
    include: { _count: { select: { jobs: true, messages: true } } },
  });
  console.log('\n=== Contacts ===');
  console.log(
    `${pad('id', 10)} ${pad('phone', 18)} ${pad('name', 24)} ${pad('bot', 5)} ${pad('flag', 5)} jobs msgs`,
  );
  for (const c of contacts) {
    console.log(
      `${pad(c.id, 10)} ${pad(c.phoneE164, 18)} ${pad(c.displayName ?? '—', 24)} ${pad(c.botActive ? 'on' : 'OFF', 5)} ${pad(c.flaggedNonIntake ? 'YES' : 'no', 5)} ${pad(String(c._count.jobs), 4)} ${c._count.messages}`,
    );
  }
  console.log();
}

async function listJobs() {
  const prisma = getPrisma();
  const jobs = await prisma.job.findMany({
    orderBy: { openedAt: 'desc' },
    include: { contact: true, _count: { select: { messages: true } } },
  });
  console.log('\n=== Jobs ===');
  console.log(
    `${pad('id', 10)} ${pad('contact', 18)} ${pad('status', 20)} ${pad('opened', 20)} msgs summary`,
  );
  for (const j of jobs) {
    const intake = parseJobIntake(j);
    const name = (intake.client as any)?.name?.value ?? j.contact.phoneE164;
    console.log(
      `${pad(j.id, 10)} ${pad(name, 18)} ${pad(j.status, 20)} ${pad(fmtDate(j.openedAt), 20)} ${pad(String(j._count.messages), 4)} ${j.summary ?? '—'}`,
    );
  }
  console.log();
}

async function listMessages(limit: number) {
  const prisma = getPrisma();
  const msgs = await prisma.message.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { contact: true },
  });
  console.log(`\n=== Últimos ${limit} mensajes ===`);
  for (const m of msgs.reverse()) {
    const dir = m.direction === 'inbound' ? '←' : '→';
    const body = (m.body ?? '(sin texto)').replace(/\n/g, ' ').slice(0, 80);
    console.log(
      `${fmtDate(m.createdAt)} ${dir} ${pad(m.contact.phoneE164, 16)} [${pad(m.kind, 7)}] ${body}`,
    );
  }
  console.log();
}

async function jobDetail(jobId: string) {
  const prisma = getPrisma();
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      contact: true,
      messages: { orderBy: { createdAt: 'asc' } },
      agentRuns: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!job) {
    console.log(`No existe job ${jobId}`);
    return;
  }
  console.log('\n=== Job ===');
  console.log(`ID:       ${job.id}`);
  console.log(`Contact:  ${job.contact.phoneE164} (${job.contact.displayName ?? 's/n'})`);
  console.log(`Status:   ${job.status}`);
  console.log(`Opened:   ${fmtDate(job.openedAt)}`);
  console.log(`Ready:    ${fmtDate(job.readyAt)}`);
  console.log(`Closed:   ${fmtDate(job.closedAt)}`);
  console.log(`Summary:  ${job.summary ?? '—'}`);
  console.log('\n=== Intake ===');
  console.log(JSON.stringify(parseJobIntake(job), null, 2));
  console.log('\n=== Conversación ===');
  for (const m of job.messages) {
    const dir = m.direction === 'inbound' ? '←' : '→';
    const body = m.body ?? `(${m.kind})`;
    console.log(`${fmtDate(m.createdAt)} ${dir} ${body}`);
  }
  console.log(`\n=== Agent runs (${job.agentRuns.length}) ===`);
  for (const r of job.agentRuns) {
    console.log(
      `${fmtDate(r.createdAt)} model=${r.model} tokens=${r.inputTokens}/${r.outputTokens} cost=${r.costUsd ?? '—'} error=${r.error ?? '—'}`,
    );
  }
  console.log();
}

async function listRuns(limit: number) {
  const prisma = getPrisma();
  const runs = await prisma.agentRun.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  console.log(`\n=== Últimos ${limit} agent runs ===`);
  for (const r of runs.reverse()) {
    const tools = JSON.parse(r.toolCalls) as Array<{ name: string; error: string | null }>;
    const toolNames = tools.length > 0 ? tools.map((t) => t.name).join(',') : '—';
    console.log(
      `${fmtDate(r.createdAt)} job=${r.jobId.slice(0, 8)} tokens=${r.inputTokens}/${r.outputTokens} tools=[${toolNames}] err=${r.error ?? '—'}`,
    );
  }
  console.log();
}

async function main() {
  const [, , cmd, ...args] = process.argv;
  try {
    switch (cmd) {
      case undefined:
        await summary();
        break;
      case 'contacts':
        await listContacts();
        break;
      case 'jobs':
        await listJobs();
        break;
      case 'messages':
        await listMessages(args[0] ? Number(args[0]) : 20);
        break;
      case 'job':
        if (!args[0]) {
          console.error('Uso: npm run db:inspect job <id>');
          process.exit(1);
        }
        await jobDetail(args[0]);
        break;
      case 'runs':
        await listRuns(args[0] ? Number(args[0]) : 10);
        break;
      default:
        console.error(`Comando desconocido: ${cmd}`);
        console.error(
          'Comandos: (sin args para resumen) | contacts | jobs | messages [n] | job <id> | runs [n]',
        );
        process.exit(1);
    }
  } finally {
    await disconnectPrisma();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
