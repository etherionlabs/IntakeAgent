import { Link } from 'react-router-dom';

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

function formatDate(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

export default function JobCard({ job }: { job: Job }) {
  const name = job.contact.displayName ?? job.contact.phoneE164;
  const opened = formatDate(job.openedAt);
  const statusLabel = STATUS_LABELS[job.status] ?? job.status;

  return (
    <Link className="job-card" to={`/jobs/${job.id}`}>
      <div className="job-card-head">
        <span className="job-card-name">{name}</span>
        <span className={`badge badge-${job.status}`}>{statusLabel}</span>
      </div>
      {opened && <div className="job-card-meta">{opened}</div>}
      {job.summary && <p className="job-card-summary">{job.summary}</p>}
    </Link>
  );
}
