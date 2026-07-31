import type { Overview } from '../api/client';

function pct(part: number, total: number): string {
  if (total <= 0) return '—';
  return `${Math.round((part / total) * 100)}%`;
}

/**
 * ¿Está vendiendo el asistente? Sin esto el dueño no tiene forma de saber si la
 * venta proactiva le sirve: los datos ya existen (oportunidades, resultado del
 * trabajo, seguimientos), solo que nunca salían de la base.
 */
export default function SalesSummary({ overview }: { overview: Overview }) {
  const f = overview.funnel;

  if (f.jobs === 0) {
    return (
      <section className="sales-summary sales-summary-empty">
        <h2>Tu venta</h2>
        <p>
          Aún no hay trabajos en los últimos {f.windowDays} días. Cuando los haya, aquí verás
          cuántos clientes aceptaron un servicio adicional y cuántos cerraron.
        </p>
      </section>
    );
  }

  const decided = f.won + f.lost;

  return (
    <section className="sales-summary">
      <h2>
        Tu venta <span className="sales-window">últimos {f.windowDays} días</span>
      </h2>
      <div className="sales-stats">
        <div className="stat">
          <span className="stat-value">{f.jobs}</span>
          <span className="stat-label">trabajos</span>
        </div>
        <div className="stat">
          <span className="stat-value">{f.withOffer}</span>
          <span className="stat-label">con extra ofrecido</span>
          <span className="stat-sub">{pct(f.withOffer, f.jobs)} de los trabajos</span>
        </div>
        <div className="stat stat-highlight">
          <span className="stat-value">{f.withAccepted}</span>
          <span className="stat-label">aceptaron un extra</span>
          <span className="stat-sub">
            {f.withOffer > 0 ? `${pct(f.withAccepted, f.withOffer)} de los ofrecidos` : '—'}
          </span>
        </div>
        <div className="stat">
          <span className="stat-value">
            {f.won}
            {decided > 0 && <span className="stat-of"> / {decided}</span>}
          </span>
          <span className="stat-label">ganados</span>
          <span className="stat-sub">
            {decided > 0 ? `${pct(f.won, decided)} de cierre` : 'sin resultados marcados'}
          </span>
        </div>
        <div className="stat">
          <span className="stat-value">{f.followUps}</span>
          <span className="stat-label">seguimientos del bot</span>
        </div>
      </div>
      {decided === 0 && (
        <p className="sales-hint">
          Marca tus trabajos como <strong>ganado</strong> o <strong>perdido</strong> al cerrarlos
          para ver tu tasa de cierre.
        </p>
      )}
    </section>
  );
}
