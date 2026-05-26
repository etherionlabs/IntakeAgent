import { describe, it, expect } from 'vitest';
import { renderUserMessage, buildBusinessFactsBlock, buildOpenJobsBlock, buildHoursBlock } from '../../src/agent/prompt';
import type { BatchMessage } from '../../src/agent/types';
import type { BusinessFacts, Config } from '../../src/config/schema';
import type { OpenJobSummary } from '../../src/agent/types';

describe('renderUserMessage', () => {
  it('renderiza un mensaje de texto simple', () => {
    const batch: BatchMessage[] = [
      { id: 'm1', kind: 'text', body: 'Hola, tengo un sillón' },
    ];
    const out = renderUserMessage(batch);
    expect(out).toContain('[mensaje 1 — texto]');
    expect(out).toContain('Hola, tengo un sillón');
  });

  it('concatena varios mensajes con separación', () => {
    const batch: BatchMessage[] = [
      { id: 'm1', kind: 'text', body: 'Hola' },
      { id: 'm2', kind: 'text', body: 'Tengo un sillón' },
    ];
    const out = renderUserMessage(batch);
    expect(out).toMatch(/\[mensaje 1[^\]]*\][\s\S]*Hola[\s\S]*\[mensaje 2[^\]]*\][\s\S]*Tengo un sillón/);
  });

  it('anota imágenes con su media path', () => {
    const batch: BatchMessage[] = [
      { id: 'm1', kind: 'image', body: null, mediaPath: 'photos/abc.jpg' },
    ];
    const out = renderUserMessage(batch);
    expect(out).toContain('foto recibida');
    expect(out).toContain('photos/abc.jpg');
  });

  it('anota audios transcritos mostrando la transcripción', () => {
    const batch: BatchMessage[] = [
      { id: 'm1', kind: 'audio', body: 'me llamo Juan', mediaPath: 'audio/x.ogg' },
    ];
    const out = renderUserMessage(batch);
    expect(out).toContain('audio transcrito');
    expect(out).toContain('me llamo Juan');
  });

  it('describe tipos no soportados con fallback', () => {
    const batch: BatchMessage[] = [
      { id: 'm1', kind: 'sticker', body: null },
    ];
    const out = renderUserMessage(batch);
    expect(out).toContain('sticker');
    expect(out).toContain('no soportado');
  });

  it('arroja si el batch está vacío', () => {
    expect(() => renderUserMessage([])).toThrow();
  });
});

const sampleFacts: BusinessFacts = {
  facts: [
    { topic: 'ubicación', aliases: ['dirección'], answer: 'Av. Reforma 123' },
    { topic: 'horarios', aliases: [], answer: 'L-V 9-19h' },
  ],
  freeContext: 'No hacemos colchones.',
};

describe('buildBusinessFactsBlock', () => {
  it('renderiza facts y free context', () => {
    const out = buildBusinessFactsBlock(sampleFacts, 'Tapicería Demo');
    expect(out).toContain('=== INFORMACIÓN DEL NEGOCIO ===');
    expect(out).toContain('Tapicería Demo');
    expect(out).toContain('ubicación');
    expect(out).toContain('Av. Reforma 123');
    expect(out).toContain('No hacemos colchones.');
  });

  it('omite la sección de free context si está vacía', () => {
    const out = buildBusinessFactsBlock({ ...sampleFacts, freeContext: '' }, 'X');
    expect(out).not.toContain('Contexto general:');
  });

  it('omite la sección de hechos si no hay ninguno', () => {
    const out = buildBusinessFactsBlock({ facts: [], freeContext: 'Algo' }, 'X');
    expect(out).not.toContain('Hechos clave');
    expect(out).toContain('Algo');
  });
});

describe('buildOpenJobsBlock', () => {
  it('devuelve cadena vacía si hay 0 ó 1 otros jobs', () => {
    expect(buildOpenJobsBlock([])).toBe('');
    expect(
      buildOpenJobsBlock([
        { id: 'a', summary: 's', openedAt: new Date('2026-05-01') },
      ]),
    ).toBe('');
  });

  it('lista los jobs cuando hay 2 o más', () => {
    const out = buildOpenJobsBlock([
      { id: 'a', summary: 'sillón verde', openedAt: new Date('2026-05-01') },
      { id: 'b', summary: 'cabecera', openedAt: new Date('2026-05-10') },
    ]);
    expect(out).toContain('JOBS ABIERTOS MÚLTIPLES');
    expect(out).toContain('a');
    expect(out).toContain('sillón verde');
    expect(out).toContain('cabecera');
  });
});

describe('buildHoursBlock', () => {
  const cfgDisabled: Pick<Config, 'hours'> = {
    hours: { enabled: false, timezone: 'America/Mexico_City', schedule: {}, outOfHoursNotice: '' },
  };
  const cfgEnabled: Pick<Config, 'hours'> = {
    hours: {
      enabled: true,
      timezone: 'America/Mexico_City',
      schedule: {
        mon: ['09:00', '19:00'],
        tue: ['09:00', '19:00'],
        wed: ['09:00', '19:00'],
        thu: ['09:00', '19:00'],
        fri: ['09:00', '19:00'],
        sat: ['10:00', '14:00'],
        sun: null,
      },
      outOfHoursNotice: 'Fuera de horario, te respondo mañana.',
    },
  };

  it('devuelve cadena vacía si hours.enabled=false', () => {
    expect(buildHoursBlock(cfgDisabled as Config, new Date('2026-05-25T20:00:00-06:00'))).toBe('');
  });

  it('reconoce dentro de horario y NO sugiere out-of-hours', () => {
    // Lunes 11:00 hora local CDMX (UTC-6)
    const out = buildHoursBlock(cfgEnabled as Config, new Date('2026-05-25T17:00:00Z'));
    expect(out).toContain('HORARIO ACTUAL');
    expect(out).toContain('dentro de horario');
    expect(out).not.toContain('Fuera de horario');
  });

  it('reconoce fuera de horario y sugiere el aviso', () => {
    // Lunes 22:00 hora local CDMX (UTC-6)
    const out = buildHoursBlock(cfgEnabled as Config, new Date('2026-05-26T04:00:00Z'));
    expect(out).toContain('fuera de horario');
    expect(out).toContain('Fuera de horario, te respondo mañana.');
  });

  it('reconoce día cerrado (schedule = null) como fuera de horario', () => {
    // Domingo 12:00 hora local CDMX
    const out = buildHoursBlock(cfgEnabled as Config, new Date('2026-05-24T18:00:00Z'));
    expect(out).toContain('fuera de horario');
  });
});
