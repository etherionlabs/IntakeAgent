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
  /** Giro de uso interno: el superadmin puede crear tenants con él, pero NO se
   *  ofrece en el alta pública. Un prospecto no debe poder registrarse como
   *  «Intake» y quedarse con el guion de venta del propio producto. */
  internal?: true;
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
  // Nosotros mismos: el asistente que vende Intake y el Partner Program. La mejor
  // demo es que el prospecto esté usándolo mientras pregunta.
  { value: 'intake', label: 'Etherion Labs (interno)', domain: 'asistentes de WhatsApp para negocios', internal: true },
] as const satisfies readonly IndustryDef[];

export type Industry = (typeof INDUSTRY_CATALOG)[number]['value'];

export const INDUSTRY_DOMAIN: Record<Industry, string> = Object.fromEntries(
  INDUSTRY_CATALOG.map((i) => [i.value, i.domain]),
) as Record<Industry, string>;

export const INDUSTRIES: Industry[] = INDUSTRY_CATALOG.map((i) => i.value);

function isInternal(i: IndustryDef): boolean {
  return 'internal' in i && i.internal === true;
}

/** Forma pública para la SPA: sin el dominio interno y sin los giros internos. */
export function industryOptions(): { value: string; label: string }[] {
  return INDUSTRY_CATALOG.filter((i) => !isInternal(i)).map(({ value, label }) => ({
    value,
    label,
  }));
}

/**
 * Catálogo COMPLETO para el panel del superadmin, con los giros internos.
 *
 * El panel del superadmin se alimentaba del catálogo público, así que marcar un
 * giro como interno lo escondía también de quien tiene que poder usarlo — que
 * era justo lo contrario de la intención. `internal` viaja para poder señalarlo
 * en el selector.
 */
export function allIndustryOptions(): { value: string; label: string; internal: boolean }[] {
  return INDUSTRY_CATALOG.map((i) => ({
    value: i.value,
    label: i.label,
    internal: isInternal(i),
  }));
}
