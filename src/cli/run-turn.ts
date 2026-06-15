#!/usr/bin/env tsx
/**
 * CLI smoke-test del agent runner con un SDK stub.
 *
 * Crea un contacto y un job demo, simula que el cliente dice "Hola, soy María González,
 * quiero retapizar un sillón de 3 plazas", y corre un turno con un stub del SDK que
 * llama a update_intake y devuelve una respuesta canned.
 *
 * Útil para validar que toda la cadena (prompt + tools + persistencia + audit) funciona
 * sin necesidad de OpenRouter ni Baileys.
 */
import { loadConfig, loadProfile } from '../config/loader';
import { getPrisma, disconnectPrisma } from '../storage/client';
import { upsertContactByPhone } from '../services/contact';
import { openJob, parseJobIntake } from '../services/job';
import { createEmptyIntakeFromSchema } from '../services/intake';
import { NoopNotifier } from '../services/notification';
import { runAgentTurn } from '../agent/runner';
import type { AgentFactory, AgentLike } from '../agent/types';
import { ensureDevTenant } from './dev-tenant';

const stubFactory: AgentFactory = (cfg) => {
  const tools = cfg.tools as any[];
  const agent: AgentLike = {
    on: () => {},
    sendSync: async () => {
      const updateIntake = tools.find((t) => t.name === 'update_intake');
      if (updateIntake) {
        await updateIntake.execute({
          fields: [
            { path: 'client.name', value: 'María González' },
            { path: 'work.item_type', value: 'sillón de 3 plazas' },
            { path: 'work.service_type', value: 'retapizar' },
            { path: 'work.quantity', value: 1 },
          ],
          notes_to_add: ['cliente mencionó que es regalo para su mamá'],
        });
      }
      return {
        text: 'Genial María, ya registré tus datos. ¿En qué ciudad estás?',
        usage: { inputTokens: 250, outputTokens: 30, costUsd: 0.002 },
      };
    },
  };
  return agent;
};

async function main() {
  const config = await loadConfig('./config.json');
  const profile = await loadProfile(config.profile);
  const prisma = getPrisma();
  const tenantId = await ensureDevTenant(prisma);

  const contact = await upsertContactByPhone(prisma, tenantId, '+5210000000099');
  const job = await openJob(prisma, tenantId, contact.id, createEmptyIntakeFromSchema(profile.intakeSchema));

  console.log(`Job demo creado: ${job.id}`);

  const result = await runAgentTurn(
    {
      job,
      contact,
      intake: parseJobIntake(job),
      batchMessages: [
        {
          id: 'msg_demo',
          kind: 'text',
          body: 'Hola, soy María González y quiero retapizar un sillón de 3 plazas.',
        },
      ],
      otherOpenJobs: [],
      now: new Date().toISOString(),
    },
    {
      prisma,
      tenantId,
      config,
      profile,
      notifier: new NoopNotifier(),
      createAgent: stubFactory,
    },
  );

  console.log('\n=== Respuesta del agente (stub) ===');
  console.log(result.responseText);
  console.log('\n=== Tool calls ===');
  for (const tc of result.toolCalls) {
    console.log(`- ${tc.name}: ${tc.error ? `ERROR ${tc.error}` : 'ok'}`);
  }
  console.log(`\nTokens: in=${result.inputTokens} out=${result.outputTokens} cost=${result.costUsd ?? 'n/a'}`);

  const reload = await prisma.job.findUnique({ where: { id: job.id } });
  console.log('\n=== Intake guardado ===');
  console.log(JSON.stringify(parseJobIntake(reload!), null, 2).slice(0, 600), '...');

  await disconnectPrisma();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
