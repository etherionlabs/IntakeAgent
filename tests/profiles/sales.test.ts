import { describe, it, expect } from 'vitest';
import { readdir } from 'node:fs/promises';
import { loadProfile } from '../../src/config/loader';
import { buildSystemPrompt } from '../../src/agent/prompt';
import { createEmptyIntakeFromSchema } from '../../src/services/intake';
import type { Config } from '../../src/config/schema';

/**
 * El proyecto pasó de "recepcionista que levanta la orden" a "asesor que además
 * vende". Estas pruebas fijan esa dirección — pero para los giros que COMPONEN
 * el módulo `ventas`, no para todos.
 *
 * La versión anterior lo exigía a todo perfil del directorio, es decir, daba por
 * sentado que toda vertical vende. Esa suposición se cayó en cuanto existió una
 * vertical de captación pura: el invariante correcto no es "todos venden", es
 * "vende quien compone `ventas`, y quien no lo compone no arrastra copy de venta".
 */
async function listProfiles(): Promise<string[]> {
  const entries = await readdir('./profiles', { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

/** Giros que componen `ventas`. Son los que deben traer playbook y catálogo. */
async function listSalesProfiles(): Promise<string[]> {
  const all = await listProfiles();
  const out: string[] = [];
  for (const name of all) {
    const p = await loadProfile(`./profiles/${name}`);
    if (p.modules.includes('ventas')) out.push(name);
  }
  return out;
}

const config = {
  hours: { enabled: false, timezone: 'America/Mexico_City', schedule: {}, outOfHoursNotice: '' },
} as unknown as Config;

describe('agente proactivo de venta en todos los giros', () => {
  it('hay al menos los giros conocidos', async () => {
    const profiles = await listProfiles();
    expect(profiles).toContain('generico');
    expect(profiles).toContain('wrapping');
    expect(profiles.length).toBeGreaterThanOrEqual(9);
  });

  it('cada perfil trae salesPlaybook y lo referencia en su plantilla', async () => {
    for (const name of await listSalesProfiles()) {
      const p = await loadProfile(`./profiles/${name}`);
      expect((p.promptVars.vars.salesPlaybook ?? '').length, `${name}: salesPlaybook vacío`).toBeGreaterThan(100);
      expect(p.promptVars.promptTemplate, `${name}: plantilla sin {{salesPlaybook}}`).toContain(
        '{{salesPlaybook}}',
      );
    }
  });

  it('cada perfil adopta la skill de venta consultiva', async () => {
    for (const name of await listSalesProfiles()) {
      const p = await loadProfile(`./profiles/${name}`);
      expect(p.promptVars.skills, `${name}: no adopta la skill ventas`).toContain('ventas');
      expect(p.skills.map((s) => s.name), `${name}: skill ventas no resuelta`).toContain('ventas');
    }
  });

  it('el playbook instruye registrar la oportunidad con la tool', async () => {
    for (const name of await listSalesProfiles()) {
      const p = await loadProfile(`./profiles/${name}`);
      expect(p.promptVars.vars.salesPlaybook, `${name}`).toContain('register_opportunity');
    }
  });

  it('las reglas duras siguen después de la venta en el prompt final', async () => {
    for (const name of await listSalesProfiles()) {
      const p = await loadProfile(`./profiles/${name}`);
      const prompt = buildSystemPrompt({
        profile: p,
        config,
        intake: createEmptyIntakeFromSchema(p.intakeSchema),
        jobId: 'j1',
        jobStatus: 'OPEN_INTAKE',
        otherOpenJobs: [],
        now: new Date('2026-07-27T12:00:00Z'),
      });
      const sales = prompt.indexOf('## Cómo asesoras y vendes');
      const rules = prompt.indexOf('## Reglas');
      expect(sales, `${name}: falta la sección de venta`).toBeGreaterThan(-1);
      // Las reglas duras van DESPUÉS: son las que ganan si el playbook empuja de más.
      expect(rules, `${name}: reglas antes que la venta`).toBeGreaterThan(sales);
      // Y no quedan variables sin sustituir.
      expect(prompt, `${name}: variable sin resolver`).not.toMatch(/\{\{salesPlaybook\}\}/);
    }
  });

  it('los giros con catálogo listan sus servicios en business-facts (vender sin inventar)', async () => {
    // El genérico es el fallback de cualquier giro sin plantilla: no puede traer
    // catálogo propio, su playbook se apoya en lo que cargue el dueño.
    const withCatalog = (await listSalesProfiles()).filter((n) => n !== 'generico');
    for (const name of withCatalog) {
      const p = await loadProfile(`./profiles/${name}`);
      const topics = p.businessFacts.facts.map((f) => f.topic);
      expect(topics, `${name}: sin fact de servicios`).toContain('servicios');
      expect(p.businessFacts.freeContext.length, `${name}: freeContext vacío`).toBeGreaterThan(80);
    }
  });

  it('un giro que NO compone ventas no arrastra nada de venta', async () => {
    const all = await listProfiles();
    const sinVentas: string[] = [];
    for (const name of all) {
      const p = await loadProfile(`./profiles/${name}`);
      if (p.modules.includes('ventas')) continue;
      sinVentas.push(name);
      expect(p.promptVars.promptTemplate, `${name}: plantilla con {{salesPlaybook}}`).not.toContain(
        '{{salesPlaybook}}',
      );
      expect(p.skills.map((s) => s.name), `${name}: arrastra skills de venta`).not.toContain('ventas');

      const prompt = buildSystemPrompt({
        profile: p,
        config,
        intake: createEmptyIntakeFromSchema(p.intakeSchema, p.modules),
        jobId: 'j1',
        jobStatus: 'OPEN_INTAKE',
        otherOpenJobs: [],
        now: new Date('2026-07-27T12:00:00Z'),
      });
      expect(prompt, `${name}: el prompt le pide vender`).not.toContain('## Cómo asesoras y vendes');
      expect(prompt, `${name}: el prompt menciona la tool de venta`).not.toContain(
        'register_opportunity',
      );
    }
    // El experimento de composición depende de que exista al menos una.
    expect(sinVentas, 'no hay ningún giro de captación pura').toContain('captacion');
  });
});
