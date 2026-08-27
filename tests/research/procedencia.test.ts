import { describe, it, expect } from 'vitest';
import {
  extractJson,
  groupByConfidence,
  isUsableUrl,
  parseResearchResponse,
  sanitizeFindings,
} from '../../src/research/parse';
import { NoopResearcher, ScriptedResearcher } from '../../src/research/types';

/**
 * La regla del producto es "no inventes requisitos, salarios ni vacantes".
 *
 * Pedírselo al modelo en el prompt no es una garantía: es una esperanza. Estos
 * tests fijan la parte que SÍ es comprobable — que nada entre al producto
 * etiquetado como hecho sin una fuente que alguien pueda abrir.
 */

const NOW = '2026-08-27T10:00:00.000Z';

describe('qué cuenta como fuente', () => {
  it('acepta http y https', () => {
    expect(isUsableUrl('https://indeed.com/x')).toBe(true);
    expect(isUsableUrl('http://ejemplo.org')).toBe(true);
  });

  it('rechaza lo que nadie puede abrir', () => {
    for (const malo of ['', '   ', 'indeed.com', 'según mi conocimiento', 'file:///etc/passwd', null]) {
      expect(isUsableUrl(malo as string), String(malo)).toBe(false);
    }
  });
});

describe('la regla de procedencia', () => {
  it('degrada a inferido lo que se dice verificado sin fuente abrible', () => {
    const { findings, downgraded } = sanitizeFindings(
      [{ claim: 'HVAC Helper paga $22/h en Brandon', confidence: 'verificado', source: null }],
      NOW,
    );
    expect(findings[0].confidence).toBe('inferido');
    expect(findings[0].source).toBeNull();
    // Y deja rastro: degradar en silencio sería tan malo como aceptarlo.
    expect(downgraded).toEqual(['HVAC Helper paga $22/h en Brandon']);
  });

  it('degrada también cuando la "fuente" no es una URL', () => {
    const { findings } = sanitizeFindings(
      [{
        claim: 'se exige licencia EPA 608',
        confidence: 'verificado',
        source: { url: 'conocimiento general', title: '', consultedAt: NOW },
      }],
      NOW,
    );
    expect(findings[0].confidence).toBe('inferido');
  });

  it('conserva lo verificado con fuente real', () => {
    const { findings, downgraded } = sanitizeFindings(
      [{
        claim: 'ACME Air contrata helpers sin experiencia',
        confidence: 'verificado',
        source: { url: 'https://acme.example/jobs/123', title: 'ACME — HVAC Helper', consultedAt: 'x' },
      }],
      NOW,
    );
    expect(findings[0].confidence).toBe('verificado');
    expect(findings[0].source?.url).toBe('https://acme.example/jobs/123');
    expect(downgraded).toEqual([]);
  });

  /**
   * La fecha la sella el sistema, no el modelo: un salario "consultado hoy"
   * inventado por el modelo parece fresco sin serlo.
   */
  it('sella la fecha de consulta ignorando la que traiga el modelo', () => {
    const { findings } = sanitizeFindings(
      [{
        claim: 'rango 20-25 USD/h',
        confidence: 'verificado',
        source: { url: 'https://x.example/a', title: 'X', consultedAt: '1999-01-01T00:00:00Z' },
      }],
      NOW,
    );
    expect(findings[0].source?.consultedAt).toBe(NOW);
  });

  it('`desconocido` sobrevive: no saber es información, no un hueco', () => {
    const { findings } = sanitizeFindings(
      [{ claim: 'no se halló rango salarial local', confidence: 'desconocido', source: null }],
      NOW,
    );
    expect(findings[0].confidence).toBe('desconocido');
  });
});

describe('parseo de la respuesta del modelo', () => {
  it('extrae JSON envuelto en prosa o en vallas de código', () => {
    expect(extractJson('Claro, aquí tienes:\n```json\n{"a":1}\n```\n¿algo más?')).toEqual({ a: 1 });
    expect(extractJson('bla {"a":2} bla')).toEqual({ a: 2 });
  });

  it('una respuesta sin JSON falla en vez de devolver vacío', () => {
    const out = parseResearchResponse('No encontré nada, lo siento.', NOW);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/JSON/);
  });

  it('aplica la regla de procedencia de punta a punta', () => {
    const raw = JSON.stringify({
      findings: [
        { claim: 'vacante real en ACME', confidence: 'verificado', source: { url: 'https://acme.example/j/1', title: 'ACME' } },
        { claim: 'suelen pagar $22/h', confidence: 'verificado', source: null },
        { claim: 'no hay dato de turnos', confidence: 'desconocido' },
      ],
      unresolved: ['no se pudo confirmar si sigue abierta'],
    });
    const out = parseResearchResponse(raw, NOW);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.findings.map((f) => f.confidence)).toEqual(['verificado', 'inferido', 'desconocido']);
    expect(out.downgraded).toEqual(['suelen pagar $22/h']);
    expect(out.unresolved).toEqual(['no se pudo confirmar si sigue abierta']);
  });

  it('agrupa por certeza para no mezclar hechos con deducciones', () => {
    const g = groupByConfidence({
      findings: [
        { claim: 'a', confidence: 'verificado', source: { url: 'https://x.example', title: '', consultedAt: NOW } },
        { claim: 'b', confidence: 'inferido', source: null },
      ],
      unresolved: [], model: 'm', costUsd: null,
    });
    expect(g.verificado).toHaveLength(1);
    expect(g.inferido).toHaveLength(1);
    expect(g.desconocido).toHaveLength(0);
  });
});

describe('investigadores sin red', () => {
  it('Noop no finge haber buscado: lo declara sin resolver', async () => {
    const r = await new NoopResearcher().research({ question: 'x' });
    expect(r.findings).toEqual([]);
    expect(r.unresolved[0]).toMatch(/deshabilitada/);
  });

  it('Scripted devuelve el guion y se queda en el último', async () => {
    const uno = { findings: [], unresolved: ['a'], model: 's', costUsd: null };
    const dos = { findings: [], unresolved: ['b'], model: 's', costUsd: null };
    const s = new ScriptedResearcher([uno, dos]);
    expect((await s.research({ question: 'x' })).unresolved).toEqual(['a']);
    expect((await s.research({ question: 'x' })).unresolved).toEqual(['b']);
    expect((await s.research({ question: 'x' })).unresolved).toEqual(['b']);
  });
});
