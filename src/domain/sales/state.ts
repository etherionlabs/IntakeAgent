/**
 * ESTADO DE DOMINIO: VENTA CONSULTIVA (específico de Intake — NO extraer).
 *
 * Todo lo de aquí es conocimiento del negocio de Intake: qué es una oportunidad
 * de venta, qué es una objeción, qué hace falta descubrir antes de proponer. El
 * runtime del artefacto (`src/artifact/`) NO conoce nada de esto; se conecta por
 * los contratos de extensión (bloques de render, tools de dominio).
 *
 * Es el bloque que hay que REEMPLAZAR —no adaptar— al construir otra vertical.
 */
import type { ArtifactState } from '../../artifact/state';

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

/**
 * Diagnóstico de la conversación de venta (SPIN adaptado a nuestro caso).
 *
 * El hallazgo que más transfiere de la investigación comercial es que un buen
 * vendedor no propone antes de entender el IMPACTO: no basta con "quiere retapizar
 * un sillón", hace falta saber qué le cuesta no hacerlo. Guardarlo como estado —y
 * no dejarlo en la conversación— sirve para tres cosas: el agente ve en cada turno
 * qué le falta por descubrir y no salta al pitch, el seguimiento proactivo tiene
 * material real para retomar, y el dueño lo lee antes de cotizar.
 */
export type Urgency = 'alta' | 'media' | 'baja';

/** Tipos de fricción que aparecen en una venta de servicio local. */
export type ObjectionType = 'precio' | 'tiempo' | 'confianza' | 'competencia' | 'lo_piensa' | 'otro';

export interface Objection {
  type: ObjectionType;
  /** La objeción tal como la planteó el cliente. */
  note: string;
  /** ¿Se resolvió o sigue en el aire? Lo no resuelto es lo que mata el trato. */
  resolved: boolean;
  updated_at: string;
}

export interface SalesDiagnosis {
  /** Qué problema tiene, en sus palabras. */
  pain?: string;
  /** Qué le cuesta si NO lo resuelve (la pregunta de implicación). */
  implication?: string;
  urgency?: Urgency;
  objections: Objection[];
}

/**
 * Los bloques que este dominio añade al artefacto. Ambos son OPCIONALES en
 * lectura: los jobs creados antes de estas funciones no los traen en su JSON
 * persistido, así que todo consumidor debe tolerar `undefined`.
 */
export interface SalesArtifactExtensions {
  opportunities?: Opportunity[];
  diagnosis?: SalesDiagnosis;
}

/** Bloques con los que nace un artefacto de este dominio. */
export function emptySalesExtensions(): Required<SalesArtifactExtensions> {
  return { opportunities: [], diagnosis: { objections: [] } };
}

/**
 * Clave de identidad de una oportunidad: minúsculas, sin acentos y con espacios
 * colapsados. Así "Polarizado 20%" y "polarizado 20%" son el MISMO servicio y
 * cambiar su estado (offered → accepted) actualiza la entrada en vez de duplicarla.
 */
function opportunityKey(service: string): string {
  return service
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export interface OpportunityUpdate {
  service: string;
  status: OpportunityStatus;
  note?: string;
}

type SalesState = ArtifactState & SalesArtifactExtensions;

export function listOpportunities(state: SalesState): Opportunity[] {
  return state.opportunities ?? [];
}

/** Servicios extra que el cliente aceptó — lo que el dueño debe cotizar de más. */
export function acceptedOpportunities(state: SalesState): Opportunity[] {
  return listOpportunities(state).filter((o) => o.status === 'accepted');
}

/** Servicios ofrecidos que el cliente todavía no contestó. */
export function pendingOpportunities(state: SalesState): Opportunity[] {
  return listOpportunities(state).filter((o) => o.status === 'offered');
}

/**
 * Registra o actualiza oportunidades de venta. Upsert por servicio: si el
 * servicio ya existe se le sobrescribe el estado (un "no" posterior gana sobre
 * el "ofrecido" previo); si no, se agrega al final conservando el orden.
 */
export function upsertOpportunities<S extends SalesState>(
  state: S,
  updates: OpportunityUpdate[],
  now: string,
  source_message_id: string | null,
): S {
  const next = structuredClone(state);
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

export function getDiagnosis(state: SalesState): SalesDiagnosis {
  return state.diagnosis ?? { objections: [] };
}

/** Objeciones que el cliente planteó y siguen sin resolverse. */
export function openObjections(state: SalesState): Objection[] {
  return getDiagnosis(state).objections.filter((o) => !o.resolved);
}

export interface DiagnosisUpdate {
  pain?: string;
  implication?: string;
  urgency?: Urgency;
  objection?: { type: ObjectionType; note: string; resolved?: boolean };
}

/**
 * Actualiza el diagnóstico. Los campos ausentes NO se borran: cada turno aporta
 * lo que descubrió sin tener que repetir lo anterior. Las objeciones son upsert
 * por tipo — el cliente que vuelve al precio no crea una segunda objeción de
 * precio, actualiza la que ya estaba.
 */
export function updateDiagnosis<S extends SalesState>(
  state: S,
  update: DiagnosisUpdate,
  now: string,
): S {
  const next = structuredClone(state);
  const current = next.diagnosis ?? { objections: [] };
  const objections = [...current.objections];

  if (update.objection) {
    const { type, note, resolved } = update.objection;
    const idx = objections.findIndex((o) => o.type === type);
    const entry: Objection = { type, note, resolved: resolved ?? false, updated_at: now };
    if (idx >= 0) objections[idx] = entry;
    else objections.push(entry);
  }

  next.diagnosis = {
    ...current,
    ...(update.pain !== undefined ? { pain: update.pain } : {}),
    ...(update.implication !== undefined ? { implication: update.implication } : {}),
    ...(update.urgency !== undefined ? { urgency: update.urgency } : {}),
    objections,
  };
  return next;
}

/** Qué le falta por descubrir al agente, en lenguaje para el modelo. */
export function missingDiscovery(state: SalesState): string[] {
  const diag = getDiagnosis(state);
  const missing: string[] = [];
  if (!diag.pain) missing.push('el problema en sus palabras');
  if (!diag.implication) missing.push('qué le cuesta si NO lo resuelve');
  if (!diag.urgency) missing.push('qué tan urgente es');
  return missing;
}
