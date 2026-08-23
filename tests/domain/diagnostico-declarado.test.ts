import { describe, it, expect } from 'vitest';
import {
  DIAGNOSIS_FIELDS,
  missingDiscovery,
  updateDiagnosis,
  validateDiagnosisUpdate,
} from '../../src/domain/sales/state';
import { unsetDeclaredFields, validateDeclaredFields } from '../../src/artifact/state';
import { diagnosisSection } from '../../src/domain/sales/render';
import { createEmptyIntakeFromSchema } from '../../src/services/intake';
import type { IntakeField } from '../../src/config/intake-schema';

/**
 * El conocimiento de QUÉ hay que descubrir pasó de estar incrustado en tres `if`
 * a ser una DECLARACIÓN del elemento. Estos tests fijan las dos consecuencias:
 * lo que falta y lo que se valida se derivan de esa declaración, y el texto que
 * ve el modelo no cambió al hacerlo.
 */

const schema = {
  $businessName: 'X',
  $businessDomain: 'y',
  $language: 'es-MX',
  sections: [
    { key: 'client', label: 'Cliente', fields: [{ key: 'name', label: 'Nombre', type: 'string' as const, required: true }] },
  ],
};

const vacio = () => createEmptyIntakeFromSchema(schema);

describe('helpers genéricos del núcleo sobre campos declarados', () => {
  const fields: IntakeField[] = [
    { key: 'a', label: 'campo A', type: 'string', required: true },
    { key: 'n', label: 'campo N', type: 'integer', required: false },
    { key: 'e', label: 'campo E', type: 'enum', required: false, options: ['x', 'y'] },
  ];

  it('lista por etiqueta los declarados que siguen sin valor', () => {
    expect(unsetDeclaredFields(fields, { a: 'hola' })).toEqual(['campo N', 'campo E']);
    expect(unsetDeclaredFields(fields, { a: 'h', n: 3, e: 'x' })).toEqual([]);
  });

  it('trata vacío y null como no capturado', () => {
    expect(unsetDeclaredFields(fields, { a: '', n: null })).toEqual(['campo A', 'campo N', 'campo E']);
  });

  it('valida solo lo presente: una actualización parcial es legítima', () => {
    expect(validateDeclaredFields(fields, { a: 'hola' })).toBeNull();
    expect(validateDeclaredFields(fields, { n: 1.5 })).toMatch(/entero/);
    expect(validateDeclaredFields(fields, { e: 'z' })).toMatch(/options/);
  });
});

describe('el diagnóstico se deriva de su declaración', () => {
  it('lo que falta sale de DIAGNOSIS_FIELDS, no de condiciones fijas', () => {
    expect(missingDiscovery(vacio())).toEqual(DIAGNOSIS_FIELDS.map((f) => f.label));
  });

  it('cada campo descubierto desaparece de la lista', () => {
    let intake = vacio();
    intake = updateDiagnosis(intake, { pain: 'se le moja el techo' }, '2026-03-10T12:00:00Z');
    expect(missingDiscovery(intake)).toEqual([
      'qué le cuesta si NO lo resuelve',
      'qué tan urgente es',
    ]);
    intake = updateDiagnosis(intake, { implication: 'se le pudre la viga', urgency: 'alta' }, '2026-03-10T12:00:00Z');
    expect(missingDiscovery(intake)).toEqual([]);
  });
});

describe('validación del diagnóstico (antes no existía)', () => {
  it('acepta lo que declara el campo', () => {
    expect(validateDiagnosisUpdate({ urgency: 'alta' })).toBeNull();
    expect(validateDiagnosisUpdate({ pain: 'el sillón está roto' })).toBeNull();
  });

  it('rechaza una urgencia fuera de las opciones declaradas', () => {
    expect(validateDiagnosisUpdate({ urgency: 'urgentísimo' as never })).toMatch(/urgency/);
  });

  it('rechaza un texto vacío: el modelo escribía interpretaciones sin que nadie mirara', () => {
    expect(validateDiagnosisUpdate({ pain: '' })).toMatch(/pain/);
  });

  it('una actualización parcial sigue siendo válida', () => {
    expect(validateDiagnosisUpdate({ implication: 'pierde clientes' })).toBeNull();
  });
});

describe('el texto que ve el modelo no cambió', () => {
  it('el bloque vacío es exactamente el de antes', () => {
    expect(diagnosisSection.render(vacio())).toEqual([
      'Diagnóstico de venta:',
      '  ✗ Problema: (sin descubrir)',
      '  ✗ Qué le cuesta no resolverlo: (sin descubrir)',
      '  ✗ Urgencia: (sin descubrir)',
      '  → Te falta descubrir: el problema en sus palabras, qué le cuesta si NO lo resuelve, ' +
        'qué tan urgente es. Descúbrelo con preguntas ANTES de proponer nada, y guárdalo con register_discovery.',
    ]);
  });

  it('el bloque completo tampoco: sin línea de pendientes', () => {
    let intake = vacio();
    intake = updateDiagnosis(
      intake,
      { pain: 'se le calienta el auto', implication: 'se agrieta el interior', urgency: 'media' },
      '2026-03-10T12:00:00Z',
    );
    expect(diagnosisSection.render(intake)).toEqual([
      'Diagnóstico de venta:',
      '  ✓ Problema: se le calienta el auto',
      '  ✓ Qué le cuesta no resolverlo: se agrieta el interior',
      '  ✓ Urgencia: media',
    ]);
  });

  it('una objeción sin resolver se sigue marcando', () => {
    const intake = updateDiagnosis(
      vacio(),
      { objection: { type: 'precio', note: 'lo ve caro' } },
      '2026-03-10T12:00:00Z',
    );
    expect(diagnosisSection.render(intake)).toContain('  ⚠ Objeción (precio): lo ve caro — SIN RESOLVER');
  });
});
