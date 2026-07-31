import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type Overview } from '../api/client';
import JobCard, { type Job } from '../components/JobCard';
import AttentionPanel from '../components/AttentionPanel';
import SalesSummary from '../components/SalesSummary';

// Los cerrados quedan fuera por defecto: son historial, no trabajo pendiente, y
// mezclados con lo abierto hacían que todo pesara igual.
const OPEN_GROUPS: { status: string; label: string }[] = [
  { status: 'READY_FOR_REVIEW', label: 'Listos para revisar' },
  { status: 'OPEN_INTAKE', label: 'En intake' },
  { status: 'IN_PROGRESS', label: 'En progreso' },
];
const CLOSED_GROUP = { status: 'CLOSED', label: 'Cerrados' };

const POLL_MS = 10000;

export default function Dashboard() {
  // ?contact=<id> llega desde la agenda: enfoca el tablero en un solo cliente.
  const [params, setParams] = useSearchParams();
  const contactFilter = params.get('contact');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const firstLoad = useRef(true);

  const load = useCallback(async () => {
    try {
      const [jobsData, overviewData] = await Promise.all([api.getJobs(), api.getOverview()]);
      setJobs(jobsData.jobs as Job[]);
      setOverview(overviewData);
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

  const shown = useMemo(
    () => (contactFilter ? jobs.filter((j) => j.contact?.id === contactFilter) : jobs),
    [jobs, contactFilter],
  );
  const filteredName = contactFilter
    ? (shown[0]?.contact?.displayName ?? shown[0]?.contact?.phoneE164 ?? 'este contacto')
    : null;

  const groups = showClosed ? [...OPEN_GROUPS, CLOSED_GROUP] : OPEN_GROUPS;
  const closedCount = shown.filter((j) => j.status === CLOSED_GROUP.status).length;
  const hasOpen = shown.some((j) => j.status !== CLOSED_GROUP.status);

  return (
    <div className="dashboard">
      <div className="dashboard-head">
        <h1>Inicio</h1>
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

      {!loading && !error && contactFilter && (
        <div className="filter-banner">
          <span>
            Mostrando solo los trabajos de <strong>{filteredName}</strong>
          </span>
          <button type="button" className="btn-ghost" onClick={() => setParams({})}>
            Quitar filtro
          </button>
          <Link to="/contacts" className="cell-link">Ir a contactos</Link>
        </div>
      )}

      {!loading && !error && !contactFilter && overview && (
        <>
          <AttentionPanel overview={overview} />
          <SalesSummary overview={overview} />
        </>
      )}

      {!loading && !error && shown.length === 0 && (
        <div className="empty-hint">
          <p><strong>{contactFilter ? 'Este contacto no tiene trabajos.' : 'Aún no hay trabajos.'}</strong></p>
          <p>
            Cuando un cliente te escriba por WhatsApp, el asistente levantará su
            solicitud y aparecerá aquí, lista para que la revises.
          </p>
        </div>
      )}

      {!loading && !error && shown.length > 0 && (
        <>
          <div className="board-head">
            <h2>{contactFilter ? 'Sus trabajos' : 'Todos los trabajos'}</h2>
            {closedCount > 0 && (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setShowClosed((v) => !v)}
              >
                {showClosed ? 'Ocultar cerrados' : `Ver cerrados (${closedCount})`}
              </button>
            )}
          </div>

          {!hasOpen && !showClosed && (
            <p className="status-empty">No tienes trabajos abiertos.</p>
          )}

          <div className="status-columns">
            {groups.map((group) => {
              const groupJobs = shown.filter((j) => j.status === group.status);
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
        </>
      )}
    </div>
  );
}
