/**
 * MÓDULO `rutas`: su bloque en el prompt.
 *
 * Lo que el modelo tiene que ver en cada turno es el estado del proceso: qué
 * rutas hay sobre la mesa, cuál está recorriendo, qué le falta y qué toca ahora.
 * Sin esto el agente vuelve a empezar cada turno y propone lo mismo otra vez.
 */
import type { ArtifactRenderSection } from '../../artifact/render';
import type { ArtifactState } from '../../artifact/state';
import {
  listRutas,
  pasosPendientes,
  rutaEnCurso,
  rutasPropuestas,
  type RutasArtifactExtensions,
  type Ruta,
} from './state';

type RutasState = ArtifactState & RutasArtifactExtensions;

function renderRuta(r: Ruta, activa: boolean): string[] {
  const lines: string[] = [];
  const marca = activa ? '▶' : '·';
  lines.push(`  ${marca} [${r.id}] ${r.destino} — viabilidad ${r.viabilidad} (${r.estado})`);
  if (r.brechas.length > 0) lines.push(`      le falta: ${r.brechas.join(', ')}`);
  if (r.tiempo_estimado) lines.push(`      tiempo: ${r.tiempo_estimado}`);
  if (r.costo_estimado) lines.push(`      costo: ${r.costo_estimado}`);
  const verificadas = r.oportunidades.filter((o) => o.confianza === 'verificado');
  if (r.oportunidades.length > 0) {
    lines.push(
      `      oportunidades: ${r.oportunidades.length} (${verificadas.length} con fuente abrible)`,
    );
  }
  if (r.motivo_bloqueo) lines.push(`      ⚠ BLOQUEADA: ${r.motivo_bloqueo}`);
  return lines;
}

export const rutasSection: ArtifactRenderSection = {
  name: 'rutas.estado',
  render(state: ArtifactState): string[] {
    const s = state as RutasState;
    const todas = listRutas(s);
    const lines: string[] = ['Rutas laborales:'];

    if (todas.length === 0) {
      lines.push('  (ninguna todavía)');
      lines.push(
        '  → Antes de proponer nada: INVESTIGA con la tool `investigar`. No nombres puestos, ' +
          'empresas, salarios ni cursos que no hayan salido de ahí. Cuando tengas material, ' +
          'registra 2 o 3 rutas con `registrar_ruta`.',
      );
      return lines;
    }

    const activa = rutaEnCurso(s);
    for (const r of todas) lines.push(...renderRuta(r, r.id === activa?.id));

    if (!activa) {
      lines.push(
        `  → Hay ${rutasPropuestas(s).length} ruta(s) propuesta(s) y ninguna elegida. ` +
          'Preséntaselas con su brecha y su próxima acción, y cuando elija llama a `activar_ruta`.',
      );
      return lines;
    }

    lines.push('');
    lines.push(`  RUTA ACTIVA: ${activa.destino}`);
    lines.push(`  PRÓXIMA ACCIÓN: ${activa.proxima_accion}`);
    const pendientes = pasosPendientes(s);
    if (pendientes.length > 0) {
      lines.push('  Pasos pendientes:');
      for (const p of pendientes.slice(0, 5)) {
        const extra = [p.duracion, p.costo].filter(Boolean).join(' · ');
        lines.push(`   ${p.orden}. ${p.accion}${extra ? ` (${extra})` : ''}`);
      }
    }
    if (activa.estado === 'bloqueada') {
      lines.push(
        '  → La ruta está BLOQUEADA. Replanifica: investiga qué falló, y propón un cambio ' +
          '(otro mensaje, más radio, empresas directas, otra ruta) en vez de repetir lo mismo.',
      );
    } else {
      lines.push(
        '  → Registra con `registrar_avance` cada paso cumplido y cualquier bloqueo en cuanto lo sepas.',
      );
    }
    return lines;
  },
};

export const rutasRenderSections: ArtifactRenderSection[] = [rutasSection];
