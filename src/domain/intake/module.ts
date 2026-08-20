/**
 * MÓDULO `intake`: captación estructurada de información.
 *
 * Lleva la conversación desde "un cliente escribió" hasta "el artefacto está
 * completo y una persona debe tomarlo". Es reutilizable: cualquier vertical que
 * necesite reunir datos validados antes de escalar a un humano lo compone.
 *
 * No incluye las capacidades del RUNTIME (marcar spam, pedir fotos, re-analizar
 * imágenes, elegir a qué caso pertenece un mensaje): esas no son de dominio, van
 * siempre y viven en `src/agent/tools.ts`.
 */
import type { ArtifactState } from '../../artifact/state';
import { labelForPath, missingRequiredPaths } from '../../artifact/state';
import type { IntakeSchema } from '../../config/intake-schema';
import type { DomainModule, FollowUpClaim } from '../modules';
import {
  buildCloseJobTool,
  buildMarkReadyTool,
  buildUpdateIntakeTool,
} from '../../agent/tools';

/**
 * Persigue los campos requeridos que faltan.
 *
 * Vivía en el módulo de ventas por accidente histórico: es de intake. Se ve al
 * componer sin ventas — sin esto, una vertical de captación pura se quedaba sin
 * ningún motivo de seguimiento.
 */
export function resolveIncompleteIntake(
  state: ArtifactState,
  schema: IntakeSchema,
): FollowUpClaim | null {
  const missingLabels = missingRequiredPaths(schema, state).map((p) => labelForPath(schema, p));
  if (missingLabels.length === 0) return null;
  return {
    reason: 'incomplete_intake',
    body: [
      `Falta capturar: ${missingLabels.join(', ')}. ` +
        'Retoma pidiendo SOLO el dato más importante que falte, no toda la lista.',
    ],
  };
}

export const intakeModule: DomainModule = {
  name: 'intake',
  // El artefacto base (secciones del esquema, media, notas) lo crea el core.
  emptyState: () => ({}),
  toolProviders: [
    { name: 'update_intake', build: buildUpdateIntakeTool },
    { name: 'mark_ready_for_review', build: buildMarkReadyTool },
    { name: 'close_job', build: buildCloseJobTool },
  ],
  // El estado del artefacto ya lo renderiza el core: este módulo no añade bloques.
  renderSections: [],
  skills: [],
  resolveFollowUp: resolveIncompleteIntake,
  // Cede ante módulos con material más caliente: un dato que falta se puede pedir
  // más tarde, una propuesta enfriándose no se recupera.
  followUpPriority: 20,
};
