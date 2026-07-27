import { describe, it, expect } from 'vitest';
import {
  createEmptyIntakeFromSchema,
  bulkUpdate,
  addFreeNote,
  isIntakeComplete,
  renderIntakeForModel,
  upsertOpportunities,
  listOpportunities,
  acceptedOpportunities,
} from '../../src/services/intake';
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

describe('addFreeNote', () => {
  it('agrega una nota al array', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    const next = addFreeNote(intake, 'cliente alérgico al cuero', '2026-05-25T10:00:00Z', 'msg_3');
    expect(next.free_notes).toHaveLength(1);
    expect(next.free_notes[0].text).toBe('cliente alérgico al cuero');
    expect(next.free_notes[0].source_message_id).toBe('msg_3');
  });
});

describe('isIntakeComplete', () => {
  it('false cuando falta un required', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    expect(isIntakeComplete(schema, intake)).toBe(false);
  });

  it('true cuando todos los required tienen valor', () => {
    let intake = createEmptyIntakeFromSchema(schema);
    const r1 = bulkUpdate(schema, intake, [{ path: 'client.name', value: 'María' }], { now: 't', source_message_id: null });
    if (!r1.ok) throw new Error('fail');
    intake = r1.intake;
    const r2 = bulkUpdate(schema, intake, [{ path: 'work.qty', value: 2 }], { now: 't', source_message_id: null });
    if (!r2.ok) throw new Error('fail');
    expect(isIntakeComplete(schema, r2.intake)).toBe(true);
  });

  it('true cuando un required está declined', () => {
    let intake = createEmptyIntakeFromSchema(schema);
    const r1 = bulkUpdate(schema, intake, [{ path: 'client.name', value: 'M' }], { now: 't', source_message_id: null });
    if (!r1.ok) throw new Error('fail');
    const r2 = bulkUpdate(schema, r1.intake, [{ path: 'work.qty', declined: true, declined_reason: 'no sabe' }], { now: 't', source_message_id: null });
    if (!r2.ok) throw new Error('fail');
    expect(isIntakeComplete(schema, r2.intake)).toBe(true);
  });
});

describe('renderIntakeForModel', () => {
  it('renderiza estado vacío con iconos correctos', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    const out = renderIntakeForModel(schema, intake, { jobId: 'j1', status: 'OPEN_INTAKE' });
    expect(out).toContain('job #j1');
    expect(out).toContain('status=OPEN_INTAKE');
    expect(out).toMatch(/✗\s+Nombre/);
    expect(out).toMatch(/○\s+Teléfono/); // opcional
    expect(out).toContain('Pendientes mínimos');
  });

  it('marca campos llenos con ✓', () => {
    let intake = createEmptyIntakeFromSchema(schema);
    const r = bulkUpdate(schema, intake, [{ path: 'client.name', value: 'María' }], {
      now: 't',
      source_message_id: null,
    });
    if (!r.ok) throw new Error('fail');
    const out = renderIntakeForModel(schema, r.intake, { jobId: 'j1', status: 'OPEN_INTAKE' });
    expect(out).toMatch(/✓\s+Nombre \[client\.name\]: "María"/);
  });

  it('incluye el path canónico de cada campo para que el modelo no lo invente', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    const out = renderIntakeForModel(schema, intake, { jobId: 'j1', status: 'OPEN_INTAKE' });
    // El modelo debe ver section.field exacto, no solo el label en español.
    expect(out).toContain('[client.name]');
    expect(out).toContain('[client.phone]');
    expect(out).toContain('[work.qty]');
    expect(out).toContain('[work.service]');
  });

  it('muestra las opciones permitidas de un campo enum', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    const out = renderIntakeForModel(schema, intake, { jobId: 'j1', status: 'OPEN_INTAKE' });
    expect(out).toMatch(/opciones:.*retapizar.*reparar/);
  });

  it('marca campos declinados con ⊘ y razón', () => {
    let intake = createEmptyIntakeFromSchema(schema);
    const r = bulkUpdate(
      schema,
      intake,
      [{ path: 'client.phone', declined: true, declined_reason: 'no tiene' }],
      { now: 't', source_message_id: null },
    );
    if (!r.ok) throw new Error('fail');
    const out = renderIntakeForModel(schema, r.intake, { jobId: 'j1', status: 'OPEN_INTAKE' });
    expect(out).toMatch(/⊘\s+Teléfono.*no tiene/);
  });

  it('incluye contadores de media y free_notes', () => {
    let intake = createEmptyIntakeFromSchema(schema);
    intake.media = { photo_count: 2, audio_count: 1 };
    intake = addFreeNote(intake, 'evento el 15', 't', 'msg');
    const out = renderIntakeForModel(schema, intake, { jobId: 'j1', status: 'OPEN_INTAKE' });
    expect(out).toContain('fotos recibidas: 2');
    expect(out).toContain('audios recibidos: 1');
    expect(out).toContain('evento el 15');
  });
});

describe('oportunidades de venta', () => {
  it('registra un servicio adicional ofrecido', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    const next = upsertOpportunities(
      intake,
      [{ service: 'polarizado 20%', status: 'offered', note: 'le interesó el calor' }],
      '2026-07-27T10:00:00.000Z',
      'msg-1',
    );
    expect(listOpportunities(next)).toEqual([
      {
        service: 'polarizado 20%',
        status: 'offered',
        note: 'le interesó el calor',
        updated_at: '2026-07-27T10:00:00.000Z',
        source_message_id: 'msg-1',
      },
    ]);
    // No muta el original.
    expect(listOpportunities(intake)).toEqual([]);
  });

  it('actualiza el estado del mismo servicio en vez de duplicarlo', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    const offered = upsertOpportunities(
      intake,
      [{ service: 'Polarizado 20%', status: 'offered' }],
      't1',
      null,
    );
    const accepted = upsertOpportunities(
      offered,
      [{ service: 'polarizado 20%', status: 'accepted' }],
      't2',
      null,
    );
    const list = listOpportunities(accepted);
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('accepted');
    expect(list[0].updated_at).toBe('t2');
  });

  it('trata como el mismo servicio nombres con acentos y espacios distintos', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    const a = upsertOpportunities(intake, [{ service: 'Rotulación', status: 'offered' }], 't1', null);
    const b = upsertOpportunities(a, [{ service: 'rotulacion', status: 'declined' }], 't2', null);
    expect(listOpportunities(b)).toHaveLength(1);
    expect(listOpportunities(b)[0].status).toBe('declined');
  });

  it('acceptedOpportunities devuelve solo los aceptados', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    const next = upsertOpportunities(
      intake,
      [
        { service: 'ppf frente', status: 'accepted' },
        { service: 'cerámica', status: 'declined' },
        { service: 'rines', status: 'offered' },
      ],
      't1',
      null,
    );
    expect(acceptedOpportunities(next).map((o) => o.service)).toEqual(['ppf frente']);
  });

  it('tolera un intake antiguo sin el campo opportunities', () => {
    const legacy = createEmptyIntakeFromSchema(schema);
    delete legacy.opportunities;
    expect(listOpportunities(legacy)).toEqual([]);
    expect(acceptedOpportunities(legacy)).toEqual([]);
    const next = upsertOpportunities(legacy, [{ service: 'extra', status: 'accepted' }], 't1', null);
    expect(listOpportunities(next)).toHaveLength(1);
  });

  it('renderIntakeForModel muestra los extras y prohíbe re-ofrecer los rechazados', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    const next = upsertOpportunities(
      intake,
      [
        { service: 'polarizado 20%', status: 'accepted' },
        { service: 'protección cerámica', status: 'declined', note: 'lo ve caro' },
      ],
      't1',
      null,
    );
    const out = renderIntakeForModel(schema, next, { jobId: 'j1', status: 'OPEN_INTAKE' });
    expect(out).toContain('Servicios adicionales (venta)');
    expect(out).toContain('polarizado 20%: ACEPTADO');
    expect(out).toContain('protección cerámica: rechazado — NO lo vuelvas a ofrecer');
    expect(out).toContain('lo ve caro');
    expect(out).toContain('register_opportunity');
  });

  it('renderIntakeForModel omite el bloque cuando no hay extras', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    const out = renderIntakeForModel(schema, intake, { jobId: 'j1', status: 'OPEN_INTAKE' });
    expect(out).not.toContain('Servicios adicionales');
  });
});
