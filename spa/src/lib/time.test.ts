import { test, expect } from 'vitest';
import { relativeTime, absoluteTime } from './time';

const NOW = new Date('2026-07-29T15:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test('minutos, horas y días', () => {
  expect(relativeTime(ago(30 * 1000), NOW)).toBe('ahora');
  expect(relativeTime(ago(5 * MIN), NOW)).toBe('hace 5 min');
  expect(relativeTime(ago(3 * HOUR), NOW)).toBe('hace 3 h');
  expect(relativeTime(ago(DAY), NOW)).toBe('ayer');
  expect(relativeTime(ago(5 * DAY), NOW)).toBe('hace 5 días');
});

test('meses y años en singular y plural', () => {
  expect(relativeTime(ago(35 * DAY), NOW)).toBe('hace 1 mes');
  expect(relativeTime(ago(90 * DAY), NOW)).toBe('hace 3 meses');
  expect(relativeTime(ago(400 * DAY), NOW)).toBe('hace 1 año');
  expect(relativeTime(ago(800 * DAY), NOW)).toBe('hace 2 años');
});

test('tolera vacío, nulo y fechas inválidas', () => {
  expect(relativeTime(null, NOW)).toBe('');
  expect(relativeTime(undefined, NOW)).toBe('');
  expect(relativeTime('no-es-fecha', NOW)).toBe('');
  expect(absoluteTime('no-es-fecha')).toBe('');
  expect(absoluteTime(null)).toBe('');
});

test('una fecha futura no dice "hace"', () => {
  expect(relativeTime(new Date(NOW.getTime() + HOUR).toISOString(), NOW)).toBe('ahora');
});
