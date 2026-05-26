import { describe, it, expect } from 'vitest';
import { getByPath, setByPath, hasPath } from '../../src/lib/path';

describe('getByPath', () => {
  it('devuelve valor en path simple', () => {
    expect(getByPath({ a: 1 }, 'a')).toBe(1);
  });
  it('devuelve valor en path anidado', () => {
    expect(getByPath({ a: { b: { c: 2 } } }, 'a.b.c')).toBe(2);
  });
  it('devuelve undefined si el path no existe', () => {
    expect(getByPath({ a: 1 }, 'b.c')).toBeUndefined();
  });
  it('no falla con objetos vacíos', () => {
    expect(getByPath({}, 'a.b')).toBeUndefined();
  });
});

describe('setByPath', () => {
  it('escribe valor en path simple sin mutar el original', () => {
    const obj = { a: 1 };
    const out = setByPath(obj, 'b', 2);
    expect(out).toEqual({ a: 1, b: 2 });
    expect(obj).toEqual({ a: 1 });
  });
  it('escribe en path anidado creando objetos intermedios', () => {
    const out = setByPath({}, 'a.b.c', 5);
    expect(out).toEqual({ a: { b: { c: 5 } } });
  });
  it('sobreescribe valor existente', () => {
    const out = setByPath({ a: { b: 1 } }, 'a.b', 2);
    expect(out).toEqual({ a: { b: 2 } });
  });
});

describe('hasPath', () => {
  it('detecta path existente con valor null', () => {
    expect(hasPath({ a: { b: null } }, 'a.b')).toBe(true);
  });
  it('detecta path inexistente', () => {
    expect(hasPath({ a: 1 }, 'a.b')).toBe(false);
  });
});
