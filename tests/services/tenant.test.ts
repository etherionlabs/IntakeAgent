import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma as prisma, cleanupDb, seedTestTenant, TEST_TENANT_ID } from '../helpers/db';

describe('tenant seeding', () => {
  beforeEach(async () => {
    await cleanupDb();
    await seedTestTenant();
  });
  afterAll(() => prisma.$disconnect());

  it('seedTestTenant inserta el tenant de pruebas', async () => {
    const t = await prisma.tenant.findUnique({ where: { id: TEST_TENANT_ID } });
    expect(t).not.toBeNull();
    expect(t?.slug).toBe('test-tenant');
  });

  it('un contacto puede crearse con tenantId', async () => {
    const c = await prisma.contact.create({
      data: { phoneE164: '+5215550000000', tenantId: TEST_TENANT_ID },
    });
    expect(c.tenantId).toBe(TEST_TENANT_ID);
  });
});
