import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, cleanupDb, seedTestTenant, TEST_TENANT_ID } from './helpers/app';
import { seedTenantSettingsFromTemplate } from '../src/onboarding/templates';

describe('seedTenantSettingsFromTemplate — media defaults', () => {
  beforeEach(async () => {
    await cleanupDb();
  });

  afterAll(async () => {
    await cleanupDb();
  });

  it('los tenants nuevos nacen con describeImages y transcribeAudio en true', async () => {
    await seedTestTenant();
    await seedTenantSettingsFromTemplate(testPrisma, TEST_TENANT_ID, 'tapiceria', { businessName: 'Tapicería X' });
    const row = await testPrisma.tenantSettings.findUnique({ where: { tenantId: TEST_TENANT_ID } });
    expect(row!.describeImages).toBe(true);
    expect(row!.transcribeAudio).toBe(true);
  });
});
