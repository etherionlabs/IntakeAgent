import type { PrismaClient } from '@prisma/client';
import { loadProfile } from '../../../src/config/loader';
import { INDUSTRY_DOMAIN, INDUSTRIES, type Industry } from './industries';

// Re-export para compatibilidad con importadores existentes; la fuente de verdad
// del catálogo es `industries.ts`.
export { INDUSTRIES, type Industry };

function subst(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}

/**
 * Copia la plantilla read-only de `profiles/<industry>/` a `TenantSettings` (la
 * instancia editable), sustituyendo {{businessName}}/{{businessDomain}}. El disco
 * es la plantilla; la DB es la instancia. Idempotente (upsert por tenantId).
 */
export async function seedTenantSettingsFromTemplate(
  prisma: PrismaClient,
  tenantId: string,
  industry: Industry,
  vars: { businessName: string },
): Promise<void> {
  const dir = `./profiles/${industry}`;
  let profile;
  try {
    profile = await loadProfile(dir);
  } catch (e) {
    throw new Error(`Plantilla de industria '${industry}' no disponible: ${(e as Error).message}`);
  }
  const businessDomain = INDUSTRY_DOMAIN[industry] ?? 'servicios';
  const subVars = { businessName: vars.businessName, businessDomain };

  const schema = JSON.parse(subst(JSON.stringify(profile.intakeSchema), subVars));
  // Forzar la identidad del negocio aunque la plantilla traiga valores demo.
  schema.$businessName = vars.businessName;
  schema.$businessDomain = businessDomain;
  const welcome = subst(profile.welcome, subVars);

  const data = {
    industry,
    businessName: vars.businessName,
    businessDomain,
    ownerPhoneE164: '', // se completa al vincular WhatsApp / en el wizard
    welcomeTemplate: welcome,
    intakeSchema: schema,
  };
  await prisma.tenantSettings.upsert({
    where: { tenantId },
    update: data,
    // Los toggles de media solo en el CREATE: un re-seed no debe pisar lo que el
    // tenant apagó desde el panel. Argumento de venta de la v1: el asistente
    // entiende fotos y notas de voz; el límite mensual ya acota el costo.
    // editImages queda en false (opt-in, más costoso). skills se siembra con las
    // del perfil del giro para que el panel las muestre marcadas desde el inicio.
    create: {
      tenantId,
      ...data,
      describeImages: true,
      transcribeAudio: true,
      skills: profile.promptVars.skills,
    },
  });
}
