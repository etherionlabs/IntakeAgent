import { describe, it, expect, beforeEach } from 'vitest';
import { cleanupDb, testPrisma } from './helpers/app';
import { hardDeleteTenant } from '../src/services/tenantDeletion';

async function seedFullTenant() {
  const tenant = await testPrisma.tenant.create({
    data: { slug: `s-${Date.now()}`, name: 'Negocio', industry: 'tapiceria', profileDir: './profiles/tapiceria' },
  });
  const user = await testPrisma.panelUser.create({
    data: { tenantId: tenant.id, username: 'dueno', email: `d-${Date.now()}@x.com`, passwordHash: 'x', role: 'admin' },
  });
  await testPrisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash: `h-${Date.now()}`, expiresAt: new Date(Date.now() + 1e6) },
  });
  const contact = await testPrisma.contact.create({ data: { tenantId: tenant.id, phoneE164: '+5215555', displayName: 'C' } });
  const job = await testPrisma.job.create({ data: { tenantId: tenant.id, contactId: contact.id, status: 'OPEN_INTAKE', intake: '{}' } });
  await testPrisma.message.create({ data: { tenantId: tenant.id, contactId: contact.id, jobId: job.id, direction: 'inbound', kind: 'text', body: 'hola', externalMsgId: `m-${Date.now()}`, channel: 'whatsapp', raw: '{}' } });
  await testPrisma.agentRun.create({ data: { tenantId: tenant.id, jobId: job.id, model: 'x', inputTokens: 1, outputTokens: 1, costUsd: 0, responseText: 'r', triggerMessageIds: '[]', toolCalls: '[]' } });
  await testPrisma.notification.create({ data: { tenantId: tenant.id, jobId: job.id, kind: 'ready', sentVia: 'whatsapp' } });
  await testPrisma.tenantSettings.create({ data: { tenantId: tenant.id, industry: 'tapiceria', businessName: 'N', businessDomain: 'd', ownerPhoneE164: '', welcomeTemplate: 'h', intakeSchema: {} } });
  await testPrisma.emailVerification.create({ data: { tenantId: tenant.id, email: 'v@x.com', token: `t-${Date.now()}`, expiresAt: new Date(Date.now() + 1e6) } });
  await testPrisma.legalAcceptance.create({ data: { tenantId: tenant.id, userId: user.id, document: 'terms', version: '1' } });
  await testPrisma.operatorAuditLog.create({ data: { operatorUserId: 'op', tenantId: tenant.id, action: 'approve' } });
  return tenant.id;
}

describe('hardDeleteTenant', () => {
  beforeEach(async () => { await cleanupDb(); });

  it('borra el tenant y todos sus hijos, preservando legal y auditoría', async () => {
    const tenantId = await seedFullTenant();
    const counts = await hardDeleteTenant(testPrisma, tenantId);
    expect(counts.tenant).toBe(1);
    expect(await testPrisma.tenant.count({ where: { id: tenantId } })).toBe(0);
    expect(await testPrisma.message.count({ where: { tenantId } })).toBe(0);
    expect(await testPrisma.job.count({ where: { tenantId } })).toBe(0);
    expect(await testPrisma.contact.count({ where: { tenantId } })).toBe(0);
    expect(await testPrisma.agentRun.count({ where: { tenantId } })).toBe(0);
    expect(await testPrisma.notification.count({ where: { tenantId } })).toBe(0);
    expect(await testPrisma.panelUser.count({ where: { tenantId } })).toBe(0);
    expect(await testPrisma.tenantSettings.count({ where: { tenantId } })).toBe(0);
    expect(await testPrisma.emailVerification.count({ where: { tenantId } })).toBe(0);
    expect(await testPrisma.legalAcceptance.count({ where: { tenantId } })).toBe(1);
    expect(await testPrisma.operatorAuditLog.count({ where: { tenantId } })).toBe(1);
  });
});
