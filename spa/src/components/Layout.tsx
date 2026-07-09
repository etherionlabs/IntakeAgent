import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api, setPaymentRequiredHandler, type BillingStatus } from '../api/client';

export default function Layout() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [bizName, setBizName] = useState<string>('');

  useEffect(() => {
    // 402 en cualquier endpoint de negocio → la suscripción no está activa.
    setPaymentRequiredHandler(() => navigate('/billing'));
    api.getBillingStatus().then(setBilling).catch(() => {});
    // Nombre del negocio para la barra superior (identidad de la sesión).
    api.getProfile()
      .then((p) => setBizName(String((p.intakeSchema as any)?.$businessName ?? '')))
      .catch(() => {});
  }, [navigate]);

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  // La suscripción (Facturación) solo aplica en modo pago; en la v1 gratis no.
  const showBilling = !!billing && billing.status !== 'none';

  return (
    <div className="layout">
      <header className="topbar">
        <span className="brand">Intake</span>
        {bizName && <span className="brand-biz">{bizName}</span>}
        <nav className="nav">
          <NavLink to="/" end>Trabajos</NavLink>
          <NavLink to="/contacts">Contactos</NavLink>
          <NavLink to="/usage">Uso</NavLink>
          <NavLink to="/whatsapp">WhatsApp</NavLink>
          <NavLink to="/settings">Configuración</NavLink>
          {showBilling && <NavLink to="/billing">Facturación</NavLink>}
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
