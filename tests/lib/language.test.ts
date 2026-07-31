import { describe, it, expect } from 'vitest';
import { detectLanguage, langFromLocale } from '../../src/lib/language';

/**
 * El sesgo importa más que el acierto: ante la duda NO se cambia de idioma.
 * Saludar en español a un angloparlante lo corrige el modelo en el turno
 * siguiente; saludar en inglés a un tapicero de Guadalajara porque escribió
 * "ok" es peor y pasa más veces.
 */
describe('detección de idioma del primer mensaje', () => {
  it('reconoce el español corriente', () => {
    expect(detectLanguage('Hola, necesito una cotización para tapizar un sillón', 'en')).toBe('es');
    expect(detectLanguage('buenas, cuanto cuesta el servicio', 'en')).toBe('es');
  });

  it('una sola tilde o eñe basta: no se escribe así en inglés', () => {
    expect(detectLanguage('mañana', 'en')).toBe('es');
    expect(detectLanguage('¿precio?', 'en')).toBe('es');
  });

  it('reconoce el inglés corriente', () => {
    expect(detectLanguage('Hi, how much does this cost for my business?', 'es')).toBe('en');
    expect(detectLanguage("Hello, I'm interested in the partner program", 'es')).toBe('en');
  });

  it('sin evidencia se queda con el idioma del negocio', () => {
    expect(detectLanguage('', 'es')).toBe('es');
    expect(detectLanguage(null, 'es')).toBe('es');
    // Una foto sin texto: no hay nada que mirar.
    expect(detectLanguage(undefined, 'en')).toBe('en');
    // Palabras que existen en los dos idiomas no inclinan la balanza.
    expect(detectLanguage('ok', 'es')).toBe('es');
    expect(detectLanguage('no', 'es')).toBe('es');
    expect(detectLanguage('123 456', 'es')).toBe('es');
  });

  it('«hola» no se confunde con inglés ni «hi» con español', () => {
    expect(detectLanguage('hola', 'en')).toBe('es');
    expect(detectLanguage('hi', 'es')).toBe('en');
  });

  it('el idioma del negocio sale del locale del intake', () => {
    expect(langFromLocale('es-MX')).toBe('es');
    expect(langFromLocale('en-US')).toBe('en');
    expect(langFromLocale(undefined)).toBe('es');
  });
});
