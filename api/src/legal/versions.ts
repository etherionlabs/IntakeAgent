/**
 * Versiones vigentes de los documentos legales (Fase 6). Se registran en
 * LegalAcceptance al aceptar. Subir una versión aquí dispara la re-aceptación.
 * NOTA: los textos son borradores de ingeniería; deben validarse con abogado de
 * la jurisdicción elegida antes de cobrar (decisión abierta §9.1).
 */
export const LEGAL_DOCUMENTS = ['terms', 'privacy', 'dpa', 'whatsapp_policy'] as const;
export type LegalDocument = (typeof LEGAL_DOCUMENTS)[number];

export const LEGAL_VERSIONS: Record<LegalDocument, string> = {
  terms: '2026-06-18',
  privacy: '2026-06-18',
  dpa: '2026-06-18',
  whatsapp_policy: '2026-06-18',
};
