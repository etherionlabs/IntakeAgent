export type OpportunityStatus = 'offered' | 'accepted' | 'declined';

export type Opportunity = {
  service: string;
  status: OpportunityStatus;
  note?: string;
  updated_at?: string;
};

const STATUS_LABELS: Record<OpportunityStatus, string> = {
  accepted: 'Aceptado',
  offered: 'Ofrecido',
  declined: 'Rechazado',
};

// Los aceptados primero: son los que el dueño tiene que meter en la cotización.
const ORDER: Record<OpportunityStatus, number> = { accepted: 0, offered: 1, declined: 2 };

/**
 * Servicios adicionales que el asistente movió en la conversación. Le dice al
 * dueño qué cotizar de más (aceptados), qué sigue en el aire (ofrecidos) y qué
 * ya no vale la pena insistir (rechazados).
 */
export default function Opportunities({ items }: { items: Opportunity[] }) {
  if (items.length === 0) {
    return (
      <p className="opportunities-empty">
        El asistente aún no ha ofrecido servicios adicionales en esta conversación.
      </p>
    );
  }

  const sorted = [...items].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const acceptedCount = items.filter((o) => o.status === 'accepted').length;

  return (
    <div className="opportunities">
      {acceptedCount > 0 && (
        <p className="opportunities-hint">
          {acceptedCount === 1
            ? 'El cliente aceptó 1 servicio adicional — inclúyelo en la cotización.'
            : `El cliente aceptó ${acceptedCount} servicios adicionales — inclúyelos en la cotización.`}
        </p>
      )}
      <ul className="opportunity-list">
        {sorted.map((o, i) => (
          <li className="opportunity" key={`${o.service}-${i}`}>
            <span className={`badge badge-opp-${o.status}`}>{STATUS_LABELS[o.status]}</span>
            <span className="opportunity-service">{o.service}</span>
            {o.note && <span className="opportunity-note">{o.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
