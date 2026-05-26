export interface OwnerReadyPayload {
  jobId: string;
  contactDisplayName: string | null;
  contactPhone: string;
  summary: string;
  panelUrl: string;
}

export interface DisconnectPayload {
  reason: string;
}

export interface Notifier {
  notifyOwnerReady(payload: OwnerReadyPayload): Promise<void>;
  notifyDisconnect(payload: DisconnectPayload): Promise<void>;
}

export interface NotificationEvent {
  kind: 'owner_ready' | 'disconnect_alert';
  payload: OwnerReadyPayload | DisconnectPayload;
  at: Date;
}

/** Notifier que no envía nada — sólo registra en memoria. Útil en Plan 2 y en tests. */
export class NoopNotifier implements Notifier {
  readonly history: NotificationEvent[] = [];

  async notifyOwnerReady(payload: OwnerReadyPayload): Promise<void> {
    this.history.push({ kind: 'owner_ready', payload, at: new Date() });
  }

  async notifyDisconnect(payload: DisconnectPayload): Promise<void> {
    this.history.push({ kind: 'disconnect_alert', payload, at: new Date() });
  }
}
