import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Layout CSS', () => {
  let layoutCSS: string;

  beforeAll(() => {
    layoutCSS = readFileSync(resolve(__dirname, '../src/panel/design/layout.css'), 'utf-8');
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

  it('should apply correct grid columns for 3-column layout', () => {
    // Check that page-layout uses the expected grid columns
    expect(layoutCSS).toContain('grid-template-columns: 360px 1fr 340px');
  });

  it('should use flex column for panels', () => {
    expect(layoutCSS).toContain('.panel');
    expect(layoutCSS).toContain('flex-direction: column');
    expect(layoutCSS).toContain('overflow-y: auto');
  });

  it('should hide panel-right at tablet breakpoint', () => {
    expect(layoutCSS).toContain('@media (max-width: 1200px)');
    // Extract tablet breakpoint section and verify panel-right is hidden
    const tabletSection = layoutCSS.substring(
      layoutCSS.indexOf('@media (max-width: 1200px)'),
      layoutCSS.indexOf('@media (max-width: 768px)')
    );
    expect(tabletSection).toContain('.panel-right');
    expect(tabletSection).toContain('display: none');
  });

  it('should transform sidebar to horizontal on mobile', () => {
    expect(layoutCSS).toContain('@media (max-width: 768px)');
    // Extract mobile breakpoint and verify sidebar becomes horizontal
    const mobileSection = layoutCSS.substring(layoutCSS.lastIndexOf('@media'));
    expect(mobileSection).toContain('.sidebar');
    expect(mobileSection).toContain('flex-direction: row');
    expect(mobileSection).toContain('position: relative'); // Should not be sticky
  });
});
