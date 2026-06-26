import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';

const INDUSTRIES = [
  { value: 'tapiceria', label: 'Tapicería' },
  { value: 'paqueteria', label: 'Paquetería' },
  { value: 'generico', label: 'Otro / Servicios' },
];

export default function Signup() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [industry, setIndustry] = useState('tapiceria');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedWhatsappRisk, setAcceptedWhatsappRisk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api.signup({ email, password, businessName, industry, acceptedTerms, acceptedWhatsappRisk });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'error inesperado');
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="signup-done">
        <h1>Revisa tu correo</h1>
        <p>Te enviamos un enlace de verificación a <strong>{email}</strong>. Ábrelo para activar tu cuenta.</p>
        <Link to="/login">Ir a iniciar sesión</Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="signup-form">
      <h1>Crear cuenta</h1>
      <label>Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
      </label>
      <label>Contraseña
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </label>
      <label>Nombre del negocio
        <input type="text" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
      </label>
      <label>Giro
        <select value={industry} onChange={(e) => setIndustry(e.target.value)}>
          {INDUSTRIES.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
        </select>
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={acceptedTerms} onChange={(e) => setAcceptedTerms(e.target.checked)} />
        Acepto los <Link to="/terms">Términos</Link>, la <Link to="/privacy">Privacidad</Link> y el <Link to="/dpa">DPA</Link>.
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={acceptedWhatsappRisk} onChange={(e) => setAcceptedWhatsappRisk(e.target.checked)} />
        Entiendo y acepto el <Link to="/whatsapp-policy">riesgo del canal de WhatsApp</Link> (no oficial).
      </label>
      {error && <p role="alert" className="error">{error}</p>}
      <button type="submit" disabled={pending || !acceptedTerms || !acceptedWhatsappRisk}>{pending ? 'Creando…' : 'Crear cuenta'}</button>
      <p>¿Ya tienes cuenta? <Link to="/login">Inicia sesión</Link></p>
    </form>
  );
}
