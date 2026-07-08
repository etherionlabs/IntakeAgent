/**
 * Catálogo canónico de giros soportados. Fuente ÚNICA de verdad: de aquí derivan
 * la enum `Industry`, el mapa de dominios y la lista que consume la SPA (vía
 * `GET /onboarding/industries`). Cada giro tiene una plantilla en `profiles/<value>/`.
 */
export interface IndustryDef {
  /** Identificador estable (== carpeta en profiles/). */
  value: string;
  /** Etiqueta para el dropdown del signup. */
  label: string;
  /** Dominio del negocio, se inyecta en {{businessDomain}} de la plantilla. */
  domain: string;
}

export const INDUSTRY_CATALOG = [
  { value: 'generico', label: 'Otro / Servicios', domain: 'servicios' },
  { value: 'tapiceria', label: 'Tapicería', domain: 'tapicería de muebles' },
  { value: 'paqueteria', label: 'Paquetería', domain: 'paquetería y envíos' },
  { value: 'mecanica', label: 'Mecánica automotriz', domain: 'mecánica automotriz' },
  { value: 'cerrajeria', label: 'Cerrajería', domain: 'cerrajería' },
  { value: 'plomeria', label: 'Plomería', domain: 'plomería y fontanería' },
  { value: 'electricista', label: 'Electricista', domain: 'servicios eléctricos' },
  { value: 'refrigeracion', label: 'Refrigeración y clima', domain: 'refrigeración y aire acondicionado' },
] as const satisfies readonly IndustryDef[];

export type Industry = (typeof INDUSTRY_CATALOG)[number]['value'];

export const INDUSTRY_DOMAIN: Record<Industry, string> = Object.fromEntries(
  INDUSTRY_CATALOG.map((i) => [i.value, i.domain]),
) as Record<Industry, string>;

export const INDUSTRIES: Industry[] = INDUSTRY_CATALOG.map((i) => i.value);

/** Forma pública para la SPA (sin el dominio interno). */
export function industryOptions(): { value: string; label: string }[] {
  return INDUSTRY_CATALOG.map(({ value, label }) => ({ value, label }));
}
