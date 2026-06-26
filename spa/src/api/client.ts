const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn; }

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
  jobAction: (id: string, action: 'mark_ready' | 'close', summary?: string) => request<{ ok: boolean; status: string }>('POST', `/jobs/${id}/actions`, { action, summary }),
  getContacts: (includeArchived = false) =>
    request<{ contacts: any[] }>('GET', `/contacts${includeArchived ? '?includeArchived=true' : ''}`),
  toggleContact: (id: string, botPaused: boolean) => request<{ ok: boolean; contact: any }>('PATCH', `/contacts/${id}`, { botPaused }),
  updateContact: (id: string, payload: { displayName?: string; unflag?: boolean }) =>
    request<{ ok: boolean; contact: any }>('PATCH', `/contacts/${id}`, payload),
  archiveContact: (id: string) => request<{ ok: boolean; contact: any }>('POST', `/contacts/${id}/archive`),
  restoreContact: (id: string) => request<{ ok: boolean; contact: any }>('POST', `/contacts/${id}/restore`),
  deleteContact: (id: string) => request<{ ok: boolean }>('DELETE', `/contacts/${id}`),
  getUsage: () => request<{ totals: any; recent: any[] }>('GET', '/usage'),
  getWaStatus: () => request<{ connected: boolean; qr: string | null; phone: string; status?: string; lastConnectedAt?: string | null; lastError?: string | null }>('GET', '/wa-status'),
  waLogout: () => request<{ ok: boolean }>('POST', '/wa-status/logout'),
  waReconnect: () => request<{ ok: boolean }>('POST', '/wa-status/reconnect'),
  signup: (payload: { email: string; password: string; businessName: string; industry: string }) =>
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
  getAdminTenants: () => request<{ tenants: AdminTenant[] }>('GET', '/admin/tenants'),
  adminSuspend: (id: string) => request<{ ok: boolean }>('POST', `/admin/tenants/${id}/suspend`),
  adminReactivate: (id: string) => request<{ ok: boolean }>('POST', `/admin/tenants/${id}/reactivate`),
  adminReconnect: (id: string) => request<{ ok: boolean }>('POST', `/admin/tenants/${id}/bot/reconnect`),
  getBillingStatus: () => request<BillingStatus>('GET', '/billing/status'),
  startCheckout: () => request<{ url: string }>('POST', '/billing/checkout'),
  openBillingPortal: () => request<{ url: string }>('POST', '/billing/portal'),
  getSettings: () => request<{ profile: ProfileSettings; config: ConfigSettings }>('GET', '/settings'),
  updateProfileSettings: (payload: ProfileSettings) =>
    request<{ ok: boolean; profile: ProfileSettings }>('PUT', '/settings/profile', payload),
  updateConfigSettings: (payload: ConfigSettings) =>
    request<{ ok: boolean; config: ConfigSettings }>('PUT', '/settings/config', payload),
};

export interface AdminTenant {
  id: string; slug: string; name: string; industry: string;
  status: string; createdAt: string;
  subscription: string | null; currentPeriodEnd: string | null;
}

export interface OnboardingState {
  step: 'verify_email' | 'subscription' | 'provisioning' | 'business' | 'welcome' | 'schema' | 'whatsapp' | 'test' | 'checklist' | 'done';
  tenantStatus: string;
  subStatus: string | null;
  flags: Record<string, boolean>;
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
