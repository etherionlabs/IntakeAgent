import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getTenantProfileDir, clearTenantProfileCache } from '../lib/tenant-profile';
import {
  readProfileSettings,
  readConfigSettings,
  writeProfileSettings,
  writeConfigSettings,
  ProfileSettingsInputZ,
  ConfigSettingsInputZ,
} from '../lib/settings-io';

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
  app.get('/settings', { preHandler: app.authenticate }, async (request) => {
    const profileDir = await getTenantProfileDir(request.tenantId);
    const [profile, config] = await Promise.all([
      readProfileSettings(profileDir),
      readConfigSettings(configPath()),
    ]);
    return { profile, config };
  });

  app.put('/settings/profile', { preHandler: app.authenticate }, async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parse = ProfileSettingsInputZ.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: parse.error.message });
    const profileDir = await getTenantProfileDir(request.tenantId);
    try {
      await writeProfileSettings(profileDir, parse.data);
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
    // El siguiente GET (aquí o en otras rutas) debe leer la versión nueva.
    clearTenantProfileCache(request.tenantId);
    const profile = await readProfileSettings(profileDir);
    return { ok: true, profile };
  });

  app.put('/settings/config', { preHandler: app.authenticate }, async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parse = ConfigSettingsInputZ.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: parse.error.message });
    try {
      await writeConfigSettings(configPath(), parse.data);
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
    const config = await readConfigSettings(configPath());
    return { ok: true, config };
  });
}
