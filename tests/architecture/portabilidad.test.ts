import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * PORTABILIDAD DEL NÚCLEO COMPARTIDO.
 *
 * Intake, movilidad y las verticales que vengan acabarán siendo proyectos
 * separados que comparten arquitectura. Estas carpetas son las que saldrían
 * primero, tal cual, a un paquete común.
 *
 * La regla que las protege es transitiva a propósito. Contar cuántos archivos
 * importan `@prisma/client` NO sirve: cuando se midió así, `src/adapters` daba
 * "0 de 8 archivos" y en realidad llegaba a Prisma por dependencia —el
 * adaptador de WhatsApp importaba la clase `InboundCoordinator` y con ella el
 * pipeline entero—. Una carpeta es portable cuando NADA de lo que alcanza
 * necesita la base de datos, no cuando sus archivos no la nombran.
 *
 * Si este test falla, la respuesta casi nunca es añadir una excepción: es
 * invertir la dependencia, como se hizo con `Channel`, `RawInboundMessage` e
 * `InboundSink`, que son vocabulario del canal y estaban en el pipeline.
 */

const ROOT = resolve(__dirname, '../..');

/** Lo que saldría a `@etherion/core` sin tocar una línea. */
const PORTABLE = [
  'src/artifact',
  'src/research',
  'src/channels',
  'src/media',
  'src/lib',
  'src/adapters',
];

/**
 * Lo que ata a un módulo al modelo de caso de Intake (`Job`, `Contact`,
 * `Message`). Es la deuda conocida —el ciclo de vida del caso, que ninguna
 * vertical ha resuelto todavía— y vive en `pipeline/` y `services/`.
 */
const PERSISTENCIA = ['@prisma/client'];

function tsFilesUnder(rel: string): string[] {
  const abs = join(ROOT, rel);
  if (statSync(abs).isFile()) return abs.endsWith('.ts') ? [abs] : [];
  return readdirSync(abs).flatMap((e) => tsFilesUnder(join(rel, e)));
}

function importSpecs(abs: string): string[] {
  const src = readFileSync(abs, 'utf-8');
  return [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
}

function resolveRelative(fromAbs: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(fromAbs), spec);
  for (const candidate of [`${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const short = (abs: string) => abs.replace(`${ROOT}/`, '');

/** Recorre el grafo de imports y devuelve el primer camino que llega a la persistencia. */
function caminoAPersistencia(raices: string[]): string[] | null {
  const vistos = new Set<string>();
  const cola: { abs: string; camino: string[] }[] = raices.map((abs) => ({ abs, camino: [abs] }));

  while (cola.length > 0) {
    const { abs, camino } = cola.shift()!;
    if (vistos.has(abs)) continue;
    vistos.add(abs);

    for (const spec of importSpecs(abs)) {
      if (PERSISTENCIA.includes(spec)) return [...camino.map(short), spec];
      const siguiente = resolveRelative(abs, spec);
      if (siguiente && !vistos.has(siguiente)) cola.push({ abs: siguiente, camino: [...camino, siguiente] });
    }
  }
  return null;
}

describe('portabilidad: el núcleo que se extraerá primero', () => {
  it('cubre las carpetas declaradas portables', () => {
    for (const dir of PORTABLE) {
      expect(existsSync(join(ROOT, dir)), dir).toBe(true);
    }
  });

  it.each(PORTABLE)('nada de lo que alcanza %s necesita la base de datos', (dir) => {
    const camino = caminoAPersistencia(tsFilesUnder(dir));
    // El mensaje del fallo es el camino completo: sin él, "algo importa Prisma"
    // no dice por dónde, que es lo único que hace falta para arreglarlo.
    expect(camino ? camino.join('\n   → ') : null).toBeNull();
  });

  /**
   * La comprobación anterior sería vacía si el grafo no se recorriera de verdad.
   * Éste fija que sí: desde las carpetas portables se alcanzan bastantes
   * archivos, y aun así ninguno llega a la persistencia.
   */
  it('el recorrido es real, no vacío', () => {
    const vistos = new Set<string>();
    const cola = PORTABLE.flatMap(tsFilesUnder);
    while (cola.length > 0) {
      const abs = cola.shift()!;
      if (vistos.has(abs)) continue;
      vistos.add(abs);
      for (const spec of importSpecs(abs)) {
        const siguiente = resolveRelative(abs, spec);
        if (siguiente && !vistos.has(siguiente)) cola.push(siguiente);
      }
    }
    expect(vistos.size).toBeGreaterThan(20);
  });
});

describe('portabilidad: la deuda conocida, acotada', () => {
  /**
   * `pipeline/` y `services/` SÍ dependen de la base de datos, y está bien: son
   * el modelo de caso de Intake. Lo que importa es que la deuda esté donde
   * decimos, y no se haya extendido a otras carpetas sin que nadie lo note.
   */
  it('el acoplamiento a persistencia vive donde está documentado', () => {
    const acoplado = (dir: string) =>
      tsFilesUnder(dir).some((f) => importSpecs(f).some((s) => PERSISTENCIA.includes(s)));

    expect(acoplado('src/pipeline'), 'pipeline debería seguir atado').toBe(true);
    expect(acoplado('src/services'), 'services debería seguir atado').toBe(true);

    // Y no debe haberse extendido a lo portable.
    for (const dir of PORTABLE) {
      expect(acoplado(dir), `${dir} se ató a la base de datos`).toBe(false);
    }
  });
});
