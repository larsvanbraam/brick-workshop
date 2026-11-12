import { describe, expect, it } from 'vite-plus/test';
import { smoothAssembly, validateAssembly, voxelizeShapes, fillVoxelModel } from './index.ts';
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

  it('returns invalid assemblies unchanged', () => {
    const floating: Assembly = { name: 'Floating', bricks: [brick('up', '3003', 0, 3, 0)] };
    const result = smoothAssembly(floating);
    expect(result.assembly).toBe(floating);
    expect(result.added).toEqual([]);
  });
});
