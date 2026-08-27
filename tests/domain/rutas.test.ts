import { describe, it, expect } from 'vitest';
import { loadProfile } from '../../src/config/loader';
import { toolNamesFor } from '../../src/agent/tools';
import { createEmptyIntakeFromSchema, renderIntakeForModel } from '../../src/services/intake';
import { evaluateJob } from '../../src/services/followUp';
import {
  activarRuta,
  listRutas,
  faltaEnRuta,
  pasosPendientes,
  registrarAvance,
  rutaEnCurso,
  sanearOportunidades,
  upsertRuta,
  validateRutaUpdate,
  type OportunidadLaboral,
} from '../../src/domain/rutas/state';
import { rutasSection } from '../../src/domain/rutas/render';
import type { Job, Contact, Message } from '@prisma/client';

/**
 * La vertical de movilidad laboral es la primera que NO es Intake: compone
 * `[intake, rutas]`, sin `ventas`. Estos tests fijan tanto su mecánica propia
 * como lo que prueban sobre la arquitectura — que una vertical nueva se compone
 * en vez de escribirse, y reutiliza fragmentos nacidos en otro giro.
 */

const MODS = ['intake', 'rutas'] as const;
const NOW = '2026-08-27T12:00:00.000Z';
const id = () => 'r1';

const schema = {
  $businessName: 'Ruta',
  $businessDomain: 'movilidad laboral',
  $language: 'es-MX',
  sections: [
    { key: 'situacion', label: 'Situación', fields: [{ key: 'trabajo_actual', label: 'Trabajo', type: 'string' as const, required: true }] },
  ],
};

const vacio = () => createEmptyIntakeFromSchema(schema, MODS);

const rutaBase = {
  destino: 'HVAC Helper',
  viabilidad: 'alta' as const,
  proxima_accion: 'Mandar el resume a las 3 empresas de la lista',
  brechas: ['sin experiencia en HVAC', 'resume no orientado al puesto'],
  pasos: [
    { orden: 1, accion: 'Adaptar el resume a HVAC helper', duracion: '1 día' },
    { orden: 2, accion: 'Aplicar a las vacantes encontradas', duracion: '2 días' },
  ],
};

describe('la vertical compone en vez de escribirse', () => {
  it('el perfil de movilidad declara [intake, rutas], sin ventas', async () => {
    const p = await loadProfile('./profiles/movilidad');
    expect(p.modules).toEqual(['intake', 'rutas']);
    expect(p.skills).toEqual([]);
  });

  /**
   * `customer.identity` nació en tapicería. Que lo use una vertical de empleo
   * es la prueba de que el fragmento es de verdad reutilizable y no una
   * abstracción de mentira.
   */
  it('reutiliza un fragmento nacido en otro giro', async () => {
    const p = await loadProfile('./profiles/movilidad');
    const client = p.intakeSchema.sections.find((s) => s.key === 'client');
    expect(client?.fields.map((f) => f.key)).toEqual(['name', 'city_or_zone', 'phone_alt']);
    // Y lo adapta a su vocabulario sin tocar el fragmento.
    expect(client?.fields.find((f) => f.key === 'city_or_zone')?.label).toBe('Ciudad / Zona donde vive');
  });

  it('el catálogo de tools trae las de rutas y ninguna de venta', () => {
    const names = toolNamesFor(MODS);
    expect(names).toContain('investigar');
    expect(names).toContain('registrar_ruta');
    expect(names).toContain('activar_ruta');
    expect(names).toContain('registrar_avance');
    expect(names).not.toContain('register_opportunity');
    expect(names).not.toContain('register_discovery');
    // Las primitivas del arnés siguen ahí: no se reescribieron.
    expect(names).toContain('update_intake');
  });

  it('el estado del artefacto no arrastra bloques de venta', () => {
    const s = vacio();
    expect(s.rutas).toEqual([]);
    expect(s.opportunities).toBeUndefined();
    expect(s.diagnosis).toBeUndefined();
    const render = renderIntakeForModel(schema, s, { jobId: 'j1', status: 'OPEN_INTAKE' }, MODS);
    expect(render).not.toMatch(/Diagnóstico de venta/);
    expect(render).toContain('Rutas laborales:');
  });
});

describe('una ruta exige lo que la hace accionable', () => {
  it('sin próxima acción no es una ruta, es un consejo', () => {
    expect(faltaEnRuta({ destino: 'HVAC Helper', viabilidad: 'alta' })).toContain('qué puede hacer hoy');
  });

  it('rechaza una viabilidad fuera de lo declarado', () => {
    expect(validateRutaUpdate({ ...rutaBase, viabilidad: 'quizás' as never })).toMatch(/viabilidad/);
  });
});

describe('regla de procedencia sobre oportunidades', () => {
  const conFuente: OportunidadLaboral = {
    titulo: 'HVAC Helper — ACME Air',
    confianza: 'verificado',
    source: { url: 'https://acme.example/jobs/1', title: 'ACME', consultedAt: NOW },
  };
  const sinFuente: OportunidadLaboral = {
    titulo: 'HVAC Helper — empresa local',
    confianza: 'verificado',
    source: null,
  };

  /**
   * Es el punto donde más caro sale inventar: alguien hace un viaje a una
   * vacante que no existe.
   */
  it('una vacante sin fuente abrible no se presenta como verificada', () => {
    const { oportunidades, degradadas } = sanearOportunidades([conFuente, sinFuente]);
    expect(oportunidades[0].confianza).toBe('verificado');
    expect(oportunidades[1].confianza).toBe('inferido');
    expect(degradadas).toEqual(['HVAC Helper — empresa local']);
  });

  it('el render dice cuántas tienen fuente, no solo cuántas hay', () => {
    const { state } = upsertRuta(vacio(), { ...rutaBase, oportunidades: [conFuente, sinFuente] }, NOW, id);
    expect(rutasSection.render(state).join('\n')).toContain('oportunidades: 2 (1 con fuente abrible)');
  });
});

describe('la ruta como proceso vivo', () => {
  it('nace propuesta: registrarla no es elegirla', () => {
    const { state, ruta } = upsertRuta(vacio(), rutaBase, NOW, id);
    expect(ruta.estado).toBe('propuesta');
    expect(rutaEnCurso(state)).toBeNull();
  });

  it('solo una activa: la anterior vuelve a propuesta, no se descarta', () => {
    let s = upsertRuta(vacio(), rutaBase, NOW, () => 'r1').state;
    s = upsertRuta(s, { ...rutaBase, destino: 'Almacén' }, NOW, () => 'r2').state;
    s = activarRuta(s, 'r1', NOW)!;
    s = activarRuta(s, 'r2', NOW)!;
    expect(rutaEnCurso(s)?.id).toBe('r2');
    expect(listRutas(s).find((r) => r.id === 'r1')!.estado).toBe('propuesta');
  });

  it('activar una ruta inexistente falla', () => {
    expect(activarRuta(vacio(), 'nope', NOW)).toBeNull();
  });

  it('un paso hecho sigue hecho al replanificar la ruta', () => {
    let s = upsertRuta(vacio(), rutaBase, NOW, id).state;
    s = activarRuta(s, 'r1', NOW)!;
    s = registrarAvance(s, { paso_orden: 1 }, NOW).state;
    // Replanifica: mismos pasos reescritos.
    s = upsertRuta(s, { ...rutaBase, id: 'r1', proxima_accion: 'Llamar a las empresas directamente' }, NOW, id).state;
    expect(listRutas(s)[0].pasos.find((p) => p.orden === 1)!.hecho).toBe(true);
    expect(pasosPendientes(s).map((p) => p.orden)).toEqual([2]);
  });

  it('un bloqueo marca la ruta y el prompt pide replanificar', () => {
    let s = upsertRuta(vacio(), rutaBase, NOW, id).state;
    s = activarRuta(s, 'r1', NOW)!;
    s = registrarAvance(s, { bloqueo: 'aplicó a 5 y nadie respondió en 2 semanas' }, NOW).state;
    expect(rutaEnCurso(s)!.estado).toBe('bloqueada');
    const render = rutasSection.render(s).join('\n');
    expect(render).toContain('BLOQUEADA');
    expect(render).toMatch(/Replanifica/);
  });

  /**
   * El bug que este test encontró: `rutaEnCurso` solo miraba 'activa', así que
   * un bloqueo dejaba la ruta irrecuperable — sin poder registrar más avance,
   * invisible para el seguimiento y ausente del prompt.
   */
  it('una ruta bloqueada sigue siendo la ruta en curso, y se puede desbloquear', () => {
    let s = upsertRuta(vacio(), rutaBase, NOW, id).state;
    s = activarRuta(s, 'r1', NOW)!;
    s = registrarAvance(s, { bloqueo: 'nadie respondió' }, NOW).state;
    expect(rutaEnCurso(s)?.id).toBe('r1');

    // Y se le puede seguir registrando avance, que es lo que permite replanificar.
    const r = registrarAvance(s, { estado: 'activa', proxima_accion: 'Llamar a las empresas directamente' }, NOW);
    expect(r.error).toBeUndefined();
    expect(rutaEnCurso(r.state)?.estado).toBe('activa');
    expect(rutaEnCurso(r.state)?.motivo_bloqueo).toBeUndefined();
  });

  it('sin ruta en curso no se puede registrar avance', () => {
    expect(registrarAvance(vacio(), { paso_orden: 1 }, NOW).error).toMatch(/no hay ruta en curso/);
  });
});

describe('seguimiento: el silencio sobre una ruta viva', () => {
  const contact = { botActive: true, flaggedNonIntake: false, archivedAt: null } as Contact;
  const lastMessage = { direction: 'outbound', createdAt: new Date('2026-08-25T12:00:00Z') } as Message;
  const policy = { afterHours: 24, maxFollowUps: 3, minHoursBetween: 24 };
  const now = new Date('2026-08-27T12:00:00Z');

  const jobCon = (intake: unknown) =>
    ({ id: 'j1', status: 'OPEN_INTAKE', archivedAt: null, followUpCount: 0, lastFollowUpAt: null,
       intake: JSON.stringify(intake) }) as unknown as Job;

  it('persigue una ruta bloqueada por delante de todo', () => {
    let s = upsertRuta(vacio(), rutaBase, NOW, id).state;
    s = activarRuta(s, 'r1', NOW)!;
    s = registrarAvance(s, { bloqueo: 'nadie respondió' }, NOW).state;
    const v = evaluateJob({ job: jobCon(s), contact, lastMessage, schema, policy, now, modules: MODS });
    expect(v?.reason).toBe('ruta_bloqueada');
  });

  it('persigue la próxima acción de una ruta en marcha', () => {
    let s = upsertRuta(vacio(), rutaBase, NOW, id).state;
    s = activarRuta(s, 'r1', NOW)!;
    const v = evaluateJob({ job: jobCon(s), contact, lastMessage, schema, policy, now, modules: MODS });
    expect(v?.reason).toBe('ruta_en_marcha');
    expect(v?.body.join(' ')).toContain('Mandar el resume');
  });

  it('si le presentaste rutas y no eligió, pregunta qué le frenó', () => {
    const s = upsertRuta(vacio(), rutaBase, NOW, id).state;
    const v = evaluateJob({ job: jobCon(s), contact, lastMessage, schema, policy, now, modules: MODS });
    expect(v?.reason).toBe('rutas_sin_elegir');
  });

  /** La ruta gana a `incomplete_intake`: un campo sin capturar cuesta menos. */
  it('la ruta viva gana al perfil incompleto', () => {
    let s = upsertRuta(vacio(), rutaBase, NOW, id).state;
    s = activarRuta(s, 'r1', NOW)!;
    // `situacion.trabajo_actual` sigue vacío y aun así gana la ruta.
    const v = evaluateJob({ job: jobCon(s), contact, lastMessage, schema, policy, now, modules: MODS });
    expect(v?.reason).toBe('ruta_en_marcha');
  });

  it('sin rutas cae al motivo del perfil incompleto', () => {
    const v = evaluateJob({ job: jobCon(vacio()), contact, lastMessage, schema, policy, now, modules: MODS });
    expect(v?.reason).toBe('incomplete_intake');
  });
});
