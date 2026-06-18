import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog';

type WaStatus = {
  connected: boolean;
  qr: string | null;
  phone: string;
  status?: string;
  lastConnectedAt?: string | null;
  lastError?: string | null;
};

const POLL_MS = 5000;

const STATUS_LABELS: Record<string, string> = {
  connecting: 'Conectando…',
  qr_required: 'Esperando escaneo de QR',
  connected: 'Conectado',
  disconnected: 'Desconectado',
  logged_out: 'Sesión cerrada',
};

export default function WhatsApp() {
  const [status, setStatus] = useState<WaStatus | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const firstLoad = useRef(true);

  const load = useCallback(async () => {
    try {
      const data = await api.getWaStatus();
      setStatus(data as WaStatus);
      setError(null);
    } catch (err) {
      // API may return 502/503 when the worker is unreachable, keep polling.
      setError(
        err instanceof Error
          ? err.message
          : 'no se pudo contactar al worker de WhatsApp',
      );
    } finally {
      if (firstLoad.current) {
        firstLoad.current = false;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => {
      void load();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  async function reconnect() {
    setActionBusy(true);
    setActionError(null);
    try {
      await api.waReconnect();
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'error al reconectar');
    } finally {
      setActionBusy(false);
    }
  }

  async function logout() {
    setActionBusy(true);
    setActionError(null);
    try {
      await api.waLogout();
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'error al desvincular');
    } finally {
      setActionBusy(false);
      setConfirmLogout(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const qr = status?.connected ? null : status?.qr;
    if (!qr) {
      setQrImage(null);
      return;
    }

    QRCode.toDataURL(qr, { margin: 1, width: 280 })
      .then((url) => {
        if (!cancelled) setQrImage(url);
      })
      .catch(() => {
        if (!cancelled) setQrImage(null);
      });

    return () => {
      cancelled = true;
    };
  }, [status?.connected, status?.qr]);

  return (
    <div className="whatsapp">
      <h1>WhatsApp</h1>

      {loading && <p>Cargando...</p>}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {status && (
        <>
          <p className="wa-status">
            <span className={status.connected ? 'wa-connected' : 'wa-disconnected'}>
              {STATUS_LABELS[status.status ?? ''] ?? (status.connected ? 'Conectado' : 'Desconectado')}
            </span>
            {status.phone && <span className="wa-phone"> — {status.phone}</span>}
          </p>

          {status.lastConnectedAt && (
            <p className="wa-meta">
              Última conexión: {new Date(status.lastConnectedAt).toLocaleString()}
            </p>
          )}
          {status.lastError && (
            <p className="wa-meta wa-meta-error">Último error: {status.lastError}</p>
          )}

          {actionError && (
            <p className="error" role="alert">
              {actionError}
            </p>
          )}

          <div className="wa-actions">
            <button type="button" onClick={() => void reconnect()} disabled={actionBusy}>
              Reconectar
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => setConfirmLogout(true)}
              disabled={actionBusy}
            >
              Desvincular
            </button>
          </div>

          {!status.connected && typeof status.qr === 'string' && status.qr && (
            <div className="wa-qr">
              <p className="wa-qr-note">
                Escanea este codigo QR desde WhatsApp. La terminal del worker
                tambien muestra un QR escaneable.
              </p>
              {qrImage ? (
                <img src={qrImage} alt="Codigo QR para conectar WhatsApp" />
              ) : (
                <p className="wa-qr-note">Generando QR...</p>
              )}
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmLogout}
        title="Desvincular WhatsApp"
        message="Se cerrará la sesión actual y deberás escanear un QR nuevo para volver a vincular un teléfono. ¿Continuar?"
        confirmLabel="Desvincular definitivamente"
        danger
        onConfirm={() => void logout()}
        onCancel={() => setConfirmLogout(false)}
      />
    </div>
  );
}
