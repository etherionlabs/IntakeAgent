import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function ProtectedRoute() {
  const { user, loading } = useAuth();
  // Mientras se rehidrata la sesión (/auth/me) no decidimos: evita un parpadeo
  // a /login antes de saber si la cookie es válida.
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}
