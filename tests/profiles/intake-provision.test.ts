import { describe, it, expect, afterAll } from 'vitest';
import { testPrisma, cleanupDb } from '../helpers/db';
import { seedTenantSettingsFromTemplate } from '../../api/src/onboarding/templates';

/**
 * El alta que hace el superadmin al crear el tenant de nosotros mismos.
 * Vale la pena fijarla: si la plantilla no siembra, el worker no levanta el
 * tenant ("TenantSettings ausente") y el asistente no contesta a nadie.
 */
describe('alta del tenant interno desde el panel del superadmin', () => {
  afterAll(async () => { await cleanupDb(); });

  it('siembra TenantSettings con la identidad y el intake de venta', async () => {
    const tenant = await testPrisma.tenant.create({
      data: { slug: `intake-${Date.now()}`, name: 'Intake', industry: 'intake', profileDir: './profiles/intake', status: 'active', approvalStatus: 'approved' },
    });
    await seedTenantSettingsFromTemplate(testPrisma, tenant.id, 'intake' as never, { businessName: 'Intake' });

    const ts = await testPrisma.tenantSettings.findUnique({ where: { tenantId: tenant.id } });
    expect(ts).toBeTruthy();
    expect(ts!.businessName).toBe('Intake');
    // El dominio sale del catálogo, no del fallback 'servicios'.
    expect(ts!.businessDomain).toBe('asistentes de WhatsApp para negocios');
    // Y el intake que le queda es el de vender, no el genérico.
    const keys = (ts!.intakeSchema as any).sections.flatMap((s: any) => s.fields.map((f: any) => f.key));
    expect(keys).toContain('who_answers');
    expect(ts!.welcomeTemplate).toContain('Intake');
  });
});
