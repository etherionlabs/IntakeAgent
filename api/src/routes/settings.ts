import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getPrisma } from '../db';
import { getTenantProfileDir, clearTenantProfileCache } from '../lib/tenant-profile';
import {
  readProfileSettings,
  readConfigSettings,
  ProfileSettingsInputZ,
  ConfigSettingsInputZ,
} from '../lib/settings-io';
import {
  writeProfileOverride,
  writeConfigOverride,
} from '../../../src/config/overrides';

/**
 * Ruta del config.json global. Se lee por-request (no como const cacheada) para
 * que los tests puedan apuntarla a un archivo temporal vía CONFIG_PATH.
 */
function configPath(): string {
  return process.env.CONFIG_PATH ?? './config.json';
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
  // Lectura: perfil del negocio (por-tenant) + config del sistema (global).
  // Devuelve los ajustes EFECTIVOS = archivos base + override guardado en DB.
  app.get('/settings', { preHandler: app.authenticate }, async (request) => {
    const prisma = getPrisma();
    const profileDir = await getTenantProfileDir(request.tenantId);
    const [profile, config] = await Promise.all([
      readProfileSettings(prisma, request.tenantId, profileDir),
      readConfigSettings(prisma, configPath()),
    ]);
    return { profile, config };
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

  app.put('/settings/config', { preHandler: app.authenticate }, async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parse = ConfigSettingsInputZ.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: parse.error.message });
    const prisma = getPrisma();
    try {
      await writeConfigOverride(prisma, parse.data);
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
    const config = await readConfigSettings(prisma, configPath());
    return { ok: true, config };
  });
}
