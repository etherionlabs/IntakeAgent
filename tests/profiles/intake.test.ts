import { describe, it, expect } from 'vitest';
import { loadProfile } from '../../src/config/loader';
import { validateIntakeSchema } from '../../src/config/intake-schema';

/**
 * El perfil con el que Intake se vende a sí mismo.
 *
 * Lo que se fija aquí no es estilo: es lo que impide que el asistente que habla
 * con nuestros prospectos invente un precio, prometa un programa de socios que
 * todavía no existe o venda funciones que no están. Un vendedor humano que hace
 * eso quema al cliente en la primera factura; este lo haría a escala.
 */
describe('perfil de venta del propio producto', () => {
  it('carga y su intake es válido', async () => {
    const p = await loadProfile('./profiles/intake');
    const result = validateIntakeSchema(p.intakeSchema);
    expect(result.ok, result.ok ? '' : result.error).toBe(true);
  });

  it('captura lo que decide la venta: quién contesta hoy y qué pregunta siempre', async () => {
    const p = await loadProfile('./profiles/intake');
    const keys = p.intakeSchema.sections.flatMap((s) => s.fields.map((f) => f.key));
    // Estas dos son el descubrimiento entero: el dolor y, literalmente, la
    // configuración que tendría su asistente.
    expect(keys).toContain('who_answers');
    expect(keys).toContain('data_always_asked');
    expect(keys).toContain('business_domain');
  });

  it('anota el interés en el programa de socios sin venderlo', async () => {
    const p = await loadProfile('./profiles/intake');
    const keys = p.intakeSchema.sections.flatMap((s) => s.fields.map((f) => f.key));
    expect(keys).toContain('partner_interest');

    const partner = p.businessFacts.facts.find((f) => f.topic === 'programa de socios');
    expect(partner, 'sin fact del programa de socios').toBeTruthy();
    // Se anuncia como lo que es —en preparación— y sin cifras inventadas.
    expect(partner!.answer).toMatch(/todavía no|aún no|en cuanto esté/i);
    expect(partner!.answer).not.toMatch(/\d+\s*%/);
  });

  it('el playbook prohíbe inventar el precio y las comisiones', async () => {
    const p = await loadProfile('./profiles/intake');
    const rules = p.promptVars.vars.hardRules ?? '';
    expect(rules).toMatch(/NUNCA inventes precios/);
    expect(rules).toMatch(/comisiones/);
    // Y no promete lo que no existe todavía.
    expect(rules).toMatch(/socios/);
  });

  it('no promete como disponible lo que está en el roadmap', async () => {
    const p = await loadProfile('./profiles/intake');
    const proximamente = p.businessFacts.facts.find((f) => f.topic === 'próximamente');
    expect(proximamente, 'sin fact de roadmap').toBeTruthy();
    expect(proximamente!.answer).toMatch(/todavía no|aún no|no te los prometo/i);
  });

  it('el precio se responde sin número: el monto lo pone el equipo', async () => {
    const p = await loadProfile('./profiles/intake');
    const precio = p.businessFacts.facts.find((f) => f.topic === 'precios');
    expect(precio, 'sin fact de precios').toBeTruthy();
    // Mientras el monto no esté decidido, el asistente NO puede llevar uno
    // escrito: cualquier cifra aquí acabaría dicha a un prospecto.
    expect(precio!.answer).not.toMatch(/\$|\d+\s*(pesos|mxn|usd|dólares)/i);
    expect(precio!.answer).toMatch(/mensual/i);
  });
});
