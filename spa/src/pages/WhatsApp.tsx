import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

type WaStatus = {
  connected: boolean;
  qr: string | null;
  phone: string;
};

const POLL_MS = 5000;

export default function WhatsApp() {
  const [status, setStatus] = useState<WaStatus | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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
            {status.connected ? (
              <span className="wa-connected">Conectado</span>
            ) : (
              <span className="wa-disconnected">Desconectado</span>
            )}
            {status.phone && <span className="wa-phone"> - {status.phone}</span>}
          </p>

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
    </div>
  );
}
