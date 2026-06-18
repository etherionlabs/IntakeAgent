/**
 * Interfaz mínima del socket de Baileys que nuestro código consume.
 * Esto nos permite inyectar mocks en tests sin importar Baileys real.
 */
export interface WASocket {
  sendMessage(jid: string, content: { text: string }): Promise<unknown>;
  end?: (error?: Error) => void;
}

/**
 * Estado de la conexión, expuesto por el adapter.
 */
export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'qr_required'
  | 'connected'
  | 'logged_out';

export interface AdapterStateSnapshot {
  status: ConnectionStatus;
  /** ASCII del QR cuando status='qr_required'. */
  qr: string | null;
  /** Teléfono E.164 de la cuenta vinculada cuando status='connected'. */
  phone: string | null;
  lastError: string | null;
  /** ISO 8601 de última conexión exitosa. */
  lastConnectedAt: string | null;
}
