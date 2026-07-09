import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api.forgotPassword(email);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'error inesperado');
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="login-form">
        <h1>Revisa tu correo</h1>
        <p className="auth-alt">
          Si <strong>{email}</strong> tiene una cuenta, te enviamos un enlace para
          restablecer tu contraseña.
        </p>
        <Link className="auth-alt" to="/login">Volver a iniciar sesión</Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="login-form">
      <h1>Recuperar contraseña</h1>
      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
        />
      </label>
      {error && <p role="alert" className="error">{error}</p>}
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? 'Enviando…' : 'Enviar enlace'}
      </button>
      <Link className="auth-alt" to="/login">Volver a iniciar sesión</Link>
    </form>
  );
}
