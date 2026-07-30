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
    promptVars: { promptTemplate: 'X', vars: {}, skills: [] },
    businessFacts: { facts: [], freeContext: '' },
    welcome: '¡Hola! Soy el asistente de {{businessName}}. ¿En qué te ayudo?',
    imageFocus: '',
    imageEditGuidance: '',
    skills: [],
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
