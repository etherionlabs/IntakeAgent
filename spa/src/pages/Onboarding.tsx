import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, type OnboardingState } from '../api/client';

type Step = OnboardingState['step'];

/**
 * Etiqueta humana de cada paso. Antes se imprimía la clave interna
 * ("Paso: awaiting_approval"), que no le dice nada a un dueño de taller.
 */
const STEP_LABELS: Record<Step, string> = {
  verify_email: 'Verifica tu correo',
  subscription: 'Activa tu suscripción',
  provisioning: 'Preparando tu asistente',
  business: 'Datos de tu negocio',
  welcome: 'Mensaje de bienvenida',
  schema: 'Qué datos pedir',
  awaiting_approval: 'Cuenta en revisión',
  whatsapp: 'Conecta tu WhatsApp',
  test: 'Prueba que responde',
  checklist: 'Todo listo',
  done: 'Listo',
};

// Orden visible para el indicador de avance. `provisioning` y `awaiting_approval`
// son esperas, no pasos que el usuario complete: no cuentan en el total.
const PROGRESS_STEPS: Step[] = [
  'verify_email',
  'subscription',
  'business',
  'welcome',
  'schema',
  'whatsapp',
  'test',
  'checklist',
];

function progressFor(step: Step, mode?: string): { current: number; total: number } | null {
  const steps = mode === 'approval'
    ? PROGRESS_STEPS.filter((s) => s !== 'subscription')
    : PROGRESS_STEPS;
  const idx = steps.indexOf(step);
  if (idx < 0) return null;
  return { current: idx + 1, total: steps.length };
}

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

  // Auto-poll mientras se aprovisiona, se espera el QR o la aprobación del operador
  // (la aprobación llega "sola" desde el panel de la plataforma; poll más lento).
  useEffect(() => {
    if (state?.step === 'provisioning' || state?.step === 'whatsapp') {
      const t = setInterval(refresh, 4000);
      return () => clearInterval(t);
    }
    if (state?.step === 'awaiting_approval') {
      const t = setInterval(refresh, 15000);
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

  const progress = progressFor(state.step, state.mode);

  return (
    <div className="onboarding">
      <h1>Configura tu cuenta</h1>
      {progress && (
        <div className="onboarding-progress">
          <div className="onboarding-bar" aria-hidden="true">
            <span style={{ width: `${(progress.current / progress.total) * 100}%` }} />
          </div>
          <p data-testid="onboarding-step">
            Paso {progress.current} de {progress.total} · {STEP_LABELS[state.step]}
          </p>
        </div>
      )}
      {!progress && <p data-testid="onboarding-step">{STEP_LABELS[state.step] ?? state.step}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      <div className="onboarding-card">
        <Step state={state} busy={busy} act={act} navigate={navigate} refresh={refresh} />
      </div>
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
      return <VerifyEmailStep busy={busy} act={act} />;
    case 'subscription':
      return <div>
        <p>Activa tu suscripción para que tu asistente empiece a atender.</p>
        <button className="btn-primary" disabled={busy} onClick={() => act(async () => { const { url } = await api.startCheckout(); window.location.href = url; })}>Suscribirme</button>
      </div>;
    case 'provisioning':
      return <div><p>Preparando tu asistente… esto tarda unos segundos.</p>
        <button disabled={busy} onClick={() => refresh()}>Actualizar</button></div>;
    case 'business':
      return <BusinessStep busy={busy} act={act} />;
    case 'welcome':
      return <WelcomeStep busy={busy} act={act} />;
    case 'schema':
      return <div>
        <p>Tu asistente ya sabe qué datos pedir según tu giro. Puedes ajustarlo después en Configuración.</p>
        <button className="btn-primary" disabled={busy} onClick={() => act(() => api.patchOnboardingSchema(undefined))}>Usar la plantilla y continuar</button>
      </div>;
    case 'awaiting_approval':
      return <div data-testid="awaiting-approval">
        <h2>Tu cuenta está en revisión</h2>
        <p>Ya dejaste todo configurado. Nuestro equipo está revisando tu cuenta;
          te avisaremos por correo cuando quede aprobada para conectar tu WhatsApp.
          Normalmente toma menos de un día hábil.</p>
        <button disabled={busy} onClick={() => refresh()}>Volver a comprobar</button>
      </div>;
    case 'whatsapp':
      return <WhatsAppStep busy={busy} act={act} />;
    case 'test':
      return <div>
        <p>Mándale un WhatsApp a tu propio número desde otro teléfono y confirma que el asistente responde.</p>
        <button className="btn-primary" disabled={busy} onClick={() => act(() => api.onboardingFlag({ testDone: true }))}>Ya hice la prueba</button>
      </div>;
    case 'checklist':
      return <div>
        <p>¡Todo listo! Correo verificado, {state.mode === 'approval' ? 'cuenta aprobada' : 'suscripción activa'}, WhatsApp conectado, configuración guardada y prueba exitosa.</p>
        <button className="btn-primary" disabled={busy} onClick={() => act(async () => { await api.completeOnboarding(); navigate('/'); })}>Ir al panel</button>
      </div>;
    default:
      return <p>Redirigiendo…</p>;
  }
}

/**
 * El reenvío exige el correo: el endpoint valida formato de email y la versión
 * anterior mandaba una cadena vacía, así que el botón siempre daba 400.
 */
function VerifyEmailStep({ busy, act }: { busy: boolean; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  return <div>
    <p>Te enviamos un enlace de verificación. Ábrelo para continuar.</p>
    <p className="onboarding-hint">¿No te llegó? Revisa el correo no deseado o pídelo de nuevo.</p>
    <label>Tu correo
      <input
        type="email"
        value={email}
        placeholder="tu@correo.com"
        onChange={(e) => { setEmail(e.target.value); setSent(false); }}
      />
    </label>
    <button
      disabled={busy || !email.includes('@')}
      onClick={() => act(async () => { await api.resendVerification(email); setSent(true); })}
    >
      Reenviar enlace
    </button>
    {sent && <p className="onboarding-ok">Si ese correo tiene una cuenta pendiente, ya va en camino.</p>}
  </div>;
}

function BusinessStep({ busy, act }: { busy: boolean; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  return <div>
    <label>Nombre del negocio<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Wrap Studio MX" /></label>
    <label>Tu WhatsApp (aquí te avisamos de cada trabajo listo)
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+52 55 1234 5678" />
    </label>
    <button className="btn-primary" disabled={busy} onClick={() => act(() => api.patchOnboardingBusiness({ businessName: name || undefined, ownerPhoneE164: phone || undefined }))}>Guardar y continuar</button>
  </div>;
}

function WelcomeStep({ busy, act }: { busy: boolean; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [welcome, setWelcome] = useState('');
  return <div>
    <label>Mensaje de bienvenida
      <textarea
        value={welcome}
        onChange={(e) => setWelcome(e.target.value)}
        placeholder="¡Hola! Soy el asistente de… ¿En qué te puedo ayudar?"
      />
    </label>
    <p className="onboarding-hint">Es lo primero que lee un cliente que te escribe por primera vez.</p>
    <button className="btn-primary" disabled={busy || !welcome} onClick={() => act(() => api.patchOnboardingWelcome(welcome))}>Guardar y continuar</button>
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
    <p>En tu teléfono abre <strong>WhatsApp → Dispositivos vinculados → Vincular un dispositivo</strong> y escanea este código.</p>
    {qr && !connected && <pre data-testid="qr">{qr}</pre>}
    {!qr && !connected && <p className="onboarding-hint">Generando el código…</p>}
    {connected && <p className="onboarding-ok">✅ Conectado.</p>}
    <button className="btn-primary" disabled={busy || !connected} onClick={() => act(() => api.onboardingFlag({ whatsappLinked: true }))}>Continuar</button>
  </div>;
}
