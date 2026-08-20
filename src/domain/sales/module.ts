/**
 * MÓDULO `ventas`: declaración componible.
 *
 * Reúne lo que este módulo aporta a una vertical. Componerlo convierte al agente
 * en asesor; no componerlo lo deja como captador puro, sin tocar el runtime.
 */
import type { ArtifactState } from '../../artifact/state';
import type { DomainModule, FollowUpClaim } from '../modules';
import { emptySalesExtensions, getDiagnosis, openObjections, pendingOpportunities } from './state';
import { salesRenderSections } from './render';
import { salesToolProviders } from './tools';

/**
 * Persigue lo que se ofreció y quedó sin respuesta. Va ANTES que un dato
 * faltante: el cliente ya mostró interés y perseguir el campo menor mientras la
 * propuesta se enfría es el error caro.
 */
export function resolvePendingOffer(state: ArtifactState): FollowUpClaim | null {
  const pendingServices = pendingOpportunities(state).map((o) => o.service);
  if (pendingServices.length === 0) return null;
  return {
    reason: 'pending_offer',
    body: [
      `Quedó en el aire lo que le ofreciste: ${pendingServices.join(', ')}. ` +
        'Retómalo de forma ligera, recordando el beneficio en una frase, y facilítale la ' +
        'respuesta (que solo tenga que decir sí o no).',
    ],
  };
}

/**
 * Lo que este módulo aporta al preámbulo aunque NO sea el que reclama: el dolor
 * del cliente y la objeción sin resolver. Es composición de verdad — `ventas`
 * enriquece el seguimiento de `intake` sin que `intake` sepa que existe.
 */
export function salesFollowUpContext(state: ArtifactState): string[] {
  const lines: string[] = [];
  const diagnosis = getDiagnosis(state);
  if (diagnosis.pain) {
    lines.push(`Lo que te contó que necesita: ${diagnosis.pain}`);
  }
  const unresolved = openObjections(state).map((o) => `${o.type}: ${o.note}`);
  if (unresolved.length > 0) {
    lines.push(
      `Quedó sin resolver: ${unresolved.join(' | ')}. Retómalo por AHÍ — ` +
        'lo más probable es que sea el motivo real del silencio.',
    );
  }
  return lines;
}

export const salesModule: DomainModule = {
  name: 'ventas',
  emptyState: emptySalesExtensions,
  toolProviders: salesToolProviders,
  renderSections: salesRenderSections,
  skills: ['descubrimiento', 'ventas', 'objeciones'],
  resolveFollowUp: resolvePendingOffer,
  followUpPriority: 10,
  followUpContext: salesFollowUpContext,
};
