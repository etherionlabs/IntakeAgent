import { describe, it, expect } from 'vitest';
import { loadProfile } from '../src/config/loader';
import { getFieldByPath } from '../src/config/intake-schema';
import {
  createEmptyIntakeFromSchema,
  bulkUpdate,
  renderIntakeForModel,
} from '../src/services/intake';

/**
 * Regresión: el cliente puede decir "no tengo fotos" y el agente debe poder
 * REGISTRAR ese rechazo para dejar de pedirlas. Antes esto era imposible porque
 * las fotos no eran un campo del schema: update_intake('media.photos', ...) fallaba
 * con "path no existe en schema" y el modelo seguía pidiéndolas en cada turno.
 *
 * El perfil tapicería debe exponer un campo declinable para las fotos.
 */
const PHOTOS_PATH = 'work.photos';

describe('perfil tapicería: fotos declinables', () => {
  it('expone un campo de fotos en el schema', async () => {
    const profile = await loadProfile('./profiles/tapiceria');
    const field = getFieldByPath(profile.intakeSchema, PHOTOS_PATH);
    expect(field).not.toBeNull();
  });

  it('permite declinar las fotos y lo muestra al modelo como declinado', async () => {
    const profile = await loadProfile('./profiles/tapiceria');
    const schema = profile.intakeSchema;
    const intake = createEmptyIntakeFromSchema(schema);

    const result = bulkUpdate(
      schema,
      intake,
      [
        {
          path: PHOTOS_PATH,
          declined: true,
          declined_reason: 'el cliente no tiene fotos ahora',
        },
      ],
      { now: new Date().toISOString(), source_message_id: null },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rendered = renderIntakeForModel(schema, result.intake, {
      jobId: 'job-1',
      status: 'OPEN_INTAKE',
    });
    expect(rendered).toMatch(/declinado/i);
  });

  it('el campo de fotos es opcional (no bloquea el cierre del intake)', async () => {
    const profile = await loadProfile('./profiles/tapiceria');
    const field = getFieldByPath(profile.intakeSchema, PHOTOS_PATH);
    expect(field?.required ?? false).toBe(false);
  });
});
