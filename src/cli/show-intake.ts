#!/usr/bin/env tsx
import { loadConfig, loadProfile } from '../config/loader';
import { getPrisma, disconnectPrisma } from '../storage/client';
import { parseJobIntake } from '../services/job';
import {
  createEmptyIntakeFromSchema,
  renderIntakeForModel,
} from '../services/intake';
import { upsertContactByPhone } from '../services/contact';
import { openJob } from '../services/job';
import { ensureDevTenant } from './dev-tenant';

async function main() {
  const arg = process.argv[2];
  const config = await loadConfig('./config.json');
  const profile = await loadProfile(config.profile);
  const prisma = getPrisma();
  const tenantId = await ensureDevTenant(prisma);

  let jobId: string;
  let status: string;

  if (arg === 'demo') {
    const contact = await upsertContactByPhone(prisma, tenantId, '+521000000000');
    const job = await openJob(
      prisma,
      tenantId,
      contact.id,
      createEmptyIntakeFromSchema(profile.intakeSchema),
    );
    jobId = job.id;
    status = job.status;
    console.log(`Job de demo creado: ${jobId}`);
  } else if (arg) {
    jobId = arg;
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      console.error(`No existe job ${jobId}`);
      process.exit(1);
    }
    status = job.status;
  } else {
    console.error('Uso: npm run cli:show-intake -- <job_id|demo>');
    process.exit(1);
  }

  const job = await prisma.job.findUnique({ where: { id: jobId } });
  const intake = job ? parseJobIntake(job) : createEmptyIntakeFromSchema(profile.intakeSchema);
  const rendered = renderIntakeForModel(profile.intakeSchema, intake, { jobId, status });
  console.log('\n' + rendered + '\n');
  await disconnectPrisma();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
