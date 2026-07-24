import { describe, it, expect } from 'vitest';
import { loadProfile } from '../../src/config/loader';

describe('perfil wrapping', () => {
  it('carga y valida (intake-schema, facts, prompt-vars, welcome)', async () => {
    const p = await loadProfile('./profiles/wrapping');
    expect(p.intakeSchema.sections.map((s) => s.key)).toEqual(['client', 'vehicle', 'work']);
    const serviceType = p.intakeSchema.sections
      .find((s) => s.key === 'work')
      ?.fields.find((f) => f.key === 'service_type');
    expect(serviceType?.type).toBe('enum');
    expect(serviceType?.options).toContain('wrap');
    expect(serviceType?.options).toContain('polarizado');
    expect(serviceType?.options).toContain('ppf');
  });

  it('trae el catálogo de servicios en business-facts (para vender sin inventar)', async () => {
    const p = await loadProfile('./profiles/wrapping');
    const topics = p.businessFacts.facts.map((f) => f.topic);
    expect(topics).toContain('servicios');
    expect(topics).toContain('wrap');
    expect(topics).toContain('polarizado');
    expect(topics).toContain('precios');
  });

  it('expone foco de imagen, guía de edición y playbooks de venta/preview', async () => {
    const p = await loadProfile('./profiles/wrapping');
    expect(p.imageFocus.length).toBeGreaterThan(0);
    expect(p.imageEditGuidance.length).toBeGreaterThan(0);
    expect((p.promptVars.vars.salesPlaybook ?? '').length).toBeGreaterThan(0);
    expect((p.promptVars.vars.previewPlaybook ?? '').length).toBeGreaterThan(0);
    // El prompt template referencia las secciones de venta y preview.
    expect(p.promptVars.promptTemplate).toContain('{{salesPlaybook}}');
    expect(p.promptVars.promptTemplate).toContain('{{previewPlaybook}}');
  });
});
