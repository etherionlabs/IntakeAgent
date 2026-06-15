import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

type Totals = {
  runs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
};

type RecentRun = {
  id: string;
  model: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
  error: string | null;
};

function fmtCost(n: number): string {
  return `$${(Number(n) || 0).toFixed(4)}`;
}

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getUsage();
      setTotals(data.totals as Totals);
      setRecent((data.recent ?? []) as RecentRun[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error al cargar el uso');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

      {!loading && !error && totals && (
        <>
          <div className="usage-cards">
            <div className="usage-card">
              <span className="usage-card-label">Ejecuciones</span>
              <span className="usage-card-value">{fmtNum(totals.runs)}</span>
            </div>
            <div className="usage-card">
              <span className="usage-card-label">Costo</span>
              <span className="usage-card-value">{fmtCost(totals.costUsd)}</span>
            </div>
            <div className="usage-card">
              <span className="usage-card-label">Tokens entrada</span>
              <span className="usage-card-value">{fmtNum(totals.inputTokens)}</span>
            </div>
            <div className="usage-card">
              <span className="usage-card-label">Tokens salida</span>
              <span className="usage-card-value">{fmtNum(totals.outputTokens)}</span>
            </div>
          </div>

          <h2 className="usage-recent-title">Ejecuciones recientes</h2>
          {recent.length === 0 ? (
            <p>No hay ejecuciones todavía.</p>
          ) : (
            <table className="usage-table">
              <thead>
                <tr>
                  <th>Modelo</th>
                  <th>Costo</th>
                  <th>Entrada</th>
                  <th>Salida</th>
                  <th>Fecha</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((run) => (
                  <tr key={run.id}>
                    <td>{run.model}</td>
                    <td>{fmtCost(run.costUsd)}</td>
                    <td>{fmtNum(run.inputTokens)}</td>
                    <td>{fmtNum(run.outputTokens)}</td>
                    <td>{fmtTime(run.createdAt)}</td>
                    <td>
                      {run.error ? (
                        <span className="usage-error" title={run.error}>
                          ⚠ error
                        </span>
                      ) : (
                        <span className="usage-ok">ok</span>
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
