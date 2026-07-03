import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type AdminTenant } from '../api/client';

export default function Admin() {
  const [tenants, setTenants] = useState<AdminTenant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setTenants((await api.getAdminTenants()).tenants); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'error'); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusy(id); setError(null);
    try { await fn(); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'error'); }
    finally { setBusy(null); }
  }

  if (error && !tenants) return <div className="admin"><p role="alert" className="error">{error}</p></div>;
  if (!tenants) return <div className="admin"><p>Cargando…</p></div>;

  const pending = tenants.filter((t) => t.approvalStatus === 'pending');
  const rest = tenants.filter((t) => t.approvalStatus !== 'pending');

  return (
    <div className="admin">
      <h1>Operador — Tenants</h1>
      {error && <p role="alert" className="error">{error}</p>}

      <section data-testid="approval-queue">
        <h2>Pendientes de aprobación ({pending.length})</h2>
        {pending.length === 0 ? <p>No hay cuentas esperando aprobación.</p> : (
          <table>
            <thead><tr><th>Negocio</th><th>Giro</th><th>Registro</th><th>Acciones</th></tr></thead>
            <tbody>
              {pending.map((t) => (
                <tr key={t.id}>
                  <td>{t.name} <small>({t.slug})</small></td>
                  <td>{t.industry}</td>
                  <td>{new Date(t.createdAt).toLocaleDateString()}</td>
                  <td>
                    <button disabled={busy === t.id} onClick={() => act(t.id, () => api.adminApprove(t.id))}>Aprobar</button>
                    <button disabled={busy === t.id} onClick={() => act(t.id, () => api.adminReject(t.id))}>Rechazar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Todos los tenants</h2>
        <table>
          <thead><tr><th>Negocio</th><th>Estado</th><th>Aprobación</th><th>Uso del mes</th><th>Límite</th><th>Acciones</th></tr></thead>
          <tbody>
            {rest.map((t) => (
              <tr key={t.id}>
                <td>{t.name} <small>({t.slug})</small></td>
                <td data-testid={`status-${t.id}`}>{t.status}</td>
                <td data-testid={`approval-${t.id}`}>{t.approvalStatus}</td>
                <td>{t.monthUsed}</td>
                <td><LimitEditor tenant={t} busy={busy === t.id} onSave={(v) => act(t.id, () => api.adminSetLimit(t.id, v))} /></td>
                <td>
                  {t.approvalStatus === 'rejected'
                    && <button disabled={busy === t.id} onClick={() => act(t.id, () => api.adminApprove(t.id))}>Aprobar</button>}
                  {t.status === 'suspended'
                    ? <button disabled={busy === t.id} onClick={() => act(t.id, () => api.adminReactivate(t.id))}>Reactivar</button>
                    : <button disabled={busy === t.id} onClick={() => act(t.id, () => api.adminSuspend(t.id))}>Suspender</button>}
                  <button disabled={busy === t.id} onClick={() => act(t.id, () => api.adminReconnect(t.id))}>Reconectar bot</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/** Editor inline del límite mensual. Vacío = default global del plan gratuito. */
function LimitEditor({ tenant, busy, onSave }: {
  tenant: AdminTenant; busy: boolean; onSave: (v: number | null) => void;
}) {
  const [value, setValue] = useState(tenant.monthlyRunLimit?.toString() ?? '');
  return (
    <span>
      <input
        aria-label={`límite de ${tenant.slug}`}
        style={{ width: '5em' }}
        value={value}
        placeholder="default"
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        disabled={busy}
        onClick={() => onSave(value.trim() === '' ? null : Number(value))}
      >Guardar</button>
    </span>
  );
}
