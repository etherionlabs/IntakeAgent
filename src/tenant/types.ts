export type TenantConnState =
  | 'starting'
  | 'connecting'
  | 'qr_required'
  | 'connected'
  | 'disconnected'
  | 'logged_out'
  | 'error';

/** Estado de un tenant expuesto por el TenantManager (consumido por el endpoint interno). */
export interface TenantStatus {
  tenantId: string;
  connected: boolean;
  qr: string | null;
  phone: string;
  status: TenantConnState;
  lastConnectedAt: string | null;
  lastError: string | null;
}

/**
 * Runtime de UN tenant: encapsula adapter (InboundSource) + sender + notifier +
 * coordinator. El TenantManager posee su ciclo de vida.
 */
export interface TenantRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): TenantStatus;
  logout(): Promise<void>;
  reconnect(): Promise<void>;
}

/** Construye el runtime de un tenant. Inyectable (tests usan un runtime falso). */
export type TenantRuntimeFactory = (tenantId: string) => TenantRuntime | Promise<TenantRuntime>;

/**
 * Gestiona N conexiones de tenant en un solo proceso (Enfoque A). Alta/baja en
 * caliente sin reiniciar. Diseño shardeable: `start()` solo levanta los tenants
 * que este shard posee.
 */
export interface TenantManager {
  start(): Promise<void>;
  addTenant(tenantId: string): Promise<void>;
  removeTenant(tenantId: string): Promise<void>;
  getStatus(tenantId: string): TenantStatus | null;
  logout(tenantId: string): Promise<void>;
  reconnect(tenantId: string): Promise<void>;
  stop(): Promise<void>;
}
