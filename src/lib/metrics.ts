/**
 * Métricas en memoria (formato Prometheus text). MVP: el endpoint las expone y
 * el monitor/alertas las leen; histórico (Prometheus+Grafana) queda diferido.
 */

const messagesByTenant = new Map<string, number>();
const llmErrorsByType = new Map<string, number>();
const httpByStatusClass = new Map<string, number>(); // '2xx','4xx','5xx'
const opportunitiesByStatus = new Map<string, number>(); // 'offered','accepted','declined'
const followUpsByReason = new Map<string, number>(); // 'pending_offer','incomplete_intake'
const objectionsByType = new Map<string, number>(); // 'precio:abierta', 'precio:resuelta'…
let botsConnected = 0;

export function incMessage(tenantId: string): void {
  messagesByTenant.set(tenantId, (messagesByTenant.get(tenantId) ?? 0) + 1);
}
export function incLlmError(type: string): void {
  llmErrorsByType.set(type, (llmErrorsByType.get(type) ?? 0) + 1);
}
/** Un servicio adicional registrado por el agente (venta proactiva). */
export function incOpportunity(status: string): void {
  opportunitiesByStatus.set(status, (opportunitiesByStatus.get(status) ?? 0) + 1);
}
/** Un seguimiento proactivo enviado, etiquetado por su motivo. */
export function incFollowUp(reason: string): void {
  followUpsByReason.set(reason, (followUpsByReason.get(reason) ?? 0) + 1);
}
/** Una objeción registrada por el agente, con si quedó resuelta. */
export function incObjection(type: string, resolved: boolean): void {
  const key = `${type}:${resolved ? 'resuelta' : 'abierta'}`;
  objectionsByType.set(key, (objectionsByType.get(key) ?? 0) + 1);
}
export function incHttp(statusCode: number): void {
  const cls = `${Math.floor(statusCode / 100)}xx`;
  httpByStatusClass.set(cls, (httpByStatusClass.get(cls) ?? 0) + 1);
}
export function setBotsConnected(n: number): void { botsConnected = n; }

/** Solo para tests: reinicia los contadores. */
export function resetMetrics(): void {
  messagesByTenant.clear(); llmErrorsByType.clear(); httpByStatusClass.clear(); botsConnected = 0;
  opportunitiesByStatus.clear(); followUpsByReason.clear(); objectionsByType.clear();
}

function line(name: string, value: number, labels?: Record<string, string>): string {
  const lbl = labels ? `{${Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',')}}` : '';
  return `${name}${lbl} ${value}`;
}

/** Render en formato Prometheus text. */
export function renderMetrics(): string {
  const out: string[] = [];
  out.push('# TYPE intake_messages_total counter');
  for (const [tenant, n] of messagesByTenant) out.push(line('intake_messages_total', n, { tenant }));
  out.push('# TYPE intake_llm_errors_total counter');
  for (const [type, n] of llmErrorsByType) out.push(line('intake_llm_errors_total', n, { type }));
  out.push('# TYPE intake_http_requests_total counter');
  for (const [cls, n] of httpByStatusClass) out.push(line('intake_http_requests_total', n, { class: cls }));
  out.push('# TYPE intake_opportunities_total counter');
  for (const [status, n] of opportunitiesByStatus) out.push(line('intake_opportunities_total', n, { status }));
  out.push('# TYPE intake_followups_total counter');
  for (const [reason, n] of followUpsByReason) out.push(line('intake_followups_total', n, { reason }));
  out.push('# TYPE intake_objections_total counter');
  for (const [key, n] of objectionsByType) {
    const [type, state] = key.split(':');
    out.push(line('intake_objections_total', n, { type, state }));
  }
  out.push('# TYPE intake_bots_connected gauge');
  out.push(line('intake_bots_connected', botsConnected));
  return out.join('\n') + '\n';
}
