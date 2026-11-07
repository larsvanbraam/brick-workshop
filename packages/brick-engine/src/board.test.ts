import { describe, expect, it } from 'vite-plus/test';
import {
  createExampleAssembly,
  footprint,
  getBaseplateJoins,
  hasStudConnection,
  isFloorPlate,
  layPlateFloor,
  validateAssembly,
} from './index.ts';
import type { Brick } from './index.ts';

/** Groups of pieces held together by stud connections. */
function connectedGroups(bricks: readonly Brick[]) {
  const group = new Map(bricks.map((brick) => [brick.id, brick.id]));
  const root = (id: string): string => (group.get(id) === id ? id : root(group.get(id)!));
  for (const lower of bricks)
    for (const upper of bricks)
      if (hasStudConnection(lower, upper)) group.set(root(lower.id), root(upper.id));
  return new Set(bricks.map((brick) => root(brick.id))).size;
}

describe('plate floors', () => {
  it('lays one 16 x 16 plate for a single module', () => {
    const floor = layPlateFloor({ x: 0, z: 0, width: 16, depth: 16 }, 2)!;
    expect(floor.height).toBe(1);
    expect(floor.bricks.map((brick) => brick.partId)).toEqual(['91405']);
  });

  it('interlocks two layers so the whole board holds together', () => {
    const floor = layPlateFloor({ x: 0, z: 0, width: 48, depth: 32 }, 2)!;
    expect(floor.height).toBe(2);
    expect(validateAssembly({ name: 'Floor', buildArea: 48, bricks: floor.bricks })).toEqual([]);
    const [bottom, top] = [0, 1].map((y) => floor.bricks.filter((brick) => brick.y === y));
    // Both layers cover the whole area.
    const area = (bricks: Brick[]) =>
      bricks.reduce((sum, brick) => sum + footprint(brick).width * footprint(brick).depth, 0);
    expect(area(bottom)).toBe(48 * 32);
    expect(area(top)).toBe(48 * 32);
    expect(top.every((brick) => brick.partId === '91405')).toBe(true);
    // Every top seam and corner sits over the middle of a bottom plate.
    for (const plate of top)
      for (const [x, z] of [
        [plate.x, plate.z],
        [plate.x + 16, plate.z + 16],
      ])
        if (x > 0 && x < 48 && z > 0 && z < 32)
          expect(
            bottom.some(
              (below) =>
                below.x < x &&
                x < below.x + footprint(below).width &&
                below.z < z &&
                z < below.z + footprint(below).depth,
            ),
          ).toBe(true);
    expect(connectedGroups(floor.bricks)).toBe(1);
  });

  it('refuses areas that are not whole modules or colors a plate is not allowed in', () => {
    expect(layPlateFloor({ x: 0, z: 0, width: 24, depth: 16 }, 2)).toBeNull();
    expect(
      layPlateFloor({ x: 0, z: 0, width: 32, depth: 32 }, 2, {
        colorAllowed: (partId) => partId !== '41539',
      }),
    ).toBeNull();
  });

  it('builds the museum on a floor that lifts as one piece', () => {
    const floor = createExampleAssembly('nordiska-museet').bricks.filter(isFloorPlate);
    expect(floor).toHaveLength(16 + 25);
    expect(connectedGroups(floor)).toBe(1);
  });

  it('builds the larger museum on a full 128-stud floor that lifts as one piece', () => {
    const floor = createExampleAssembly('nordiska-museet-2').bricks.filter(isFloorPlate);
    expect(floor).toHaveLength(64 + 81);
    expect(connectedGroups(floor)).toBe(1);
  });
});

describe('baseplate seams', () => {
  const plate = (id: string, x: number): Brick => ({
    id,
    partId: '3867',
    color: 2,
    x,
    y: 0,
    z: 0,
    rotation: 0,
  });

  it('reports baseplates side by side as loose until a piece spans the seam', () => {
    const loose = getBaseplateJoins({
      name: 'Board',
      buildArea: 32,
      bricks: [plate('a', 0), plate('b', 16)],
    });
    expect(loose.seams).toHaveLength(1);
    expect(loose.joined).toBe(false);
    const tie: Brick = { id: 'tie', partId: '3020', color: 2, x: 14, y: 0.5, z: 6, rotation: 90 };
    const tied = getBaseplateJoins({
      name: 'Board',
      buildArea: 32,
      bricks: [plate('a', 0), plate('b', 16), tie],
    });
    expect(tied.seams[0].ties).toEqual(['tie']);
    expect(tied.joined).toBe(true);
  });
});
