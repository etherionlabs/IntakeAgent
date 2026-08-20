import { describe, it, expect } from 'vitest';
import { buildWelcome } from '../../src/pipeline/coordinator';
import type { Config, Profile } from '../../src/config/schema';
import type { IntakeSchema } from '../../src/config/intake-schema';

const schema: IntakeSchema = {
  $businessName: 'Tapicería Demo',
  $businessDomain: 'tapicería de muebles',
  $language: 'es-MX',
  sections: [
    { key: 'client', label: 'Cliente', fields: [{ key: 'name', label: 'Nombre', type: 'string', required: true }] },
  ],
};

const NOTICE = 'Te atiende un asistente automatizado. Si prefieres hablar con una persona, dímelo.';

function makeProfile(over: Partial<Profile> = {}): Profile {
  return {
    intakeSchema: schema,
    promptVars: { promptTemplate: 'X', vars: {}, skills: [], modules: ['intake', 'ventas'] },
    businessFacts: { facts: [], freeContext: '' },
    welcome: '¡Hola! Soy el asistente de {{businessName}}. ¿En qué te ayudo?',
    imageFocus: '',
    imageEditGuidance: '',
    skills: [],
    modules: ['intake', 'ventas'],
    aiDisclosure: true,
    hash: 'h',
    ...over,
  };
}

const config = { disclosure: { text: NOTICE } } as Config;

describe('divulgación de IA en el saludo', () => {
  it('sustituye las variables del negocio', () => {
    const out = buildWelcome(makeProfile({ aiDisclosure: false }), config);
    expect(out).toContain('Tapicería Demo');
    expect(out).not.toContain('{{businessName}}');
  });

  it('con la divulgación activa, el aviso va en el primer mensaje', () => {
    const out = buildWelcome(makeProfile(), config);
    expect(out).toContain('¿En qué te ayudo?');
    expect(out).toContain('asistente automatizado');
  });

  it('apagada por el tenant, el saludo va limpio', () => {
    const out = buildWelcome(makeProfile({ aiDisclosure: false }), config);
    expect(out).not.toContain('asistente automatizado');
  });

  it('no repite el aviso si el dueño ya lo puso en su bienvenida', () => {
    const profile = makeProfile({
      welcome: 'Hola. Te atiende un asistente automatizado de {{businessName}}. ¿Qué necesitas?',
    });
    const out = buildWelcome(profile, config);
    expect(out.match(/asistente automatizado/g)).toHaveLength(1);
  });

  it('un texto de aviso vacío no ensucia el saludo', () => {
    const out = buildWelcome(makeProfile(), { disclosure: { text: '   ' } } as Config);
    expect(out.trim().endsWith('¿En qué te ayudo?')).toBe(true);
  });
});

describe('regla dura de transparencia en los perfiles', () => {
  it('todos los giros prohíben negar que es una IA', async () => {
    const { loadProfile } = await import('../../src/config/loader');
    const { readdir } = await import('node:fs/promises');
    const dirs = (await readdir('./profiles', { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const name of dirs) {
      const p = await loadProfile(`./profiles/${name}`);
      const rules = p.promptVars.vars.hardRules ?? '';
      expect(rules, `${name}: sin regla de transparencia`).toMatch(/robot|bot|IA/);
      expect(rules, `${name}: no prohíbe hacerse pasar por persona`).toMatch(/persona/i);
    }
  });

  it('el perfil cargado de archivos divulga por defecto (default compliant)', async () => {
    const { loadProfile } = await import('../../src/config/loader');
    const p = await loadProfile('./profiles/generico');
    expect(p.aiDisclosure).toBe(true);
  });
});

describe('el saludo sale en el idioma del cliente', () => {
  const NOTICE_EN = "You're chatting with an automated assistant.";
  const bilingue = () =>
    makeProfile({
      welcomeTranslations: { en: "Hi! I'm {{businessName}}'s assistant. How can I help?" },
    });
  const configBi = {
    disclosure: { text: NOTICE, translations: { en: NOTICE_EN } },
  } as unknown as Config;

  it('en inglés usa la bienvenida traducida', () => {
    const out = buildWelcome(bilingue(), configBi, 'en');
    expect(out).toContain("Hi! I'm Tapicería Demo's assistant");
    expect(out).not.toContain('¡Hola!');
  });

  it('el aviso de IA acompaña al idioma: un aviso que no se entiende no avisa', () => {
    const out = buildWelcome(bilingue(), configBi, 'en');
    expect(out).toContain(NOTICE_EN);
    expect(out).not.toContain(NOTICE);
  });

  it('sin traducción cargada se queda en el idioma del negocio, no rompe', () => {
    // Un giro que solo atiende en español no tiene welcome.en.txt: sigue igual
    // que siempre en vez de quedarse mudo.
    const out = buildWelcome(makeProfile(), configBi, 'en');
    expect(out).toContain('¡Hola!');
    expect(out).toContain('Tapicería Demo');
  });

  it('sin idioma explícito usa el del negocio', () => {
    const out = buildWelcome(bilingue(), configBi);
    expect(out).toContain('¡Hola!');
    expect(out).toContain(NOTICE);
  });

  it('si falta la traducción del aviso, avisa igual en el idioma original', () => {
    // Peor es no avisar: la obligación del art. 50 no se salta por no tener
    // el texto traducido.
    const soloWelcome = { disclosure: { text: NOTICE, translations: {} } } as unknown as Config;
    const out = buildWelcome(bilingue(), soloWelcome, 'en');
    expect(out).toContain("Hi! I'm");
    expect(out).toContain(NOTICE);
  });
});
