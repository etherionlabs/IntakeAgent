/**
 * MÓDULO `rutas`: declaración componible.
 *
 * Se compone con `intake` (que reúne el perfil) para formar la vertical de
 * movilidad laboral. No se compone con `ventas`: aquí no se le vende nada a
 * nadie, y la prueba de que la composición funciona es justamente que una
 * vertical pueda tomar `intake` sin arrastrar el resto.
 */
import type { ArtifactState } from '../../artifact/state';
import type { DomainModule, FollowUpClaim } from '../modules';
import { emptyRutasExtensions, pasosPendientes, rutaEnCurso, rutasPropuestas } from './state';
import { rutasRenderSections } from './render';
import { rutasToolProviders } from './tools';

/**
 * Persigue el silencio sobre una ruta viva.
 *
 * Es el motivo con más valor del producto: una ruta abandonada a los tres días
 * es exactamente el fracaso que el acompañamiento existe para evitar. Va por
 * delante de todo lo demás.
 */
export function resolveRutaEnMarcha(state: ArtifactState): FollowUpClaim | null {
  const activa = rutaEnCurso(state);
  if (activa) {
    if (activa.estado === 'bloqueada') {
      return {
        reason: 'ruta_bloqueada',
        body: [
          `Su ruta hacia "${activa.destino}" quedó bloqueada: ${activa.motivo_bloqueo ?? 'sin detalle'}. ` +
            'Retoma proponiendo UN cambio concreto de estrategia, no repitiendo lo que ya no funcionó.',
        ],
      };
    }
    const pendientes = pasosPendientes(state);
    if (pendientes.length > 0) {
      return {
        reason: 'ruta_en_marcha',
        body: [
          `Está recorriendo la ruta hacia "${activa.destino}" y lo que sigue es: ${activa.proxima_accion}. ` +
            'Pregúntale cómo le fue con eso, sin dar por hecho que lo hizo ni reprochárselo si no.',
        ],
      };
    }
  }

  const propuestas = rutasPropuestas(state);
  if (!activa && propuestas.length > 0) {
    return {
      reason: 'rutas_sin_elegir',
      body: [
        `Le presentaste ${propuestas.length} ruta(s) y no eligió ninguna: ` +
          `${propuestas.map((r) => r.destino).join(', ')}. Retómalo preguntando qué le frenó ` +
          '—suele ser el tiempo o el dinero, no el interés— en vez de volver a listarlas.',
      ],
    };
  }
  return null;
}

export const rutasModule: DomainModule = {
  name: 'rutas',
  version: '0.1.0',
  emptyState: emptyRutasExtensions,
  toolProviders: rutasToolProviders,
  renderSections: rutasRenderSections,
  skills: [],
  resolveFollowUp: resolveRutaEnMarcha,
  // Gana a `incomplete_intake` (20): una ruta viva sin avanzar cuesta más que un
  // campo del perfil sin capturar.
  followUpPriority: 5,
};
