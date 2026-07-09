import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'error inesperado');
    } finally {
      setPending(false);
    }
  }

  if (!token) {
    return (
      <div className="login-form">
        <h1>Enlace inválido</h1>
        <p className="auth-alt">El enlace de recuperación no es válido o expiró.</p>
        <Link className="auth-alt" to="/forgot-password">Solicitar uno nuevo</Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="login-form">
        <h1>Contraseña actualizada</h1>
        <p className="auth-alt">Ya puedes iniciar sesión con tu nueva contraseña.</p>
        <Link className="auth-alt" to="/login">Ir a iniciar sesión</Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="login-form">
      <h1>Nueva contraseña</h1>
      <label>
        Contraseña nueva
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
      </label>
      {error && <p role="alert" className="error">{error}</p>}
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? 'Guardando…' : 'Guardar contraseña'}
      </button>
    </form>
  );
}
