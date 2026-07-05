import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { usePlatformAuth } from '../auth/PlatformAuthContext';

export default function PlatformLogin() {
  const { login } = usePlatformAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await login(username, password);
      navigate('/platform');
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('error inesperado');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="login-form">
      <h1>Intake Platform</h1>
      <label>
        Usuario
        <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
      </label>
      <label>
        Contrasena
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </label>
      {error && <p role="alert" className="error">{error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? 'Entrando...' : 'Entrar'}
      </button>
    </form>
  );
}
