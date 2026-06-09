import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Design System', () => {
  let systemCSS: string;

  beforeAll(() => {
    systemCSS = readFileSync(resolve(__dirname, '../src/panel/design/system.css'), 'utf-8');
  });

  it('should define all required color variables', () => {
    const requiredVars = [
      '--bg-primary',
      '--bg-secondary',
      '--text-primary',
      '--accent',
      '--accent-danger',
      '--accent-success',
      '--brand-primary',
      '--brand-secondary',
    ];

    requiredVars.forEach((variable) => {
      expect(systemCSS).toContain(`${variable}:`);
    });
  });

  it('should define typography scales', () => {
    expect(systemCSS).toContain('--font-size-');
    expect(systemCSS).toContain('--font-weight-');
  });

  it('should define spacing scale', () => {
    expect(systemCSS).toContain('--spacing-');
  });

  it('should define shadow utilities', () => {
    expect(systemCSS).toContain('--shadow-');
  });

  it('should define focus ring variable', () => {
    expect(systemCSS).toContain('--focus-ring:');
  });

  it('should define all component classes', () => {
    const components = ['.btn', '.btn-primary', '.btn-secondary', '.input', '.card'];
    components.forEach((comp) => {
      expect(systemCSS).toContain(comp);
    });
  });

  it('should define component states', () => {
    expect(systemCSS).toContain('.btn:disabled');
    expect(systemCSS).toContain('.input:disabled');
    expect(systemCSS).toContain('.input::placeholder');
  });

  it('should use CSS variables, not hardcoded colors in components', () => {
    // Check that component styles use var() for colors
    expect(systemCSS).toMatch(/\.input:focus[\s\S]*?var\(/);
    expect(systemCSS).not.toMatch(/\.input:focus[\s\S]*?rgba\(37, 99, 235/);
  });
});
