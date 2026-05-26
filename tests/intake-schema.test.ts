import { describe, it, expect } from 'vitest';
import { IntakeSchemaZ, validateIntakeSchema } from '../src/config/intake-schema';

const valid = {
  $businessName: 'Tapicería Acme',
  $businessDomain: 'tapicería',
  $language: 'es-MX',
  sections: [
    {
      key: 'client',
      label: 'Cliente',
      fields: [
        { key: 'name', label: 'Nombre', type: 'string', required: true },
        {
          key: 'service_type',
          label: 'Servicio',
          type: 'enum',
          required: true,
          options: ['retapizar', 'reparar'],
        },
        { key: 'qty', label: 'Cantidad', type: 'integer', required: true, min: 1 },
      ],
    },
  ],
};

describe('IntakeSchemaZ', () => {
  it('acepta schema válido', () => {
    expect(() => IntakeSchemaZ.parse(valid)).not.toThrow();
  });

  it('rechaza schema sin $businessName', () => {
    const bad = { ...valid, $businessName: undefined };
    expect(() => IntakeSchemaZ.parse(bad)).toThrow();
  });

  it('rechaza type enum sin options', () => {
    const bad = structuredClone(valid);
    bad.sections[0].fields[1] = {
      key: 'service_type',
      label: 'Servicio',
      type: 'enum',
      required: true,
    } as any;
    expect(() => IntakeSchemaZ.parse(bad)).toThrow();
  });

  it('rechaza type enum con options vacío', () => {
    const bad = structuredClone(valid);
    (bad.sections[0].fields[1] as any).options = [];
    expect(() => IntakeSchemaZ.parse(bad)).toThrow();
  });
});

describe('validateIntakeSchema', () => {
  it('detecta keys duplicadas dentro de una sección', () => {
    const bad = structuredClone(valid);
    bad.sections[0].fields.push({
      key: 'name',
      label: 'Otro nombre',
      type: 'string',
      required: false,
    });
    const result = validateIntakeSchema(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/duplicad/i);
  });

  it('valida correctamente un schema bien formado', () => {
    const result = validateIntakeSchema(valid);
    expect(result.ok).toBe(true);
  });
});
