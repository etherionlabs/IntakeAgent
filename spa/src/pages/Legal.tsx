import { Link } from 'react-router-dom';

interface Doc { title: string; intro: string; }

// Resúmenes de las rutas legales. El texto completo (docs/legal/*.md) es borrador
// de ingeniería y debe validarse con abogado antes de cobrar.
const DOCS: Record<string, Doc> = {
  terms: { title: 'Términos de Servicio', intro: 'Condiciones de uso del servicio Intake. El canal de WhatsApp se ofrece "tal cual"; incorpora por referencia el DPA.' },
  privacy: { title: 'Política de Privacidad', intro: 'Qué datos tratamos (teléfono, mensajes, intake), con qué finalidad, sub-encargados (OpenRouter, Stripe, email, hosting), retención y cómo ejercer acceso/borrado.' },
  dpa: { title: 'Acuerdo de Tratamiento de Datos (DPA)', intro: 'Tú eres el responsable del tratamiento de los datos de tus clientes; nosotros, el encargado. Lista de sub-encargados y tus obligaciones de base legal.' },
  whatsapp_policy: { title: 'Política de uso de WhatsApp', intro: 'Usamos una integración no oficial (Baileys). Existe riesgo de bloqueo del número del negocio por parte de WhatsApp. Buenas prácticas anti-ban y deslinde.' },
};

export default function Legal({ doc }: { doc: keyof typeof DOCS }) {
  const d = DOCS[doc];
  return (
    <div className="legal-page">
      <h1>{d.title}</h1>
      <p>{d.intro}</p>
      <p className="muted">Documento vigente versión 2026-06-18. Borrador de ingeniería pendiente de validación legal por jurisdicción.</p>
      <p><Link to="/signup">Volver al registro</Link> · <Link to="/landing">Inicio</Link></p>
    </div>
  );
}
