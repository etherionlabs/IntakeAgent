import { describe, it, expect } from 'vitest';
import { buildVisionInstructions, type DescribeContext } from '../../src/media/describer';

describe('buildVisionInstructions', () => {
  it('sin contexto produce un prompt genérico válido', () => {
    const out = buildVisionInstructions();
    expect(out).toContain('describe fotos');
    expect(out).toContain('No inventes');
    // No debe filtrar líneas de contexto vacías.
    expect(out).not.toContain('Negocio:');
    expect(out).not.toContain('Estado actual');
  });

  it('inyecta negocio, datos a recoger, sesión y conversación', () => {
    const ctx: DescribeContext = {
      businessName: 'Tapicería Demo',
      businessDomain: 'tapicería de muebles',
      businessContext: 'Trabajamos muebles de sala.',
      collects: '- Trabajo: Mueble; Tela',
      sessionState: 'ya sabemos — Mueble: sillón; aún falta — Tela preferida',
      recentConversation: 'Asistente: ¿me mandas foto de la tela? | Cliente: aquí está',
    };
    const out = buildVisionInstructions(ctx);
    expect(out).toContain('Tapicería Demo — tapicería de muebles');
    expect(out).toContain('Trabajamos muebles de sala.');
    expect(out).toContain('Mueble; Tela');
    expect(out).toContain('aún falta — Tela preferida');
    expect(out).toContain('¿me mandas foto de la tela?');
  });
});
