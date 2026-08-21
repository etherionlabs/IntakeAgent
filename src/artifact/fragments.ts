/**
 * FRAGMENTOS DE ARTEFACTO (genérico — candidato a extracción).
 *
 * Un fragmento es una pieza de artefacto reutilizable POR DEBAJO de la vertical:
 * ni un giro ni un módulo, sino un trozo de conocimiento operativo que varias
 * verticales necesitan igual. "Quién es el cliente" y "dónde y cuándo" son los
 * dos primeros, y no son hipótesis: estaban copiados a mano en 7 y 4 giros.
 *
 * FRONTERA CLAVE — se referencian por CONTRATO, no por nombre de vecino:
 *
 *   una vertical NO dice  "dame el `client` de cerrajería"   ← acopla hermanos
 *   una vertical SÍ dice  "necesito `customer.identity`"     ← acopla al contrato
 *
 * Tapicería no depende de cerrajería: ambas dependen de un concepto compartido.
 * Con referencias por nombre reaparecería justo el acoplamiento que se quiere
 * quitar; con `provides`/`use` el fragmento se puede sustituir por otro que
 * provea lo mismo sin que ninguna vertical se entere.
 *
 * Este módulo no sabe qué es un cliente ni una dirección: solo resuelve
 * referencias y detecta colisiones.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';

/**
 * Referencia a un fragmento desde la lista de secciones de una vertical.
 *
 * `labels` permite reescribir el texto visible de campos concretos sin tocar el
 * fragmento. La línea es deliberada:
 *
 *   el CONTRATO es dueño de la estructura   (claves, tipos, required, opciones)
 *   la VERTICAL es dueña de las palabras    (etiquetas)
 *
 * Cambiar una etiqueta no rompe el contrato; cambiar un tipo sí. Sin esta
 * válvula, la primera vertical que necesite decir "Dirección exacta" en vez de
 * "Dirección" abandonaría el fragmento y volvería a copiar la sección entera
 * — que es exactamente la duplicación que se está quitando.
 */
export const SectionRefZ = z.object({
  use: z.string().min(1),
  labels: z.record(z.string(), z.string()).optional(),
});
export type SectionRef = z.infer<typeof SectionRefZ>;

export const FragmentZ = z.object({
  id: z.string().min(1),
  /** Contrato que este fragmento satisface. Es la clave de resolución. */
  provides: z.string().min(1),
  version: z.string().min(1),
  description: z.string().default(''),
  /** La sección de artefacto que aporta. Se valida con el esquema al resolver. */
  section: z.object({}).passthrough(),
});
export type ArtifactFragment = z.infer<typeof FragmentZ>;

export class FragmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FragmentError';
  }
}

/**
 * Carga la biblioteca de fragmentos, indexada por su CONTRATO (`provides`).
 *
 * Dos fragmentos que prometan el mismo contrato son un error, no una elección
 * silenciosa: si algún día hacen falta implementaciones alternativas, la vertical
 * tendrá que poder decir cuál quiere, y eso es una decisión de diseño que se toma
 * cuando aparezca el caso — no un desempate arbitrario hoy.
 */
export async function loadFragments(
  fragmentsDir = './fragments',
): Promise<Map<string, ArtifactFragment>> {
  const base = resolve(fragmentsDir);
  const out = new Map<string, ArtifactFragment>();
  let dirs: string[];
  try {
    const entries = await readdir(base, { withFileTypes: true });
    dirs = entries.filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return out; // Sin biblioteca de fragmentos: las verticales que no usen `use` siguen igual.
  }
  for (const name of dirs) {
    let parsed: ArtifactFragment;
    try {
      parsed = FragmentZ.parse(JSON.parse(await readFile(join(base, name, 'fragment.json'), 'utf-8')));
    } catch (e) {
      throw new FragmentError(`fragmento "${name}" inválido: ${(e as Error).message}`);
    }
    const previo = out.get(parsed.provides);
    if (previo) {
      throw new FragmentError(
        `dos fragmentos proveen "${parsed.provides}": "${previo.id}" y "${parsed.id}". ` +
          'Un contrato admite una sola implementación mientras no exista forma de elegir.',
      );
    }
    out.set(parsed.provides, parsed);
  }
  return out;
}

/** Huella del contenido de los fragmentos usados, para que el configHash los refleje. */
export function fragmentsFingerprint(
  raw: unknown,
  fragments: Map<string, ArtifactFragment>,
): string {
  return referencedContracts(raw)
    .map((c) => {
      const f = fragments.get(c);
      return f ? `${f.provides}@${f.version}:${JSON.stringify(f.section)}` : `${c}@missing`;
    })
    .join('\n');
}

/** Contratos que un esquema crudo referencia, en orden de aparición. */
export function referencedContracts(raw: unknown): string[] {
  const sections = (raw as { sections?: unknown[] })?.sections;
  if (!Array.isArray(sections)) return [];
  return sections
    .map((s) => SectionRefZ.safeParse(s))
    .filter((r) => r.success)
    .map((r) => (r as { data: SectionRef }).data.use);
}

/**
 * Reescribe las etiquetas que la vertical pidió cambiar. Una clave que no existe
 * en el fragmento es un error: casi siempre es un typo, y en silencio dejaría a
 * la vertical creyendo que renombró un campo que sigue llamándose como antes.
 */
function applyLabelOverrides(
  fragment: ArtifactFragment,
  labels: Record<string, string> | undefined,
): unknown {
  const section = fragment.section as { key?: string; fields?: { key?: string; label?: string }[] };
  if (!labels || Object.keys(labels).length === 0) return section;

  const known = new Set((section.fields ?? []).map((f) => f.key));
  for (const key of Object.keys(labels)) {
    if (!known.has(key)) {
      throw new FragmentError(
        `"${fragment.provides}" no tiene el campo "${key}" que se intenta renombrar. ` +
          `Campos: ${[...known].join(', ')}`,
      );
    }
  }
  return {
    ...section,
    fields: (section.fields ?? []).map((f) =>
      f.key && labels[f.key] ? { ...f, label: labels[f.key] } : f,
    ),
  };
}

/**
 * Expande las referencias `{ "use": "<contrato>" }` en su sitio.
 *
 * La expansión es POSICIONAL a propósito: el orden de las secciones es el orden
 * en que el modelo las lee en el prompt, así que una vertical tiene que poder
 * decir dónde va el fragmento, no recibirlo todo al principio.
 *
 * Devuelve el esquema crudo ya plano; la validación posterior es la de siempre y
 * no necesita saber que los fragmentos existen.
 */
export function resolveSectionRefs(
  raw: unknown,
  fragments: Map<string, ArtifactFragment>,
): unknown {
  const schema = raw as { sections?: unknown[] };
  if (!Array.isArray(schema?.sections)) return raw;

  const resolved: unknown[] = [];
  for (const entry of schema.sections) {
    const ref = SectionRefZ.safeParse(entry);
    if (!ref.success) {
      resolved.push(entry);
      continue;
    }
    const fragment = fragments.get(ref.data.use);
    if (!fragment) {
      const disponibles = [...fragments.keys()].join(', ') || '(ninguno)';
      throw new FragmentError(
        `ninguna pieza provee el contrato "${ref.data.use}". Disponibles: ${disponibles}`,
      );
    }
    resolved.push(applyLabelOverrides(fragment, ref.data.labels));
  }

  // Una clave de sección repetida deja campos inalcanzables (el segundo bloque
  // pisa al primero en el estado). Falla al cargar en vez de perder datos en
  // producción.
  const keys = resolved.map((s) => (s as { key?: string })?.key).filter(Boolean) as string[];
  const dup = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dup) {
    throw new FragmentError(
      `la sección "${dup}" está declarada dos veces (¿un fragmento y una sección propia?)`,
    );
  }

  return { ...schema, sections: resolved };
}
