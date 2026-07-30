export type ObjectionType = 'precio' | 'tiempo' | 'confianza' | 'competencia' | 'lo_piensa' | 'otro';

export type Objection = {
  type: ObjectionType;
  note: string;
  resolved: boolean;
};

export type SalesDiagnosis = {
  pain?: string;
  implication?: string;
  urgency?: 'alta' | 'media' | 'baja';
  objections?: Objection[];
};

const OBJECTION_LABELS: Record<string, string> = {
  precio: 'Precio',
  tiempo: 'Tiempos',
  confianza: 'Confianza',
  competencia: 'Comparando con otro',
  lo_piensa: 'Lo está pensando',
  otro: 'Otra',
};

const URGENCY_LABELS: Record<string, string> = {
  alta: 'Le urge',
  media: 'Urgencia media',
  baja: 'Sin prisa',
};

/**
 * Por qué el cliente quiere el trabajo y qué le preocupa, antes de cotizar.
 *
 * Es lo que el asistente descubrió conversando y que hasta ahora se quedaba
 * enterrado en el historial: el dueño llegaba a la cotización sabiendo QUÉ pide
 * el cliente, pero no por qué le importa ni qué duda tiene sin resolver.
 */
export default function Diagnosis({ diagnosis }: { diagnosis: SalesDiagnosis | null }) {
  const d = diagnosis ?? {};
  const objections = d.objections ?? [];
  const nothing = !d.pain && !d.implication && !d.urgency && objections.length === 0;

  if (nothing) {
    return (
      <p className="diagnosis-empty">
        El asistente aún no ha profundizado en la necesidad de este cliente.
      </p>
    );
  }

  const open = objections.filter((o) => !o.resolved);

  return (
    <div className="diagnosis">
      {open.length > 0 && (
        <p className="diagnosis-alert">
          {open.length === 1
            ? 'Hay 1 duda del cliente sin resolver.'
            : `Hay ${open.length} dudas del cliente sin resolver.`}
        </p>
      )}

      {d.pain && (
        <div className="diagnosis-row">
          <span className="diagnosis-label">Qué necesita</span>
          <span>{d.pain}</span>
        </div>
      )}
      {d.implication && (
        <div className="diagnosis-row">
          <span className="diagnosis-label">Qué le cuesta no resolverlo</span>
          <span>{d.implication}</span>
        </div>
      )}
      {d.urgency && (
        <div className="diagnosis-row">
          <span className="diagnosis-label">Urgencia</span>
          <span className={`chip chip-urgency-${d.urgency}`}>{URGENCY_LABELS[d.urgency]}</span>
        </div>
      )}

      {objections.length > 0 && (
        <div className="diagnosis-row">
          <span className="diagnosis-label">Dudas que planteó</span>
          <ul className="diagnosis-objections">
            {objections.map((o, i) => (
              <li key={`${o.type}-${i}`} className={o.resolved ? 'resolved' : 'open'}>
                <span className={`badge ${o.resolved ? 'badge-opp-accepted' : 'badge-opp-offered'}`}>
                  {OBJECTION_LABELS[o.type] ?? o.type}
                </span>
                <span>{o.note}</span>
                {!o.resolved && <span className="diagnosis-open-tag">sin resolver</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
