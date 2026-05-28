import type { AdapterStateSnapshot } from '../adapters/whatsapp/types';

/**
 * Interfaz mínima que el panel consume del adapter. Permite testear el panel
 * sin importar Baileys: en tests pasamos un objeto fake con state().
 */
export interface ConnectionStateProvider {
  state(): AdapterStateSnapshot;
}

/** Stub: siempre reporta "disconnected". Útil para arrancar el panel solo. */
export class NullConnectionStateProvider implements ConnectionStateProvider {
  state(): AdapterStateSnapshot {
    return {
      status: 'disconnected',
      qr: null,
      lastError: 'panel sin adapter conectado',
      lastConnectedAt: null,
    };
  }
}
