import { Link } from 'react-router-dom';
import { relativeTime, absoluteTime } from '../lib/time';

type Contact = {
  id: string;
  phoneE164: string;
  displayName?: string | null;
  botActive?: boolean;
  flaggedNonIntake?: boolean;
};

export type Job = {
  id: string;
  status: string;
  summary?: string | null;
  openedAt?: string | null;
  readyAt?: string | null;
  closedAt?: string | null;
  intakeComplete?: boolean;
  contact: Contact;
};

const STATUS_LABELS: Record<string, string> = {
  OPEN_INTAKE: 'En intake',
  READY_FOR_REVIEW: 'Listo para revisar',
  IN_PROGRESS: 'En progreso',
  CLOSED: 'Cerrado',
};

export default function JobCard({ job }: { job: Job }) {
  const name = job.contact.displayName ?? job.contact.phoneE164;
  // Relativo, no absoluto: lo que importa es cuánto lleva esperando el cliente.
  const opened = relativeTime(job.openedAt);
  const statusLabel = STATUS_LABELS[job.status] ?? job.status;

  return (
    <Link className="job-card" to={`/jobs/${job.id}`}>
      <div className="job-card-head">
        <span className="job-card-name">{name}</span>
        <span className={`badge badge-${job.status}`}>{statusLabel}</span>
      </div>
      {opened && (
        <div className="job-card-meta" title={absoluteTime(job.openedAt)}>
          {opened}
        </div>
      )}
      {job.summary && <p className="job-card-summary">{job.summary}</p>}
    </Link>
  );
}
