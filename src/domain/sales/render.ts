/**
 * MÓDULO `ventas`: sus bloques en el prompt.
 *
 * Antes vivían dentro del renderer del artefacto, que por tanto sabía qué es una
 * objeción y hasta nombraba las tools de venta en su salida. Aquí son secciones
 * que se registran en el renderer genérico: el core inserta lo que estas
 * funciones devuelven, sin interpretarlo.
 *
 * La salida es IDÉNTICA a la de antes, a propósito: el prompt es una interfaz
 * con el modelo y cambiarlo en un refactor de fronteras mezclaría dos riesgos.
 */
import type { ArtifactRenderSection } from '../../artifact/render';
import type { ArtifactState } from '../../artifact/state';
import {
  getDiagnosis,
  listOpportunities,
  missingDiscovery,
  type OpportunityStatus,
  type SalesArtifactExtensions,
} from './state';

type SalesState = ArtifactState & SalesArtifactExtensions;

/**
 * Diagnóstico de venta. Se imprime SIEMPRE, incluso vacío: su valor está justo
 * en mostrarle al agente lo que todavía no ha descubierto, que es lo que lo
 * frena de saltar al pitch.
 */
export const diagnosisSection: ArtifactRenderSection = {
  name: 'sales.diagnosis',
  render(state: ArtifactState): string[] {
    const diag = getDiagnosis(state as SalesState);
    const missing = missingDiscovery(state as SalesState);
    const lines: string[] = [];

    lines.push('Diagnóstico de venta:');
    lines.push(`  ${diag.pain ? '✓' : '✗'} Problema: ${diag.pain ?? '(sin descubrir)'}`);
    lines.push(
      `  ${diag.implication ? '✓' : '✗'} Qué le cuesta no resolverlo: ${diag.implication ?? '(sin descubrir)'}`,
    );
    lines.push(`  ${diag.urgency ? '✓' : '✗'} Urgencia: ${diag.urgency ?? '(sin descubrir)'}`);
    for (const o of diag.objections) {
      lines.push(
        `  ${o.resolved ? '✓' : '⚠'} Objeción (${o.type}): ${o.note}${o.resolved ? '' : ' — SIN RESOLVER'}`,
      );
    }
    if (missing.length > 0) {
      lines.push(
        `  → Te falta descubrir: ${missing.join(', ')}. Descúbrelo con preguntas ANTES de ` +
          'proponer nada, y guárdalo con register_discovery.',
      );
    }
    return lines;
  },
};

/** Servicios adicionales ofrecidos/aceptados/rechazados. Vacío = no se imprime. */
export const opportunitiesSection: ArtifactRenderSection = {
  name: 'sales.opportunities',
  render(state: ArtifactState): string[] {
    const opportunities = listOpportunities(state as SalesState);
    if (opportunities.length === 0) return [];

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

    const lines: string[] = ['Servicios adicionales (venta):'];
    for (const o of opportunities) {
      const note = o.note ? ` — ${o.note}` : '';
      lines.push(`  ${icons[o.status]} ${o.service}: ${labels[o.status]}${note}`);
    }
    lines.push(
      '  → Registra con register_opportunity cada extra que ofrezcas y actualízalo cuando el ' +
        'cliente responda. Los ACEPTADOS van en el resumen para que el dueño los cotice; los ' +
        'rechazados no se vuelven a mencionar.',
    );
    return lines;
  },
};

/** Bloques que el dominio de venta aporta al estado del artefacto, en orden. */
export const salesRenderSections: ArtifactRenderSection[] = [
  diagnosisSection,
  opportunitiesSection,
];
