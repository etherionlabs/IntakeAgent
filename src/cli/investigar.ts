#!/usr/bin/env tsx
/**
 * HERRAMIENTA DE VALIDACIÓN — investigación laboral.
 *
 * No es producto: es el instrumento para contestar la pregunta de la que depende
 * toda la vertical de movilidad laboral —
 *
 *     ¿podemos traer HOY, con fuente y fecha, oportunidades y requisitos REALES
 *     para un puesto y una ciudad concretos?
 *
 * Si la respuesta es sí, el resto (perfil, rutas, seguimiento) es construcción
 * normal sobre lo que ya existe. Si es no, el producto cambia de forma, y más
 * vale saberlo antes de escribir una ruta.
 *
 * Uso:
 *   npm run cli:investigar -- --puesto "HVAC Helper" --lugar "Brandon, Florida"
 *   npm run cli:investigar -- --puesto "HVAC Helper" --lugar "Brandon, FL" \
 *       --contexto "sin experiencia previa, inglés básico, tiene auto"
 *   npm run cli:investigar -- ... --modelo "perplexity/sonar" --json
 */
import { WebResearcher, ResearchError } from '../research/webResearcher';
import { groupByConfidence } from '../research/parse';
import type { Finding, ResearchQuery, ResearchResult } from '../research/types';

interface Args {
  puesto: string;
  lugar: string;
  contexto?: string;
  modelo?: string;
  json: boolean;
}

function parseArgs(argv: string[]): Args | null {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const puesto = get('--puesto');
  const lugar = get('--lugar');
  if (!puesto || !lugar) return null;
  return {
    puesto,
    lugar,
    contexto: get('--contexto'),
    modelo: get('--modelo'),
    json: argv.includes('--json'),
  };
}

/**
 * Las preguntas que una RUTA necesita responder. No es una búsqueda genérica:
 * cada una alimenta un trozo concreto de la ruta —destino, brecha, pasos, coste—
 * y por eso se preguntan por separado en vez de en un prompt gigante.
 */
function questionsFor(a: Args): { etiqueta: string; query: ResearchQuery }[] {
  const base = { location: a.lugar, context: a.contexto };
  return [
    {
      etiqueta: 'VACANTES REALES',
      query: {
        ...base,
        question:
          `¿Qué vacantes reales y actuales de "${a.puesto}" (o equivalentes de nivel inicial) ` +
          `hay cerca? Nombra empresas concretas y enlaza la oferta cuando exista.`,
      },
    },
    {
      etiqueta: 'REQUISITOS DE ENTRADA',
      query: {
        ...base,
        question:
          `¿Qué piden realmente para entrar como "${a.puesto}" sin experiencia previa? ` +
          `¿Hay certificación o licencia OBLIGATORIA por ley, o basta con formación del empleador?`,
      },
    },
    {
      etiqueta: 'SALARIO',
      query: {
        ...base,
        question: `¿Qué rango salarial real tiene "${a.puesto}" de nivel inicial en esa zona?`,
      },
    },
    {
      etiqueta: 'FORMACIÓN / APRENDIZAJE',
      query: {
        ...base,
        question:
          `¿Qué programas de formación, apprenticeships o cursos hay cerca para "${a.puesto}"? ` +
          `Interesan coste, duración y si son gratuitos o subvencionados.`,
      },
    },
  ];
}

function renderFinding(f: Finding): string {
  const icono = { verificado: '✓', inferido: '~', desconocido: '?' }[f.confidence];
  const fuente = f.source
    ? `\n      ↳ ${f.source.title || '(sin título)'} — ${f.source.url}\n        consultado: ${f.source.consultedAt}`
    : '';
  return `   ${icono} ${f.claim}${fuente}`;
}

function renderResult(etiqueta: string, r: ResearchResult): void {
  const g = groupByConfidence(r);
  console.log(`\n━━━ ${etiqueta} ━━━`);
  console.log(`   modelo: ${r.model}${r.costUsd !== null ? ` · costo: $${r.costUsd.toFixed(4)}` : ''}`);

  if (g.verificado.length > 0) {
    console.log('\n  VERIFICADO (con fuente abrible)');
    for (const f of g.verificado) console.log(renderFinding(f));
  }
  if (g.inferido.length > 0) {
    console.log('\n  INFERIDO (deducción, sin fuente que lo diga)');
    for (const f of g.inferido) console.log(renderFinding(f));
  }
  if (g.desconocido.length > 0) {
    console.log('\n  DESCONOCIDO');
    for (const f of g.desconocido) console.log(renderFinding(f));
  }
  if (r.unresolved.length > 0) {
    console.log('\n  SIN RESOLVER');
    for (const u of r.unresolved) console.log(`   · ${u}`);
  }
  if (r.findings.length === 0) {
    console.log('\n  (ningún hallazgo)');
  }
}

/** Lo único que importa del ejercicio: ¿cuánto de esto es REAL y comprobable? */
function renderVeredicto(resultados: { etiqueta: string; r: ResearchResult }[]): void {
  const total = resultados.reduce((n, x) => n + x.r.findings.length, 0);
  const verificados = resultados.reduce(
    (n, x) => n + x.r.findings.filter((f) => f.confidence === 'verificado').length,
    0,
  );
  const costo = resultados.reduce((n, x) => n + (x.r.costUsd ?? 0), 0);

  console.log('\n\n════════ VEREDICTO ════════');
  console.log(`  hallazgos: ${total}   ·   con fuente abrible: ${verificados}`);
  console.log(`  costo total: $${costo.toFixed(4)}`);
  console.log('');
  if (verificados === 0) {
    console.log('  ✗ CERO hallazgos verificables. Con esto no se puede construir una ruta');
    console.log('    sin inventar, que es justo lo que el producto no debe hacer.');
    console.log('    → probar otro modelo (--modelo) o una vía de búsqueda distinta.');
  } else if (verificados < total / 3) {
    console.log('  ~ Hay fuentes, pero la mayoría son deducciones. Sirve para orientar,');
    console.log('    no todavía para prometer vacantes concretas.');
  } else {
    console.log('  ✓ Material suficiente para construir una ruta con respaldo.');
  }
  console.log('\n  Lo que hay que juzgar a ojo, y no lo dice ningún número:');
  console.log('   · ¿las vacantes existen de verdad y siguen abiertas?');
  console.log('   · ¿los requisitos son los reales o los que "suenan" razonables?');
  console.log('   · ¿esto le sirve a una persona que hace delivery hoy?');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error('Uso: npm run cli:investigar -- --puesto "<puesto>" --lugar "<ciudad, estado>"');
    console.error('     [--contexto "<situación de la persona>"] [--modelo "<modelo>"] [--json]');
    process.exit(2);
  }

  const apiKey = process.env.OPENROUTER_API_KEY ?? '';
  if (!apiKey) {
    console.error('✗ Falta OPENROUTER_API_KEY. Sin clave no hay investigación que validar.');
    process.exit(1);
  }

  const researcher = new WebResearcher({ apiKey, model: args.modelo });
  const preguntas = questionsFor(args);

  console.log(`Investigando "${args.puesto}" en ${args.lugar}…`);
  if (args.contexto) console.log(`Contexto: ${args.contexto}`);

  const resultados: { etiqueta: string; r: ResearchResult }[] = [];
  for (const { etiqueta, query } of preguntas) {
    try {
      const r = await researcher.research(query);
      resultados.push({ etiqueta, r });
      if (!args.json) renderResult(etiqueta, r);
    } catch (e) {
      // Un fallo se muestra y se sigue: saber CUÁL de las cuatro preguntas
      // funciona y cuál no es parte de lo que se está validando.
      const msg = e instanceof ResearchError ? e.message : String(e);
      console.error(`\n━━━ ${etiqueta} ━━━\n  ✗ falló: ${msg}`);
    }
  }

  if (args.json) {
    console.log(JSON.stringify(resultados, null, 2));
    return;
  }
  if (resultados.length > 0) renderVeredicto(resultados);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
