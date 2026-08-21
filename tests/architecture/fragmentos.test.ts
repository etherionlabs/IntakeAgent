import { describe, it, expect } from 'vitest';
import {
  FragmentError,
  loadFragments,
  referencedContracts,
  resolveSectionRefs,
  fragmentsFingerprint,
} from '../../src/artifact/fragments';
import { loadProfile } from '../../src/config/loader';
import { validateIntakeSchema } from '../../src/config/intake-schema';

/**
 * FRAGMENTOS: reutilización POR DEBAJO de la vertical.
 *
 * `client` estaba copiado a mano en 7 giros y `logistics` en 4. No era deuda
 * hipotética: era duplicación real con una sola vertical en producción.
 *
 * Lo que estos tests fijan no es que la resolución funcione —eso es lo fácil—
 * sino las dos reglas que evitan que el mecanismo se degrade:
 *   1. se referencia por CONTRATO, nunca por el nombre del vecino;
 *   2. el contrato es dueño de la ESTRUCTURA y la vertical de las PALABRAS.
 */

const FRAGMENTS = './fragments';

describe('fragmentos: la biblioteca', () => {
  it('se indexa por contrato, no por carpeta', async () => {
    const frags = await loadFragments(FRAGMENTS);
    expect([...frags.keys()].sort()).toEqual(['customer.identity', 'service.logistics']);
    expect(frags.get('customer.identity')?.id).toBe('customer-identity');
  });

  it('sin biblioteca no revienta: una vertical que no use fragmentos sigue igual', async () => {
    const frags = await loadFragments('./no-existe');
    expect(frags.size).toBe(0);
    const raw = { sections: [{ key: 'a', label: 'A', fields: [] }] };
    expect(resolveSectionRefs(raw, frags)).toEqual(raw);
  });
});

describe('fragmentos: resolución', () => {
  it('expande en su POSICIÓN, porque el orden es el que lee el modelo', async () => {
    const frags = await loadFragments(FRAGMENTS);
    const raw = {
      sections: [
        { key: 'work', label: 'Trabajo', fields: [] },
        { use: 'customer.identity' },
      ],
    };
    const out = resolveSectionRefs(raw, frags) as { sections: { key: string }[] };
    expect(out.sections.map((s) => s.key)).toEqual(['work', 'client']);
  });

  it('un contrato que nadie provee falla al cargar, no en producción', async () => {
    const frags = await loadFragments(FRAGMENTS);
    expect(() => resolveSectionRefs({ sections: [{ use: 'contabilidad.asiento' }] }, frags)).toThrow(
      FragmentError,
    );
  });

  /**
   * Una clave repetida deja el segundo bloque pisando al primero en el estado:
   * campos que el modelo ve en el prompt y que nunca se pueden escribir.
   */
  it('una sección declarada dos veces falla en vez de perder campos', async () => {
    const frags = await loadFragments(FRAGMENTS);
    const raw = {
      sections: [{ use: 'customer.identity' }, { key: 'client', label: 'Otro', fields: [] }],
    };
    expect(() => resolveSectionRefs(raw, frags)).toThrow(/dos veces/);
  });
});

describe('fragmentos: estructura del contrato vs palabras de la vertical', () => {
  it('la vertical puede reescribir una etiqueta', async () => {
    const frags = await loadFragments(FRAGMENTS);
    const out = resolveSectionRefs(
      { sections: [{ use: 'service.logistics', labels: { address: 'Dirección exacta' } }] },
      frags,
    ) as { sections: { fields: { key: string; label: string }[] }[] };
    const address = out.sections[0].fields.find((f) => f.key === 'address');
    expect(address?.label).toBe('Dirección exacta');
  });

  it('renombrar un campo inexistente falla: casi siempre es un typo', async () => {
    const frags = await loadFragments(FRAGMENTS);
    expect(() =>
      resolveSectionRefs({ sections: [{ use: 'service.logistics', labels: { adress: 'x' } }] }, frags),
    ).toThrow(/no tiene el campo/);
  });

  it('el override NO puede cambiar la estructura: claves y tipos son del contrato', async () => {
    const frags = await loadFragments(FRAGMENTS);
    const out = resolveSectionRefs(
      { sections: [{ use: 'customer.identity', labels: { name: 'Su nombre' } }] },
      frags,
    ) as { sections: { fields: { key: string; type: string; required?: boolean }[] }[] };
    const campos = out.sections[0].fields;
    expect(campos.map((f) => f.key)).toEqual(['name', 'city_or_zone', 'phone_alt']);
    expect(campos.find((f) => f.key === 'name')?.type).toBe('string');
    expect(campos.find((f) => f.key === 'name')?.required).toBe(true);
  });
});

describe('fragmentos: trazabilidad', () => {
  /**
   * Sin esto, editar un fragmento cambiaría el esquema de 7 giros sin mover su
   * configHash: los AgentRun quedarían atribuidos a una config que no corrió.
   */
  it('la huella cambia si cambia el fragmento referenciado', async () => {
    const frags = await loadFragments(FRAGMENTS);
    const raw = { sections: [{ use: 'customer.identity' }] };
    const antes = fragmentsFingerprint(raw, frags);

    const tocado = new Map(frags);
    const f = { ...frags.get('customer.identity')!, version: '9.9.9' };
    tocado.set('customer.identity', f);
    expect(fragmentsFingerprint(raw, tocado)).not.toBe(antes);
  });

  it('lista los contratos que una vertical referencia, en orden', () => {
    const raw = {
      sections: [{ use: 'customer.identity' }, { key: 'work', fields: [] }, { use: 'service.logistics' }],
    };
    expect(referencedContracts(raw)).toEqual(['customer.identity', 'service.logistics']);
  });
});

describe('fragmentos: los giros reales', () => {
  it('los 7 giros que compartían `client` lo referencian por contrato', async () => {
    const giros = ['cerrajeria', 'electricista', 'plomeria', 'refrigeracion', 'tapiceria', 'mecanica', 'wrapping'];
    for (const giro of giros) {
      const p = await loadProfile(`./profiles/${giro}`, './skills', FRAGMENTS);
      const client = p.intakeSchema.sections.find((s) => s.key === 'client');
      expect(client, `${giro}: sin sección client`).toBeDefined();
      expect(client!.fields.map((f) => f.key), giro).toEqual(['name', 'city_or_zone', 'phone_alt']);
    }
  });

  it('todo perfil sigue produciendo un esquema válido tras resolver', async () => {
    const { readdir } = await import('node:fs/promises');
    const dirs = (await readdir('./profiles', { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    expect(dirs.length).toBeGreaterThanOrEqual(10);
    for (const dir of dirs) {
      const p = await loadProfile(`./profiles/${dir}`, './skills', FRAGMENTS);
      expect(validateIntakeSchema(p.intakeSchema).ok, `${dir}`).toBe(true);
    }
  });

  it('cerrajería conserva su "Dirección exacta" sin duplicar la sección', async () => {
    const p = await loadProfile('./profiles/cerrajeria', './skills', FRAGMENTS);
    const logistics = p.intakeSchema.sections.find((s) => s.key === 'logistics');
    expect(logistics!.fields.find((f) => f.key === 'address')!.label).toBe('Dirección exacta');
    // …y los demás mantienen la del fragmento.
    const plomeria = await loadProfile('./profiles/plomeria', './skills', FRAGMENTS);
    const otra = plomeria.intakeSchema.sections.find((s) => s.key === 'logistics');
    expect(otra!.fields.find((f) => f.key === 'address')!.label).toBe('Dirección');
  });
});
