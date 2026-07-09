import { useCallback, useEffect, useState } from 'react';
import { api, type UsagePlan } from '../api/client';

type Totals = { runs: number };

type RecentRun = {
  id: string;
  createdAt: string;
  error: string | null;
};

function fmtNum(n: number): string {
  return (Number(n) || 0).toLocaleString();
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export default function Usage() {
  const [totals, setTotals] = useState<Totals | null>(null);
  const [recent, setRecent] = useState<RecentRun[]>([]);
  const [plan, setPlan] = useState<UsagePlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getUsage();
      setTotals(data.totals as Totals);
      setRecent((data.recent ?? []) as RecentRun[]);
      setPlan(data.plan ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error al cargar el uso');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pct =
    plan && plan.monthlyLimit
      ? Math.min(100, Math.round((plan.monthUsed / plan.monthlyLimit) * 100))
      : 0;

  return (
    <div className="usage">
      <div className="usage-head">
        <h1>Uso</h1>
        <button type="button" onClick={() => void load()} disabled={loading}>
          Refrescar
        </button>
      </div>

      {loading && <p>Cargando…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!loading && !error && plan && (
        <div className="usage-plan" data-testid="usage-plan">
          <h2>Plan {plan.name}</h2>
          {plan.monthlyLimit !== null ? (
            <>
              <div className="plan-big">
                {fmtNum(plan.monthUsed)}{' '}
                <span style={{ opacity: 0.8, fontSize: '1rem' }}>de {fmtNum(plan.monthlyLimit)}</span>
              </div>
              <div className="plan-sub">respuestas del bot este mes</div>
              <div className="usage-meter">
                <span style={{ width: `${pct}%` }} />
              </div>
              {plan.monthRemaining === 0 && (
                <div className="plan-warn">
                  Límite alcanzado: el bot pausó las respuestas hasta el próximo mes.
                </div>
              )}
            </>
          ) : (
            <>
              <div className="plan-big">{fmtNum(totals?.runs ?? 0)}</div>
              <div className="plan-sub">respuestas del bot este mes · sin límite</div>
            </>
          )}
        </div>
      )}

      {!loading && !error && (
        <>
          <h2 className="usage-recent-title">Actividad reciente</h2>
          {recent.length === 0 ? (
            <p>Aún no hay actividad. Cuando el bot responda a tus clientes, aquí verás el registro.</p>
          ) : (
            <table className="usage-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((run) => (
                  <tr key={run.id}>
                    <td>{fmtTime(run.createdAt)}</td>
                    <td>
                      {run.error ? (
                        <span className="usage-error" title={run.error}>⚠ error</span>
                      ) : (
                        <span className="usage-ok">✓ respondido</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
