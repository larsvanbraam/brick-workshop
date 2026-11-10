import { describe, expect, it } from 'vite-plus/test';
import { MAX_VOXEL_LAYERS, fillVoxelModel, validateAssembly } from '@brick-workshop/engine';
import { keepMainObjects, maxModelWidth, voxelizeTriangles } from '../src/model-reference.ts';
import type { ModelTriangles } from '../src/model-reference.ts';

type Point = [number, number, number];
const RED = [0.8, 0.1, 0.1];
const WHITE = [0.95, 0.95, 0.95];
const palette = [
  { id: 4, hex: '#c91a09' },
  { id: 15, hex: '#ffffff' },
];

/** Single-face (zero-thickness) quads, like SketchUp walls, as triangles. */
function triangles(
  quads: { corners: [Point, Point, Point, Point]; color: number[]; unpainted?: boolean }[],
): ModelTriangles {
  const positions: number[] = [];
  const colors: number[] = [];
  const unpainted: number[] = [];
  for (const { corners: [a, b, c, d], color, unpainted: flag } of quads) {
    positions.push(...a, ...b, ...c, ...a, ...c, ...d);
    colors.push(...color, ...color);
    unpainted.push(flag ? 1 : 0, flag ? 1 : 0);
  }
  return {
    name: 'House',
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    unpainted: new Uint8Array(unpainted),
  };
}

/** A closed 4 x 4 x 4.8 box (four bricks tall at width 4) with a floor halfway up. */
function closedBox(inside: number[], floor: number[]): Parameters<typeof triangles>[0] {
  const [s, h] = [4, 4.8];
  const quad = (corners: [Point, Point, Point, Point], color = WHITE) => ({ corners, color });
  return [
    // The front wall faces out (normal -z); the lining behind it faces in (+z).
    quad([[0, 0, 0], [0, h, 0], [s, h, 0], [s, 0, 0]]),
    quad([[0, 0, s], [s, 0, s], [s, h, s], [0, h, s]]),
    quad([[0, 0, 0], [0, 0, s], [0, h, s], [0, h, 0]]),
    quad([[s, 0, 0], [s, 0, s], [s, h, s], [s, h, 0]]),
    quad([[0, 0, 0], [s, 0, 0], [s, 0, s], [0, 0, s]]),
    quad([[0, h, 0], [s, h, 0], [s, h, s], [0, h, s]]),
    quad([[0, 2.4, 0], [s, 2.4, 0], [s, 2.4, s], [0, 2.4, s]], floor),
    quad([[0, 0, 0.01], [s, 0, 0.01], [s, h, 0.01], [0, h, 0.01]], inside),
  ];
}

// A 10 x 6 unit house with 3.6-unit white walls and a red gable roof rising to 6 units.
const house = triangles([
  { corners: [[0, 0, 0], [10, 0, 0], [10, 3.6, 0], [0, 3.6, 0]], color: WHITE },
  { corners: [[0, 0, 6], [10, 0, 6], [10, 3.6, 6], [0, 3.6, 6]], color: WHITE },
  { corners: [[0, 0, 0], [0, 0, 6], [0, 3.6, 6], [0, 3.6, 0]], color: WHITE },
  { corners: [[10, 0, 0], [10, 0, 6], [10, 3.6, 6], [10, 3.6, 0]], color: WHITE },
  { corners: [[0, 3.6, 0], [10, 3.6, 0], [10, 6, 3], [0, 6, 3]], color: RED },
  { corners: [[0, 3.6, 6], [10, 3.6, 6], [10, 6, 3], [0, 6, 3]], color: RED },
]);

describe('3D model reference conversion', () => {
  it('samples zero-thickness walls and roofs into colored brick layers', () => {
    const model = voxelizeTriangles(house, { widthStuds: 10, palette });
    expect([model.width, model.depth, model.layers]).toEqual([11, 7, 6]);
    const cell = (layer: number, x: number, z: number) => model.cells[(layer * model.depth + z) * model.width + x];
    expect(cell(0, 0, 0)).toBe(15);
    expect(cell(0, 5, 3)).toBeNull();
    expect(cell(5, 5, 3)).toBe(4);
    expect(cell(5, 5, 0)).toBeNull();
  });

  it('marks which way the roof runs down and slopes its step edges', () => {
    const model = voxelizeTriangles(house, { widthStuds: 10, palette });
    const hints = new Set(model.slopes!.filter(Boolean));
    expect(hints).toEqual(new Set(['z-', 'z+']));
    const fill = fillVoxelModel(model);
    expect(fill.details.slopes).toBeGreaterThan(0);
    expect(validateAssembly(fill.assembly)).toEqual([]);
  });

  it('finds a window recessed into a wall and frames it', () => {
    const quad = (corners: [Point, Point, Point, Point]) => ({ corners, color: WHITE });
    const [w, d, h] = [12, 8, 8.4];
    const box = triangles([
      // Front wall with a 2 x 2.4 hole, closed by a pane set 0.6 back.
      quad([[0, 0, 0], [4.5, 0, 0], [4.5, h, 0], [0, h, 0]]),
      quad([[6.5, 0, 0], [w, 0, 0], [w, h, 0], [6.5, h, 0]]),
      quad([[4.5, 0, 0], [6.5, 0, 0], [6.5, 1.8, 0], [4.5, 1.8, 0]]),
      quad([[4.5, 4.2, 0], [6.5, 4.2, 0], [6.5, h, 0], [4.5, h, 0]]),
      quad([[4.5, 1.8, 0.6], [6.5, 1.8, 0.6], [6.5, 4.2, 0.6], [4.5, 4.2, 0.6]]),
      quad([[0, 0, d], [w, 0, d], [w, h, d], [0, h, d]]),
      quad([[0, 0, 0], [0, 0, d], [0, h, d], [0, h, 0]]),
      quad([[w, 0, 0], [w, 0, d], [w, h, d], [w, h, 0]]),
      quad([[0, h, 0], [w, h, 0], [w, h, d], [0, h, d]]),
    ]);
    const model = voxelizeTriangles(box, { widthStuds: 12, palette });
    expect(model.openings).toEqual([
      { kind: 'window', x: 5, z: 0, layer: 2, width: 2, height: 2, axis: 'x', facing: 'z-' },
    ]);
    const fill = fillVoxelModel(model);
    expect(fill.details.windows).toBe(1);
    expect(validateAssembly(fill.assembly)).toEqual([]);
  });

  it('leaves the clear parts of a see-through texture open, like a painted lattice', () => {
    // An 8-wide wall whose texture is opaque on its left half and clear on its right half.
    const wall = triangles([{ corners: [[0, 0, 0], [8, 0, 0], [8, 2.4, 0], [0, 2.4, 0]], color: WHITE }]);
    const uvs = new Float32Array([0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0]);
    const textured = {
      ...wall,
      uvs,
      masks: new Int16Array([0, 0]),
      alphaMasks: [{ width: 2, height: 1, opaque: new Uint8Array([1, 0]) }],
    };
    const filled = (model: ReturnType<typeof voxelizeTriangles>) =>
      Array.from({ length: model.width }, (_, x) => model.cells[x] !== null);
    expect(filled(voxelizeTriangles(wall, { widthStuds: 8, palette })).every(Boolean)).toBe(true);
    const open = filled(voxelizeTriangles(textured, { widthStuds: 8, palette }));
    expect(open.slice(0, 4).every(Boolean)).toBe(true);
    expect(open.slice(5).some(Boolean)).toBe(false);
  });

  it('produces a brick shell the engine accepts', () => {
    const fill = fillVoxelModel(voxelizeTriangles(house, { widthStuds: 10, palette }));
    expect(validateAssembly(fill.assembly)).toEqual([]);
    expect(fill.assembly.bricks.length).toBeGreaterThan(10);
    expect(fill.assembly.bricks.some((brick) => brick.color === 4)).toBe(true);
  });

  it('colors cells from the outward faces and drops cells no outside air reaches', () => {
    const box = triangles(closedBox(RED, RED));
    const model = voxelizeTriangles(box, { widthStuds: 4, palette });
    const cell = (layer: number, x: number, z: number) => model.cells[(layer * model.depth + z) * model.width + x];
    // The red lining faces into the box, so the front wall keeps its white outside.
    expect(cell(1, 2, 0)).toBe(15);
    // The red floor inside the closed box is hollowed out, unless hollow is off.
    expect(cell(2, 2, 2)).toBeNull();
    const solid = voxelizeTriangles(box, { widthStuds: 4, palette, hollow: false });
    expect(solid.cells[(2 * solid.depth + 2) * solid.width + 2]).toBe(4);
  });

  it('lets any painted face win over unpainted ones in the same cell', () => {
    const wall = triangles([
      { corners: [[0, 0, 0], [4, 0, 0], [4, 1, 0], [0, 1, 0]], color: WHITE, unpainted: true },
      { corners: [[0, 0, 0.1], [4, 0, 0.1], [4, 1, 0.1], [0, 1, 0.1]], color: RED },
    ]);
    const model = voxelizeTriangles(wall, { widthStuds: 4, palette });
    expect(model.cells.filter((cell) => cell !== null).every((cell) => cell === 4)).toBe(true);
  });

  it('leaves out distant objects and ground planes much larger than the model', () => {
    const scene = triangles([
      // A 2 x 2 x 6 tower, a cap touching it, a figure 20 units away and a 200-unit ground plane.
      { corners: [[0, 0, 0], [2, 0, 0], [2, 6, 0], [0, 6, 0]], color: WHITE },
      { corners: [[0, 6, 0], [2, 6, 0], [1, 7, 0], [1, 7, 0]], color: RED },
      { corners: [[20, 0, 0], [20.5, 0, 0], [20.5, 1.8, 0], [20, 1.8, 0]], color: RED },
      { corners: [[-100, 0, -100], [100, 0, -100], [100, 0, 100], [-100, 0, 100]], color: WHITE },
      // A base slab just under the tower stays.
      { corners: [[-0.5, 0, -0.1], [2.5, 0, -0.1], [2.5, 0, 0.1], [-0.5, 0, 0.1]], color: RED },
    ]);
    const objects = new Uint32Array([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
    const kept = keepMainObjects(scene, objects, ['tower', 'cap', 'figure', 'ground', 'base']);
    expect(kept.omitted).toEqual(['figure', 'ground']);
    expect(kept.colors.length / 3).toBe(6);
  });

  it('refuses models that would be too tall at the chosen width, and finds one that fits', () => {
    const tower = triangles([{ corners: [[0, 0, 0], [1, 0, 0], [1, 10, 0], [0, 10, 0]], color: WHITE }]);
    expect(() => voxelizeTriangles(tower, { widthStuds: 16, palette })).toThrow('Use a smaller width');
    const width = maxModelWidth(tower, 16);
    expect(voxelizeTriangles(tower, { widthStuds: width, palette }).layers).toBeLessThanOrEqual(MAX_VOXEL_LAYERS);
    expect(() => voxelizeTriangles(tower, { widthStuds: width + 1, palette })).toThrow('Use a smaller width');
  });
});
