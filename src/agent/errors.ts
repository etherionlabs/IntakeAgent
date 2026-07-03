export type LlmErrorKind =
  | 'rate_limit' //          429: transitorio, reintentable con backoff
  | 'insufficient_credits' // 402 / saldo agotado: NO reintentar, accionable (recargar)
  | 'transient' //          red/5xx: reintentable
  | 'other';

/**
 * Clasifica un error del LLM (OpenRouter) a partir de su mensaje/estado. No lanza.
 * Determinista para poder degradar y alertar según el tipo.
 */
export function classifyLlmError(err: unknown): LlmErrorKind {
  const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  const status = extractStatus(err);

  if (status === 402 || /insufficient|saldo|quota|credit|payment required|balance/.test(msg)) {
    return 'insufficient_credits';
  }
  if (status === 429 || /rate.?limit|too many requests|\b429\b/.test(msg)) {
    return 'rate_limit';
  }
  if ((status && status >= 500) || /timeout|timed out|econnreset|socket|network|fetch failed|503|502|504/.test(msg)) {
    return 'transient';
  }
  return 'other';
}

function extractStatus(err: unknown): number | undefined {
  if (err && typeof err === 'object') {
    const anyErr = err as any;
    const s = anyErr.status ?? anyErr.statusCode ?? anyErr.response?.status ?? anyErr.output?.statusCode;
    if (typeof s === 'number') return s;
  }
  return undefined;
}

/** ¿El error amerita una alerta accionable al operador (saldo agotado)? */
export function isActionableLlmError(kind: LlmErrorKind): boolean {
  return kind === 'insufficient_credits';
}
