import { Outlet, useNavigate } from 'react-router-dom';
import { usePlatformAuth } from '../auth/PlatformAuthContext';

export default function PlatformLayout() {
  const { user, logout } = usePlatformAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/platform/login');
  }

  return (
    <div className="layout platform-layout">
      <header className="topbar">
        <span className="brand">Intake Platform</span>
        <span className="platform-user">{user?.username}</span>
        <button type="button" className="logout" onClick={handleLogout}>
          Salir
        </button>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
