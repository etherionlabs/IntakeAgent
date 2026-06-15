import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import IntakeForm, { type Intake, type IntakeSchema } from '../components/IntakeForm';
import MessageList, { type Message } from '../components/MessageList';

type Contact = {
  id: string;
  phoneE164: string;
  displayName?: string | null;
};

type Job = {
  id: string;
  status: string;
  summary?: string | null;
  openedAt?: string | null;
  intakeComplete?: boolean;
  contact: Contact;
};

const STATUS_LABELS: Record<string, string> = {
  OPEN_INTAKE: 'En intake',
  READY_FOR_REVIEW: 'Listo para revisar',
  IN_PROGRESS: 'En progreso',
  CLOSED: 'Cerrado',
};

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [intake, setIntake] = useState<Intake>({});
  const [messages, setMessages] = useState<Message[]>([]);
  const [schema, setSchema] = useState<IntakeSchema>({ sections: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [jobData, profile] = await Promise.all([
        api.getJob(id),
        api.getProfile(),
      ]);
      setJob(jobData.job as Job);
      setIntake((jobData.intake ?? {}) as Intake);
      setMessages((jobData.messages ?? []) as Message[]);
      setSchema((profile.intakeSchema ?? { sections: [] }) as IntakeSchema);
      if (jobData.job?.summary) setSummary(jobData.job.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'error al cargar el trabajo');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runAction(action: 'mark_ready' | 'close') {
    if (!id) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await api.jobAction(id, action, action === 'mark_ready' ? summary : undefined);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'error en la acción');
    } finally {
      setActionBusy(false);
    }
  }

  if (loading) return <p>Cargando…</p>;
  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (!job) return <p>Trabajo no encontrado.</p>;

  const name = job.contact.displayName ?? job.contact.phoneE164;
  const statusLabel = STATUS_LABELS[job.status] ?? job.status;

  return (
    <div className="job-detail">
      <div className="job-detail-head">
        <Link to="/" className="back-link">
          ← Trabajos
        </Link>
        <h1>{name}</h1>
        <div className="job-detail-sub">
          <span className={`badge badge-${job.status}`}>{statusLabel}</span>
          <span className="job-detail-phone">{job.contact.phoneE164}</span>
        </div>
      </div>

      <div className="job-detail-grid">
        <section className="job-detail-col">
          <h2>Intake</h2>
          <IntakeForm
            jobId={job.id}
            schema={schema}
            intake={intake}
            onChanged={() => void load()}
          />
        </section>

        <section className="job-detail-col">
          <h2>Acciones</h2>
          <div className="actions-panel">
            <label htmlFor="summary">Resumen</label>
            <textarea
              id="summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Resumen del trabajo (mín. 20 caracteres)"
            />
            {actionError && (
              <p className="error" role="alert">
                {actionError}
              </p>
            )}
            <div className="actions-buttons">
              <button
                type="button"
                onClick={() => void runAction('mark_ready')}
                disabled={actionBusy}
              >
                Marcar listo
              </button>
              <button
                type="button"
                onClick={() => void runAction('close')}
                disabled={actionBusy}
              >
                Cerrar
              </button>
            </div>
          </div>

          <h2>Mensajes</h2>
          <MessageList messages={messages} />
        </section>
      </div>
    </div>
  );
}
