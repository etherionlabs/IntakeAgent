import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
} from 'baileys';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import qrcode from 'qrcode-terminal';
import { logger } from '../../lib/logger';
import { extractPhoneFromJid } from './jid';
import type {
  AdapterStateSnapshot,
  ConnectionStatus,
  WASocket,
} from './types';

export interface ConnectionOptions {
  /** Carpeta donde Baileys guarda las llaves de la sesión. */
  sessionDir: string;
  /** Callback cuando llega un mensaje. */
  onMessage: (wam: any, socket: WASocket) => Promise<void>;
  /** Callback cuando el estado de conexión cambia. */
  onStatusChange: (status: ConnectionStatus, error?: string) => void;
  /** Callback cuando hay un QR para imprimir. */
  onQr: (qr: string) => void;
}

/**
 * Mantiene un socket de Baileys conectado. Reintenta al desconectarse,
 * excepto cuando la causa es logout (sesión inválida).
 */
export class BaileysConnection {
  private socket: any = null;
  private status: ConnectionStatus = 'disconnected';
  private lastError: string | null = null;
  private lastConnectedAt: string | null = null;
  private lastQr: string | null = null;
  private phone: string | null = null;
  private reconnecting = false;
  private stopped = false;

  constructor(private readonly opts: ConnectionOptions) {}

  asWASocket(): WASocket {
    return {
      sendMessage: async (jid, content) => {
        if (!this.socket) throw new Error('baileys: socket no conectado');
        return this.socket.sendMessage(jid, content);
      },
      end: (err) => {
        if (this.socket?.end) this.socket.end(err);
      },
    };
  }

  state(): AdapterStateSnapshot {
    return {
      status: this.status,
      qr: this.lastQr,
      phone: this.phone,
      lastError: this.lastError,
      lastConnectedAt: this.lastConnectedAt,
    };
  }

  async start(): Promise<void> {
    await mkdir(resolve(this.opts.sessionDir), { recursive: true });
    this.stopped = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.reconnecting = false;
    if (this.socket?.end) {
      try {
        this.socket.end(undefined);
      } catch {}
    }
    this.socket = null;
    this.setStatus('disconnected');
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.setStatus('connecting');
    const { state, saveCreds } = await useMultiFileAuthState(this.opts.sessionDir);

    const sock = makeWASocket({
      auth: state,
      // Usar un fingerprint de browser conocido — WhatsApp rechaza browsers
      // genéricos en el handshake de registración (error 405).
      browser: Browsers.macOS('Desktop'),
      syncFullHistory: false,
    });

    this.socket = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update: any) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        this.lastQr = qr;
        this.setStatus('qr_required');
        this.opts.onQr(qr);
        qrcode.generate(qr, { small: true });
      }
      if (connection === 'open') {
        this.lastQr = null;
        this.lastError = null;
        this.lastConnectedAt = new Date().toISOString();
        this.phone = extractPhoneFromJid(this.socket?.user?.id ?? '');
        this.setStatus('connected');
        logger.info('whatsapp.connected');
      }
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const reason = lastDisconnect?.error?.message ?? 'unknown';
        this.lastError = reason;
        logger.warn({ code, reason }, 'whatsapp.disconnected');
        if (code === DisconnectReason.loggedOut) {
          this.phone = null;
          this.setStatus('logged_out');
        } else {
          this.setStatus('disconnected');
          if (!this.reconnecting && !this.stopped) {
            this.reconnecting = true;
            setTimeout(() => {
              this.reconnecting = false;
              void this.connect().catch((e: Error) =>
                logger.error({ err: e.message }, 'whatsapp.reconnect_failed'),
              );
            }, 3000);
          }
        }
      }
    });

    sock.ev.on('messages.upsert', async (upsert: any) => {
      logger.info(
        {
          type: upsert.type,
          count: upsert.messages?.length ?? 0,
          jids: (upsert.messages ?? []).map((m: any) => m?.key?.remoteJid),
          fromMes: (upsert.messages ?? []).map((m: any) => m?.key?.fromMe),
          kinds: (upsert.messages ?? []).map((m: any) =>
            Object.keys(m?.message ?? {}).slice(0, 3),
          ),
        },
        'whatsapp.messages_upsert',
      );
      if (upsert.type !== 'notify') return;
      for (const wam of upsert.messages) {
        try {
          await this.opts.onMessage(wam, this.asWASocket());
        } catch (e) {
          logger.error(
            { err: e instanceof Error ? e.message : String(e) },
            'whatsapp.on_message_failed',
          );
        }
      }
    });
  }

  /** Descarga el buffer de media de un mensaje. */
  async downloadMedia(wam: any): Promise<Buffer> {
    if (!this.socket) throw new Error('baileys: socket no conectado');
    const baileys = await import('baileys');
    return (await baileys.downloadMediaMessage(
      wam,
      'buffer',
      {},
      {
        logger: undefined as any,
        reuploadRequest: this.socket.updateMediaMessage,
      },
    )) as Buffer;
  }

  /** Cierra sesión, borra la sesión persistida y reconecta para generar un QR nuevo. */
  async logout(): Promise<void> {
    try {
      if (this.socket?.logout) await this.socket.logout();
    } catch {
      // best-effort: si el socket ya no responde, igual borramos la sesión local.
    }
    this.reconnecting = false;
    this.socket = null;
    await rm(resolve(this.opts.sessionDir), { recursive: true, force: true });
    this.phone = null;
    this.lastQr = null;
    this.stopped = false;
    await this.connect();
  }

  /** Reintenta la conexión SIN borrar la sesión (re-vincula la misma cuenta). */
  async reconnect(): Promise<void> {
    if (this.socket?.end) {
      try { this.socket.end(undefined); } catch {}
    }
    this.reconnecting = false;
    this.socket = null;
    this.stopped = false;
    await this.connect();
  }

  private setStatus(s: ConnectionStatus): void {
    this.status = s;
    this.opts.onStatusChange(s, this.lastError ?? undefined);
  }
}
