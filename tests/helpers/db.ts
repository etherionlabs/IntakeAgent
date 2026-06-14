import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const url =
  process.env.DATABASE_URL ?? 'postgres://intake:intake@localhost:5432/intake';

const adapter = new PrismaPg({ connectionString: url });

/** Cliente Prisma compartido por TODOS los tests (vitest corre con fileParallelism:false). */
export const testPrisma = new PrismaClient({ adapter });

/** Borra todas las filas respetando el orden de FKs. Tenant se siembra en Task 2. */
export async function cleanupDb(): Promise<void> {
  await testPrisma.message.deleteMany();
  await testPrisma.agentRun.deleteMany();
  await testPrisma.notification.deleteMany();
  await testPrisma.job.deleteMany();
  await testPrisma.contact.deleteMany();
}
