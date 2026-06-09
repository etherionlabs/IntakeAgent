import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Config, Profile } from '../../config/schema';
import type { ConnectionStateProvider } from '../adapter-state';

interface Settings {
  autoReplyEnabled?: boolean;
  businessHoursStart?: string;
  businessHoursEnd?: string;
  captureVehicleInfo?: boolean;
  captureContactInfo?: boolean;
  requestPhotos?: boolean;
  autoCloseCompleted?: boolean;
  sendBudgetReminder?: boolean;
}

/**
 * Load settings from database with defaults
 */
async function loadSettings(prisma: PrismaClient): Promise<Settings> {
  try {
    const settingRecord = await prisma.setting.findUnique({
      where: { key: 'panel_settings' },
    });
    if (settingRecord) {
      return JSON.parse(settingRecord.value);
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }

  // Default settings
  return {
    autoReplyEnabled: false,
    businessHoursStart: '09:00',
    businessHoursEnd: '17:00',
    captureVehicleInfo: true,
    captureContactInfo: true,
    requestPhotos: true,
    autoCloseCompleted: false,
    sendBudgetReminder: true,
  };
}

/**
 * Save settings to database
 */
async function saveSettings(prisma: PrismaClient, settings: Settings): Promise<void> {
  await prisma.setting.upsert({
    where: { key: 'panel_settings' },
    create: {
      key: 'panel_settings',
      value: JSON.stringify(settings),
    },
    update: {
      value: JSON.stringify(settings),
    },
  });
}

/**
 * Convert form checkbox values to booleans
 */
function parseFormData(body: Record<string, any>): Partial<Settings> {
  return {
    autoReplyEnabled: body.autoReplyEnabled === 'on' || body.autoReplyEnabled === true,
    businessHoursStart: body.businessHoursStart || undefined,
    businessHoursEnd: body.businessHoursEnd || undefined,
    captureVehicleInfo: body.captureVehicleInfo === 'on' || body.captureVehicleInfo === true,
    captureContactInfo: body.captureContactInfo === 'on' || body.captureContactInfo === true,
    requestPhotos: body.requestPhotos === 'on' || body.requestPhotos === true,
    autoCloseCompleted: body.autoCloseCompleted === 'on' || body.autoCloseCompleted === true,
    sendBudgetReminder: body.sendBudgetReminder === 'on' || body.sendBudgetReminder === true,
  };
}

export function registerSettingsRoute(
  app: FastifyInstance,
  prisma: PrismaClient,
  _config: Config,
  _profile: Profile,
  adapterState: ConnectionStateProvider,
): void {
  app.get('/panel/settings', async (req, reply) => {
    if (!(req as any).panelUser) {
      reply.redirect('/panel/login', 303);
      return;
    }
    const username = (req as any).panelUser;
    const userInitials = username
      .split(/\s+/)
      .map((n: string) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || 'YM';
    const settings = await loadSettings(prisma);

    return reply.view('settings.hbs', {
      title: 'Settings',
      username,
      currentPage: 'settings',
      userInitials,
      adapter: adapterState.state(),
      settings,
    }, { layout: 'layouts/base.handlebars' });
  });

  app.post<{ Body: Record<string, any> }>(
    '/panel/api/settings/operating-hours',
    async (req, reply) => {
      if (!(req as any).panelUser) {
        reply.code(401);
        return { error: 'unauthorized' };
      }

      const settings = await loadSettings(prisma);
      const updates = parseFormData(req.body ?? {});

      const updated = {
        ...settings,
        autoReplyEnabled: updates.autoReplyEnabled ?? settings.autoReplyEnabled,
        businessHoursStart: updates.businessHoursStart ?? settings.businessHoursStart,
        businessHoursEnd: updates.businessHoursEnd ?? settings.businessHoursEnd,
      };

      await saveSettings(prisma, updated);

      return reply.view('settings.hbs', {
        title: 'Settings',
        username: (req as any).panelUser,
        currentPage: 'settings',
        settings: updated,
      });
    },
  );

  app.post<{ Body: Record<string, any> }>(
    '/panel/api/settings/data-collection',
    async (req, reply) => {
      if (!(req as any).panelUser) {
        reply.code(401);
        return { error: 'unauthorized' };
      }

      const settings = await loadSettings(prisma);
      const updates = parseFormData(req.body ?? {});

      const updated = {
        ...settings,
        captureVehicleInfo: updates.captureVehicleInfo ?? settings.captureVehicleInfo,
        captureContactInfo: updates.captureContactInfo ?? settings.captureContactInfo,
        requestPhotos: updates.requestPhotos ?? settings.requestPhotos,
      };

      await saveSettings(prisma, updated);

      return reply.view('settings.hbs', {
        title: 'Settings',
        username: (req as any).panelUser,
        currentPage: 'settings',
        settings: updated,
      });
    },
  );

  app.post<{ Body: Record<string, any> }>(
    '/panel/api/settings/automations',
    async (req, reply) => {
      if (!(req as any).panelUser) {
        reply.code(401);
        return { error: 'unauthorized' };
      }

      const settings = await loadSettings(prisma);
      const updates = parseFormData(req.body ?? {});

      const updated = {
        ...settings,
        autoCloseCompleted: updates.autoCloseCompleted ?? settings.autoCloseCompleted,
        sendBudgetReminder: updates.sendBudgetReminder ?? settings.sendBudgetReminder,
      };

      await saveSettings(prisma, updated);

      return reply.view('settings.hbs', {
        title: 'Settings',
        username: (req as any).panelUser,
        currentPage: 'settings',
        settings: updated,
      });
    },
  );
}
