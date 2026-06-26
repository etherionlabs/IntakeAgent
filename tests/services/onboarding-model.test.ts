import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { testPrisma, cleanupDb, seedTestTenant, TEST_TENANT_ID } from '../helpers/db';
import { in24h } from '../../api/src/lib/tokens';

describe('onboarding model', () => {
  beforeEach(async () => { await cleanupDb(); });
  afterAll(async () => { await cleanupDb(); });

  it('Tenant nuevo nace pending_verification', async () => {
    const t = await testPrisma.tenant.create({
      data: { slug: 'nuevo', name: 'Nuevo', industry: 'generico', profileDir: '' },
    });
    expect(t.status).toBe('pending_verification');
    expect(t.onboarding).toBeNull();
  });

  it('EmailVerification con token único', async () => {
    await seedTestTenant();
    await testPrisma.emailVerification.create({
      data: { tenantId: TEST_TENANT_ID, email: 'a@b.com', token: 'tok-1', expiresAt: in24h() },
    });
    await expect(
      testPrisma.emailVerification.create({
        data: { tenantId: TEST_TENANT_ID, email: 'c@d.com', token: 'tok-1', expiresAt: in24h() },
      }),
    ).rejects.toThrow();
  });
});
