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

/**
 * Estado de un servicio ADICIONAL al que el agente le movió en la conversación.
 * - `offered`: se ofreció y el cliente aún no se define.
 * - `accepted`: el cliente lo quiere → el dueño debe cotizarlo junto al trabajo principal.
 * - `declined`: el cliente dijo que no → NO se vuelve a ofrecer.
 */
export type OpportunityStatus = 'offered' | 'accepted' | 'declined';

export interface Opportunity {
  /** Servicio extra tal como se le nombró al cliente (ej. "polarizado 20%"). */
  service: string;
  status: OpportunityStatus;
  note?: string;
  updated_at: string;
  source_message_id: string | null;
}

export interface IntakeState {
  [section: string]:
    | Record<string, FieldState>
    | { photo_count: number; audio_count: number }
    | FreeNote[]
    | Opportunity[]
    | undefined;
  media: { photo_count: number; audio_count: number };
  free_notes: FreeNote[];
  /**
   * Servicios adicionales ofrecidos/aceptados/rechazados en la conversación.
   * Opcional en lectura: los jobs creados antes de esta función no lo traen en
   * su JSON persistido, así que todo consumidor debe tolerar `undefined`.
   */
  opportunities?: Opportunity[];
  // Narrow section access: access via string keys gives the union type above,
  // but explicit media/free_notes/opportunities are known to be their specific types
}

export function createEmptyIntakeFromSchema(schema: IntakeSchema): IntakeState {
  const intake: IntakeState = {
    media: { photo_count: 0, audio_count: 0 },
    free_notes: [],
    opportunities: [],
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

/**
 * Clave de identidad de una oportunidad: minúsculas, sin acentos y con espacios
 * colapsados. Así "Polarizado 20%" y "polarizado 20%" son el MISMO servicio y
 * cambiar su estado (offered → accepted) actualiza la entrada en vez de duplicarla.
 */
function opportunityKey(service: string): string {
  return service
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export interface OpportunityUpdate {
  service: string;
  status: OpportunityStatus;
  note?: string;
}

export function listOpportunities(intake: IntakeState): Opportunity[] {
  return intake.opportunities ?? [];
}

/** Servicios extra que el cliente aceptó — lo que el dueño debe cotizar de más. */
export function acceptedOpportunities(intake: IntakeState): Opportunity[] {
  return listOpportunities(intake).filter((o) => o.status === 'accepted');
}

/**
 * Registra o actualiza oportunidades de venta. Upsert por servicio: si el
 * servicio ya existe se le sobrescribe el estado (un "no" posterior gana sobre
 * el "ofrecido" previo); si no, se agrega al final conservando el orden.
 */
export function upsertOpportunities(
  intake: IntakeState,
  updates: OpportunityUpdate[],
  now: string,
  source_message_id: string | null,
): IntakeState {
  const next = structuredClone(intake);
  const list = [...(next.opportunities ?? [])];
  for (const u of updates) {
    const service = u.service.trim();
    const entry: Opportunity = {
      service,
      status: u.status,
      ...(u.note ? { note: u.note } : {}),
      updated_at: now,
      source_message_id,
    };
    const idx = list.findIndex((o) => opportunityKey(o.service) === opportunityKey(service));
    if (idx >= 0) list[idx] = entry;
    else list.push(entry);
  }
  next.opportunities = list;
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

export interface RenderCtx {
  jobId: string;
  status: string;
}

export function renderIntakeForModel(
  schema: IntakeSchema,
  intake: IntakeState,
  ctx: RenderCtx,
): string {
  const lines: string[] = [];
  lines.push(`=== ESTADO DEL INTAKE (job #${ctx.jobId}, status=${ctx.status}) ===`);

  for (const section of schema.sections) {
    lines.push(`${section.label}:`);
    const sec = intake[section.key] as Record<string, FieldState>;
    for (const field of section.fields) {
      const f = sec?.[field.key];
      const reqMark = field.required ? ' (REQUERIDO)' : '';
      // El path canónico [section.field] y las opciones de enum se incluyen
      // SIEMPRE: sin esto el modelo inventa paths a partir del label en español
      // (ej. "Dirección" → logistics.dirección) y update_intake falla, perdiendo
      // datos que el cliente ya dio. El label es para humanos; el path, para tools.
      const path = `[${section.key}.${field.key}]`;
      const opts =
        (field.type === 'enum' || field.type === 'multi_enum') && field.options
          ? ` (opciones: ${field.options.join(' | ')})`
          : '';
      const meta = `${path}${opts}`;
      if (!f || (f.value === null && !f.declined)) {
        const icon = field.required ? '✗' : '○';
        const askedNote = f?.asked ? ' [ya preguntado]' : '';
        lines.push(`  ${icon} ${field.label} ${meta}${reqMark}${askedNote}`);
      } else if (f.declined) {
        lines.push(
          `  ⊘ ${field.label} ${meta}${reqMark} — declinado: "${f.declined_reason ?? ''}"`,
        );
      } else {
        const v = typeof f.value === 'string' ? `"${f.value}"` : String(f.value);
        lines.push(`  ✓ ${field.label} ${meta}: ${v}`);
      }
    }
  }

  lines.push(`Media:`);
  lines.push(`  📷 fotos recibidas: ${intake.media.photo_count}`);
  lines.push(`  🎤 audios recibidos: ${intake.media.audio_count}`);

  if (intake.free_notes.length > 0) {
    lines.push(`Notas libres:`);
    for (const n of intake.free_notes) {
      lines.push(`  - ${n.text}`);
    }
  }

  const opportunities = listOpportunities(intake);
  if (opportunities.length > 0) {
    const icons: Record<OpportunityStatus, string> = {
      offered: '·',
      accepted: '✓',
      declined: '✗',
    };
    const labels: Record<OpportunityStatus, string> = {
      offered: 'ofrecido, sin respuesta',
      accepted: 'ACEPTADO',
      declined: 'rechazado — NO lo vuelvas a ofrecer',
    };
    lines.push('Servicios adicionales (venta):');
    for (const o of opportunities) {
      const note = o.note ? ` — ${o.note}` : '';
      lines.push(`  ${icons[o.status]} ${o.service}: ${labels[o.status]}${note}`);
    }
    lines.push(
      '  → Registra con register_opportunity cada extra que ofrezcas y actualízalo cuando el ' +
        'cliente responda. Los ACEPTADOS van en el resumen para que el dueño los cotice; los ' +
        'rechazados no se vuelven a mencionar.',
    );
  }

  const missing: string[] = [];
  for (const section of schema.sections) {
    const sec = intake[section.key] as Record<string, FieldState>;
    for (const field of section.fields) {
      if (!field.required) continue;
      const f = sec?.[field.key];
      const satisfied = f && (f.value !== null || f.declined === true);
      if (!satisfied) missing.push(`${section.key}.${field.key}`);
    }
  }

  lines.push(
    missing.length === 0
      ? 'Pendientes mínimos para cerrar intake: ninguno (puedes presentar resumen)'
      : `Pendientes mínimos para cerrar intake: ${missing.join(', ')}`,
  );

  return lines.join('\n');
}
