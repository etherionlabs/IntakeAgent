import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * FRONTERA REUTILIZABLE ↔ DOMINIO.
 *
 * Estos módulos son los que un día se extraerán a una infraestructura agéntica
 * general. La prueba de que la abstracción está bien puesta es negativa: si para
 * soportar otra vertical hubiera que tocarlos, no son reutilizables.
 *
 * Este test es esa prueba, ejecutable. Falla en dos casos:
 *   1. un módulo del core importa de `src/domain/` — dependencia invertida;
 *   2. un módulo del core menciona vocabulario de ventas — conocimiento filtrado.
 *
 * Si un cambio legítimo lo rompe, la respuesta correcta casi nunca es añadir una
 * excepción: es mover esa lógica a `src/domain/` y conectarla por un contrato.
 */

const ROOT = resolve(__dirname, '../..');

/** Módulos que declaramos neutrales al dominio. */
const CORE_PATHS = [
  'src/artifact',
  // fragments.ts entra explícito: resuelve contratos sin saber qué es un cliente.
  'src/channels',
  'src/agent/runner.ts',
  'src/agent/toolRegistry.ts',
  'src/agent/followUpGate.ts',
  'src/agent/errors.ts',
  'src/agent/audit.ts',
  'src/agent/sdk-factory.ts',
  'src/pipeline/debouncer.ts',
  'src/pipeline/idempotency.ts',
  'src/config/intake-schema.ts',
];

/**
 * Vocabulario que delata conocimiento del negocio de Intake. NO incluye
 * "intake" ni "job": son los sustantivos con los que el core nombra el artefacto
 * y el caso, y renombrarlos sería churn sin frontera nueva.
 */
const DOMAIN_VOCABULARY = [
  'opportunit',
  'oportunidad',
  'objection',
  'objecion',
  'objeción',
  'diagnosis',
  'diagnóstico',
  'upsell',
  'salesPlaybook',
  'cotiza',
];

/**
 * Quita comentarios antes de buscar. La regla vincula al CÓDIGO: un comentario
 * que explica dónde está la frontera (y nombra el ejemplo de Intake al hacerlo)
 * es justo lo que queremos conservar, no un acoplamiento.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

function filesUnder(relPath: string): string[] {
  const abs = join(ROOT, relPath);
  if (statSync(abs).isFile()) return [relPath];
  return readdirSync(abs).flatMap((entry) => filesUnder(join(relPath, entry)));
}

const CORE_FILES = CORE_PATHS.flatMap(filesUnder).filter((f) => f.endsWith('.ts'));

describe('fronteras de arquitectura: core reutilizable', () => {
  it('cubre los módulos declarados como reutilizables', () => {
    expect(CORE_FILES.length).toBeGreaterThanOrEqual(12);
  });

  it.each(CORE_FILES)('%s no importa de la capa de dominio', (file) => {
    const source = readFileSync(join(ROOT, file), 'utf-8');
    const domainImports = [...source.matchAll(/from\s+'([^']+)'/g)]
      .map((m) => m[1])
      .filter((spec) => /(^|\/)domain\//.test(spec));
    expect(domainImports).toEqual([]);
  });

  it.each(CORE_FILES)('%s no menciona vocabulario del dominio de venta', (file) => {
    const source = stripComments(readFileSync(join(ROOT, file), 'utf-8')).toLowerCase();
    const found = DOMAIN_VOCABULARY.filter((word) => source.includes(word.toLowerCase()));
    expect(found).toEqual([]);
  });
});

describe('fronteras de arquitectura: capa de dominio', () => {
  const DOMAIN_FILES = filesUnder('src/domain').filter((f) => f.endsWith('.ts'));

  it('existe y está poblada', () => {
    expect(DOMAIN_FILES.length).toBeGreaterThan(0);
  });

  /**
   * El dominio SÍ puede depender del core: es la dirección correcta de la
   * flecha. Lo que no debe hacer es depender de otra vertical.
   */
  it.each(DOMAIN_FILES)('%s no depende de otra vertical', (file) => {
    const source = readFileSync(join(ROOT, file), 'utf-8');
    const vertical = file.split('/')[2];
    const crossVertical = [...source.matchAll(/from\s+'([^']+)'/g)]
      .map((m) => m[1])
      .filter((spec) => /(^|\/)domain\//.test(spec))
      .filter((spec) => !spec.includes(`domain/${vertical}`) && !spec.startsWith('./'));
    expect(crossVertical).toEqual([]);
  });
});
