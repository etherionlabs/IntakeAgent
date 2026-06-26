import { Link } from 'react-router-dom';

export default function Landing() {
  return (
    <div className="landing">
      <header className="landing-hero">
        <h1>Tu recepcionista de WhatsApp que nunca duerme</h1>
        <p>Intake atiende a tus clientes por WhatsApp, levanta los datos de cada trabajo y te avisa cuando algo está listo para revisar.</p>
        <Link to="/signup" className="cta">Empieza gratis</Link>
      </header>

      <section>
        <h2>Cómo funciona</h2>
        <ol>
          <li>Regístrate y conecta tu WhatsApp con un código QR.</li>
          <li>Configura tu giro y qué datos quieres recoger (plantillas por industria).</li>
          <li>Deja que atienda: ves todo ordenado en el panel y recibes avisos.</li>
        </ol>
      </section>

      <section>
        <h2>Precios</h2>
        <p>Suscripción mensual fija. <Link to="/signup">Crear cuenta</Link>.</p>
      </section>

      <section className="transparency">
        <p>Usamos una integración no oficial de WhatsApp. Lee la <Link to="/whatsapp-policy">política de uso de WhatsApp</Link> antes de empezar.</p>
      </section>

      <footer className="landing-footer">
        <Link to="/terms">Términos</Link> · <Link to="/privacy">Privacidad</Link> · <Link to="/dpa">DPA</Link> · <span>soporte@intake.app</span>
      </footer>
    </div>
  );
}
