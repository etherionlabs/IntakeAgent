export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} no está definida (requerida por la API).`);
  return v;
}
// Railway (y la mayoría de PaaS) inyectan PORT y esperan que el proceso escuche ahí
// para enrutar el tráfico público. Fallback a API_PORT (local) y luego 3001.
export const PORT = Number(process.env.PORT ?? process.env.API_PORT ?? 3001);
export const CORS_ORIGIN = process.env.CORS_ORIGIN ?? '*';
// Ruta del config.json global del deployment (compartido por el worker).
// La API lo lee/escribe para las pantallas de configuración del panel.
export const CONFIG_PATH = process.env.CONFIG_PATH ?? './config.json';
