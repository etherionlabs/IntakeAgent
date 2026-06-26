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

  return (
    <div className="admin">
      <h1>Operador — Tenants</h1>
      {error && <p role="alert" className="error">{error}</p>}
      <table>
        <thead><tr><th>Negocio</th><th>Estado</th><th>Suscripción</th><th>Acciones</th></tr></thead>
        <tbody>
          {tenants.map((t) => (
            <tr key={t.id}>
              <td>{t.name} <small>({t.slug})</small></td>
              <td data-testid={`status-${t.id}`}>{t.status}</td>
              <td>{t.subscription ?? '—'}</td>
              <td>
                {t.status === 'suspended'
                  ? <button disabled={busy === t.id} onClick={() => act(t.id, () => api.adminReactivate(t.id))}>Reactivar</button>
                  : <button disabled={busy === t.id} onClick={() => act(t.id, () => api.adminSuspend(t.id))}>Suspender</button>}
                <button disabled={busy === t.id} onClick={() => act(t.id, () => api.adminReconnect(t.id))}>Reconectar bot</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
