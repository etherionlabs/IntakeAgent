/**
 * MÓDULO `rutas`: estado de las rutas laborales.
 *
 * La unidad del producto no es una vacante: es una RUTA desde donde está la
 * persona hasta un destino alcanzable, con lo que le separa, los pasos que lo
 * cierran y una próxima acción concreta. Una vacante suelta no le sirve a quien
 * hace delivery y no sabe qué le piden ni cómo llegar.
 *
 * Igual que `ventas`, es un módulo componible: cualquier vertical que acompañe a
 * alguien de un estado a otro —laboral, formativo, migratorio— podría usarlo.
 * Lo específico de movilidad laboral está en las etiquetas, no en la mecánica.
 */
import type { ArtifactState } from '../../artifact/state';
import { unsetDeclaredFields, validateDeclaredFields } from '../../artifact/state';
import type { IntakeField } from '../../config/intake-schema';
import { isUsableUrl } from '../../research/parse';
import type { Confidence, Source } from '../../research/types';

/** Qué tan alcanzable parece el destino para esta persona. */
export type Viabilidad = 'alta' | 'media' | 'baja';

/**
 * Estado de una ruta.
 * - `propuesta`: se le ofreció, no ha elegido.
 * - `activa`: es la que está recorriendo. Solo puede haber una.
 * - `bloqueada`: algo la frenó (no hubo respuestas, apareció un requisito nuevo).
 * - `descartada` / `lograda`: terminadas.
 */
export type EstadoRuta = 'propuesta' | 'activa' | 'bloqueada' | 'descartada' | 'lograda';

export interface PasoRuta {
  orden: number;
  /** Qué tiene que hacer, en imperativo y concreto. */
  accion: string;
  /** Qué brecha cierra este paso. */
  cierra?: string;
  costo?: string;
  duracion?: string;
  hecho: boolean;
}

/**
 * Una oportunidad concreta encontrada durante la investigación.
 *
 * Lleva su certeza y su fuente por la misma razón que los hallazgos: lo que se
 * le presenta a alguien como "hay una vacante aquí" tiene que poder abrirse.
 */
export interface OportunidadLaboral {
  titulo: string;
  empleador?: string;
  ubicacion?: string;
  salario?: string;
  confianza: Confidence;
  source: Source | null;
}

export interface Ruta {
  id: string;
  /** Puesto o categoría concreta a la que lleva. */
  destino: string;
  viabilidad: Viabilidad;
  /** Qué separa hoy a la persona del destino. */
  brechas: string[];
  pasos: PasoRuta[];
  oportunidades: OportunidadLaboral[];
  tiempo_estimado?: string;
  costo_estimado?: string;
  /** Siempre tiene que haber algo que la persona pueda hacer hoy. */
  proxima_accion: string;
  estado: EstadoRuta;
  /** Por qué se bloqueó, cuando aplique. Alimenta la replanificación. */
  motivo_bloqueo?: string;
  updated_at: string;
}

export interface RutasArtifactExtensions {
  rutas?: Ruta[];
}

export function emptyRutasExtensions(): Required<RutasArtifactExtensions> {
  return { rutas: [] };
}

type RutasState = ArtifactState & RutasArtifactExtensions;

/**
 * Los campos que toda ruta debe traer, DECLARADOS.
 *
 * Mismo patrón que el diagnóstico de ventas: el elemento es dueño de qué hace
 * falta, el núcleo pone el validador y el cálculo de lo que falta.
 */
export const RUTA_FIELDS: readonly IntakeField[] = [
  { key: 'destino', label: 'a dónde lleva la ruta', type: 'string', required: true },
  {
    key: 'viabilidad',
    label: 'qué tan alcanzable es',
    type: 'enum',
    required: true,
    options: ['alta', 'media', 'baja'],
  },
  { key: 'proxima_accion', label: 'qué puede hacer hoy', type: 'text', required: true },
];

export function listRutas(state: RutasState): Ruta[] {
  return state.rutas ?? [];
}

/**
 * La ruta que la persona está recorriendo. Incluye las BLOQUEADAS a propósito.
 *
 * Estar bloqueada es una condición de la ruta en curso, no un abandono: si
 * dejara de contar como la ruta actual, no se le podría registrar más avance, el
 * seguimiento no la perseguiría y el prompt no la mostraría — es decir, un
 * bloqueo la volvería irrecuperable, que es exactamente el fracaso que el
 * acompañamiento existe para evitar. Desbloquear es replanificar, no empezar.
 */
export function rutaEnCurso(state: RutasState): Ruta | null {
  return listRutas(state).find((r) => r.estado === 'activa' || r.estado === 'bloqueada') ?? null;
}

export function rutasPropuestas(state: RutasState): Ruta[] {
  return listRutas(state).filter((r) => r.estado === 'propuesta');
}

/** Pasos de la ruta activa que siguen sin hacerse. */
export function pasosPendientes(state: RutasState): PasoRuta[] {
  const enCurso = rutaEnCurso(state);
  if (!enCurso) return [];
  return enCurso.pasos.filter((p) => !p.hecho).sort((a, b) => a.orden - b.orden);
}

export interface RutaUpdate {
  id?: string;
  destino: string;
  viabilidad: Viabilidad;
  proxima_accion: string;
  brechas?: string[];
  pasos?: Omit<PasoRuta, 'hecho'>[];
  oportunidades?: OportunidadLaboral[];
  tiempo_estimado?: string;
  costo_estimado?: string;
}

export function validateRutaUpdate(update: RutaUpdate): string | null {
  return validateDeclaredFields(RUTA_FIELDS, {
    destino: update.destino,
    viabilidad: update.viabilidad,
    proxima_accion: update.proxima_accion,
  });
}

/** Qué le falta a una ruta para poder presentarse. */
export function faltaEnRuta(update: Partial<RutaUpdate>): string[] {
  return unsetDeclaredFields(RUTA_FIELDS, update as Record<string, unknown>);
}

/**
 * Aplica la regla de procedencia a las oportunidades.
 *
 * Es el punto donde más importa: una vacante que se le enseña a alguien como
 * real y no lo es le hace perder un viaje y la confianza. Sin URL abrible no se
 * presenta como verificada.
 */
export function sanearOportunidades(
  oportunidades: OportunidadLaboral[],
): { oportunidades: OportunidadLaboral[]; degradadas: string[] } {
  const out: OportunidadLaboral[] = [];
  const degradadas: string[] = [];
  for (const o of oportunidades) {
    if (o.confianza === 'verificado' && !isUsableUrl(o.source?.url)) {
      degradadas.push(o.titulo);
      out.push({ ...o, confianza: 'inferido', source: null });
      continue;
    }
    out.push(o);
  }
  return { oportunidades: out, degradadas };
}

/**
 * Registra o actualiza una ruta. Upsert por `id`; sin `id` se crea una nueva.
 * Los pasos entran sin hacer: marcarlos es otra acción, con su propia evidencia.
 */
export function upsertRuta<S extends RutasState>(
  state: S,
  update: RutaUpdate,
  now: string,
  nuevoId: () => string,
): { state: S; ruta: Ruta; degradadas: string[] } {
  const next = structuredClone(state);
  const lista = [...(next.rutas ?? [])];
  const previa = update.id ? lista.find((r) => r.id === update.id) : undefined;
  const { oportunidades, degradadas } = sanearOportunidades(update.oportunidades ?? []);

  const ruta: Ruta = {
    id: previa?.id ?? update.id ?? nuevoId(),
    destino: update.destino,
    viabilidad: update.viabilidad,
    brechas: update.brechas ?? previa?.brechas ?? [],
    pasos: (update.pasos ?? []).map((p) => ({ ...p, hecho: marcadoAntes(previa, p.orden) })),
    oportunidades: oportunidades.length > 0 ? oportunidades : (previa?.oportunidades ?? []),
    ...(update.tiempo_estimado ? { tiempo_estimado: update.tiempo_estimado } : {}),
    ...(update.costo_estimado ? { costo_estimado: update.costo_estimado } : {}),
    proxima_accion: update.proxima_accion,
    // Actualizar una ruta no la activa ni la desbloquea: eso son decisiones aparte.
    estado: previa?.estado ?? 'propuesta',
    ...(previa?.motivo_bloqueo ? { motivo_bloqueo: previa.motivo_bloqueo } : {}),
    updated_at: now,
  };

  const idx = lista.findIndex((r) => r.id === ruta.id);
  if (idx >= 0) lista[idx] = ruta;
  else lista.push(ruta);
  next.rutas = lista;
  return { state: next, ruta, degradadas };
}

/** Un paso ya hecho sigue hecho aunque se reescriba la ruta al replanificar. */
function marcadoAntes(previa: Ruta | undefined, orden: number): boolean {
  return previa?.pasos.find((p) => p.orden === orden)?.hecho ?? false;
}

/**
 * Activa una ruta. Solo puede haber una activa: las demás propuestas quedan
 * como estaban, y la anterior activa pasa a propuesta —no a descartada—, porque
 * cambiar de ruta no es renunciar a la otra.
 */
export function activarRuta<S extends RutasState>(state: S, id: string, now: string): S | null {
  const next = structuredClone(state);
  const lista = [...(next.rutas ?? [])];
  if (!lista.some((r) => r.id === id)) return null;
  next.rutas = lista.map((r) => {
    // Elegirla la reactiva aunque estuviera bloqueada, y le limpia el motivo.
    if (r.id === id) {
      const { motivo_bloqueo: _ignorado, ...resto } = r;
      return { ...resto, estado: 'activa' as EstadoRuta, updated_at: now };
    }
    if (r.estado === 'activa' || r.estado === 'bloqueada') {
      return { ...r, estado: 'propuesta' as EstadoRuta, updated_at: now };
    }
    return r;
  });
  return next;
}

export interface AvanceRuta {
  paso_orden?: number;
  bloqueo?: string;
  proxima_accion?: string;
  estado?: EstadoRuta;
}

/**
 * Registra lo que pasó al recorrer la ruta activa. Es lo que convierte la ruta
 * en un proceso vivo: un bloqueo aquí es la entrada de la replanificación.
 */
export function registrarAvance<S extends RutasState>(
  state: S,
  avance: AvanceRuta,
  now: string,
): { state: S; error?: string } {
  const enCurso = rutaEnCurso(state);
  if (!enCurso) return { state, error: 'no hay ruta en curso' };

  const next = structuredClone(state);
  next.rutas = (next.rutas ?? []).map((r) => {
    if (r.id !== enCurso.id) return r;
    const pasos =
      avance.paso_orden !== undefined
        ? r.pasos.map((p) => (p.orden === avance.paso_orden ? { ...p, hecho: true } : p))
        : r.pasos;
    // Volver a 'activa' explícitamente es desbloquear: se limpia el motivo.
    const desbloquea = avance.estado === 'activa';
    const { motivo_bloqueo, ...sinMotivo } = r;
    const base = desbloquea ? sinMotivo : r;
    return {
      ...base,
      pasos,
      ...(avance.proxima_accion ? { proxima_accion: avance.proxima_accion } : {}),
      ...(avance.bloqueo ? { motivo_bloqueo: avance.bloqueo, estado: 'bloqueada' as EstadoRuta } : {}),
      ...(avance.estado ? { estado: avance.estado } : {}),
      updated_at: now,
    };
  });
  return { state: next };
}
