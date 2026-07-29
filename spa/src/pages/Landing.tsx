import { Link } from 'react-router-dom';

export default function Landing() {
  return (
    <div className="landing">
      <header className="landing-hero">
        <p className="landing-eyebrow">Asistente de WhatsApp para negocios de servicio</p>
        <h1>No solo toma el pedido. Vende.</h1>
        <p className="landing-sub">
          Intake atiende a tus clientes por WhatsApp, entiende qué necesitan y les ofrece
          los servicios que de verdad les convienen. Tú recibes la orden de trabajo
          completa, con los extras que el cliente ya aceptó.
        </p>
        <Link to="/signup" className="cta">Empieza gratis</Link>
        <p className="landing-note">Sin tarjeta. Conectas tu WhatsApp con un código QR.</p>
      </header>

      <section className="landing-section">
        <h2>Lo que hace mientras trabajas</h2>
        <div className="landing-cards">
          <article className="landing-card">
            <h3>Levanta el trabajo</h3>
            <p>
              Pregunta lo que hace falta —vehículo, medidas, dirección, fotos— y no
              vuelve a preguntar lo que ya sabe. Cuando está completo, te avisa.
            </p>
          </article>
          <article className="landing-card">
            <h3>Ofrece lo que suma</h3>
            <p>
              Si alguien pide un wrap, le propone polarizado a juego; si trae el auto a
              reparación, sugiere revisar frenos de una vez. Solo lo que aplica a su
              caso, sin inventar precios y sin insistir.
            </p>
          </article>
          <article className="landing-card">
            <h3>Da seguimiento solo</h3>
            <p>
              Cuando un cliente deja de responder, le escribe para retomar lo que quedó
              en el aire. En tu horario, con un tope, y nunca a quien ya dijo que no.
            </p>
          </article>
          <article className="landing-card">
            <h3>Te deja todo listo</h3>
            <p>
              En el panel ves qué cotizar, quién está esperando y cuántos clientes
              aceptaron un servicio adicional este mes.
            </p>
          </article>
        </div>
      </section>

      <section className="landing-section">
        <h2>Cómo empiezas</h2>
        <ol className="landing-steps">
          <li>Creas tu cuenta y eliges tu giro: taller, cerrajería, plomería, tapicería…</li>
          <li>Conectas tu WhatsApp escaneando un código QR, como en WhatsApp Web.</li>
          <li>Le mandas un mensaje de prueba y ya está atendiendo.</li>
        </ol>
        <p className="landing-note">
          Viene configurado según tu giro; puedes ajustar el tono, los datos que pide y
          qué ofrece, desde el panel y sin tocar código.
        </p>
      </section>

      <section className="landing-section landing-honest">
        <h2>Lo que debes saber antes</h2>
        <ul>
          <li>
            Usamos una integración <strong>no oficial</strong> de WhatsApp. Léela en la{' '}
            <Link to="/whatsapp-policy">política de uso</Link> antes de empezar.
          </li>
          <li>
            El asistente <strong>no cotiza precios</strong>: prepara la orden con todo lo
            que el cliente quiere y el número lo pones tú.
          </li>
          <li>
            El seguimiento automático viene <strong>apagado</strong>. Tú decides si lo
            enciendes.
          </li>
        </ul>
      </section>

      <section className="landing-section landing-cta-final">
        <h2>Pruébalo con tus clientes</h2>
        <p>Empieza gratis y conéctalo en unos minutos.</p>
        <Link to="/signup" className="cta">Crear mi cuenta</Link>
        <p className="landing-note">
          ¿Ya tienes cuenta? <Link to="/login">Inicia sesión</Link>
        </p>
      </section>

      <footer className="landing-footer">
        <Link to="/terms">Términos</Link> · <Link to="/privacy">Privacidad</Link> ·{' '}
        <Link to="/dpa">DPA</Link> · <span>soporte@intake.app</span>
      </footer>
    </div>
  );
}
