import { describe, it, expect } from 'vitest';
import { loadProfile } from '../../src/config/loader';
import { buildSystemPrompt } from '../../src/agent/prompt';
import { providersFor } from '../../src/agent/tools';
import { createEmptyIntakeFromSchema, renderIntakeForModel } from '../../src/services/intake';
import { evaluateJob } from '../../src/services/followUp';
import { resolveModules } from '../../src/domain/modules';
import { MODULE_REGISTRY } from '../../src/domain/registry';
import type { Config } from '../../src/config/schema';
import type { Job, Contact, Message } from '@prisma/client';

/**
 * LA PRUEBA DE COMPOSICIÓN.
 *
 * La tesis de la plataforma es que una vertical se COMPONE en vez de escribirse:
 * captación pura es `[intake]`, venta consultiva es `[intake, ventas]`, y el
 * runtime no se entera. Validarla no exige inventar una vertical nueva: basta
 * con QUITAR un módulo a la que ya existe y comprobar que nada se derrama.
 *
 * Si estos tests se rompen al añadir un módulo nuevo, la composición está
 * filtrando conocimiento de dominio a alguna pieza que debería ser neutral.
 */

const SOLO_INTAKE = ['intake'] as const;
const CON_VENTAS = ['intake', 'ventas'] as const;

const config = {
  hours: { enabled: false, timezone: 'America/Mexico_City', schedule: {}, outOfHoursNotice: '' },
} as unknown as Config;

describe('composición: catálogo de tools', () => {
  it('sin `ventas` el modelo no ve ninguna tool de venta', () => {
    const names = providersFor(SOLO_INTAKE).map((p) => p.name);
    expect(names).not.toContain('register_opportunity');
    expect(names).not.toContain('register_discovery');
  });

  it('las capacidades del runtime van siempre, se componga lo que se componga', () => {
    for (const mods of [SOLO_INTAKE, CON_VENTAS]) {
      const names = providersFor(mods).map((p) => p.name);
      expect(names).toContain('update_intake');
      expect(names).toContain('mark_ready_for_review');
      expect(names).toContain('flag_non_intake');
      expect(names).toContain('select_or_open_job');
    }
  });

  it('componer `ventas` solo AÑADE: no quita ni renombra nada', () => {
    const sin = providersFor(SOLO_INTAKE).map((p) => p.name);
    const con = providersFor(CON_VENTAS).map((p) => p.name);
    expect(con).toEqual(expect.arrayContaining(sin));
    expect(con.length).toBe(sin.length + 2);
  });
});

describe('composición: estado del artefacto', () => {
  const schema = {
    $businessName: 'X',
    $businessDomain: 'y',
    $language: 'es-MX',
    sections: [{ key: 'client', label: 'Cliente', fields: [{ key: 'name', label: 'Nombre', type: 'string' as const, required: true }] }],
  };

  it('sin `ventas` el artefacto no arrastra bloques de venta', () => {
    const state = createEmptyIntakeFromSchema(schema, SOLO_INTAKE);
    expect(state.opportunities).toBeUndefined();
    expect(state.diagnosis).toBeUndefined();
    // El artefacto base sigue completo.
    expect(state.client).toEqual({ name: { value: null, asked: false } });
    expect(state.media).toEqual({ photo_count: 0, audio_count: 0 });
  });

  it('sin `ventas` el estado que ve el modelo no menciona venta', () => {
    const state = createEmptyIntakeFromSchema(schema, SOLO_INTAKE);
    const render = renderIntakeForModel(schema, state, { jobId: 'j1', status: 'OPEN_INTAKE' }, SOLO_INTAKE);
    expect(render).not.toMatch(/Diagnóstico de venta/);
    expect(render).not.toMatch(/Servicios adicionales/);
    expect(render).not.toMatch(/register_(discovery|opportunity)/);
    // Y sigue diciendo lo que falta capturar, que es su trabajo.
    expect(render).toContain('Pendientes mínimos para cerrar intake: client.name');
  });

  it('con `ventas` los bloques vuelven, sin tocar el core', () => {
    const state = createEmptyIntakeFromSchema(schema, CON_VENTAS);
    const render = renderIntakeForModel(schema, state, { jobId: 'j1', status: 'OPEN_INTAKE' }, CON_VENTAS);
    expect(render).toContain('Diagnóstico de venta');
  });
});

describe('composición: seguimiento proactivo', () => {
  const schema = {
    $businessName: 'X',
    $businessDomain: 'y',
    $language: 'es-MX',
    sections: [{ key: 'client', label: 'Cliente', fields: [{ key: 'name', label: 'Nombre', type: 'string' as const, required: true }] }],
  };
  const NOW = new Date('2026-03-10T18:00:00Z');
  const contact = { botActive: true, flaggedNonIntake: false, archivedAt: null } as Contact;
  const lastMessage = { direction: 'outbound', createdAt: new Date('2026-03-09T12:00:00Z') } as Message;
  const job = {
    id: 'j1',
    status: 'OPEN_INTAKE',
    archivedAt: null,
    followUpCount: 0,
    lastFollowUpAt: null,
    intake: JSON.stringify(createEmptyIntakeFromSchema(schema, SOLO_INTAKE)),
  } as unknown as Job;

  const policy = { afterHours: 24, maxFollowUps: 2, minHoursBetween: 24 };

  /**
   * Esto es lo que el experimento descubrió: `incomplete_intake` vivía en el
   * módulo de ventas. Sin corregirlo, una vertical de captación pura se quedaba
   * SIN ningún motivo de seguimiento — muda ante el silencio del cliente.
   */
  it('una vertical de captación pura conserva su motivo de seguimiento', () => {
    const v = evaluateJob({ job, contact, lastMessage, schema, policy, now: NOW, modules: SOLO_INTAKE });
    expect(v?.reason).toBe('incomplete_intake');
    expect(v?.body.join(' ')).toContain('Nombre');
  });

  it('sin `ventas` el seguimiento no aporta contexto comercial', () => {
    const v = evaluateJob({ job, contact, lastMessage, schema, policy, now: NOW, modules: SOLO_INTAKE });
    expect(v?.context).toEqual([]);
  });
});

describe('composición: skills que aporta cada módulo', () => {
  it('`ventas` trae sus técnicas consigo; `intake` no arrastra ninguna', () => {
    const [intake] = resolveModules(SOLO_INTAKE, MODULE_REGISTRY);
    const [, ventas] = resolveModules(CON_VENTAS, MODULE_REGISTRY);
    expect(intake.skills).toEqual([]);
    expect(ventas.skills).toEqual(['descubrimiento', 'ventas', 'objeciones']);
  });

  it('un módulo desconocido falla al resolver, no en silencio', () => {
    expect(() => resolveModules(['contabilidad'], MODULE_REGISTRY)).toThrow(/desconocido/);
  });
});

describe('composición: el perfil de captación pura carga de punta a punta', () => {
  it('compone solo `intake` y su prompt no le pide vender', async () => {
    const profile = await loadProfile('./profiles/captacion');
    expect(profile.modules).toEqual(['intake']);
    // Sin `ventas`, ninguna técnica comercial se inyecta.
    expect(profile.skills).toEqual([]);

    const prompt = buildSystemPrompt({
      profile,
      config,
      intake: createEmptyIntakeFromSchema(profile.intakeSchema, profile.modules),
      jobId: 'j1',
      jobStatus: 'OPEN_INTAKE',
      otherOpenJobs: [],
      now: new Date('2026-03-10T18:00:00Z'),
    });

    expect(prompt).not.toMatch(/Diagnóstico de venta/);
    expect(prompt).not.toMatch(/HABILIDADES/);
    expect(prompt).not.toMatch(/register_opportunity/);
    expect(prompt).toContain('recopilar la información del pedido');
  });

  it('el perfil por defecto sigue componiendo venta (nada cambió para Intake)', async () => {
    const profile = await loadProfile('./profiles/generico');
    expect(profile.modules).toEqual(['intake', 'ventas']);
    expect(profile.skills.map((s) => s.name)).toEqual(['descubrimiento', 'ventas', 'objeciones']);
  });
});

describe('composición: huecos que el experimento dejó al descubierto', () => {
  /**
   * El panel puede seleccionar skills por tenant (`TenantSettings.skills`) y esa
   * selección SUSTITUYE a las del perfil, sin consultar los módulos compuestos.
   *
   * Resultado: se le pueden inyectar técnicas de venta a una vertical que no
   * compone `ventas`. El modelo recibe instrucciones para ofrecer servicios y
   * registrar oportunidades, pero `register_opportunity` no existe en su
   * catálogo. Este test PINTA el hueco, no lo aprueba.
   */
  it('las skills por tenant pueden contradecir la composición (hueco conocido)', () => {
    const names = providersFor(SOLO_INTAKE).map((p) => p.name);
    expect(names).not.toContain('register_opportunity');
    // Nada impide que TenantSettings.skills traiga 'ventas' con esta composición:
    // la selección de skills y la de módulos son hoy dos ejes sin validación cruzada.
    const [, ventas] = resolveModules(CON_VENTAS, MODULE_REGISTRY);
    expect(ventas.skills).toContain('ventas');
  });

  /**
   * Los consumidores de estado de venta (aviso al dueño, panel) toleran que los
   * bloques no existan porque ya toleraban los jobs anteriores a esa función.
   * La retro-compatibilidad resultó ser, gratis, compatibilidad de composición.
   */
  it('los consumidores de venta degradan a vacío en vez de reventar', async () => {
    const { acceptedOpportunities, listOpportunities, getDiagnosis } = await import(
      '../../src/services/intake'
    );
    const schema = {
      $businessName: 'X', $businessDomain: 'y', $language: 'es-MX',
      sections: [{ key: 'client', label: 'Cliente', fields: [{ key: 'name', label: 'Nombre', type: 'string' as const, required: true }] }],
    };
    const state = createEmptyIntakeFromSchema(schema, SOLO_INTAKE);
    expect(acceptedOpportunities(state)).toEqual([]);
    expect(listOpportunities(state)).toEqual([]);
    expect(getDiagnosis(state)).toEqual({ objections: [] });
  });
});
