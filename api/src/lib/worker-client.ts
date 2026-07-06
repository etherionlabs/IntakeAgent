import { resolveManagerUrl } from './manager-url';

/**
 * Llama al TenantManager (worker) interno con autenticación por token.
 * Devuelve null si la URL o el token no están configurados, o si la petición
 * falla — el llamador decide si eso es un error fatal.
 *
 * @param doFetch  Referencia a `fetch` (inyectable en tests).
 * @param method   HTTP method ('GET' | 'POST').
 * @param tenantId ID del tenant destinatario.
 * @param path     Ruta interna, p.ej. '/internal/tenant/add'.
 */
export async function workerCall(
  doFetch: typeof fetch,
  method: 'GET' | 'POST',
  tenantId: string,
  path: string,
): Promise<unknown> {
  const base = resolveManagerUrl(tenantId);
  const token = process.env.INTERNAL_API_TOKEN;
  if (!base || !token) return null;
  try {
    const url =
      method === 'GET'
        ? `${base}${path}?tenantId=${encodeURIComponent(tenantId)}`
        : `${base}${path}`;
    const res = await doFetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
      },
      ...(method === 'POST' ? { body: JSON.stringify({ tenantId }) } : {}),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
