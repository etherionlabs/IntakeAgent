import type { InboundCoordinator } from '../../pipeline/coordinator';
import { BaileysConnection } from './connection';
import { mapWAMessageToRaw } from './mapMessage';
import type { Notifier } from '../../services/notification';
import { logger } from '../../lib/logger';
import type { Channel } from '../../pipeline/types';
import type { InboundSource, ConnectionControl } from '../../channels/types';
import type { AdapterStateSnapshot, ConnectionStatus, WASocket } from './types';

export interface BaileysAdapterOptions {
  sessionDir: string;
  coordinator: InboundCoordinator;
  notifier: Notifier;
  /** Tenant al que pertenece esta conexión (acompaña las alertas; forward-compat Fase 2). */
  tenantId?: string;
  /** Avisar al dueño por WhatsApp al desconectar (config.owner.notifyOnDisconnect). */
  notifyOwner?: boolean;
  /** Umbral (ms) de desconexión sostenida para alertar. Def. 5 min. */
  alertThresholdMs?: number;
}

const DEFAULT_ALERT_MS = Number(process.env.WA_DISCONNECT_ALERT_MS ?? 5 * 60 * 1000);

export class BaileysAdapter implements InboundSource, ConnectionControl {
  readonly channel: Channel = 'whatsapp';
  private readonly conn: BaileysConnection;
  private disconnectTimer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: BaileysAdapterOptions) {
    this.conn = new BaileysConnection({
      sessionDir: opts.sessionDir,
      onMessage: (wam) => this.handleWAMessage(wam),
      onStatusChange: (status, err) => this.handleStatusChange(status, err),
      onQr: (qr) => {
        logger.info({ qrLength: qr.length }, 'whatsapp.qr_required');
      },
    });
  }

  async start(): Promise<void> {
    await this.conn.start();
  }

  async stop(): Promise<void> {
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
    await this.conn.stop();
  }

  state(): AdapterStateSnapshot {
    return this.conn.state();
  }

  async logout(): Promise<void> {
    await this.conn.logout();
  }

  async reconnect(): Promise<void> {
    await this.conn.reconnect();
  }

  asSocket(): WASocket {
    return this.conn.asWASocket();
  }

  private async handleWAMessage(wam: any): Promise<void> {
    const raw = await mapWAMessageToRaw(wam, (m) => this.conn.downloadMedia(m));
    if (!raw) return;
    await this.opts.coordinator.handleInbound(raw);
  }

  private handleStatusChange(
    status: ConnectionStatus,
    err: string | undefined,
  ): void {
    if (status === 'connected') {
      // Reconectó — cancela cualquier alerta pendiente.
      if (this.disconnectTimer) {
        clearTimeout(this.disconnectTimer);
        this.disconnectTimer = null;
      }
      return;
    }
    if (status === 'disconnected' || status === 'logged_out') {
      // Programa la alerta si la desconexión persiste más del umbral.
      if (!this.disconnectTimer) {
        const threshold = this.opts.alertThresholdMs ?? DEFAULT_ALERT_MS;
        this.disconnectTimer = setTimeout(() => {
          this.disconnectTimer = null;
          if (this.conn.state().status !== 'connected') {
            this.fireDisconnectAlert(status, err);
          }
        }, threshold);
      }
    }
  }

  private fireDisconnectAlert(status: ConnectionStatus, err: string | undefined): void {
    const loggedOut = status === 'logged_out';
    const reason = err ?? status;
    // Canal de operador fiable aunque WhatsApp esté caído: log estructurado con
    // tenantId y marca `alert` que la capa de observabilidad (Fase 5) recoge.
    // `logged_out` exige acción humana (re-escanear QR).
    logger.error(
      { alert: true, tenantId: this.opts.tenantId, reason, loggedOut, action: loggedOut ? 'rescan_qr' : 'auto_reconnect' },
      'whatsapp.disconnect_alert',
    );
    // Aviso adicional al dueño por WhatsApp (si el canal sigue vivo y está habilitado).
    if (this.opts.notifyOwner !== false) {
      void this.opts.notifier
        .notifyDisconnect({ reason: loggedOut ? `${reason} (re-vincula el QR)` : reason })
        .catch(() => {});
    }
  }
}
