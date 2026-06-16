import { describe, it, expect } from 'vitest';
import {
  NoopDescriber,
  ScriptedDescriber,
  imageMimeFromPath,
} from '../../src/media/describer';
import { buildConversationContext } from '../../src/services/imageDescription';
import type { BatchMessage, HistoryEntry } from '../../src/agent/types';

describe('NoopDescriber', () => {
  it('siempre devuelve null', async () => {
    const d = new NoopDescriber();
    expect(await d.describe(Buffer.from(''), 'image/jpeg', {} as never)).toBeNull();
  });
});

describe('ScriptedDescriber', () => {
  it('devuelve las descripciones en orden y luego null', async () => {
    const d = new ScriptedDescriber(['sillón rojo', null]);
    expect(await d.describe(Buffer.from(''), 'image/jpeg', {} as never)).toBe('sillón rojo');
    expect(await d.describe(Buffer.from(''), 'image/jpeg', {} as never)).toBeNull();
    expect(await d.describe(Buffer.from(''), 'image/jpeg', {} as never)).toBeNull();
  });
});

describe('imageMimeFromPath', () => {
  it('mapea extensiones conocidas', () => {
    expect(imageMimeFromPath('a/b.png')).toBe('image/png');
    expect(imageMimeFromPath('a/b.webp')).toBe('image/webp');
    expect(imageMimeFromPath('a/b.gif')).toBe('image/gif');
    expect(imageMimeFromPath('a/b.jpg')).toBe('image/jpeg');
    expect(imageMimeFromPath('a/b.jpeg')).toBe('image/jpeg');
  });

  it('cae a jpeg para extensiones desconocidas', () => {
    expect(imageMimeFromPath('a/b.bin')).toBe('image/jpeg');
    expect(imageMimeFromPath('sinpunto')).toBe('image/jpeg');
  });
});

describe('buildConversationContext', () => {
  it('incluye historial inbound/outbound y el texto del batch actual', () => {
    const history: HistoryEntry[] = [
      { direction: 'outbound', kind: 'text', body: '¡Hola! ¿En qué te ayudo?', createdAt: '' },
      { direction: 'inbound', kind: 'text', body: 'Quiero retapizar un sillón', createdAt: '' },
    ];
    const batch: BatchMessage[] = [
      { id: 'm1', kind: 'image', body: null },
      { id: 'm2', kind: 'text', body: 'es para la sala' },
    ];
    const out = buildConversationContext(history, batch);
    expect(out).toContain('Asistente: ¡Hola!');
    expect(out).toContain('Cliente: Quiero retapizar un sillón');
    expect(out).toContain('Cliente: es para la sala');
  });

  it('omite entradas vacías y trunca contextos largos', () => {
    const longText = 'x'.repeat(3000);
    const history: HistoryEntry[] = [
      { direction: 'inbound', kind: 'text', body: '', createdAt: '' },
      { direction: 'inbound', kind: 'text', body: longText, createdAt: '' },
    ];
    const out = buildConversationContext(history, []);
    expect(out.length).toBeLessThanOrEqual(1500);
    expect(out).not.toContain('Cliente: \n');
  });
});
