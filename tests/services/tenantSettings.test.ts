import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, cleanupDb, seedTestTenant, seedTestTenantSettings, TEST_TENANT_ID } from '../helpers/db';

describe('TenantSettings', () => {
  beforeEach(async () => { await cleanupDb(); await seedTestTenant(); });
  afterAll(async () => { await cleanupDb(); });

  it('Tenant nace active=true por default', async () => {
    const t = await testPrisma.tenant.findUnique({ where: { id: TEST_TENANT_ID } });
    expect(t?.active).toBe(true);
  });

  it('TenantSettings persiste con defaults de media/debounce', async () => {
    await seedTestTenantSettings();
    const s = await testPrisma.tenantSettings.findUnique({ where: { tenantId: TEST_TENANT_ID } });
    expect(s?.debounceMs).toBe(8000);
    expect(s?.transcribeAudio).toBe(false);
    expect(s?.describeImages).toBe(false);
    expect(s?.businessName).toBe('Test Tapicería');
    expect(s?.intakeSchema).toEqual({ sections: [] });
  });
});
