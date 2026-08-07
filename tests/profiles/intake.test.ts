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

/**
 * Precios oficiales de lanzamiento y lo que cobra cada nivel del Partner Program:
 * el 20% recurrente del partner comercial, su bono de activación (2 mensualidades,
 * al día 90) y el bono del referidor (1 mensualidad, una sola vez).
 */
const PRECIOS = [
  { pais: 'Estados Unidos', precio: 'US$99', comision: 'US$19.80', bonoPartner: 'US$198', bonoReferidor: 'US$99' },
  { pais: 'México', precio: 'US$69', comision: 'US$13.80', bonoPartner: 'US$138', bonoReferidor: 'US$69' },
  { pais: 'Colombia', precio: 'US$59', comision: 'US$11.80', bonoPartner: 'US$118', bonoReferidor: 'US$59' },
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
    // Dos plazos de prueba distintos en el catálogo es una promesa que el
    // prospecto va a cobrarnos. Se mira el plazo EN SU FRASE, no en todo el
    // texto: el programa tiene otros plazos legítimos (los 60 días para el
    // primer cliente de un partner) que no son la prueba del producto.
    const plazosDePrueba = p.businessFacts.facts
      .flatMap((f) => f.answer.split(/(?<=[.!?])\s+/))
      .filter((frase) => /prueba|gratis|trial/i.test(frase))
      .flatMap((frase) => frase.match(/\d+\s*d[íi]as/gi) ?? []);
    expect(plazosDePrueba.length, 'ningún fact dice cuánto dura la prueba').toBeGreaterThan(0);
    for (const plazo of plazosDePrueba) {
      expect(plazo.replace(/\s+/g, ' '), 'hay un plazo de prueba distinto en otro fact').toBe(`${PRUEBA_DIAS} días`);
    }
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

  it('los dos niveles del programa existen y se distinguen', async () => {
    const p = await loadProfile('./profiles/intake');
    const programa = p.businessFacts.facts.find((f) => f.topic === 'programa de partners');
    expect(programa, 'sin fact del programa').toBeTruthy();
    // Cobran distinto porque hacen trabajos distintos: confundirlos es prometer mal.
    expect(programa!.answer).toMatch(/referidor/i);
    expect(programa!.answer).toMatch(/partner comercial/i);
    // Y el agente tiene que averiguar cuál es ANTES de dar números.
    expect(p.promptVars.vars.salesPlaybook).toMatch(/cuál de los dos niveles|niveles.*encaja/i);
  });

  it('cada nivel cobra lo suyo, y las cuentas cuadran en los tres mercados', async () => {
    const p = await loadProfile('./profiles/intake');
    const comision = p.businessFacts.facts.find((f) => f.topic === 'comisión del partner');
    expect(comision, 'sin fact de comisión').toBeTruthy();
    expect(comision!.answer).toContain('20%');
    for (const { pais, comision: recurrente, bonoPartner, bonoReferidor } of PRECIOS) {
      expect(comision!.answer, `recurrente mal calculado para ${pais}`).toContain(recurrente);
      expect(comision!.answer, `bono del partner mal calculado para ${pais}`).toContain(bonoPartner);
      expect(comision!.answer, `bono del referidor mal calculado para ${pais}`).toContain(bonoReferidor);
    }
  });

  it('el bono se paga al día 90 y eso se explica, no se esconde', async () => {
    const p = await loadProfile('./profiles/intake');
    const como = p.businessFacts.facts.find((f) => f.topic === 'cómo funciona ser partner');
    expect(como!.answer).toMatch(/d[íi]a 90/i);
    // Es la parte que un socio necesita oír completa: por qué espera y qué pasa después.
    expect(como!.answer).toMatch(/aunque el cliente cancele/i);
    // El recurrente NO se condiciona a seguir vendiendo: es el ancla de confianza.
    expect(como!.answer).toMatch(/no depende de que sigas/i);
  });

  it('el programa pide algo a cambio, y el agente lo dice', async () => {
    const p = await loadProfile('./profiles/intake');
    const req = p.businessFacts.facts.find((f) => f.topic === 'requisitos del partner');
    expect(req, 'sin fact de requisitos').toBeTruthy();
    expect(req!.answer).toMatch(/certificaci[óo]n/i);
    expect(req!.answer).toMatch(/60 d[íi]as/i);
    // Un partner humano no tiene las reglas duras del agente: hay que dárselas.
    expect(req!.answer).toMatch(/inventar|no puedes decir/i);
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
