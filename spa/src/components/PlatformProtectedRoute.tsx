import { Navigate, Outlet } from 'react-router-dom';
import { usePlatformAuth } from '../auth/PlatformAuthContext';

export default function PlatformProtectedRoute() {
  const { token } = usePlatformAuth();
  if (!token) return <Navigate to="/platform/login" replace />;
  return <Outlet />;
}
