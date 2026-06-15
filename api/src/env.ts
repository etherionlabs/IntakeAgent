export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} no está definida (requerida por la API).`);
  return v;
}
export const PORT = Number(process.env.API_PORT ?? 3001);
export const CORS_ORIGIN = process.env.CORS_ORIGIN ?? '*';
