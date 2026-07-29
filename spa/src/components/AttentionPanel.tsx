import { Link } from 'react-router-dom';
import type { Overview } from '../api/client';
import { relativeTime, absoluteTime } from '../lib/time';

const WAITING_REASONS: Record<string, string> = {
  bot_paused: 'pausaste el bot con este cliente',
  flagged: 'marcado como spam — el bot no responde',
  no_reply: 'el bot no alcanzó a responder',
};

/**
 * Lo que el dueño tiene que hacer AHORA. Va arriba de todo porque el tablero de
 * trabajos no distingue urgencias: ahí un trabajo cerrado hace meses pesa lo
 * mismo que uno listo hace diez minutos.
 */
export default function AttentionPanel({ overview }: { overview: Overview }) {
  const { pendingQuotes, readyForReview, waiting } = overview.attention;
  const nothingToDo =
    pendingQuotes.length === 0 && readyForReview === 0 && waiting.length === 0;

  if (nothingToDo) {
    return (
      <section className="attention attention-clear">
        <h2>Todo al día</h2>
        <p>No tienes nada pendiente por revisar. El asistente sigue atendiendo.</p>
      </section>
    );
  }

  return (
    <section className="attention">
      <h2>Necesita tu atención</h2>

      {pendingQuotes.length > 0 && (
        <div className="attention-block attention-quotes">
          <h3>
            Por cotizar
            <span className="attention-count">{pendingQuotes.length}</span>
          </h3>
          <p className="attention-hint">
            Estos clientes aceptaron servicios adicionales. Inclúyelos en la cotización.
          </p>
          <ul className="attention-list">
            {pendingQuotes.map((q) => (
              <li key={q.jobId}>
                <Link to={`/jobs/${q.jobId}`}>
                  <span className="attention-name">{q.contactName}</span>
                  <span className="attention-services">
                    {q.services.map((s) => (
                      <span className="chip" key={s}>
                        {s}
                      </span>
                    ))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {readyForReview > 0 && (
        <div className="attention-block">
          <h3>
            Listos para revisar
            <span className="attention-count">{readyForReview}</span>
          </h3>
          <p className="attention-hint">
            El asistente ya tomó todos los datos y el cliente confirmó.
          </p>
        </div>
      )}

      {waiting.length > 0 && (
        <div className="attention-block attention-waiting">
          <h3>
            Esperando respuesta
            <span className="attention-count">{waiting.length}</span>
          </h3>
          <p className="attention-hint">
            Te escribieron y nadie contestó. Entra tú a la conversación.
          </p>
          <ul className="attention-list">
            {waiting.map((w) => (
              <li key={w.jobId}>
                <Link to={`/jobs/${w.jobId}`}>
                  <span className="attention-name">{w.contactName}</span>
                  <span className="attention-meta" title={absoluteTime(w.since)}>
                    {relativeTime(w.since)} · {WAITING_REASONS[w.reason] ?? w.reason}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
