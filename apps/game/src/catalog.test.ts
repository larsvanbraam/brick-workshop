import { describe, expect, it } from 'vite-plus/test';
import { getPart } from '@brick-workshop/engine';
import { placementFor } from './build.ts';
import {
  categoryOf,
  colorsFor,
  getSnap,
  isPlaceable,
  nextRotation,
  placeableParts,
} from './catalog.ts';
import { STARTER_HOTBAR } from './hotbar.ts';

describe('the brick box', () => {
  it('offers the parts that stand on studs, and leaves out what needs a partner', () => {
    expect(placeableParts().length).toBeGreaterThan(200);
    for (const slot of STARTER_HOTBAR) expect(isPlaceable(slot.partId)).toBe(true);
    // Glass needs its frame, a bar needs a clip.
    expect(isPlaceable('60601')).toBe(false);
    expect(isPlaceable('30374')).toBe(false);
  });

  it('sits plants half a stud over, where their receivers are', () => {
    expect(getSnap('3001', 0)).toEqual({ dx: 0, dz: 0 });
    expect(getSnap('6064', 0)).toEqual({ dx: 0.5, dz: 0.5 });
    const aim = {
      brick: { id: 'g', partId: '3020', color: 2, x: 0, y: 0, z: 0, rotation: 0 as const },
      face: 'top' as const,
      x: 5.2,
      y: 1,
      z: 5.2,
    };
    const bush = placementFor(aim, { partId: '6064', color: 2, rotation: 0 }, 'b', 32, {
      dx: 0.5,
      dz: 0.5,
    });
    expect(bush.x % 1).toBe(0.5);
    expect(bush.z % 1).toBe(0.5);
  });

  it('turns only to rotations a part can be placed in', () => {
    expect(nextRotation('3001', 0)).toBe(90);
    expect(nextRotation('3001', 270)).toBe(0);
  });

  it('offers the colours a part really comes in', () => {
    const colors = colorsFor('3001');
    expect(colors.length).toBeGreaterThan(5);
    expect(colors).toContain(4);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('sorts every part into a category', () => {
    expect(categoryOf(getPart('3001'))).toBe('bricks');
    expect(categoryOf(getPart('3020'))).toBe('plates');
    expect(categoryOf(getPart('3039'))).toBe('slopes');
    expect(categoryOf(getPart('6064'))).toBe('plants');
  });
});
