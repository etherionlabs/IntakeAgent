import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, type OnboardingState } from '../api/client';

export default function Onboarding() {
  const navigate = useNavigate();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try { setState(await api.getOnboardingState()); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'error'); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Auto-poll mientras se aprovisiona o se espera el QR.
  useEffect(() => {
    if (state?.step === 'provisioning' || state?.step === 'whatsapp') {
      const t = setInterval(refresh, 4000);
      return () => clearInterval(t);
    }
  }, [state?.step, refresh]);

  useEffect(() => { if (state?.step === 'done') navigate('/'); }, [state?.step, navigate]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); await refresh(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'error'); }
    finally { setBusy(false); }
  }

  if (error && !state) return <div className="onboarding"><p role="alert" className="error">{error}</p></div>;
  if (!state) return <div className="onboarding"><p>Cargando…</p></div>;

  return (
    <div className="onboarding">
      <h1>Configura tu cuenta</h1>
      <p data-testid="onboarding-step">Paso: {state.step}</p>
      {error && <p role="alert" className="error">{error}</p>}
      <Step state={state} busy={busy} act={act} navigate={navigate} refresh={refresh} />
    </div>
  );
}

function Step({ state, busy, act, navigate, refresh }: {
  state: OnboardingState; busy: boolean;
  act: (fn: () => Promise<unknown>) => Promise<void>;
  navigate: (p: string) => void; refresh: () => Promise<void>;
}) {
  switch (state.step) {
    case 'verify_email':
      return <div><p>Verifica tu correo con el enlace que te enviamos. ¿No llegó?</p>
        <button disabled={busy} onClick={() => act(() => api.resendVerification(''))}>Reenviar (usa tu email)</button></div>;
    case 'subscription':
      return <button disabled={busy} onClick={() => act(async () => { const { url } = await api.startCheckout(); window.location.href = url; })}>Suscribirme</button>;
    case 'provisioning':
      return <div><p>Preparando tu bot… esto tarda unos segundos.</p>
        <button disabled={busy} onClick={() => refresh()}>Actualizar</button></div>;
    case 'business':
      return <BusinessStep busy={busy} act={act} />;
    case 'welcome':
      return <WelcomeStep busy={busy} act={act} />;
    case 'schema':
      return <div><p>Tu formulario de intake viene precargado según tu giro. Puedes editarlo luego en Configuración.</p>
        <button disabled={busy} onClick={() => act(() => api.patchOnboardingSchema(undefined))}>Usar la plantilla y continuar</button></div>;
    case 'whatsapp':
      return <WhatsAppStep busy={busy} act={act} />;
    case 'test':
      return <div><p>Envía un WhatsApp de prueba a tu bot y confirma que responde.</p>
        <button disabled={busy} onClick={() => act(() => api.onboardingFlag({ testDone: true }))}>Ya hice la prueba</button></div>;
    case 'checklist':
      return <div>
        <p>¡Todo listo! Email verificado, suscripción activa, bot vinculado, configuración guardada y prueba exitosa.</p>
        <button disabled={busy} onClick={() => act(async () => { await api.completeOnboarding(); navigate('/'); })}>Ir al panel</button>
      </div>;
    default:
      return <p>Redirigiendo…</p>;
  }
}

function BusinessStep({ busy, act }: { busy: boolean; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  return <div>
    <label>Nombre del negocio<input value={name} onChange={(e) => setName(e.target.value)} /></label>
    <label>WhatsApp del dueño (para avisos)<input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+52..." /></label>
    <button disabled={busy} onClick={() => act(() => api.patchOnboardingBusiness({ businessName: name || undefined, ownerPhoneE164: phone || undefined }))}>Guardar y continuar</button>
  </div>;
}

function WelcomeStep({ busy, act }: { busy: boolean; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [welcome, setWelcome] = useState('');
  return <div>
    <label>Mensaje de bienvenida<textarea value={welcome} onChange={(e) => setWelcome(e.target.value)} /></label>
    <button disabled={busy || !welcome} onClick={() => act(() => api.patchOnboardingWelcome(welcome))}>Guardar y continuar</button>
  </div>;
}

function WhatsAppStep({ busy, act }: { busy: boolean; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [qr, setQr] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try { const s = await api.getWaStatus(); if (!alive) return; setQr(s.qr); setConnected(s.connected); } catch { /* ignore */ }
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return <div>
    <p>Escanea el código con WhatsApp → Dispositivos vinculados.</p>
    {qr && !connected && <pre data-testid="qr">{qr}</pre>}
    {connected && <p>✅ Conectado.</p>}
    <button disabled={busy || !connected} onClick={() => act(() => api.onboardingFlag({ whatsappLinked: true }))}>Continuar</button>
  </div>;
}
