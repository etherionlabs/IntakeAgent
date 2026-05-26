import type { IntakeSchema } from '../config/intake-schema';
import { getFieldByPath, listRequiredPaths } from '../config/intake-schema';
import { getByPath } from '../lib/path';

export interface FieldState {
  value: string | number | boolean | null;
  asked: boolean;
  declined?: boolean;
  declined_reason?: string;
  updated_at?: string;
  source_message_id?: string;
}

export interface FreeNote {
  text: string;
  added_at: string;
  source_message_id: string | null;
}

export interface IntakeState {
  [section: string]: Record<string, FieldState> | { photo_count: number; audio_count: number } | FreeNote[];
  media: { photo_count: number; audio_count: number };
  free_notes: FreeNote[];
  // Narrow section access: access via string keys gives the union type above,
  // but explicit media/free_notes are known to be their specific types
}

export function createEmptyIntakeFromSchema(schema: IntakeSchema): IntakeState {
  const intake: IntakeState = {
    media: { photo_count: 0, audio_count: 0 },
    free_notes: [],
  };
  for (const section of schema.sections) {
    const sec: Record<string, FieldState> = {};
    for (const field of section.fields) {
      sec[field.key] = { value: null, asked: false };
    }
    intake[section.key] = sec;
  }
  return intake;
}

export interface IntakeUpdate {
  path: string;
  value?: string | number | boolean;
  declined?: boolean;
  declined_reason?: string;
}

export interface UpdateMeta {
  now: string;
  source_message_id: string | null;
}

export type BulkUpdateResult =
  | { ok: true; intake: IntakeState }
  | { ok: false; error: string };

export function bulkUpdate(
  schema: IntakeSchema,
  intake: IntakeState,
  updates: IntakeUpdate[],
  meta: UpdateMeta,
): BulkUpdateResult {
  if (updates.length === 0) {
    return { ok: false, error: 'updates vacío' };
  }
  const next = structuredClone(intake);

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

function validateValueAgainstField(
  field: import('../config/intake-schema').IntakeField,
  value: unknown,
): string | null {
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

export function addFreeNote(
  intake: IntakeState,
  text: string,
  now: string,
  source_message_id: string | null,
): IntakeState {
  const next = structuredClone(intake);
  next.free_notes = [
    ...next.free_notes,
    { text, added_at: now, source_message_id },
  ];
  return next;
}

export function isIntakeComplete(schema: IntakeSchema, intake: IntakeState): boolean {
  for (const path of listRequiredPaths(schema)) {
    const field = getByPath(intake, path) as FieldState | undefined;
    if (!field) return false;
    const satisfied = field.value !== null || field.declined === true;
    if (!satisfied) return false;
  }
  return true;
}
