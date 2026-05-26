import { describe, it, expect } from 'vitest';
import { renderUserMessage } from '../../src/agent/prompt';
import type { BatchMessage } from '../../src/agent/types';

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
