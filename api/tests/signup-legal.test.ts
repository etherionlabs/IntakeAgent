import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildServer } from '../src/server';
import { cleanupDb, TEST_JWT_SECRET, testPrisma } from './helpers/app';
import type { EmailSender } from '../src/lib/email';

const sink: EmailSender = { async send() {} };
const BASE = { email: 'legal@negocio.com', password: 'pw1234567890', businessName: 'Negocio Legal', industry: 'generico' };

describe('aceptación legal en signup', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  beforeEach(async () => { await cleanupDb(); app = await buildServer({ jwtSecret: TEST_JWT_SECRET, emailSender: sink }); });
  afterAll(async () => { await cleanupDb(); });

  it('sin acceptedTerms → 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: { ...BASE, acceptedWhatsappRisk: true } });
    expect(res.statusCode).toBe(400);
  });

  it('sin acceptedWhatsappRisk → 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: { ...BASE, acceptedTerms: true } });
    expect(res.statusCode).toBe(400);
  });

  it('con ambas → crea una LegalAcceptance por documento con versión, ip y userAgent', async () => {
    const res = await app.inject({
      method: 'POST', url: '/auth/signup',
      headers: { 'user-agent': 'vitest-UA' },
      payload: { ...BASE, acceptedTerms: true, acceptedWhatsappRisk: true },
    });
    expect(res.statusCode).toBe(201);
    const tenantId = res.json().tenantId;
    const rows = await testPrisma.legalAcceptance.findMany({ where: { tenantId } });
    const docs = rows.map((r) => r.document).sort();
    expect(docs).toEqual(['dpa', 'privacy', 'terms', 'whatsapp_policy']);
    const terms = rows.find((r) => r.document === 'terms')!;
    expect(terms.version).toBe('2026-06-18');
    expect(terms.userAgent).toBe('vitest-UA');
  });

  it('atomicidad: email duplicado no deja LegalAcceptance huérfana', async () => {
    await app.inject({ method: 'POST', url: '/auth/signup', payload: { ...BASE, acceptedTerms: true, acceptedWhatsappRisk: true } });
    const before = await testPrisma.legalAcceptance.count();
    const dup = await app.inject({ method: 'POST', url: '/auth/signup', payload: { ...BASE, businessName: 'Otro', acceptedTerms: true, acceptedWhatsappRisk: true } });
    expect(dup.statusCode).toBe(409);
    expect(await testPrisma.legalAcceptance.count()).toBe(before); // no creció
  });
});
