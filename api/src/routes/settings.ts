import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../db';
import { getTenantProfile, getTenantProfileDir, clearTenantProfileCache } from '../lib/tenant-profile';
import { validateIntakeSchema } from '../../../src/config/intake-schema';
import {
  readProfileSettings,
  ProfileSettingsInputZ,
} from '../lib/settings-io';
import { writeProfileOverride } from '../../../src/config/overrides';
import { listSkillCatalog, loadProfile } from '../../../src/config/loader';

/** Toggles de media por-tenant (TenantSettings). Los modelos NO se exponen:
 *  quedan null → default del deployment (config.json). `skills` es la lista de
 *  técnicas activas; se valida contra el catálogo al guardar. */
const MediaSettingsInputZ = z.object({
  describeImages: z.boolean(),
  transcribeAudio: z.boolean(),
  editImages: z.boolean(),
  followUpEnabled: z.boolean(),
  skills: z.array(z.string()),
});

/** Secciones/campos que el dueño edita desde el panel. La validación fuerte
 *  (tipos, keys duplicadas, enums con opciones) la hace validateIntakeSchema. */
const FieldsInputZ = z.object({
  sections: z.array(z.unknown()).min(1, 'debe haber al menos una sección'),
});

/** Coacciona el JSON de `TenantSettings.skills` a string[] (o null si no es arreglo). */
function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((v): v is string => typeof v === 'string');
}

/** Solo los usuarios admin pueden modificar la configuración. */
function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.authUser?.role !== 'admin') {
    reply.code(403).send({ error: 'requiere rol admin' });
    return false;
  }
  return true;
}

export async function settingsRoutes(app: FastifyInstance) {
  // Lectura: SOLO el perfil del negocio (por-tenant) + toggles de media. El config
  // del sistema es GLOBAL al deployment (modelo, temperatura, horario, teléfono del
  // dueño del deployment) → NO se expone a los usuarios de tenant; va como null para
  // que el panel oculte la sección "Sistema". Devuelve los ajustes EFECTIVOS
  // (archivos base + override guardado en DB).
  app.get('/settings', { preHandler: app.authenticate }, async (request) => {
    const prisma = getPrisma();
    const profileDir = await getTenantProfileDir(request.tenantId);
    const [profile, ts, availableSkills] = await Promise.all([
      readProfileSettings(prisma, request.tenantId, profileDir),
      prisma.tenantSettings.findUnique({
        where: { tenantId: request.tenantId },
        select: {
          describeImages: true,
          transcribeAudio: true,
          editImages: true,
          followUpEnabled: true,
          skills: true,
        },
      }),
      listSkillCatalog(),
    ]);
    let media: {
      describeImages: boolean;
      transcribeAudio: boolean;
      editImages: boolean;
      followUpEnabled: boolean;
      skills: string[];
    } | null = null;
    if (ts) {
      // skills explícitas del tenant, o (si null) las referenciadas por el perfil.
      const skills =
        asStringArray(ts.skills) ?? (await loadProfile(profileDir)).promptVars.skills;
      media = {
        describeImages: ts.describeImages,
        transcribeAudio: ts.transcribeAudio,
        editImages: ts.editImages,
        followUpEnabled: ts.followUpEnabled,
        skills,
      };
    }
    // Las secciones/campos que el asistente pide en cada conversación. Vienen del
    // schema del tenant (misma fuente que usa el bot), no de la plantilla del giro.
    const fields = (await getTenantProfile(request.tenantId)).intakeSchema.sections;
    return { profile, config: null, media, availableSkills, fields };
  });

  /**
   * Estructura del intake: qué le pregunta el asistente a cada cliente. Se guarda
   * en `TenantSettings.intakeSchema`, que es lo que lee el worker, así que el
   * cambio aplica al bot en la siguiente conversación.
   */
  app.put('/settings/fields', { preHandler: app.authenticate }, async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parse = FieldsInputZ.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: parse.error.message });

    const prisma = getPrisma();
    const existing = await prisma.tenantSettings.findUnique({ where: { tenantId: request.tenantId } });
    if (!existing) return reply.code(404).send({ error: 'TenantSettings ausente para este tenant' });

    // Se conserva la cabecera ($businessName/$businessDomain/$language) del schema
    // vigente: el dueño edita campos, no la identidad del negocio (esa vive en el
    // perfil y se edita en su propia sección).
    const current = (await getTenantProfile(request.tenantId)).intakeSchema;
    const next = { ...current, sections: parse.data.sections };

    const result = validateIntakeSchema(next);
    if (!result.ok) return reply.code(400).send({ error: result.error });

    await prisma.tenantSettings.update({
      where: { tenantId: request.tenantId },
      data: { intakeSchema: result.schema as object },
    });
    // El perfil está cacheado en memoria: sin esto el panel seguiría viendo lo viejo.
    clearTenantProfileCache(request.tenantId);
    return { ok: true, fields: result.schema.sections };
  });

  app.put('/settings/profile', { preHandler: app.authenticate }, async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parse = ProfileSettingsInputZ.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: parse.error.message });
    const prisma = getPrisma();
    try {
      // Persistimos el override en DB (compartida con el worker), no en archivos.
      await writeProfileOverride(prisma, request.tenantId, parse.data);
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
    // Invalidar la caché de perfil de la API para que el siguiente GET (y las
    // rutas que usan el perfil) lean la versión nueva. El worker la recoge en su
    // próximo turno al releer el override de DB.
    clearTenantProfileCache(request.tenantId);
    const profileDir = await getTenantProfileDir(request.tenantId);
    const profile = await readProfileSettings(prisma, request.tenantId, profileDir);
    return { ok: true, profile };
  });

  // El config del sistema es GLOBAL (afecta a TODOS los tenants del deployment) y
  // NO editable desde el panel de un negocio: un admin de tenant lo tocaría para
  // todos. Se rechaza siempre. Su default vive en config.json; si algún día se
  // administra por UI, será desde el panel superadmin, no aquí.
  app.put('/settings/config', { preHandler: app.authenticate }, async (_request, reply) => {
    return reply.code(403).send({ error: 'la configuración del sistema es global y no se edita desde el panel del negocio' });
  });

  // Toggles de media por-tenant. Escriben directo a TenantSettings (patrón de
  // onboarding); el worker los recoge en su siguiente turno vía reloadConfig.
  app.put('/settings/media', { preHandler: app.authenticate }, async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parse = MediaSettingsInputZ.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: parse.error.message });
    const prisma = getPrisma();
    const existing = await prisma.tenantSettings.findUnique({ where: { tenantId: request.tenantId } });
    if (!existing) return reply.code(404).send({ error: 'TenantSettings ausente para este tenant' });
    // Validar skills contra el catálogo: descartamos nombres desconocidos para no
    // persistir referencias muertas.
    const catalog = new Set((await listSkillCatalog()).map((s) => s.name));
    const skills = parse.data.skills.filter((s) => catalog.has(s));
    const row = await prisma.tenantSettings.update({
      where: { tenantId: request.tenantId },
      data: {
        describeImages: parse.data.describeImages,
        transcribeAudio: parse.data.transcribeAudio,
        editImages: parse.data.editImages,
        followUpEnabled: parse.data.followUpEnabled,
        skills,
      },
      select: {
        describeImages: true,
        transcribeAudio: true,
        editImages: true,
        followUpEnabled: true,
        skills: true,
      },
    });
    return {
      ok: true,
      media: {
        describeImages: row.describeImages,
        transcribeAudio: row.transcribeAudio,
        editImages: row.editImages,
        followUpEnabled: row.followUpEnabled,
        skills: asStringArray(row.skills) ?? [],
      },
    };
  });
}
