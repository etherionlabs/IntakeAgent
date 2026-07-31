import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api, setPaymentRequiredHandler, type BillingStatus } from '../api/client';

export default function Layout() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [bizName, setBizName] = useState<string>('');
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    // 402 en cualquier endpoint de negocio → la suscripción no está activa.
    setPaymentRequiredHandler(() => navigate('/billing'));
    api.getBillingStatus().then(setBilling).catch(() => {});
    // Nombre del negocio para la barra superior (identidad de la sesión).
    api.getProfile()
      .then((p) => setBizName(String((p.intakeSchema as any)?.$businessName ?? '')))
      .catch(() => {});
  }, [navigate]);

  // Navegar cierra el menú: en móvil ocupa la pantalla y dejarlo abierto tapa
  // la página a la que acabas de entrar.
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [menuOpen]);

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  // La suscripción (Facturación) solo aplica en modo pago; en la v1 gratis no.
  const showBilling = !!billing && billing.status !== 'none';

  return (
    <div className="layout">
      <header className="topbar">
        <button
          type="button"
          className="nav-toggle"
          aria-label="Menú"
          aria-expanded={menuOpen}
          aria-controls="main-nav"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span aria-hidden="true">☰</span>
        </button>
        <span className="brand">Intake</span>
        {bizName && <span className="brand-biz">{bizName}</span>}
        <nav id="main-nav" className={`nav${menuOpen ? ' nav-open' : ''}`}>
          <NavLink to="/" end>Inicio</NavLink>
          <NavLink to="/contacts">Contactos</NavLink>
          <NavLink to="/usage">Uso</NavLink>
          <NavLink to="/whatsapp">WhatsApp</NavLink>
          <NavLink to="/settings">Configuración</NavLink>
          {showBilling && <NavLink to="/billing">Facturación</NavLink>}
          {/* En móvil el menú es el único lugar donde cabe salir. */}
          <button type="button" className="nav-logout" onClick={handleLogout}>
            Salir
          </button>
        </nav>
        <button type="button" className="logout" onClick={handleLogout}>
          Salir
        </button>
      </header>
      {menuOpen && (
        <div className="nav-backdrop" onClick={() => setMenuOpen(false)} aria-hidden="true" />
      )}
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
