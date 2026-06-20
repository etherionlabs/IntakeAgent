import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function Layout() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <div className="layout">
      <header className="topbar">
        <span className="brand">Intake</span>
        <nav className="nav">
          <NavLink to="/" end>Jobs</NavLink>
          <NavLink to="/contacts">Contactos</NavLink>
          <NavLink to="/usage">Uso</NavLink>
          <NavLink to="/whatsapp">WhatsApp</NavLink>
          <NavLink to="/settings">Configuración</NavLink>
        </nav>
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
