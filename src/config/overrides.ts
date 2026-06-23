import type { PrismaClient } from '@prisma/client';
import {
  ProfileSettingsZ,
  ConfigSettingsZ,
  type ProfileSettings,
  type ConfigSettings,
} from './settings';

/**
 * Persistencia de los overrides de configuración editables en la tabla `Setting`
 * (key/value JSON). Postgres es el ÚNICO recurso compartido entre el contenedor
 * de la API (que guarda lo que el panel edita) y el del worker (que lo lee para
 * responder). Por eso los ajustes editables viven aquí y no en archivos del
 * contenedor, que no se comparten entre servicios.
 *
 * Keys:
 *   - `profile:<tenantId>` → ProfileSettings (por-tenant)
 *   - `config`             → ConfigSettings (global, como config.json)
 */

const profileKey = (tenantId: string): string => `profile:${tenantId}`;
const CONFIG_KEY = 'config';

async function readSetting(prisma: PrismaClient, key: string): Promise<unknown | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

async function writeSetting(prisma: PrismaClient, key: string, value: unknown): Promise<void> {
  const serialized = JSON.stringify(value);
  await prisma.setting.upsert({
    where: { key },
    update: { value: serialized },
    create: { key, value: serialized },
  });
}

/** Override del perfil guardado para el tenant, o null si nunca se editó. */
export async function readProfileOverride(
  prisma: PrismaClient,
  tenantId: string,
): Promise<ProfileSettings | null> {
  const raw = await readSetting(prisma, profileKey(tenantId));
  if (raw == null) return null;
  const parsed = ProfileSettingsZ.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function writeProfileOverride(
  prisma: PrismaClient,
  tenantId: string,
  settings: ProfileSettings,
): Promise<void> {
  const parsed = ProfileSettingsZ.parse(settings);
  await writeSetting(prisma, profileKey(tenantId), parsed);
}

/** Override del config global guardado, o null si nunca se editó. */
export async function readConfigOverride(
  prisma: PrismaClient,
): Promise<ConfigSettings | null> {
  const raw = await readSetting(prisma, CONFIG_KEY);
  if (raw == null) return null;
  const parsed = ConfigSettingsZ.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function writeConfigOverride(
  prisma: PrismaClient,
  settings: ConfigSettings,
): Promise<void> {
  const parsed = ConfigSettingsZ.parse(settings);
  await writeSetting(prisma, CONFIG_KEY, parsed);
}
