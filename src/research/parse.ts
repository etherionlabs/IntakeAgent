/**
 * Parseo y SANEADO de lo que devuelve el investigador.
 *
 * La regla del producto —no inventar requisitos, salarios ni vacantes— no se
 * sostiene pidiéndoselo al modelo en el prompt. Aquí se hace comprobable:
 * cualquier hallazgo que se declare `verificado` sin una fuente abrible se
 * degrada a `inferido` y se deja constancia. El modelo puede equivocarse; lo
 * que no puede es que su error entre al producto etiquetado como hecho.
 */
import { z } from 'zod';
import type { Confidence, Finding, ResearchResult, Source } from './types';

const SourceZ = z.object({
  url: z.string().min(1),
  title: z.string().default(''),
  consultedAt: z.string().optional(),
});

const FindingZ = z.object({
  claim: z.string().min(3),
  confidence: z.enum(['verificado', 'inferido', 'desconocido']).default('inferido'),
  source: SourceZ.nullable().optional(),
});

const PayloadZ = z.object({
  findings: z.array(FindingZ).default([]),
  unresolved: z.array(z.string()).default([]),
});

/** ¿La URL es algo que una persona pueda abrir? */
export function isUsableUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export interface SanitizeResult {
  findings: Finding[];
  /** Hallazgos degradados por declararse verificados sin fuente utilizable. */
  downgraded: string[];
}

/**
 * Aplica la regla de procedencia. `consultedAt` se sella aquí, no se acepta del
 * modelo: la fecha de consulta es cuándo lo miramos nosotros, y un modelo que la
 * inventa produce datos que parecen frescos sin serlo.
 */
export function sanitizeFindings(findings: Finding[], now: string): SanitizeResult {
  const out: Finding[] = [];
  const downgraded: string[] = [];

  for (const f of findings) {
    const usable = isUsableUrl(f.source?.url);
    if (f.confidence === 'verificado' && !usable) {
      downgraded.push(f.claim);
      out.push({ claim: f.claim, confidence: 'inferido', source: null });
      continue;
    }
    const source: Source | null = usable
      ? { url: f.source!.url.trim(), title: f.source!.title || '', consultedAt: now }
      : null;
    out.push({ claim: f.claim, confidence: f.confidence, source });
  }
  return { findings: out, downgraded };
}

/** Extrae el primer objeto JSON del texto (los modelos lo envuelven en prosa o ```). */
export function extractJson(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

export type ParseOutcome =
  | { ok: true; findings: Finding[]; unresolved: string[]; downgraded: string[] }
  | { ok: false; error: string };

/**
 * Convierte la respuesta cruda en hallazgos saneados. Un fallo de parseo NO se
 * traga en silencio: sin hallazgos, el producto recomendaría rutas sin respaldo,
 * y eso es peor que no recomendar nada.
 */
export function parseResearchResponse(raw: string, now: string): ParseOutcome {
  const json = extractJson(raw);
  if (json === null) {
    return { ok: false, error: 'la respuesta no contenía JSON reconocible' };
  }
  const parsed = PayloadZ.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: `JSON con forma inesperada: ${parsed.error.message}` };
  }
  const normalized: Finding[] = parsed.data.findings.map((f) => ({
    claim: f.claim,
    confidence: f.confidence as Confidence,
    source: f.source
      ? { url: f.source.url, title: f.source.title ?? '', consultedAt: now }
      : null,
  }));
  const { findings, downgraded } = sanitizeFindings(normalized, now);
  return { ok: true, findings, unresolved: parsed.data.unresolved, downgraded };
}

/** Agrupa por certeza, para presentar sin mezclar hechos con deducciones. */
export function groupByConfidence(result: ResearchResult): Record<Confidence, Finding[]> {
  return {
    verificado: result.findings.filter((f) => f.confidence === 'verificado'),
    inferido: result.findings.filter((f) => f.confidence === 'inferido'),
    desconocido: result.findings.filter((f) => f.confidence === 'desconocido'),
  };
}
