import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api, setPaymentRequiredHandler, type BillingStatus } from '../api/client';

export default function Layout() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [billing, setBilling] = useState<BillingStatus | null>(null);

  useEffect(() => {
    // 402 en cualquier endpoint de negocio → la suscripción no está activa.
    setPaymentRequiredHandler(() => navigate('/billing'));
    api.getBillingStatus().then(setBilling).catch(() => {});
  }, [navigate]);

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
          <NavLink to="/billing">Facturación</NavLink>
        </nav>
        <button type="button" className="logout" onClick={handleLogout}>
          Salir
        </button>
      </header>
      {billing?.status === 'past_due' && (
        <div role="alert" className="billing-banner">
          Tu último pago falló. <NavLink to="/billing">Actualiza tu método de pago</NavLink> para no perder el servicio.
        </div>
      )}
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
