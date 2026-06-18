import type { InboundCoordinator } from '../../pipeline/coordinator';
import { BaileysConnection } from './connection';
import { mapWAMessageToRaw } from './mapMessage';
import type { Notifier } from '../../services/notification';
import { logger } from '../../lib/logger';
import type { AdapterStateSnapshot, ConnectionStatus, WASocket } from './types';

export interface BaileysAdapterOptions {
  sessionDir: string;
  coordinator: InboundCoordinator;
  notifier: Notifier;
}

export class BaileysAdapter {
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
      // Programa la alerta a 2 minutos si no hay una pendiente.
      if (!this.disconnectTimer) {
        this.disconnectTimer = setTimeout(
          () => {
            this.disconnectTimer = null;
            if (this.conn.state().status !== 'connected') {
              void this.opts.notifier
                .notifyDisconnect({ reason: err ?? status })
                .catch(() => {});
            }
          },
          2 * 60 * 1000,
        );
      }
    }
  }
}
