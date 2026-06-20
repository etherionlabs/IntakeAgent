import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, cleanupDb, TEST_TENANT_ID } from '../helpers/db';
import { backfillTenantSettings } from '../../scripts/backfill-tenant-settings';

// Usa el config.json real del repo + el perfil ./profiles/tapiceria.
describe('backfillTenantSettings', () => {
  beforeEach(async () => {
    await cleanupDb();
    await testPrisma.tenant.create({
      data: { id: TEST_TENANT_ID, slug: 'tap', name: 'Tapicería Demo', industry: 'tapiceria', profileDir: './profiles/tapiceria' },
    });
  });
  afterAll(async () => { await cleanupDb(); });

  it('crea TenantSettings desde config.json + profileDir', async () => {
    const { upserted } = await backfillTenantSettings(testPrisma, './config.json');
    expect(upserted).toBe(1);
    const s = await testPrisma.tenantSettings.findUnique({ where: { tenantId: TEST_TENANT_ID } });
    expect(s).not.toBeNull();
    expect(s?.businessName).toBe('Tapicería Demo');
    expect(s?.welcomeTemplate.length).toBeGreaterThan(0);
    expect(s?.intakeSchema).toBeTruthy();
  });

  it('es idempotente (re-correr actualiza, no duplica)', async () => {
    await backfillTenantSettings(testPrisma, './config.json');
    await backfillTenantSettings(testPrisma, './config.json');
    const count = await testPrisma.tenantSettings.count();
    expect(count).toBe(1);
  });
});
