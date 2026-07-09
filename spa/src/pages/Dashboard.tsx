import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import JobCard, { type Job } from '../components/JobCard';

const GROUPS: { status: string; label: string }[] = [
  { status: 'OPEN_INTAKE', label: 'En intake' },
  { status: 'READY_FOR_REVIEW', label: 'Listos para revisar' },
  { status: 'IN_PROGRESS', label: 'En progreso' },
  { status: 'CLOSED', label: 'Cerrados' },
];

const POLL_MS = 10000;

export default function Dashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const firstLoad = useRef(true);

  const load = useCallback(async () => {
    try {
      const data = await api.getJobs();
      setJobs(data.jobs as Job[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error al cargar trabajos');
    } finally {
      if (firstLoad.current) {
        firstLoad.current = false;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
    // Actualización en vivo: los trabajos nuevos aparecen sin recargar.
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="dashboard">
      <div className="dashboard-head">
        <h1>Trabajos</h1>
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

      {!loading && !error && jobs.length === 0 && (
        <div className="empty-hint">
          <p><strong>Aún no hay trabajos.</strong></p>
          <p>
            Cuando un cliente te escriba por WhatsApp, el asistente levantará su
            solicitud y aparecerá aquí, lista para que la revises.
          </p>
        </div>
      )}

      {!loading && !error && jobs.length > 0 && (
        <div className="status-columns">
          {GROUPS.map((group) => {
            const groupJobs = jobs.filter((j) => j.status === group.status);
            return (
              <section className="status-column" key={group.status}>
                <h2>
                  {group.label}
                  <span className="col-count">{groupJobs.length}</span>
                </h2>
                {groupJobs.length === 0 ? (
                  <p className="status-empty">—</p>
                ) : (
                  groupJobs.map((job) => <JobCard key={job.id} job={job} />)
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
