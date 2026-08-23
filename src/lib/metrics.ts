/**
 * Métricas en memoria (formato Prometheus text). MVP: el endpoint las expone y
 * el monitor/alertas las leen; histórico (Prometheus+Grafana) queda diferido.
 */

const messagesByTenant = new Map<string, number>();
const llmErrorsByType = new Map<string, number>();
const httpByStatusClass = new Map<string, number>(); // '2xx','4xx','5xx'
const followUpsByReason = new Map<string, number>(); // 'pending_offer','incomplete_intake'
/**
 * Contadores que aportan los ELEMENTOS de vertical, por nombre y etiquetas. El
 * núcleo no sabe qué miden: transporta el nombre que el elemento eligió y lo
 * publica como `intake_<nombre>_total`. Así el dominio puede añadir o cambiar sus
 * métricas sin tocar este archivo.
 */
const domainEvents = new Map<string, Map<string, number>>();
let botsConnected = 0;

export function incMessage(tenantId: string): void {
  messagesByTenant.set(tenantId, (messagesByTenant.get(tenantId) ?? 0) + 1);
}
export function incLlmError(type: string): void {
  llmErrorsByType.set(type, (llmErrorsByType.get(type) ?? 0) + 1);
}
/** Un evento de dominio aportado por un elemento de vertical. */
export function incDomainEvent(name: string, labels: Record<string, string> = {}): void {
  const byLabels = domainEvents.get(name) ?? new Map<string, number>();
  const key = JSON.stringify(labels);
  byLabels.set(key, (byLabels.get(key) ?? 0) + 1);
  domainEvents.set(name, byLabels);
}
/** Un seguimiento proactivo enviado, etiquetado por su motivo. */
export function incFollowUp(reason: string): void {
  followUpsByReason.set(reason, (followUpsByReason.get(reason) ?? 0) + 1);
}
export function incHttp(statusCode: number): void {
  const cls = `${Math.floor(statusCode / 100)}xx`;
  httpByStatusClass.set(cls, (httpByStatusClass.get(cls) ?? 0) + 1);
}
export function setBotsConnected(n: number): void { botsConnected = n; }

/** Solo para tests: reinicia los contadores. */
export function resetMetrics(): void {
  messagesByTenant.clear(); llmErrorsByType.clear(); httpByStatusClass.clear(); botsConnected = 0;
  followUpsByReason.clear(); domainEvents.clear();
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
  out.push('# TYPE intake_followups_total counter');
  for (const [reason, n] of followUpsByReason) out.push(line('intake_followups_total', n, { reason }));
  // Métricas de los elementos de vertical. El nombre lo eligió el elemento; los
  // nombres publicados no cambian respecto a antes de existir este mecanismo,
  // para no romper dashboards ni alertas en operación.
  for (const [name, byLabels] of domainEvents) {
    out.push(`# TYPE intake_${name}_total counter`);
    for (const [key, n] of byLabels) {
      out.push(line(`intake_${name}_total`, n, JSON.parse(key) as Record<string, string>));
    }
  }
  out.push('# TYPE intake_bots_connected gauge');
  out.push(line('intake_bots_connected', botsConnected));
  return out.join('\n') + '\n';
}
