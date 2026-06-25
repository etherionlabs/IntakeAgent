import { useEffect, useState } from 'react';
import { api, ApiError, type BillingStatus } from '../api/client';

const LABEL: Record<BillingStatus['status'], string> = {
  none: 'Sin suscripción',
  incomplete: 'Pago incompleto',
  trialing: 'En prueba',
  active: 'Activa',
  past_due: 'Pago pendiente',
  canceled: 'Cancelada',
  unpaid: 'Sin pagar',
};

function formatPrice(s: BillingStatus): string | null {
  if (s.amountCents == null || !s.currency) return null;
  const amount = (s.amountCents / 100).toLocaleString('es-MX', { minimumFractionDigits: 2 });
  return `${amount} ${s.currency.toUpperCase()}${s.interval ? ` / ${s.interval === 'year' ? 'año' : 'mes'}` : ''}`;
}

export default function Billing() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api.getBillingStatus().then(setStatus).catch(() => setError('No se pudo cargar el estado de facturación.'));
  }, []);

  async function go(action: () => Promise<{ url: string }>) {
    setError(null);
    setPending(true);
    try {
      const { url } = await action();
      window.location.href = url;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'error inesperado');
      setPending(false);
    }
  }

  if (error && !status) return <div className="billing"><p role="alert" className="error">{error}</p></div>;
  if (!status) return <div className="billing"><p>Cargando…</p></div>;

  const hasSubscription = status.status !== 'none';
  const operative = status.status === 'active' || status.status === 'trialing';

  return (
    <div className="billing">
      <h1>Facturación</h1>
      <p>Estado: <strong data-testid="billing-status">{LABEL[status.status]}</strong></p>
      {status.planName && <p>Plan: {status.planName}{formatPrice(status) ? ` — ${formatPrice(status)}` : ''}</p>}
      {status.currentPeriodEnd && (
        <p>{status.cancelAtPeriodEnd ? 'Acceso hasta' : 'Próxima renovación'}: {new Date(status.currentPeriodEnd).toLocaleDateString('es-MX')}</p>
      )}

      {status.status === 'past_due' && (
        <p role="alert" className="error">Tu último pago falló. Actualiza tu método de pago para no perder el servicio.</p>
      )}

      {error && <p role="alert" className="error">{error}</p>}

      {!operative && !hasSubscription && (
        <button type="button" disabled={pending} onClick={() => go(api.startCheckout)}>
          {pending ? 'Redirigiendo…' : 'Suscribirme'}
        </button>
      )}
      {hasSubscription && (
        <button type="button" disabled={pending} onClick={() => go(api.openBillingPortal)}>
          {pending ? 'Abriendo…' : 'Gestionar facturación'}
        </button>
      )}
    </div>
  );
}
