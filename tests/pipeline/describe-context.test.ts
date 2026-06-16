import { describe, it, expect } from 'vitest';
import { buildDescribeContext } from '../../src/pipeline/describe-context';
import { createEmptyIntakeFromSchema, bulkUpdate } from '../../src/services/intake';
import type { IntakeSchema } from '../../src/config/intake-schema';
import type { BusinessFacts } from '../../src/config/schema';

const SCHEMA: IntakeSchema = {
  $businessName: 'Tapicería Demo',
  $businessDomain: 'tapicería de muebles',
  $language: 'es-MX',
  sections: [
    {
      key: 'work',
      label: 'Trabajo',
      fields: [
        { key: 'item_type', label: 'Mueble', type: 'string', required: true },
        { key: 'fabric', label: 'Tela', type: 'string', required: true, hint: 'tipo y color de la tela' },
      ],
    },
  ],
};

const FACTS: BusinessFacts = {
  facts: [],
  freeContext: 'Trabajamos muebles de sala y comedor.',
};

describe('buildDescribeContext', () => {
  it('incluye negocio, datos a recoger y hechos del negocio', () => {
    const intake = createEmptyIntakeFromSchema(SCHEMA);
    const ctx = buildDescribeContext({ schema: SCHEMA, intake, businessFacts: FACTS });
    expect(ctx.businessName).toBe('Tapicería Demo');
    expect(ctx.businessDomain).toBe('tapicería de muebles');
    expect(ctx.collects).toContain('Mueble');
    expect(ctx.collects).toContain('Tela (tipo y color de la tela)');
    expect(ctx.businessContext).toBe('Trabajamos muebles de sala y comedor.');
  });

  it('refleja el estado de la sesión: lo conocido y lo que falta', () => {
    let intake = createEmptyIntakeFromSchema(SCHEMA);
    const res = bulkUpdate(SCHEMA, intake, [{ path: 'work.item_type', value: 'sillón' }], {
      now: '2026-06-16T00:00:00Z',
      source_message_id: null,
    });
    if (!res.ok) throw new Error(res.error);
    intake = res.intake;

    const ctx = buildDescribeContext({ schema: SCHEMA, intake, businessFacts: FACTS });
    expect(ctx.sessionState).toContain('ya sabemos — Mueble: sillón');
    expect(ctx.sessionState).toContain('aún falta — Tela');
  });

  it('incluye la conversación reciente y respeta el caption', () => {
    const intake = createEmptyIntakeFromSchema(SCHEMA);
    const ctx = buildDescribeContext({
      schema: SCHEMA,
      intake,
      businessFacts: FACTS,
      caption: 'mira esta silla',
      recentMessages: [
        { direction: 'outbound', body: '¿me mandas foto?' },
        { direction: 'inbound', body: 'sí, va' },
      ],
    });
    expect(ctx.caption).toBe('mira esta silla');
    expect(ctx.recentConversation).toContain('Asistente: ¿me mandas foto?');
    expect(ctx.recentConversation).toContain('Cliente: sí, va');
  });
});
