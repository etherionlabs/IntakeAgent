import type { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';
import { ownsTenant } from './shard';
import type { TenantManager, TenantRuntime, TenantRuntimeFactory, TenantStatus } from './types';

export interface TenantManagerDeps {
  prisma: PrismaClient;
  runtimeFactory: TenantRuntimeFactory;
  /** Override del filtro de shard (tests). Default: ownsTenant del entorno. */
  owns?: (tenantId: string) => boolean;
}

interface Entry {
  runtime: TenantRuntime | null;
  /** Estado de error de arranque cuando runtime no se pudo construir/levantar. */
  error?: string;
}

export class TenantManagerImpl implements TenantManager {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly deps: TenantManagerDeps) {}

  private owns(tenantId: string): boolean {
    return this.deps.owns ? this.deps.owns(tenantId) : ownsTenant(tenantId);
  }

  /** Levanta todos los tenants `active` que este shard posee, con aislamiento de fallos. */
  async start(): Promise<void> {
    const tenants = await this.deps.prisma.tenant.findMany({
      where: { active: true },
      select: { id: true },
    });
    const mine = tenants.filter((t) => this.owns(t.id));
    logger.info({ total: tenants.length, mine: mine.length }, 'tenant_manager.start');
    await Promise.allSettled(mine.map((t) => this.addTenant(t.id)));
  }

  /** Alta en caliente. Idempotente. Un fallo deja el tenant en `status:'error'`, no lanza. */
  async addTenant(tenantId: string): Promise<void> {
    if (this.entries.has(tenantId)) return; // idempotente
    try {
      const runtime = await this.deps.runtimeFactory(tenantId);
      this.entries.set(tenantId, { runtime });
      await runtime.start();
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.entries.set(tenantId, { runtime: null, error });
      logger.error({ tenantId, error }, 'tenant_manager.add_failed');
    }
  }

  /** Baja en caliente. Idempotente. No borra la sesión persistida (eso es `logout`). */
  async removeTenant(tenantId: string): Promise<void> {
    const entry = this.entries.get(tenantId);
    if (!entry) return;
    this.entries.delete(tenantId);
    if (entry.runtime) {
      try { await entry.runtime.stop(); } catch (e) {
        logger.warn({ tenantId, err: e instanceof Error ? e.message : String(e) }, 'tenant_manager.stop_failed');
      }
    }
  }

  /** Número de tenants con conexión activa (para la métrica bots_connected). */
  connectedCount(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.runtime?.getStatus().connected) n++;
    return n;
  }

  getStatus(tenantId: string): TenantStatus | null {
    const entry = this.entries.get(tenantId);
    if (!entry) return null;
    if (!entry.runtime) {
      return {
        tenantId, connected: false, qr: null, phone: '',
        status: 'error', lastConnectedAt: null, lastError: entry.error ?? 'error',
      };
    }
    return entry.runtime.getStatus();
  }

  async logout(tenantId: string): Promise<void> {
    await this.entries.get(tenantId)?.runtime?.logout();
  }

  async reconnect(tenantId: string): Promise<void> {
    await this.entries.get(tenantId)?.runtime?.reconnect();
  }

  async suspendTenant(tenantId: string): Promise<void> {
    await this.entries.get(tenantId)?.runtime?.suspend();
  }

  async resumeTenant(tenantId: string): Promise<void> {
    await this.entries.get(tenantId)?.runtime?.resume();
  }

  async stop(): Promise<void> {
    const ids = [...this.entries.keys()];
    await Promise.allSettled(ids.map((id) => this.removeTenant(id)));
  }
}
