import { describe, expect, it } from 'vitest';
import { CHECKS, cosine, renderScore, targetDesigns } from './example-score.ts';
import type { Score } from './example-score.ts';

const GOOD: Score = {
  id: 'good',
  pieces: 1000,
  designs: 90,
  smallShare: 0.5,
  detailShare: 0.06,
  roofSlopes: 0.3,
  mainColors: 9,
  platesPerBrick: 1,
  wallRelief: 0.2,
  plantShare: 0.03,
  plantDesigns: 6,
  nearest: { id: 'other', similarity: 0.5 },
};

describe('example score', () => {
  it('scales the variety target with size, within 40 to 150 designs', () => {
    expect(targetDesigns(300)).toBe(40);
    expect(targetDesigns(1000)).toBe(80);
    expect(targetDesigns(5000)).toBe(150);
  });

  it('measures how alike two part mixes are', () => {
    const a = new Map([
      ['3001', 4],
      ['3004', 2],
    ]);
    expect(cosine(a, a)).toBeCloseTo(1);
    expect(cosine(a, new Map([['3039', 3]]))).toBe(0);
    expect(cosine(a, new Map())).toBe(0);
  });

  it('passes a varied, detailed build', () => {
    expect(CHECKS.every((check) => check.pass(GOOD) !== false)).toBe(true);
    expect(renderScore(GOOD)).toContain('all checks pass');
  });

  it('flags a flat, copied build and says how to fix it', () => {
    const flat: Score = {
      ...GOOD,
      designs: 30,
      smallShare: 0.2,
      detailShare: 0,
      roofSlopes: 0.05,
      wallRelief: 0.02,
      plantShare: 0,
      plantDesigns: 0,
      nearest: { id: 'other', similarity: 0.95 },
    };
    const failed = CHECKS.filter((check) => check.pass(flat) === false).map((check) => check.key);
    expect(failed).toEqual(['variety', 'small', 'detail', 'roof', 'relief', 'plants', 'distinct']);
    const text = renderScore(flat);
    expect(text).toContain('LOW');
    expect(text).toContain('fix:');
  });

  it('skips the roof check when the build has no real top', () => {
    const noRoof = { ...GOOD, roofSlopes: undefined };
    expect(CHECKS.find((check) => check.key === 'roof')!.pass(noRoof)).toBeUndefined();
  });
});
