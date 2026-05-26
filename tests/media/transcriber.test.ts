import { describe, it, expect } from 'vitest';
import {
  NoopTranscriber,
  ScriptedTranscriber,
} from '../../src/media/transcriber';

describe('NoopTranscriber', () => {
  it('devuelve null siempre', async () => {
    const t = new NoopTranscriber();
    const out = await t.transcribe(Buffer.from('x'), 'audio/ogg');
    expect(out).toBeNull();
  });
});

describe('ScriptedTranscriber', () => {
  it('devuelve la siguiente cadena del script', async () => {
    const t = new ScriptedTranscriber(['hola', 'qué tal']);
    expect(await t.transcribe(Buffer.from(''), 'audio/ogg')).toBe('hola');
    expect(await t.transcribe(Buffer.from(''), 'audio/ogg')).toBe('qué tal');
  });

  it('devuelve null cuando se acaba el script', async () => {
    const t = new ScriptedTranscriber(['hola']);
    await t.transcribe(Buffer.from(''), 'audio/ogg');
    expect(await t.transcribe(Buffer.from(''), 'audio/ogg')).toBeNull();
  });
});
