// En producción (SPA desplegado) usamos SIEMPRE el proxy de mismo origen `/api`
// (ver spa/public/_redirects) para que la cookie de sesión sea first-party y el
// navegador no la bloquee como cookie de terceros. En dev, VITE_API_URL o localhost.
const BASE = import.meta.env.PROD ? '/api' : (import.meta.env.VITE_API_URL ?? 'http://localhost:3001');

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/**
 * URL del archivo de imagen de un mensaje (foto entrante o previsualización). Se
 * usa como `src` de un <img>; en producción es mismo-origen (`/api/...`), así que
 * el navegador manda la cookie de sesión.
 */
export function mediaUrl(messageId: string): string {
  return `${BASE}/messages/${encodeURIComponent(messageId)}/media`;
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn; }
let onPlatformUnauthorized: (() => void) | null = null;
export function setPlatformUnauthorizedHandler(fn: () => void) { onPlatformUnauthorized = fn; }

let onPaymentRequired: (() => void) | null = null;
export function setPaymentRequiredHandler(fn: () => void) { onPaymentRequired = fn; }

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// La cookie CSRF (intake_csrf) NO es HttpOnly: la reflejamos en el header
// x-csrf-token en las mutaciones (double-submit).
function readCsrfCookie(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)intake_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  // OJO: solo enviar content-type cuando HAY body. Fastify responde 400 si llega
  // content-type:application/json con body vacío (pasa en DELETE y POST sin cuerpo,
  // ej. eliminar contacto o desvincular WhatsApp).
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (MUTATING.has(method)) {
    const csrf = readCsrfCookie();
    if (csrf) headers['x-csrf-token'] = csrf;
  }
  // credentials:'include' envía/recibe la cookie de sesión HttpOnly cross-site.
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { onUnauthorized?.(); throw new ApiError(401, 'no autorizado'); }
  // 402: suscripción inactiva. Solo lo emiten rutas de negocio (no /billing/*).
  if (res.status === 402) { onPaymentRequired?.(); throw new ApiError(402, 'suscripción inactiva'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as any)?.error ?? `error ${res.status}`);
  return data as T;
}

function getPlatformToken(): string | null { return localStorage.getItem('intake_platform_token'); }

async function platformRequest<T>(method: string, path: string, body?: unknown, tokenOverride?: string | null): Promise<T> {
  const headers: Record<string, string> = {};
  const token = tokenOverride === undefined ? getPlatformToken() : tokenOverride;
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { onPlatformUnauthorized?.(); throw new ApiError(401, 'no autorizado'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as any)?.error ?? `error ${res.status}`);
  return data as T;
}

export const api = {
  login: (email: string, password: string) => request<{ user: any }>('POST', '/auth/login', { email, password }),
  logout: () => request<{ ok: boolean }>('POST', '/auth/logout'),
  me: () => request<{ user: any }>('GET', '/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>('POST', '/auth/change-password', { currentPassword, newPassword }),
  forgotPassword: (email: string) => request<{ ok: boolean }>('POST', '/auth/forgot-password', { email }),
  resetPassword: (token: string, newPassword: string) =>
    request<{ ok: boolean }>('POST', '/auth/reset-password', { token, newPassword }),
  getProfile: () => request<{ intakeSchema: any }>('GET', '/profile'),
  getJobs: (status?: string, includeArchived = false) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (includeArchived) params.set('includeArchived', 'true');
    const qs = params.toString();
    return request<{ jobs: any[] }>('GET', `/jobs${qs ? `?${qs}` : ''}`);
  },
  archiveJob: (id: string) => request<{ ok: boolean; job: any }>('POST', `/jobs/${id}/archive`),
  restoreJob: (id: string) => request<{ ok: boolean; job: any }>('POST', `/jobs/${id}/restore`),
  deleteJob: (id: string) => request<{ ok: boolean }>('DELETE', `/jobs/${id}`),
  getJob: (id: string) => request<{ job: any; intake: any; messages: any[] }>('GET', `/jobs/${id}`),
  patchIntake: (id: string, payload: { path: string; value?: unknown; declined?: boolean; declined_reason?: string }) => request<{ ok: boolean; intake: any }>('PATCH', `/jobs/${id}/intake`, payload),
  jobAction: (id: string, action: 'mark_ready' | 'close', summary?: string, outcome?: 'WON' | 'LOST') =>
    request<{ ok: boolean; status: string; outcome?: string | null }>('POST', `/jobs/${id}/actions`, { action, summary, outcome }),
  getContacts: (includeArchived = false) =>
    request<{ contacts: any[] }>('GET', `/contacts${includeArchived ? '?includeArchived=true' : ''}`),
  toggleContact: (id: string, botPaused: boolean) => request<{ ok: boolean; contact: any }>('PATCH', `/contacts/${id}`, { botPaused }),
  updateContact: (id: string, payload: { displayName?: string; unflag?: boolean }) =>
    request<{ ok: boolean; contact: any }>('PATCH', `/contacts/${id}`, payload),
  archiveContact: (id: string) => request<{ ok: boolean; contact: any }>('POST', `/contacts/${id}/archive`),
  restoreContact: (id: string) => request<{ ok: boolean; contact: any }>('POST', `/contacts/${id}/restore`),
  deleteContact: (id: string) => request<{ ok: boolean }>('DELETE', `/contacts/${id}`),
  getOverview: () => request<Overview>('GET', '/overview'),
  getUsage: () => request<{ totals: any; recent: any[]; mode?: string; approvalStatus?: string; plan?: UsagePlan | null }>('GET', '/usage'),
  getWaStatus: () => request<{ connected: boolean; qr: string | null; phone: string; status?: string; lastConnectedAt?: string | null; lastError?: string | null }>('GET', '/wa-status'),
  waLogout: () => request<{ ok: boolean }>('POST', '/wa-status/logout'),
  waReconnect: () => request<{ ok: boolean }>('POST', '/wa-status/reconnect'),
  signup: (payload: { email: string; password: string; businessName: string; industry: string; acceptedTerms: boolean; acceptedWhatsappRisk: boolean }) =>
    request<{ tenantId: string; status: string }>('POST', '/auth/signup', payload),
  verifyEmail: (token: string) => request<{ status: string }>('GET', `/auth/verify-email?token=${encodeURIComponent(token)}`),
  resendVerification: (email: string) => request<{ ok: boolean }>('POST', '/auth/resend-verification', { email }),
  getOnboardingState: () => request<OnboardingState>('GET', '/onboarding/state'),
  patchOnboardingBusiness: (payload: { businessName?: string; ownerPhoneE164?: string }) =>
    request<{ ok: boolean }>('PATCH', '/onboarding/business', payload),
  patchOnboardingWelcome: (welcome: string) => request<{ ok: boolean }>('PATCH', '/onboarding/welcome', { welcome }),
  patchOnboardingSchema: (intakeSchema: unknown) => request<{ ok: boolean }>('PATCH', '/onboarding/schema', { intakeSchema }),
  onboardingFlag: (flag: { whatsappLinked?: boolean; testDone?: boolean }) =>
    request<{ ok: boolean }>('POST', '/onboarding/flag', flag),
  completeOnboarding: () => request<{ ok: boolean }>('POST', '/onboarding/complete'),
  getIndustries: () => request<{ industries: { value: string; label: string }[] }>('GET', '/onboarding/industries'),
  getBillingStatus: () => request<BillingStatus>('GET', '/billing/status'),
  startCheckout: () => request<{ url: string }>('POST', '/billing/checkout'),
  openBillingPortal: () => request<{ url: string }>('POST', '/billing/portal'),
  getSettings: () =>
    request<{ profile: ProfileSettings; config: ConfigSettings | null; media: MediaSettings | null; availableSkills: SkillInfo[]; fields: IntakeSection[] }>('GET', '/settings'),
  assistSettings: (action: 'facts' | 'fields' | 'welcome', text: string) =>
    request<{ ok: boolean; suggestion: unknown }>('POST', '/settings/assist', { action, text }),
  assistStatus: () => request<{ available: boolean }>('GET', '/settings/assist/status'),
  assistChat: (messages: ChatTurn[], snapshot: ConfigSnapshot) =>
    request<{ ok: boolean; reply: string; patch: ConfigPatch | null; done: boolean }>(
      'POST', '/settings/assist/chat', { messages, snapshot },
    ),
  updateFieldsSettings: (sections: IntakeSection[]) =>
    request<{ ok: boolean; fields: IntakeSection[] }>('PUT', '/settings/fields', { sections }),
  updateProfileSettings: (payload: ProfileSettings) =>
    request<{ ok: boolean; profile: ProfileSettings }>('PUT', '/settings/profile', payload),
  updateConfigSettings: (payload: ConfigSettings) =>
    request<{ ok: boolean; config: ConfigSettings }>('PUT', '/settings/config', payload),
  updateMediaSettings: (payload: MediaSettings) =>
    request<{ ok: boolean; media: MediaSettings }>('PUT', '/settings/media', payload),
};

export const platformApi = {
  login: (username: string, password: string) =>
    platformRequest<{ token: string; user: PlatformUser }>('POST', '/platform/auth/login', { username, password }, null),
  getTenants: () => platformRequest<{ tenants: PlatformTenant[] }>('GET', '/platform/tenants'),
  createTenant: (payload: CreateTenantPayload) =>
    platformRequest<{ tenant: PlatformTenant }>('POST', '/platform/tenants', payload),
  getTenantUsers: (tenantId: string) =>
    platformRequest<{ users: PlatformTenantUser[] }>('GET', `/platform/tenants/${tenantId}/users`),
  createTenantUser: (tenantId: string, payload: CreateTenantUserPayload) =>
    platformRequest<{ user: PlatformTenantUser }>('POST', `/platform/tenants/${tenantId}/users`, payload),
  updateTenant: (id: string, payload: { name?: string; industry?: string }) =>
    platformRequest<{ ok: boolean; tenant: PlatformTenant }>('PATCH', `/platform/tenants/${id}`, payload),
  deleteTenant: (id: string, confirmSlug: string) =>
    platformRequest<{ ok: boolean }>('DELETE', `/platform/tenants/${id}`, { confirmSlug }),
  approveTenant: (id: string) => platformRequest<{ ok: boolean; approvalStatus: string }>('POST', `/platform/tenants/${id}/approve`),
  rejectTenant: (id: string) => platformRequest<{ ok: boolean; approvalStatus: string }>('POST', `/platform/tenants/${id}/reject`),
  setLimit: (id: string, monthlyRunLimit: number | null) =>
    platformRequest<{ ok: boolean; monthlyRunLimit: number | null }>('PATCH', `/platform/tenants/${id}/limit`, { monthlyRunLimit }),
  suspendTenant: (id: string) => platformRequest<{ ok: boolean }>('POST', `/platform/tenants/${id}/suspend`),
  reactivateTenant: (id: string) => platformRequest<{ ok: boolean }>('POST', `/platform/tenants/${id}/reactivate`),
  reconnectBot: (id: string) => platformRequest<{ ok: boolean }>('POST', `/platform/tenants/${id}/bot/reconnect`),
  updateTenantUser: (tenantId: string, userId: string, payload: { email?: string; password?: string }) =>
    platformRequest<{ ok: boolean; user: PlatformTenantUser }>('PATCH', `/platform/tenants/${tenantId}/users/${userId}`, payload),
  deleteTenantUser: (tenantId: string, userId: string) =>
    platformRequest<{ ok: boolean }>('DELETE', `/platform/tenants/${tenantId}/users/${userId}`),
};

export interface PlatformUser {
  id: string;
  username: string;
  role: 'superadmin';
}

export interface PlatformTenant {
  id: string;
  slug: string;
  name: string;
  industry: string;
  profileDir: string;
  createdAt: string;
  status: string;
  approvalStatus: 'pending' | 'approved' | 'rejected';
  approvedAt: string | null;
  monthlyRunLimit: number | null;
  monthUsed: number;
  subscription: string | null;
  currentPeriodEnd?: string | null;
  _count?: { panelUsers: number; contacts: number; jobs: number };
}

export interface PlatformTenantUser {
  id: string;
  username: string;
  email: string | null;
  role: string;
  createdAt: string;
}

export interface CreateTenantPayload {
  slug: string;
  name: string;
  industry: string;
  profileDir: string;
}

export interface CreateTenantUserPayload {
  username: string;
  email: string;
  password: string;
}

export interface OnboardingState {
  step: 'verify_email' | 'subscription' | 'provisioning' | 'business' | 'welcome' | 'schema' | 'awaiting_approval' | 'whatsapp' | 'test' | 'checklist' | 'done';
  tenantStatus: string;
  subStatus: string | null;
  mode?: 'approval' | 'subscription';
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  flags: Record<string, boolean>;
}

export interface UsagePlan {
  name: string;
  monthlyLimit: number | null;
  monthUsed: number;
  monthRemaining: number | null;
}

export interface BillingStatus {
  status: 'none' | 'incomplete' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid';
  planName: string | null;
  amountCents?: number;
  currency?: string;
  interval?: string;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  gracePeriodEndsAt?: string | null;
}

export interface BusinessFact {
  topic: string;
  aliases: string[];
  answer: string;
}

export interface ProfileSettings {
  businessName: string;
  businessDomain: string;
  welcome: string;
  vars: Record<string, string>;
  businessFacts: { facts: BusinessFact[]; freeContext: string };
}

/** Resumen de la pantalla principal: qué atender y cómo va la venta. */
export interface PendingQuote {
  jobId: string;
  contactName: string;
  status: string;
  services: string[];
  updatedAt: string | null;
}

export interface WaitingJob {
  jobId: string;
  contactName: string;
  reason: 'bot_paused' | 'flagged' | 'no_reply';
  since: string;
}

export interface Overview {
  attention: {
    pendingQuotes: PendingQuote[];
    readyForReview: number;
    waiting: WaitingJob[];
  };
  funnel: {
    windowDays: number;
    jobs: number;
    withOffer: number;
    withAccepted: number;
    won: number;
    lost: number;
    followUps: number;
  };
}

/** Un dato que el asistente pide al cliente. `key` es la identidad con la que se
 *  guardan las respuestas: se deriva de la etiqueta al crear y no cambia después. */
export interface IntakeField {
  key: string;
  label: string;
  type: 'string' | 'text' | 'integer' | 'number' | 'currency' | 'boolean' | 'enum' | 'phone' | 'date';
  required?: boolean;
  hint?: string;
  options?: string[];
}

export interface IntakeSection {
  key: string;
  label: string;
  fields: IntakeField[];
}

/** Un turno de la conversación de configuración. El hilo lo guarda el panel. */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Lo que el panel tiene EN EL FORMULARIO (con cambios sin guardar incluidos). */
export interface ConfigSnapshot {
  businessName: string;
  businessDomain: string;
  welcome: string;
  tone: string;
  freeContext: string;
  facts: { topic: string; answer: string }[];
  sections: { label: string; fields: { label: string; type: string; required?: boolean }[] }[];
}

/** Cambios propuestos por el asistente. Se aplican al formulario, nunca a la base. */
export interface ConfigPatch {
  businessName?: string;
  businessDomain?: string;
  welcome?: string;
  tone?: string;
  freeContext?: string;
  facts?: { topic: string; answer: string }[];
  sections?: { label: string; fields: Omit<IntakeField, 'key'>[] }[];
}

export interface MediaSettings {
  describeImages: boolean;
  transcribeAudio: boolean;
  editImages: boolean;
  /** El bot reabre la conversación cuando el cliente deja de responder. */
  followUpEnabled: boolean;
  /** Avisa al cliente que le atiende un asistente automatizado (AI Act art. 50). */
  aiDisclosure: boolean;
  /** Nombres de las skills (técnicas) activas para este tenant. */
  skills: string[];
}

/** Metadatos de una skill del catálogo disponible. */
export interface SkillInfo {
  name: string;
  title: string;
  description: string;
}

export interface ConfigSettings {
  model: string;
  temperature: number;
  maxSteps: number;
  hours: {
    enabled: boolean;
    timezone: string;
    schedule: Record<string, [string, string] | null>;
    outOfHoursNotice: string;
  };
  owner: {
    phoneE164: string;
    notifyOnReady: boolean;
    notifyOnDisconnect: boolean;
    panelUrl: string;
  };
  limits: {
    monthlyCostUsd: number;
    alertOnCostUsd: number;
    maxConsecutiveErrors: number;
  };
}
