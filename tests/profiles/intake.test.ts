import { describe, it, expect } from 'vitest';
import { loadProfile } from '../../src/config/loader';
import { validateIntakeSchema } from '../../src/config/intake-schema';

/**
 * El perfil con el que Etherion Labs vende Intake y su Partner Program.
 *
 * Lo que se fija aquí no es estilo: es lo que impide que el asistente que habla
 * con nuestros prospectos cotice el precio de otro país, invente una comisión o
 * prometa funciones que no existen. Un vendedor humano que hace eso quema a un
 * cliente en la primera factura; este lo haría a escala y con nuestra marca.
 *
 * Los números vienen de la especificación comercial de Etherion Labs. Si cambian
 * los precios oficiales, este archivo es el que avisa de dónde hay que tocarlos.
 */

/** Precios oficiales de lanzamiento y su comisión al 20%. */
const PRECIOS = [
  { pais: 'Estados Unidos', precio: 'US$99', comision: 'US$19.80' },
  { pais: 'México', precio: 'US$69', comision: 'US$13.80' },
  { pais: 'Colombia', precio: 'US$59', comision: 'US$11.80' },
];

/**
 * Días de prueba oficiales. Es un compromiso comercial como el precio: el
 * asistente lo dice de nuestra parte y el prospecto lo da por bueno. Si cambia,
 * tiene que cambiar también donde se cobra de verdad — `Plan.trialDays` en la
 * base de datos, que es lo que Stripe usa como `trial_period_days`.
 */
const PRUEBA_DIAS = 14;

describe('perfil de venta de Etherion Labs', () => {
  it('carga y su intake es válido', async () => {
    const p = await loadProfile('./profiles/intake');
    const result = validateIntakeSchema(p.intakeSchema);
    expect(result.ok, result.ok ? '' : result.error).toBe(true);
  });

  it('el país es obligatorio: sin él no se puede cotizar', async () => {
    const p = await loadProfile('./profiles/intake');
    const campos = p.intakeSchema.sections.flatMap((s) => s.fields);
    const pais = campos.find((f) => f.key === 'country');
    expect(pais, 'sin campo de país').toBeTruthy();
    expect(pais!.required, 'el país no es obligatorio').toBe(true);
    // Los tres mercados de lanzamiento, más la salida para el resto.
    expect(pais!.options).toEqual(['Estados Unidos', 'México', 'Colombia', 'Otro']);
  });

  it('distingue las dos ventas: usar Intake o ser Partner', async () => {
    const p = await loadProfile('./profiles/intake');
    const campos = p.intakeSchema.sections.flatMap((s) => s.fields);
    const tipo = campos.find((f) => f.key === 'conversation_type');
    expect(tipo, 'sin campo que separe cliente de partner').toBeTruthy();
    expect(tipo!.required).toBe(true);
    expect(campos.map((f) => f.key)).toContain('partner_profile');
  });

  it('captura lo que decide la venta: quién contesta hoy y qué pregunta siempre', async () => {
    const p = await loadProfile('./profiles/intake');
    const keys = p.intakeSchema.sections.flatMap((s) => s.fields.map((f) => f.key));
    // Estas dos son el descubrimiento entero: el dolor y, literalmente, la
    // configuración que tendría su asistente.
    expect(keys).toContain('who_answers');
    expect(keys).toContain('data_always_asked');
  });

  it('lleva los precios oficiales de los tres mercados', async () => {
    const p = await loadProfile('./profiles/intake');
    const precios = p.businessFacts.facts.find((f) => f.topic === 'precios');
    expect(precios, 'sin fact de precios').toBeTruthy();
    for (const { pais, precio } of PRECIOS) {
      expect(precios!.answer, `falta el precio de ${pais}`).toContain(precio);
    }
    expect(precios!.answer).toMatch(/mensual/i);
  });

  it('la prueba dura lo que decimos que dura, y no otra cifra', async () => {
    const p = await loadProfile('./profiles/intake');
    const prueba = p.businessFacts.facts.find((f) => f.topic === 'prueba');
    expect(prueba, 'sin fact de la prueba').toBeTruthy();
    expect(prueba!.answer).toContain(`${PRUEBA_DIAS} días`);
    // Un plazo distinto suelto en cualquier otro fact es una promesa que el
    // prospecto va a cobrarnos: el número solo puede salir de aquí.
    const otrosPlazos = p.businessFacts.facts
      .filter((f) => f.topic !== 'prueba')
      .flatMap((f) => f.answer.match(/\d+\s*d[íi]as/gi) ?? []);
    expect(otrosPlazos, 'otro fact promete un plazo de prueba distinto').toEqual([]);
  });

  it('la comisión del Partner es 20% y las cuentas cuadran', async () => {
    const p = await loadProfile('./profiles/intake');
    const comision = p.businessFacts.facts.find((f) => f.topic === 'comisión del partner');
    expect(comision, 'sin fact de comisión').toBeTruthy();
    expect(comision!.answer).toContain('20%');
    for (const { pais, comision: monto } of PRECIOS) {
      expect(comision!.answer, `comisión mal calculada para ${pais}`).toContain(monto);
    }
  });

  it('el Partner Program se presenta como cartera recurrente, no como afiliados', async () => {
    const p = await loadProfile('./profiles/intake');
    const partner = p.businessFacts.facts.find((f) => f.topic === 'programa de partners');
    expect(partner, 'sin fact del Partner Program').toBeTruthy();
    expect(partner!.answer).toMatch(/no es un programa de afiliados/i);
    expect(partner!.answer).toMatch(/cada mes|mensual|recurrente/i);
    // Y el playbook lo instruye igual, que es donde de verdad se decide el guion.
    expect(p.promptVars.vars.salesPlaybook).toMatch(/afiliados/i);
    expect(p.promptVars.vars.salesPlaybook).toMatch(/register_opportunity/);
  });

  it('deja claro quién cobra: el cliente le paga a Etherion Labs', async () => {
    const p = await loadProfile('./profiles/intake');
    const como = p.businessFacts.facts.find((f) => f.topic === 'cómo funciona ser partner');
    expect(como, 'sin fact de cómo funciona el programa').toBeTruthy();
    expect(como!.answer).toMatch(/Etherion Labs/);
    expect(como!.answer).toMatch(/nunca cobras/i);
  });

  it('las reglas duras impiden cotizar a ciegas o inventar cifras', async () => {
    const p = await loadProfile('./profiles/intake');
    const rules = p.promptVars.vars.hardRules ?? '';
    expect(rules).toMatch(/NUNCA inventes precios/);
    expect(rules).toMatch(/comisiones/);
    expect(rules).toMatch(/promociones|descuentos/);
    // El precio cambia por país: cotizar sin preguntarlo es dar el precio de otro.
    expect(rules).toMatch(/sin saber el país/i);
    // El ROI se argumenta con el número del prospecto, no con un sueldo supuesto.
    expect(rules).toMatch(/sueldos/i);
  });

  it('no promete como disponible lo que está en el roadmap', async () => {
    const p = await loadProfile('./profiles/intake');
    const proximamente = p.businessFacts.facts.find((f) => f.topic === 'próximamente');
    expect(proximamente, 'sin fact de roadmap').toBeTruthy();
    expect(proximamente!.answer).toMatch(/todavía no|aún no|no te los prometo/i);
  });

  it('fuera de los tres mercados no se promete servicio', async () => {
    const p = await loadProfile('./profiles/intake');
    const paises = p.businessFacts.facts.find((f) => f.topic === 'países');
    expect(paises, 'sin fact de mercados').toBeTruthy();
    for (const { pais } of PRECIOS) expect(paises!.answer).toContain(pais);
    expect(paises!.answer).toMatch(/otro país|en cuanto abramos/i);
  });
});
