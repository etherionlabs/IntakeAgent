import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { cleanupDb, seedTestTenant, testPrisma, TEST_TENANT_ID } from './helpers/app';
import { provisionTenant } from '../src/onboarding/provision';
import { seedTenantSettingsFromTemplate } from '../src/onboarding/templates';

async function setTenant(status: string, industry = 'tapiceria') {
  await seedTestTenant();
  await testPrisma.tenant.update({ where: { id: TEST_TENANT_ID }, data: { status, industry, name: 'Tapicería Luz' } });
}

describe('provisionTenant', () => {
  beforeEach(async () => { await cleanupDb(); });
  afterAll(async () => { await cleanupDb(); });

  it('tenant verified → siembra TenantSettings, addTenant 1 vez y queda active', async () => {
    await setTenant('verified');
    const addTenant = vi.fn(async () => {});
    const r = await provisionTenant(testPrisma, TEST_TENANT_ID, { addTenant });
    expect(r.provisioned).toBe(true);
    expect(addTenant).toHaveBeenCalledTimes(1);
    const t = await testPrisma.tenant.findUnique({ where: { id: TEST_TENANT_ID } });
    expect(t?.status).toBe('active');
    const s = await testPrisma.tenantSettings.findUnique({ where: { tenantId: TEST_TENANT_ID } });
    expect(s?.businessName).toBe('Tapicería Luz');
    expect((s?.intakeSchema as any).$businessName).toBe('Tapicería Luz'); // sustituido
  });

  it('idempotente: segunda llamada (webhook duplicado) no re-aprovisiona', async () => {
    await setTenant('verified');
    const addTenant = vi.fn(async () => {});
    await provisionTenant(testPrisma, TEST_TENANT_ID, { addTenant }); // → active
    const r2 = await provisionTenant(testPrisma, TEST_TENANT_ID, { addTenant });
    expect(r2.provisioned).toBe(false);
    expect(addTenant).toHaveBeenCalledTimes(1);
  });

  it('tenant NO verificado → no aprovisiona', async () => {
    await setTenant('pending_verification');
    const addTenant = vi.fn(async () => {});
    const r = await provisionTenant(testPrisma, TEST_TENANT_ID, { addTenant });
    expect(r.provisioned).toBe(false);
    expect(addTenant).not.toHaveBeenCalled();
  });
});

describe('seedTenantSettingsFromTemplate', () => {
  beforeEach(async () => { await cleanupDb(); await seedTestTenant(); });
  afterAll(async () => { await cleanupDb(); });

  it('carga la plantilla de industria y sustituye {{businessName}}', async () => {
    await seedTenantSettingsFromTemplate(testPrisma, TEST_TENANT_ID, 'generico', { businessName: 'Mi Negocio' });
    const s = await testPrisma.tenantSettings.findUnique({ where: { tenantId: TEST_TENANT_ID } });
    expect(s?.businessName).toBe('Mi Negocio');
    expect(s?.welcomeTemplate).toContain('Mi Negocio');
    expect((s?.intakeSchema as any).sections.length).toBeGreaterThan(0);
  });

  it('industria inexistente → error', async () => {
    await expect(
      seedTenantSettingsFromTemplate(testPrisma, TEST_TENANT_ID, 'inexistente' as any, { businessName: 'X' }),
    ).rejects.toThrow();
  });
});
