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
});
