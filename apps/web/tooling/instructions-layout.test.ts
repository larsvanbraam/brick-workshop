import { describe, expect, it } from 'vite-plus/test';
import { createExampleAssembly } from '@lego-builder/brick-engine';
import type { Assembly } from '@lego-builder/brick-engine';
import {
  countPages,
  deriveManualTheme,
  getPageDimensions,
  getStepGrid,
  hslToRgb,
} from '../src/instructions/layout.ts';

describe('instruction page layout', () => {
  it('turns pages for landscape', () => {
    expect(getPageDimensions('a4', 'portrait')).toEqual({ width: 210, height: 297 });
    expect(getPageDimensions('a4', 'landscape')).toEqual({ width: 297, height: 210 });
  });

  it('fits steps per page to the paper', () => {
    expect(getStepGrid('a5', 'portrait')).toEqual({ columns: 1, rows: 1 });
    expect(getStepGrid('a5', 'landscape')).toEqual({ columns: 1, rows: 1 });
    expect(getStepGrid('a4', 'landscape')).toEqual({ columns: 2, rows: 1 });
    expect(getStepGrid('a4', 'portrait')).toEqual({ columns: 1, rows: 2 });
    expect(getStepGrid('letter', 'landscape')).toEqual({ columns: 2, rows: 1 });
    expect(getStepGrid('a3', 'landscape')).toEqual({ columns: 3, rows: 2 });
  });

  it('counts covers, step pages and parts list pages', () => {
    // Cover, 50 two-step pages, one parts list page and the back cover.
    expect(countPages(100, 20, 'a4', 'landscape')).toBe(53);
    // A5 holds 16 parts list tiles, so 20 kinds take two pages.
    expect(countPages(100, 20, 'a5', 'portrait')).toBe(1 + 100 + 2 + 1);
  });
});

describe('deriveManualTheme', () => {
  it('tints the manual after the most used colorful brick', () => {
    const red: Assembly = {
      name: 'Red',
      bricks: [
        { id: 'a', partId: '3003', color: 4, x: 0, y: 0, z: 0, rotation: 0 },
        { id: 'b', partId: '3003', color: 4, x: 2, y: 0, z: 0, rotation: 0 },
        { id: 'c', partId: '3003', color: 71, x: 4, y: 0, z: 0, rotation: 0 },
      ],
    };
    const theme = deriveManualTheme(red);
    // Red leads; grey is skipped as colorless.
    const [r, g, b] = theme.frame;
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
    expect(Math.min(...theme.page)).toBeGreaterThan(220);
  });

  it('falls back to blue for colorless builds and is stable', () => {
    const grey: Assembly = {
      name: 'Grey',
      bricks: [{ id: 'a', partId: '3003', color: 71, x: 0, y: 0, z: 0, rotation: 0 }],
    };
    expect(deriveManualTheme(grey).frame).toEqual(hslToRgb(210, 0.6, 0.38));
    const house = createExampleAssembly('courtyard-house');
    expect(deriveManualTheme(house)).toEqual(deriveManualTheme(house));
  });
});
