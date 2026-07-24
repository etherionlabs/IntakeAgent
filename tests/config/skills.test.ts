import { describe, it, expect } from 'vitest';
import { loadSkills, loadProfile } from '../../src/config/loader';
import { buildSkillsBlock } from '../../src/agent/prompt';
import type { LoadedSkill } from '../../src/config/schema';

describe('loadSkills', () => {
  it('carga la skill de ventas desde la biblioteca', async () => {
    const skills = await loadSkills(['ventas']);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('ventas');
    expect(skills[0].title.length).toBeGreaterThan(0);
    expect(skills[0].instructions.length).toBeGreaterThan(0);
  });

  it('omite (sin lanzar) una skill inexistente', async () => {
    const skills = await loadSkills(['ventas', 'no-existe-xyz']);
    expect(skills.map((s) => s.name)).toEqual(['ventas']);
  });

  it('devuelve vacío para lista vacía', async () => {
    expect(await loadSkills([])).toEqual([]);
  });
});

describe('perfil wrapping + skills', () => {
  it('resuelve la skill "ventas" referenciada en prompt-vars', async () => {
    const p = await loadProfile('./profiles/wrapping');
    expect(p.promptVars.skills).toContain('ventas');
    expect(p.skills.map((s) => s.name)).toContain('ventas');
  });
});

describe('buildSkillsBlock', () => {
  const skill: LoadedSkill = {
    name: 'ventas',
    title: 'Venta consultiva',
    description: 'Cerrar sin presionar.',
    instructions: '- Descubre la necesidad.\n- Habla en beneficios.',
  };

  it('vacío cuando no hay skills', () => {
    expect(buildSkillsBlock([])).toBe('');
  });

  it('renderiza título e instrucciones bajo un encabezado de técnicas', () => {
    const block = buildSkillsBlock([skill]);
    expect(block).toContain('HABILIDADES');
    expect(block).toContain('## Venta consultiva');
    expect(block).toContain('Habla en beneficios');
    // No debe revelarse al cliente.
    expect(block.toLowerCase()).toContain('no las menciones');
  });
});
