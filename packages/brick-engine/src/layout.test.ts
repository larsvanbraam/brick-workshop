import { describe, expect, it } from 'vite-plus/test';
import { getConnectionSites, validateAssembly } from './index.ts';
import type { Brick, Rotation } from './index.ts';
import { bottomUp, reflectToFront } from './examples/layout.ts';
import type { ExampleBrickAdder } from './examples/types.ts';

/** An adder that collects pieces as bricks. */
function collect() {
  const bricks: Brick[] = [];
  const add: ExampleBrickAdder = (partId, color, x, y, z, rotation = 0, facing, upsideDown) => {
    bricks.push({
      id: `p${bricks.length + 1}`,
      partId,
      color,
      x,
      y,
      z,
      rotation,
      ...(facing ? { facing } : {}),
      ...(upsideDown ? { upsideDown: true as const } : {}),
    });
  };
  return { bricks, add };
}

/** Where a piece's first top stud or bottom receiver lands at a turn, from its corner. */
function site(partId: string, rotation: Rotation, surface: 'top' | 'bottom') {
  const [first] = getConnectionSites(
    { id: '', partId, color: 0, x: 0, y: 0, z: 0, rotation },
    surface,
  );
  return first;
}

describe('reflectToFront', () => {
  it('keeps handed pieces connected in every turn', () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      const { bricks, add } = collect();
      const front = reflectToFront(add, 16);
      // A sprig hung on a 1 x 1 plate by its one receiver.
      front('3024', 2, 4, 0, 4);
      const receiver = site('32607', rotation, 'bottom');
      front('32607', 10, 4.5 - receiver.x, 1, 4.5 - receiver.z, rotation);
      // A corner slope on a 2 x 2 brick, with a plate on its one stud.
      front('3003', 72, 9, 0, 9);
      front('3045', 320, 9, 3, 9, rotation);
      const stud = site('3045', rotation, 'top');
      front('3024', 4, 9 + stud.x - 0.5, 6, 9 + stud.z - 0.5);
      expect(validateAssembly({ name: 'Reflected', buildArea: 16, bricks })).toEqual([]);
      // Reflected in z, the slope's stud is where the plan's stud reflects to.
      const slope = bricks[3];
      const [moved] = getConnectionSites(slope, 'top');
      expect(moved.z).toBe(16 - (9 + stud.z));
      expect(moved.x).toBe(9 + stud.x);
    }
  });
});

describe('bottomUp', () => {
  it('hands pieces on bottom-up, keeping drawing order within a height', () => {
    const { bricks, add } = collect();
    const ordered = bottomUp(add);
    ordered.add('3005', 4, 0, 3, 0);
    ordered.add('87087', 72, 2, 0, 2);
    ordered.add('3005', 1, 0, 0, 0);
    ordered.add('3005', 2, 4, 0, 4);
    expect(bricks).toEqual([]);
    ordered.flush();
    expect(bricks.map((brick) => [brick.color, brick.y])).toEqual([
      [72, 0],
      [1, 0],
      [2, 0],
      [4, 3],
    ]);
    expect(validateAssembly({ name: 'Stack', bricks })).toEqual([]);
  });
});
