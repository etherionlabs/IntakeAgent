import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    if (!token) { setState('error'); return; }
    api.verifyEmail(token).then(() => setState('ok')).catch(() => setState('error'));
  }, [token]);

  if (state === 'loading') return <div className="verify"><p>Verificando…</p></div>;
  if (state === 'error') {
    return (
      <div className="verify">
        <h1>Enlace inválido o expirado</h1>
        <p>Pide un nuevo enlace de verificación desde el inicio de sesión.</p>
        <Link to="/login">Ir a iniciar sesión</Link>
      </div>
    );
  }
  return (
    <div className="verify">
      <h1>¡Correo verificado!</h1>
      <p>Tu cuenta está confirmada. Inicia sesión para continuar con la configuración.</p>
      <Link to="/login">Continuar</Link>
    </div>
  );
}
