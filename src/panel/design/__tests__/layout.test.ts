import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Layout CSS', () => {
  let layoutCSS: string;

  beforeAll(() => {
    layoutCSS = readFileSync(resolve(__dirname, '../layout.css'), 'utf-8');
  });

  it('should define sidebar layout', () => {
    expect(layoutCSS).toContain('.sidebar');
    expect(layoutCSS).toContain('64px');
  });

  it('should define main grid layout', () => {
    expect(layoutCSS).toContain('.container');
    expect(layoutCSS).toContain('grid');
  });

  it('should define responsive breakpoints', () => {
    expect(layoutCSS).toContain('@media (max-width: 1200px)');
    expect(layoutCSS).toContain('@media (max-width: 768px)');
  });

  it('should define panel layouts', () => {
    expect(layoutCSS).toContain('.panel');
  });
});
