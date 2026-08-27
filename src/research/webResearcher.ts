/**
 * Investigador web vía OpenRouter.
 *
 * Usa el mismo camino que el resto del proyecto (`@openrouter/sdk`, import ESM
 * perezoso). La búsqueda se activa por el NOMBRE del modelo —el sufijo
 * `:online` de OpenRouter— así que no hace falta nada del SDK que no estemos
 * usando ya.
 *
 * ⚠ SIN VERIFICAR EMPÍRICAMENTE. No hay clave de OpenRouter en el entorno donde
 * se escribió esto, así que la conexión real está sin probar. Por eso el
 * investigador FALLA RUIDOSAMENTE en vez de devolver vacío: en este producto
 * "no encontré nada" y "la búsqueda no funciona" se ven igual desde fuera, y
 * confundirlos haría recomendar rutas sin respaldo. El primer `npm run
 * cli:investigar` con una clave real es lo que confirma o tumba esta pieza.
 */
import type { Researcher, ResearchQuery, ResearchResult } from './types';
import { parseResearchResponse } from './parse';

export class ResearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResearchError';
  }
}

export interface WebResearcherOptions {
  apiKey: string;
  /** Modelo con búsqueda web. En OpenRouter, el sufijo `:online` la activa. */
  model?: string;
  now?: () => Date;
}

export class WebResearcher implements Researcher {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly now: () => Date;

  constructor(opts: WebResearcherOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? 'openai/gpt-4o-mini:online';
    this.now = opts.now ?? (() => new Date());
  }

  async research(query: ResearchQuery): Promise<ResearchResult> {
    if (!this.apiKey) {
      throw new ResearchError('falta OPENROUTER_API_KEY: sin clave no hay investigación');
    }

    const { OpenRouter } = await import('@openrouter/sdk');
    const sdk = new OpenRouter({ apiKey: this.apiKey });

    let raw: string;
    let costUsd: number | null = null;
    try {
      const result = sdk.callModel({
        model: this.model,
        input: [{ role: 'user', content: buildUserPrompt(query) }],
        instructions: INSTRUCTIONS,
        temperature: 0,
      });
      const response = await result.getResponse();
      raw = (await result.getText())?.trim() ?? '';
      costUsd = response?.usage?.cost ?? null;
    } catch (e) {
      throw new ResearchError(
        `la llamada al investigador falló (${this.model}): ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    if (raw.length === 0) {
      throw new ResearchError(`el modelo ${this.model} devolvió una respuesta vacía`);
    }

    const parsed = parseResearchResponse(raw, this.now().toISOString());
    if (!parsed.ok) {
      throw new ResearchError(`${parsed.error}. Respuesta cruda:\n${raw.slice(0, 800)}`);
    }

    return {
      findings: parsed.findings,
      unresolved: [
        ...parsed.unresolved,
        ...parsed.downgraded.map((c) => `sin fuente abrible, degradado a inferido: ${c}`),
      ],
      model: this.model,
      costUsd,
      raw,
    };
  }
}

const INSTRUCTIONS = `Eres un investigador laboral. Buscas información PÚBLICA y REAL sobre empleo,
requisitos, salarios, certificaciones y programas de formación.

REGLAS DURAS:
- NO inventes vacantes, empresas, salarios, requisitos ni disponibilidad. Si no lo encuentras, dilo.
- Marca cada hallazgo con su certeza:
  · "verificado" SOLO si tienes una URL concreta que lo respalde. Sin URL abrible, NO es verificado.
  · "inferido" para deducciones razonables a partir de lo que sí encontraste.
  · "desconocido" para lo que no pudiste averiguar. Es una respuesta válida y útil.
- Prefiere quedarte corto y honesto antes que completo e inventado.
- No pongas fechas de consulta: las sella el sistema.

Responde SOLO con un objeto JSON con esta forma:
{
  "findings": [
    { "claim": "…un hecho en una frase…", "confidence": "verificado|inferido|desconocido",
      "source": { "url": "https://…", "title": "…" } }
  ],
  "unresolved": ["…lo que no pudiste averiguar…"]
}
Usa "source": null cuando no sea verificado.`;

function buildUserPrompt(query: ResearchQuery): string {
  const lines = [query.question];
  if (query.location) lines.push(`Ubicación: ${query.location}`);
  if (query.context) lines.push(`Contexto de la persona: ${query.context}`);
  return lines.join('\n');
}
