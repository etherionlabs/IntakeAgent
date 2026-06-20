export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} no está definida (requerida por la API).`);
  return v;
}
// Railway (y la mayoría de PaaS) inyectan PORT y esperan que el proceso escuche ahí
// para enrutar el tráfico público. Fallback a API_PORT (local) y luego 3001.
export const PORT = Number(process.env.PORT ?? process.env.API_PORT ?? 3001);
export const CORS_ORIGIN = process.env.CORS_ORIGIN ?? '*';

// Origen(es) permitidos para CORS. Con cookies cross-site se exige un origin
// concreto (no `*`) en producción. Acepta lista separada por comas (staging+prod).
export function getCorsOrigin(): string | string[] {
  const raw = process.env.CORS_ORIGIN?.trim();
  if (process.env.NODE_ENV === 'production') {
    if (!raw || raw === '*') {
      throw new Error('CORS_ORIGIN debe ser un origin concreto en producción (no "*"), por las cookies cross-site.');
    }
  }
  if (!raw) return '*';
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length > 1 ? list : list[0];
}
// Ruta del config.json global del deployment (compartido por el worker).
// La API lo lee/escribe para las pantallas de configuración del panel.
export const CONFIG_PATH = process.env.CONFIG_PATH ?? './config.json';
