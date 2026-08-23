/**
 * RUNTIME DE ARTEFACTOS (genérico — candidato a extracción).
 *
 * Un "artefacto" es la estructura de información que gobierna el proceso: qué
 * datos hacen falta, cuáles ya están, cuáles faltan y cuándo se considera
 * completo. En Intake ese artefacto es el formulario dinámico del trabajo, pero
 * NADA de este módulo sabe que se trata de ventas, de talleres o de servicios:
 * solo sabe de campos, secciones, escrituras validadas y completitud.
 *
 * Regla de frontera: si para soportar otra vertical hubiera que tocar este
 * archivo con un `if <dominio>`, la abstracción está mal puesta. Lo específico
 * del dominio vive en `src/domain/<dominio>/` y se conecta por los contratos de
 * `src/artifact/render.ts`.
 */
import type { IntakeSchema, IntakeField } from '../config/intake-schema';
import { getFieldByPath, listRequiredPaths } from '../config/intake-schema';
import { getByPath } from '../lib/path';

/** Estado de UN campo del artefacto. */
export interface FieldState {
  value: string | number | boolean | null;
  asked: boolean;
  declined?: boolean;
  declined_reason?: string;
  updated_at?: string;
  source_message_id?: string;
}

/** Dato que no cabe en ningún campo del esquema pero vale la pena conservar. */
export interface FreeNote {
  text: string;
  added_at: string;
  source_message_id: string | null;
}

/** Contadores de media del canal. Neutrales al dominio (los llena el pipeline). */
export interface ArtifactMediaCounters {
  photo_count: number;
  audio_count: number;
}

/**
 * Estado persistido del artefacto.
 *
 * Las claves de sección salen del esquema, así que el índice es abierto. Un
 * dominio puede AÑADIR sus propios bloques (Intake añade `opportunities` y
 * `diagnosis`) extendiendo este tipo; el core los transporta sin interpretarlos.
 */
export interface ArtifactState {
  [section: string]: unknown;
  media: ArtifactMediaCounters;
  free_notes: FreeNote[];
}

/** Crea el estado vacío a partir del esquema: todas las secciones, todos los campos. */
export function createEmptyArtifact(schema: IntakeSchema): ArtifactState {
  const state: ArtifactState = {
    media: { photo_count: 0, audio_count: 0 },
    free_notes: [],
  };
  for (const section of schema.sections) {
    const sec: Record<string, FieldState> = {};
    for (const field of section.fields) {
      sec[field.key] = { value: null, asked: false };
    }
    state[section.key] = sec;
  }
  return state;
}

export interface ArtifactUpdate {
  path: string;
  value?: string | number | boolean;
  declined?: boolean;
  declined_reason?: string;
}

export interface UpdateMeta {
  now: string;
  source_message_id: string | null;
}

export type BulkUpdateResult<S extends ArtifactState = ArtifactState> =
  | { ok: true; intake: S }
  | { ok: false; error: string };

/**
 * Escritura validada y ATÓMICA: o se aplican todas las actualizaciones o no se
 * aplica ninguna. Un path fuera del esquema, un tipo que no cuadra o un
 * `declined` sin motivo abortan el lote entero — es preferible perder la
 * escritura a dejar el artefacto en un estado a medias.
 */
export function bulkUpdateArtifact<S extends ArtifactState>(
  schema: IntakeSchema,
  state: S,
  updates: ArtifactUpdate[],
  meta: UpdateMeta,
): BulkUpdateResult<S> {
  if (updates.length === 0) {
    return { ok: false, error: 'updates vacío' };
  }
  const next = structuredClone(state);

  for (const u of updates) {
    const field = getFieldByPath(schema, u.path);
    if (!field) return { ok: false, error: `path no existe en schema: ${u.path}` };

    const hasValue = u.value !== undefined;
    const isDeclined = u.declined === true;

    if (hasValue && isDeclined) {
      return { ok: false, error: `${u.path}: no se permite value y declined a la vez` };
    }
    if (!hasValue && !isDeclined) {
      return { ok: false, error: `${u.path}: requiere value o declined=true` };
    }
    if (isDeclined && (!u.declined_reason || u.declined_reason.length < 2)) {
      return { ok: false, error: `${u.path}: declined requiere declined_reason` };
    }

    const [sectionKey, fieldKey] = u.path.split('.');
    const section = next[sectionKey] as Record<string, FieldState>;

    if (hasValue) {
      const validationError = validateValueAgainstField(field, u.value!);
      if (validationError) {
        return { ok: false, error: `${u.path}: ${validationError}` };
      }
      section[fieldKey] = {
        value: u.value!,
        asked: true,
        updated_at: meta.now,
        source_message_id: meta.source_message_id ?? undefined,
      };
    } else {
      section[fieldKey] = {
        value: null,
        asked: true,
        declined: true,
        declined_reason: u.declined_reason,
        updated_at: meta.now,
        source_message_id: meta.source_message_id ?? undefined,
      };
    }
  }
  return { ok: true, intake: next };
}

/**
 * Valida un valor contra la declaración de un campo. Se exporta porque un
 * ELEMENTO de vertical declara sus propios campos y necesita el mismo validador:
 * sin esto acabaría escribiendo el suyo, que es como se degradan estas cosas.
 */
export function validateValueAgainstField(field: IntakeField, value: unknown): string | null {
  switch (field.type) {
    case 'string':
    case 'text':
    case 'phone':
    case 'date':
      if (typeof value !== 'string' || value.length === 0)
        return `tipo ${field.type} requiere string no vacío`;
      return null;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value))
        return 'tipo integer requiere número entero';
      if (field.min !== undefined && value < field.min)
        return `valor menor que min=${field.min}`;
      if (field.max !== undefined && value > field.max)
        return `valor mayor que max=${field.max}`;
      return null;
    case 'number':
    case 'currency':
      if (typeof value !== 'number')
        return `tipo ${field.type} requiere número`;
      if (field.min !== undefined && value < field.min)
        return `valor menor que min=${field.min}`;
      if (field.max !== undefined && value > field.max)
        return `valor mayor que max=${field.max}`;
      return null;
    case 'boolean':
      if (typeof value !== 'boolean')
        return 'tipo boolean requiere true/false';
      return null;
    case 'enum':
      if (typeof value !== 'string' || !field.options!.includes(value))
        return `valor no está en options (${field.options!.join(', ')})`;
      return null;
    case 'multi_enum':
      return 'multi_enum no soportado en update directo, usa array fuera del MVP';
    default:
      return `tipo desconocido: ${field.type}`;
  }
}

/** Añade una nota libre. No valida contra el esquema: es justo lo que no cabe en él. */
export function addFreeNoteToArtifact<S extends ArtifactState>(
  state: S,
  text: string,
  now: string,
  source_message_id: string | null,
): S {
  const next = structuredClone(state);
  next.free_notes = [...next.free_notes, { text, added_at: now, source_message_id }];
  return next;
}

/**
 * Criterio de completitud del artefacto: TODOS los campos requeridos tienen
 * valor o quedaron explícitamente declinados. Es lo único que el core entiende
 * por "terminado"; qué se hace entonces lo decide el dominio.
 */
export function isArtifactComplete(schema: IntakeSchema, state: ArtifactState): boolean {
  return missingRequiredPaths(schema, state).length === 0;
}

/** Paths requeridos todavía sin satisfacer, en el orden del esquema. */
export function missingRequiredPaths(schema: IntakeSchema, state: ArtifactState): string[] {
  const out: string[] = [];
  for (const path of listRequiredPaths(schema)) {
    const field = getByPath(state, path) as FieldState | undefined;
    const satisfied = field && (field.value !== null || field.declined === true);
    if (!satisfied) out.push(path);
  }
  return out;
}

/** Etiqueta humana de un path (`section.field`); cae al propio path si no existe. */
export function labelForPath(schema: IntakeSchema, path: string): string {
  const [sectionKey, fieldKey] = path.split('.');
  const section = schema.sections.find((s) => s.key === sectionKey);
  const field = section?.fields.find((f) => f.key === fieldKey);
  return field?.label ?? path;
}

/**
 * Qué campos de un conjunto DECLARADO siguen sin valor, devueltos por su etiqueta.
 *
 * Es la versión genérica de "qué me falta" para un elemento que declara sus
 * campos sin vivir en el array de secciones del artefacto. `missingRequiredPaths`
 * hace lo mismo para las secciones del esquema; este trabaja sobre una lista de
 * campos suelta y valores planos.
 *
 * Existe porque el módulo de ventas tenía esta lógica escrita a mano, con las
 * etiquetas incrustadas en tres `if`. El conocimiento de QUÉ hay que descubrir es
 * del elemento; el cómo se calcula lo que falta, del núcleo.
 */
export function unsetDeclaredFields(
  fields: readonly IntakeField[],
  values: Readonly<Record<string, unknown>>,
): string[] {
  return fields
    .filter((f) => values[f.key] === undefined || values[f.key] === null || values[f.key] === '')
    .map((f) => f.label);
}

/**
 * Valida un objeto plano contra un conjunto de campos declarados. Ignora las
 * claves ausentes (una actualización parcial es legítima: cada turno aporta lo
 * que descubrió) y devuelve el primer error, o null.
 */
export function validateDeclaredFields(
  fields: readonly IntakeField[],
  values: Readonly<Record<string, unknown>>,
): string | null {
  for (const field of fields) {
    const value = values[field.key];
    if (value === undefined) continue;
    const error = validateValueAgainstField(field, value);
    if (error) return `${field.key}: ${error}`;
  }
  return null;
}
