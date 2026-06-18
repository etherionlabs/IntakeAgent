import { describe, it, expect } from 'vitest';
import { extractPhoneFromJid } from '../../../src/adapters/whatsapp/jid';

describe('extractPhoneFromJid', () => {
  it('con sufijo de dispositivo :n', () => {
    expect(extractPhoneFromJid('5215551234567:12@s.whatsapp.net')).toBe('+5215551234567');
  });
  it('sin sufijo', () => {
    expect(extractPhoneFromJid('5215551234567@s.whatsapp.net')).toBe('+5215551234567');
  });
  it('jid vacío o sin dígitos → null', () => {
    expect(extractPhoneFromJid('')).toBeNull();
    expect(extractPhoneFromJid('@s.whatsapp.net')).toBeNull();
  });
});
