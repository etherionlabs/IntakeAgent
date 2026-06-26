import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const url =
  process.env.DATABASE_URL ?? 'postgres://intake:intake@localhost:5432/intake';

const adapter = new PrismaPg({ connectionString: url });

/** Cliente Prisma compartido por TODOS los tests (vitest corre con fileParallelism:false). */
export const testPrisma = new PrismaClient({ adapter });

/** Tenant fijo usado por todos los tests que necesitan aislamiento. */
export const TEST_TENANT_ID = '00000000-0000-0000-0000-000000000001';

export async function seedTestTenant(): Promise<void> {
  await testPrisma.tenant.upsert({
    where: { id: TEST_TENANT_ID },
    update: {},
    create: {
      id: TEST_TENANT_ID,
      slug: 'test-tenant',
      name: 'Test Tenant',
      industry: 'test',
      profileDir: './profiles/tapiceria',
    },
  });
}

/** Borra todas las filas respetando el orden de FKs. Tenant se siembra en Task 2. */
export async function cleanupDb(): Promise<void> {
  await testPrisma.message.deleteMany();
  await testPrisma.agentRun.deleteMany();
  await testPrisma.notification.deleteMany();
  await testPrisma.job.deleteMany();
  await testPrisma.contact.deleteMany();
  await testPrisma.passwordResetToken.deleteMany();
  await testPrisma.emailVerification.deleteMany();
  await testPrisma.panelUser.deleteMany();
  await testPrisma.subscription.deleteMany();
  await testPrisma.stripeEvent.deleteMany();
  await testPrisma.tenantSettings.deleteMany();
  await testPrisma.operatorAuditLog.deleteMany();
  await testPrisma.legalAcceptance.deleteMany();
  await testPrisma.tenant.deleteMany();
  await testPrisma.plan.deleteMany();
}

export const TEST_PLAN_ID = '00000000-0000-0000-0000-0000000000a1';

/** Siembra un Plan activo de prueba. El monto real lo manda Stripe; aquí es display. */
export async function seedTestPlan(overrides: Record<string, unknown> = {}): Promise<string> {
  const plan = await testPrisma.plan.upsert({
    where: { id: TEST_PLAN_ID },
    update: {},
    create: {
      id: TEST_PLAN_ID,
      stripePriceId: 'price_test',
      name: 'Plan Test',
      amountCents: 4900,
      currency: 'usd',
      interval: 'month',
      trialDays: 0,
      ...overrides,
    },
  });
  return plan.id;
}

/** Siembra una fila mínima válida de TenantSettings para el tenant dado. */
export async function seedTestTenantSettings(
  tenantId: string = TEST_TENANT_ID,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await testPrisma.tenantSettings.upsert({
    where: { tenantId },
    update: {},
    create: {
      tenantId,
      industry: 'tapiceria',
      businessName: 'Test Tapicería',
      businessDomain: 'tapicería',
      ownerPhoneE164: '+5210000000000',
      welcomeTemplate: 'Hola, soy el asistente.',
      intakeSchema: {
        $businessName: 'Test Tapicería',
        $businessDomain: 'tapicería',
        $language: 'es-MX',
        sections: [
          { key: 'client', label: 'Cliente', fields: [{ key: 'name', label: 'Nombre', type: 'string', required: true }] },
        ],
      },
      ...overrides,
    },
  });
}
