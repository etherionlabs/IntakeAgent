import { describe, it, expect } from 'vitest';
import { createEmptyIntakeFromSchema, bulkUpdate } from '../../src/services/intake';
import type { IntakeSchema } from '../../src/config/intake-schema';

const schema: IntakeSchema = {
  $businessName: 'X',
  $businessDomain: 'y',
  $language: 'es-MX',
  sections: [
    {
      key: 'client',
      label: 'Cliente',
      fields: [
        { key: 'name', label: 'Nombre', type: 'string', required: true },
        { key: 'phone', label: 'Teléfono', type: 'phone', required: false },
      ],
    },
    {
      key: 'work',
      label: 'Trabajo',
      fields: [
        { key: 'qty', label: 'Cant', type: 'integer', required: true, min: 1 },
        {
          key: 'service',
          label: 'Servicio',
          type: 'enum',
          required: false,
          options: ['retapizar', 'reparar'],
        },
      ],
    },
  ],
};

describe('createEmptyIntakeFromSchema', () => {
  it('genera estado con todos los campos vacíos no preguntados', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    const clientFields = intake.client as Record<string, any>;
    const workFields = intake.work as Record<string, any>;
    expect(clientFields.name).toEqual({ value: null, asked: false });
    expect(clientFields.phone).toEqual({ value: null, asked: false });
    expect(workFields.qty).toEqual({ value: null, asked: false });
  });

  it('incluye contador de media y free_notes vacíos', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    expect(intake.media).toEqual({ photo_count: 0, audio_count: 0 });
    expect(intake.free_notes).toEqual([]);
  });
});

describe('bulkUpdate', () => {
  const meta = {
    now: '2026-05-25T10:00:00Z',
    source_message_id: 'msg_1',
  };

  it('actualiza un campo string válido', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    const result = bulkUpdate(schema, intake, [{ path: 'client.name', value: 'María' }], meta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.intake.client as any).name.value).toBe('María');
    expect((result.intake.client as any).name.asked).toBe(true);
    expect((result.intake.client as any).name.updated_at).toBe(meta.now);
    expect((result.intake.client as any).name.source_message_id).toBe('msg_1');
  });

  it('rechaza path inexistente', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    const result = bulkUpdate(schema, intake, [{ path: 'nope.x', value: 'y' }], meta);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/no existe/i);
  });

  it('rechaza valor con tipo incorrecto (integer recibe string)', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    const result = bulkUpdate(schema, intake, [{ path: 'work.qty', value: 'cinco' as any }], meta);
    expect(result.ok).toBe(false);
  });

  it('acepta integer dentro de min', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    const result = bulkUpdate(schema, intake, [{ path: 'work.qty', value: 3 }], meta);
    expect(result.ok).toBe(true);
  });

  it('rechaza integer por debajo de min', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    const result = bulkUpdate(schema, intake, [{ path: 'work.qty', value: 0 }], meta);
    expect(result.ok).toBe(false);
  });

  it('acepta declined con motivo', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    const result = bulkUpdate(
      schema,
      intake,
      [{ path: 'client.phone', declined: true, declined_reason: 'no tiene' }],
      meta,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.intake.client as any).phone.declined).toBe(true);
    expect((result.intake.client as any).phone.declined_reason).toBe('no tiene');
    expect((result.intake.client as any).phone.value).toBeNull();
  });

  it('rechaza declined sin motivo', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    const result = bulkUpdate(
      schema,
      intake,
      [{ path: 'client.phone', declined: true }],
      meta,
    );
    expect(result.ok).toBe(false);
  });

  it('rechaza value y declined simultáneos', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    const result = bulkUpdate(
      schema,
      intake,
      [{ path: 'client.phone', value: 'x', declined: true, declined_reason: 'r' }],
      meta,
    );
    expect(result.ok).toBe(false);
  });
});

describe('bulkUpdate enum', () => {
  const meta = { now: 't', source_message_id: null };

  it('acepta valor en options', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    const result = bulkUpdate(schema, intake, [{ path: 'work.service', value: 'reparar' }], meta);
    expect(result.ok).toBe(true);
  });
  it('rechaza valor fuera de options', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    const result = bulkUpdate(schema, intake, [{ path: 'work.service', value: 'pintar' }], meta);
    expect(result.ok).toBe(false);
  });
});
