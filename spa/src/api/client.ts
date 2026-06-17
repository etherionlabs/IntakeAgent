const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn; }

function getToken(): string | null { return localStorage.getItem('intake_token'); }

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401) { onUnauthorized?.(); throw new ApiError(401, 'no autorizado'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as any)?.error ?? `error ${res.status}`);
  return data as T;
}

export const api = {
  login: (username: string, password: string) => request<{ token: string; user: any }>('POST', '/auth/login', { username, password }),
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
  getWaStatus: () => request<{ connected: boolean; qr: string | null; phone: string }>('GET', '/wa-status'),
  getSettings: () => request<{ profile: ProfileSettings; config: ConfigSettings }>('GET', '/settings'),
  updateProfileSettings: (payload: ProfileSettings) =>
    request<{ ok: boolean; profile: ProfileSettings }>('PUT', '/settings/profile', payload),
  updateConfigSettings: (payload: ConfigSettings) =>
    request<{ ok: boolean; config: ConfigSettings }>('PUT', '/settings/config', payload),
};

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
