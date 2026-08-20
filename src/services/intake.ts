/**
 * FACHADA DEL ARTEFACTO DE INTAKE.
 *
 * Este módulo ya no implementa nada: compone el runtime GENÉRICO del artefacto
 * (`src/artifact/`) con el estado y los bloques ESPECÍFICOS del dominio de venta
 * (`src/domain/sales/`). Es, literalmente, la línea donde Intake deja de ser
 * infraestructura y empieza a ser un negocio concreto.
 *
 *   IntakeState        = ArtifactState (genérico) + extensiones de venta
 *   renderIntakeForModel = renderArtifactForModel + secciones de venta
 *
 * Se conserva la superficie pública de siempre (mismos nombres, mismas firmas,
 * misma salida) para que el resto del sistema no se entere del corte. Otra
 * vertical escribe SU composición: el mismo core con la lista de módulos que
 * necesite — puede incluir `ventas`, que es reutilizable, o prescindir de él.
 */
import type { IntakeSchema } from '../config/intake-schema';
import {
  addFreeNoteToArtifact,
  bulkUpdateArtifact,
  createEmptyArtifact,
  isArtifactComplete,
  type ArtifactState,
  type ArtifactUpdate,
  type BulkUpdateResult,
} from '../artifact/state';
import { renderArtifactForModel, type RenderCtx } from '../artifact/render';
import { emptySalesExtensions, type SalesArtifactExtensions } from '../domain/sales/state';
import { salesRenderSections } from '../domain/sales/render';

// --- Contratos genéricos del artefacto (re-exportados sin cambios) ---
export type {
  FieldState,
  FreeNote,
  ArtifactState,
  UpdateMeta,
} from '../artifact/state';
export { missingRequiredPaths, labelForPath } from '../artifact/state';
export type { RenderCtx } from '../artifact/render';

// --- Estado del dominio de venta (re-exportado sin cambios) ---
export type {
  Opportunity,
  OpportunityStatus,
  OpportunityUpdate,
  Objection,
  ObjectionType,
  SalesDiagnosis,
  DiagnosisUpdate,
  Urgency,
} from '../domain/sales/state';
export {
  acceptedOpportunities,
  getDiagnosis,
  listOpportunities,
  openObjections,
  pendingOpportunities,
  updateDiagnosis,
  upsertOpportunities,
} from '../domain/sales/state';

/** El artefacto de Intake: el formulario genérico MÁS los bloques de venta. */
export type IntakeState = ArtifactState & SalesArtifactExtensions;

/** Alias histórico del update genérico. */
export type IntakeUpdate = ArtifactUpdate;

export function createEmptyIntakeFromSchema(schema: IntakeSchema): IntakeState {
  return { ...createEmptyArtifact(schema), ...emptySalesExtensions() };
}

export function bulkUpdate(
  schema: IntakeSchema,
  intake: IntakeState,
  updates: IntakeUpdate[],
  meta: { now: string; source_message_id: string | null },
): BulkUpdateResult<IntakeState> {
  return bulkUpdateArtifact(schema, intake, updates, meta);
}

export function addFreeNote(
  intake: IntakeState,
  text: string,
  now: string,
  source_message_id: string | null,
): IntakeState {
  return addFreeNoteToArtifact(intake, text, now, source_message_id);
}

export function isIntakeComplete(schema: IntakeSchema, intake: IntakeState): boolean {
  return isArtifactComplete(schema, intake);
}

/** Estado del artefacto para el modelo, con los bloques de venta de Intake. */
export function renderIntakeForModel(
  schema: IntakeSchema,
  intake: IntakeState,
  ctx: RenderCtx,
): string {
  return renderArtifactForModel(schema, intake, ctx, salesRenderSections);
}
