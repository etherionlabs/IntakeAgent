import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanupDb, testPrisma } from './helpers/app';
import { approveTenant, rejectTenant } from '../src/services/tenantApproval';

// Necesario para que resolveManagerUrl devuelva una URL y workerCall invoque doFetch.
process.env.INTERNAL_API_TOKEN = 'test-token';
process.env.WORKER_INTERNAL_URL = 'http://worker.test';

async function seedTenant(status = 'provisioning') {
  const tenant = await testPrisma.tenant.create({
    data: { slug: `s-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, name: 'Negocio', industry: 'tapiceria', profileDir: './profiles/tapiceria', status },
  });
  await testPrisma.panelUser.create({
    data: { tenantId: tenant.id, username: 'dueno', email: `d-${Date.now()}@x.com`, passwordHash: 'x', role: 'admin' },
  });
  return tenant;
}

describe('tenantApproval', () => {
  beforeEach(async () => { await cleanupDb(); });

  it('approveTenant aprueba, activa, llama al worker y avisa por email', async () => {
    const tenant = await seedTenant('provisioning');
    const doFetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }) as any);
    const emailSender = { send: vi.fn(async () => {}) };
    const res = await approveTenant(testPrisma, { doFetch, emailSender }, tenant.id);
    expect(res).not.toBeNull();
    const after = await testPrisma.tenant.findUnique({ where: { id: tenant.id } });
    expect(after!.approvalStatus).toBe('approved');
    expect(after!.active).toBe(true);
    expect(after!.approvedAt).not.toBeNull();
    expect(doFetch).toHaveBeenCalledTimes(1);
    expect(emailSender.send).toHaveBeenCalledTimes(1);
  });

  it('approveTenant devuelve null si el tenant no existe', async () => {
    const res = await approveTenant(testPrisma, { doFetch: vi.fn(), emailSender: { send: vi.fn() } }, 'no-existe');
    expect(res).toBeNull();
  });

  it('rejectTenant rechaza, desactiva y suspende en el worker', async () => {
    const tenant = await seedTenant('active');
    const doFetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }) as any);
    const emailSender = { send: vi.fn(async () => {}) };
    await rejectTenant(testPrisma, { doFetch, emailSender }, tenant.id);
    const after = await testPrisma.tenant.findUnique({ where: { id: tenant.id } });
    expect(after!.approvalStatus).toBe('rejected');
    expect(after!.active).toBe(false);
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  it('no lanza si el email falla', async () => {
    const tenant = await seedTenant('provisioning');
    const doFetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }) as any);
    const emailSender = { send: vi.fn(async () => { throw new Error('smtp down'); }) };
    await expect(approveTenant(testPrisma, { doFetch, emailSender }, tenant.id)).resolves.not.toBeNull();
  });
});
