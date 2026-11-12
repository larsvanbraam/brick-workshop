import { describe, expect, it } from 'vite-plus/test';
import { smoothAssembly, validateAssembly, voxelizeShapes, fillVoxelModel } from './index.ts';
import { createExampleRegistry } from './examples/registry.ts';
import type { Assembly, Brick } from './index.ts';

const brick = (id: string, partId: string, x: number, y: number, z: number, color = 72): Brick => ({
  id,
  partId,
  color,
  x,
  y,
  z,
  rotation: 0,
});

describe('smoothAssembly', () => {
  it('runs a curved slope off a step and rounds the open corners on top', () => {
    const assembly: Assembly = {
      name: 'Step',
      bricks: [
        brick('low', '3003', 0, 0, 0),
        brick('back', '3003', 0, 0, 2),
        brick('high', '3003', 0, 3, 2),
      ],
    };
    const result = smoothAssembly(assembly);
    expect(validateAssembly(result.assembly)).toEqual([]);
    // The low brick's two studs lean against the high brick: one curve per column, low side -z.
    const curves = result.added.filter((piece) => piece.partId === '11477');
    expect(curves).toHaveLength(2);
    expect(curves.map(({ x, y, z, rotation }) => ({ x, y, z, rotation }))).toEqual([
      { x: 0, y: 3, z: 0, rotation: 0 },
      { x: 1, y: 3, z: 0, rotation: 0 },
    ]);
    // Every stud on the high brick is an open corner.
    const corners = result.added.filter((piece) => piece.partId === '25269');
    expect(corners.map((piece) => [piece.x, piece.z, piece.rotation]).sort()).toEqual(
      [
        [0, 2, 90],
        [1, 2, 0],
        [0, 3, 180],
        [1, 3, 270],
      ].sort(),
    );
    expect(result.counts).toMatchObject({ curves: 2, corners: 4, accents: 0 });
    expect(assembly.bricks).toHaveLength(3);
  });

  it('swaps outside corners for round pieces in place and keeps their IDs', () => {
    const assembly: Assembly = {
      name: 'Corners',
      bricks: [brick('dot', '3024', 0, 0, 0), brick('pad', '3022', 4, 0, 4)],
    };
    const result = smoothAssembly(assembly);
    expect(validateAssembly(result.assembly)).toEqual([]);
    const byId = new Map(result.assembly.bricks.map((piece) => [piece.id, piece]));
    expect(byId.get('dot')).toMatchObject({ partId: '6141', x: 0, z: 0 });
    expect(byId.get('pad')).toMatchObject({ partId: '7904', x: 4, z: 4 });
    expect(result.swapped.sort()).toEqual(['dot', 'pad']);
    // The round plate's stud gets a round tile, not a square corner.
    expect(result.added.some((piece) => piece.partId === '98138' && piece.x === 0)).toBe(true);
  });

  it('lays flush tiles on one-plate steps and leaves detail parts and other regions alone', () => {
    const assembly: Assembly = {
      name: 'Terrace',
      bricks: [
        brick('base', '3958', 0, 0, 0, 2),
        brick('upper', '3022', 2, 1, 2, 2),
        brick('door', '3579', 10, 0, 0),
      ],
      buildArea: 16,
    };
    const result = smoothAssembly(assembly, { corners: false });
    expect(validateAssembly(result.assembly)).toEqual([]);
    expect(result.counts.tiles).toBeGreaterThan(0);
    // Studs against the 2 x 2 plate are flush tiles, one plate up from the base.
    expect(
      result.added.some(
        (piece) => piece.partId === '3070b' && piece.x === 1 && piece.z === 2 && piece.y === 1,
      ),
    ).toBe(true);
    expect(result.assembly.bricks.find((piece) => piece.id === 'door')).toEqual(assembly.bricks[2]);
    expect(result.added.every((piece) => piece.x < 10)).toBe(true);

    const outside = smoothAssembly(assembly, { region: { minX: 8 } });
    expect(outside.assembly).toBe(assembly);
    expect(outside.added).toEqual([]);
  });

  it('scatters flowers on green tops only when asked', () => {
    const lawn: Assembly = {
      name: 'Lawn',
      bricks: [brick('lawn', '3033', 0, 0, 0, 2)],
      buildArea: 16,
    };
    expect(smoothAssembly(lawn).counts.accents).toBe(0);
    const garden = smoothAssembly(lawn, { accents: true, accentDensity: 1 });
    expect(validateAssembly(garden.assembly)).toEqual([]);
    // Every inner stud of the 6 x 10 plate; the rim is tiled.
    expect(garden.counts.accents).toBe(4 * 8);
    expect(garden.added.filter((piece) => piece.partId === '6141')).toHaveLength(32);
  });

  it('stays valid on a sculpted shape and is deterministic', () => {
    const grid = voxelizeShapes(
      [{ type: 'ellipsoid', center: [8, 0, 8], radii: [7, 4, 6], color: 2 }],
      { buildArea: 16, layerStuds: 1.2 },
    )!;
    const fill = fillVoxelModel(
      {
        name: 'Hill',
        width: grid.width,
        depth: grid.depth,
        layers: grid.layers,
        cells: grid.cells,
      },
      { buildArea: 16, supportGaps: true, details: false },
    );
    const first = smoothAssembly(fill.assembly, { accents: true });
    expect(validateAssembly(first.assembly)).toEqual([]);
    expect(first.counts.slopes + first.counts.curves).toBeGreaterThan(10);
    expect(smoothAssembly(fill.assembly, { accents: true }).assembly).toEqual(first.assembly);
    // A piece limit stops additions but keeps the result valid.
    const limited = smoothAssembly(fill.assembly, { maxPieces: fill.assembly.bricks.length + 5 });
    expect(limited.added.length).toBeLessThanOrEqual(5);
    expect(validateAssembly(limited.assembly)).toEqual([]);
  });

  it('works on pieces standing half a plate up on a baseplate, with flowers on the lawn', () => {
    // A 1-stud wall ring, three courses tall, on a green baseplate.
    const walls: Brick[] = [];
    for (let course = 0; course < 3; course += 1) {
      const y = 0.5 + course * 3;
      const shift = course % 2;
      for (const z of [4, 11])
        for (let x = 4 + shift; x + 4 <= 12 + shift; x += 4)
          walls.push({ ...brick(`w${course}-${z}-${x}`, '3010', x, y, z, 70), rotation: 90 });
      for (const x of [4, 11])
        for (let z = 5; z < 11; z += 3)
          walls.push(brick(`s${course}-${x}-${z}`, '3622', x, y, z, 70));
    }
    const house: Assembly = {
      name: 'House',
      buildArea: 16,
      bricks: [brick('lawn', '3867', 0, 0, 0, 2), ...walls],
    };
    expect(validateAssembly(house)).toEqual([]);
    const result = smoothAssembly(house, { accents: true, accentDensity: 1 });
    expect(validateAssembly(result.assembly)).toEqual([]);
    // Wall tops are tiled, the four outside corners quarter-round.
    expect(result.counts.tiles + result.counts.corners).toBeGreaterThan(20);
    expect(result.added.filter((piece) => piece.partId === '25269').length).toBeGreaterThanOrEqual(
      4,
    );
    expect(result.added.filter((piece) => piece.y === 9.5).length).toBe(28);
    // Flowers stand on the lawn only, never against a wall or on the board's rim.
    const flowers = result.added.filter((piece) => piece.partId === '6141');
    expect(flowers.length).toBeGreaterThan(50);
    for (const flower of flowers) {
      expect(flower.y).toBe(0.5);
      expect(flower.x > 0 && flower.x < 15 && flower.z > 0 && flower.z < 15).toBe(true);
    }
    // No tiles or slopes on the baseplate itself.
    expect(
      result.added.filter((piece) => piece.y === 0.5).every((piece) => piece.partId === '6141'),
    ).toBe(true);
  });

  it('runs the smoothing passes of an example on the parts they select', () => {
    const build = (add: (...args: [string, number, number, number, number]) => void) => {
      add('3003', 72, 0, 0, 0);
      add('3003', 72, 0, 0, 2);
      add('3003', 72, 0, 3, 2);
      add('3003', 4, 6, 0, 0);
    };
    const definition = {
      id: 'rocks',
      name: 'Rocks',
      tags: [],
      expectedPieceCount: 4 + 2 + 4,
      smooth: [{ only: (piece: Brick) => piece.color === 72 }],
      build,
    };
    const rocks = createExampleRegistry([definition]).createAssembly('rocks');
    expect(validateAssembly(rocks)).toEqual([]);
    // Grey rock gets two curves and four corner tiles; the red brick keeps its studs.
    expect(rocks.bricks.filter((piece) => piece.y === 3 && piece.x >= 6)).toEqual([]);
    expect(new Set(rocks.bricks.map((piece) => piece.id)).size).toBe(rocks.bricks.length);
    expect(rocks.bricks.at(-1)!.id).toBe('Rocks-10');
    expect(() =>
      createExampleRegistry([{ ...definition, expectedPieceCount: 4 }]).createAssembly('rocks'),
    ).toThrow('expected 4 pieces, got 10');
  });

  it('leans only on pieces in scope and grows flowers in clusters of one colour', () => {
    const lawn: Assembly = {
      name: 'Garden',
      buildArea: 32,
      bricks: [brick('lawn', '3867', 0, 0, 0, 2), brick('wall', '3003', 6, 0.5, 6)],
    };
    // A lawn pass over a plate beside a grey brick: no green slope climbs the brick.
    const plate: Assembly = {
      name: 'Plate',
      buildArea: 16,
      bricks: [brick('green', '3033', 0, 0, 0, 2), brick('grey', '3003', 2, 1, 2)],
    };
    const leaned = smoothAssembly(plate, { only: (piece) => piece.color === 2 });
    expect(leaned.counts.slopes + leaned.counts.curves).toBe(0);
    expect(
      smoothAssembly(plate).counts.slopes + smoothAssembly(plate).counts.curves,
    ).toBeGreaterThan(0);

    const garden = smoothAssembly(lawn, { accents: true, accentDensity: 0.15 });
    expect(validateAssembly(garden.assembly)).toEqual([]);
    const flowers = garden.added.filter((piece) => piece.partId === '6141');
    expect(flowers.length).toBeGreaterThan(5);
    const colours = new Map<string, Set<number>>();
    for (const flower of flowers) {
      const cell = `${Math.floor(flower.x / 4)},${Math.floor(flower.z / 4)}`;
      colours.set(cell, (colours.get(cell) ?? new Set()).add(flower.color));
    }
    for (const set of colours.values()) expect(set.size).toBe(1);
    // Clumps, not dots: most flowers have another flower next to them.
    const at = new Set(flowers.map((flower) => `${flower.x},${flower.z}`));
    const neighboured = flowers.filter((flower) =>
      [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dz]) => at.has(`${flower.x + dx},${flower.z + dz}`)),
    );
    expect(neighboured.length / flowers.length).toBeGreaterThan(0.6);
  });

  it('returns invalid assemblies unchanged', () => {
    const floating: Assembly = { name: 'Floating', bricks: [brick('up', '3003', 0, 3, 0)] };
    const result = smoothAssembly(floating);
    expect(result.assembly).toBe(floating);
    expect(result.added).toEqual([]);
  });
});
