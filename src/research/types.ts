/**
 * INVESTIGACIÓN CON PROCEDENCIA (genérico — candidato a extracción).
 *
 * Hasta ahora el agente solo hablaba con el modelo: la única salida a internet
 * en todo el proyecto era el editor de imágenes. Una vertical que construye
 * rutas laborales necesita hechos del mundo —vacantes, requisitos, salarios,
 * cursos— y esos hechos caducan.
 *
 * Por eso la unidad no es "texto que devolvió el modelo" sino un HALLAZGO con
 * su procedencia y su grado de certeza. La regla del producto es que no se
 * inventan requisitos ni salarios; para que eso sea comprobable y no un deseo
 * escrito en el prompt, la estructura obliga a declarar de dónde sale cada cosa.
 */

/**
 * Qué tan firme es un hallazgo.
 * - `verificado`: sale de una fuente concreta que se puede abrir.
 * - `inferido`: deducción razonable, sin fuente que lo diga literalmente.
 * - `desconocido`: no se pudo averiguar. Es información útil, no un hueco.
 */
export type Confidence = 'verificado' | 'inferido' | 'desconocido';

export interface Source {
  url: string;
  title: string;
  /** Cuándo se consultó. Un salario sin fecha no significa nada. */
  consultedAt: string;
}

export interface Finding {
  /** El hecho, en una frase. */
  claim: string;
  confidence: Confidence;
  /** Obligatoria para `verificado`; null en los demás casos. */
  source: Source | null;
}

export interface ResearchQuery {
  /** Qué se quiere averiguar, en lenguaje natural. */
  question: string;
  /** Dónde aplica (ciudad, estado). Casi todo en esta vertical es local. */
  location?: string;
  /** Contexto del usuario que acota la búsqueda (ej. "sin experiencia previa"). */
  context?: string;
}

export interface ResearchResult {
  findings: Finding[];
  /** Lo que el investigador no pudo resolver, en claro. */
  unresolved: string[];
  model: string;
  costUsd: number | null;
  /** Texto crudo devuelto, para depurar cuando el parseo falle. */
  raw?: string;
}

export interface Researcher {
  research(query: ResearchQuery): Promise<ResearchResult>;
}

/**
 * No investiga nada.
 *
 * A diferencia de `NoopDescriber`, esto NO es una degradación aceptable en
 * producción: "no encontré vacantes" y "la búsqueda no funciona" se ven igual
 * desde fuera, y confundirlos haría que el producto recomiende rutas sin
 * respaldo. Existe para tests y para poder ejercer el resto del loop sin red.
 */
export class NoopResearcher implements Researcher {
  async research(_query: ResearchQuery): Promise<ResearchResult> {
    return {
      findings: [],
      unresolved: ['investigación deshabilitada (NoopResearcher)'],
      model: 'noop',
      costUsd: null,
    };
  }
}

/** Devuelve resultados predefinidos en orden. Para tests sin red. */
export class ScriptedResearcher implements Researcher {
  private idx = 0;
  constructor(private readonly script: ReadonlyArray<ResearchResult>) {}

  async research(_query: ResearchQuery): Promise<ResearchResult> {
    const next = this.script[this.idx];
    if (this.idx < this.script.length - 1) this.idx += 1;
    return next ?? { findings: [], unresolved: [], model: 'scripted', costUsd: null };
  }
}
