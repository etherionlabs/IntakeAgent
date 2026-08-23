/**
 * MÓDULO `intake`: captación estructurada de información.
 *
 * Lleva la conversación desde "un cliente escribió" hasta "el artefacto está
 * completo y una persona debe tomarlo". Es reutilizable: cualquier vertical que
 * necesite reunir datos validados antes de escalar a un humano lo compone.
 *
 * NO declara tools, y eso es un hallazgo, no un olvido. Al intentar dárselas
 * como tools de elemento, el compilador mostró que `update_intake`,
 * `mark_ready_for_review` y `close_job` necesitan el notificador, la config y el
 * esquema del perfil — es decir, son primitivas del ARNÉS, no conocimiento de
 * dominio. Capturar información estructurada en un artefacto y escalarla a una
 * persona es lo que hace el runtime; lo específico de este dominio son el
 * esquema (que vive en `profiles/`) y su motivo de seguimiento.
 *
 * Dicho de otro modo: el único elemento con código propio hoy es `ventas`.
 */
import type { ArtifactState } from '../../artifact/state';
import { labelForPath, missingRequiredPaths } from '../../artifact/state';
import type { IntakeSchema } from '../../config/intake-schema';
import type { DomainModule, FollowUpClaim } from '../modules';

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
  version: '1.0.0',
  // El artefacto base (secciones del esquema, media, notas) lo crea el core.
  emptyState: () => ({}),
  toolProviders: [],
  // El estado del artefacto ya lo renderiza el core: este módulo no añade bloques.
  renderSections: [],
  skills: [],
  resolveFollowUp: resolveIncompleteIntake,
  // Cede ante módulos con material más caliente: un dato que falta se puede pedir
  // más tarde, una propuesta enfriándose no se recupera.
  followUpPriority: 20,
};
