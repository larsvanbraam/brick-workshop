import { describe, expect, it } from 'vite-plus/test';
import { MAX_BUILD_AREA, MAX_VOXEL_LAYERS, describeVoxelModel, fillVoxelModel, getPart, styleVoxelFill, validateAssembly } from './index.ts';
import type { VoxelModel } from './index.ts';

/** A hollow rectangular room: walls one stud thick, `layers` bricks tall. */
function room(width: number, depth: number, layers: number, color = 4): VoxelModel {
  const cells: (number | null)[] = [];
  for (let layer = 0; layer < layers; layer += 1)
    for (let z = 0; z < depth; z += 1)
      for (let x = 0; x < width; x += 1)
        cells.push(x === 0 || z === 0 || x === width - 1 || z === depth - 1 ? color : null);
  return { name: 'Room', width, depth, layers, cells };
}

describe('voxel shell filling', () => {
  it('fills every wall cell with valid, centered bricks and staggers courses', () => {
    const model = room(10, 8, 4);
    const fill = fillVoxelModel(model);
    expect(validateAssembly(fill.assembly)).toEqual([]);
    expect(fill.skippedCells).toBe(0);
    expect(fill.origin).toEqual({ x: 3, z: 4 });
    expect(fill.assembly.buildArea).toBe(16);
    const covered = fill.assembly.bricks.reduce((sum, brick) => {
      const part = getPart(brick.partId);
      return sum + part.width * part.depth;
    }, 0);
    expect(covered).toBe(fill.filledCells);
    // Stacking identical footprints straight up is penalised, so some course must differ.
    const footprint = (y: number) =>
      fill.assembly.bricks.filter((brick) => brick.y === y).map(({ x, z, partId, rotation }) => `${x},${z},${partId},${rotation}`);
    expect(footprint(3)).not.toEqual(footprint(0));
  });

  it('grows the board to fit, skips unsupported overhangs and honours color policy', () => {
    const wide = room(40, 6, 1);
    expect(fillVoxelModel(wide).assembly.buildArea).toBe(40);
    const floating: VoxelModel = {
      name: 'Floating', width: 4, depth: 1, layers: 2, cells: [4, null, null, null, null, null, null, 4],
    };
    const fill = fillVoxelModel(floating);
    expect(fill.assembly.bricks).toHaveLength(1);
    expect(fill.skippedCells).toBe(1);
    expect(fill.addedCells).toBe(0);
    const onlyOneByOne = fillVoxelModel(room(4, 4, 1), { colorAllowed: (partId) => partId === '3005' });
    expect(onlyOneByOne.assembly.bricks.every((brick) => brick.partId === '3005')).toBe(true);
    expect(fillVoxelModel(room(6, 6, 6), { maxPieces: 5 }).assembly.bricks.length).toBeLessThanOrEqual(5);
  });

  it('widens overhangs toward the course below and slopes the exposed step edges', () => {
    // A 45-degree slope: each layer's cell sits diagonally on the one below.
    const slope: VoxelModel = {
      name: 'Slope', width: 4, depth: 1, layers: 3,
      cells: [4, null, null, null, null, 4, null, null, null, null, 4, null],
    };
    const fill = fillVoxelModel(slope);
    expect(validateAssembly(fill.assembly)).toEqual([]);
    expect(fill.skippedCells).toBe(0);
    expect(fill.addedCells).toBe(2);
    expect(fill.details).toEqual({ slopes: 1, windows: 0, doors: 0, railings: 0 });
    expect(fill.assembly.bricks.map(({ x, y, partId, rotation }) => [x - fill.origin.x, y, partId, rotation])).toEqual([
      [0, 0, '3005', 0],
      // High side (studs) toward +x, where the next course sits.
      [0, 3, '3040b', 90],
      [1, 6, '3004', 90],
    ]);
    // Slope hints limit slopes to roofs running that way, e.g. not a stepped gable wall.
    const gable = fillVoxelModel({ ...slope, slopes: slope.cells.map(() => 'z-') });
    expect(gable.details.slopes).toBe(0);
  });

  it('frames openings with the nearest standard window or door frame', () => {
    // An 8-wide, 8-tall wall along x with a 2 x 2 window and a 3-wide door at the bottom.
    const wall: VoxelModel = {
      name: 'Wall', width: 8, depth: 1, layers: 8,
      cells: Array.from({ length: 64 }, () => 15),
      openings: [
        { kind: 'window', x: 5, z: 0, layer: 2, width: 2, height: 2, axis: 'x' },
        { kind: 'door', x: 0, z: 0, layer: 0, width: 3, height: 4, axis: 'x' },
      ],
    };
    const fill = fillVoxelModel(wall);
    expect(validateAssembly(fill.assembly)).toEqual([]);
    expect(fill.details).toEqual({ slopes: 0, windows: 1, doors: 1, railings: 0 });
    const frame = (id: string) => fill.assembly.bricks.find((brick) => brick.partId === id)!;
    expect([frame('60592').x - fill.origin.x, frame('60592').y, frame('60592').rotation]).toEqual([5, 6, 90]);
    expect([frame('3579').x - fill.origin.x, frame('3579').y]).toEqual([0, 0]);
    expect(fill.skippedCells).toBe(0);
  });

  it('drops a door to the floor of its doorway and props a floor slab over a hollow', () => {
    // Two end posts carry a floor slab at layer 3; above it a wall with a doorway at x 1-3
    // under wall from layer 8 up, whose lower half was hidden (by a railing) when it was found.
    const cells = Array.from({ length: 6 * 11 }, (_, cell) => {
      const [x, layer] = [cell % 6, Math.floor(cell / 6)];
      if (layer < 3) return x === 0 || x === 5 ? 15 : null;
      if (layer === 3 || layer >= 8) return 15;
      return x >= 1 && x <= 3 ? null : 15;
    });
    const fill = fillVoxelModel({
      name: 'Balcony', width: 6, depth: 1, layers: 11, cells,
      openings: [{ kind: 'door', x: 1, z: 0, layer: 6, width: 3, height: 2, axis: 'x' }],
    });
    expect(validateAssembly(fill.assembly)).toEqual([]);
    const door = fill.assembly.bricks.find((brick) => brick.partId === '3579')!;
    expect([door.x - fill.origin.x, door.y]).toEqual([1, 12]);
    expect(fill.skippedCells).toBe(0);
  });

  it('does not frame gaps in a railing, which have no wall above their top rail', () => {
    // Posts on every other stud at layer 2 under a two-course top rail, then open sky.
    const railing: VoxelModel = {
      name: 'Railing', width: 8, depth: 1, layers: 6,
      cells: Array.from({ length: 48 }, (_, cell) => {
        const [x, layer] = [cell % 8, Math.floor(cell / 8)];
        if (layer === 5) return null;
        return layer === 2 && x % 2 ? null : 0;
      }),
      openings: [{ kind: 'window', x: 3, z: 0, layer: 2, width: 1, height: 1, axis: 'x' }],
    };
    expect(fillVoxelModel(railing).details.windows).toBe(0);
    // The same gap under a full wall is a window.
    const wall = { ...railing, cells: railing.cells.map((cell, index) => (index >= 40 ? 0 : cell)) };
    expect(fillVoxelModel(wall).details.windows).toBe(1);
  });

  it('turns posts with gaps under open air into a railing piece', () => {
    // A solid course, then posts on every other stud of a 9-stud line, then nothing.
    const balcony: VoxelModel = {
      name: 'Balcony', width: 9, depth: 1, layers: 3,
      cells: Array.from({ length: 27 }, (_, cell) => {
        const [x, layer] = [cell % 9, Math.floor(cell / 9)];
        if (layer === 0) return 0;
        return layer === 1 && x % 2 === 0 ? 0 : null;
      }),
    };
    const fill = fillVoxelModel(balcony);
    expect(validateAssembly(fill.assembly)).toEqual([]);
    expect(fill.details.railings).toBe(2);
    expect(fill.assembly.bricks.filter((brick) => brick.partId === '3633')).toHaveLength(2);
  });

  it('finishes a fill like a set: masonry, caps and a baseplate, all still valid', () => {
    const fill = fillVoxelModel(room(8, 8, 3, 72));
    const styled = styleVoxelFill(fill, room(8, 8, 3, 72));
    expect(validateAssembly(styled.assembly)).toEqual([]);
    expect(styled.style.baseplates).toBe(1);
    expect(styled.style.caps).toBeGreaterThan(0);
    expect(styled.assembly.bricks.some((brick) => brick.partId === '3867')).toBe(true);
    // Everything that stood on the ground now stands on the baseplate.
    expect(styled.assembly.bricks.filter((brick) => brick.y === 0).every((brick) => brick.partId === '3867')).toBe(true);
    expect(styled.assembly.bricks.filter((brick) => brick.partId !== '3867').length).toBeGreaterThan(fill.assembly.bricks.length);
  });

  it('textures walls with short, mixed bricks and shaded stone', () => {
    const plain = fillVoxelModel(room(16, 16, 6, 72));
    const textured = fillVoxelModel(room(16, 16, 6, 72), { texture: true });
    expect(validateAssembly(textured.assembly)).toEqual([]);
    const length = (brick: { partId: string }) => Math.max(getPart(brick.partId).width, getPart(brick.partId).depth);
    expect(plain.assembly.bricks.some((brick) => length(brick) > 4)).toBe(true);
    expect(textured.assembly.bricks.every((brick) => length(brick) <= 4)).toBe(true);
    expect(new Set(textured.assembly.bricks.map((brick) => brick.partId)).size).toBeGreaterThanOrEqual(3);
    const styled = styleVoxelFill(textured, room(16, 16, 6, 72));
    expect(validateAssembly(styled.assembly)).toEqual([]);
    const colors = new Set(styled.assembly.bricks.filter((brick) => brick.partId !== '3867').map((brick) => brick.color));
    expect(colors.has(72) && colors.has(71)).toBe(true);
    // The same model always textures the same way.
    expect(styleVoxelFill(fillVoxelModel(room(16, 16, 6, 72), { texture: true }), room(16, 16, 6, 72)).assembly).toEqual(
      styled.assembly,
    );
  });

  it('supports left-out cells inside the building and brackets an eave, never posts outside', () => {
    // An 11 x 11 room, three bricks tall, with a full slab on top and an eave one stud out.
    const [w, d, layers] = [13, 13, 4];
    const cells = Array.from({ length: w * d * layers }, (_, cell) => {
      const [x, z, layer] = [cell % w, Math.floor(cell / w) % d, Math.floor(cell / (w * d))];
      const inside = x >= 1 && x <= 11 && z >= 1 && z <= 11;
      const wall = inside && (x === 1 || x === 11 || z === 1 || z === 11);
      if (layer < 3) return wall ? 72 : null;
      return x === 0 && z === 6 ? 70 : inside ? 70 : null;
    });
    const model = { name: 'Slab', width: w, depth: d, layers, cells };
    const plain = fillVoxelModel(model);
    const supported = fillVoxelModel(model, { supportGaps: true });
    expect(validateAssembly(supported.assembly)).toEqual([]);
    expect(plain.skippedCells).toBeGreaterThan(supported.skippedCells);
    // The eave stud outside the walls gets a corbel bonded into the wall course below it, a
    // bracket under the eave, not a post down to the ground.
    expect(supported.skippedCells).toBe(0);
    expect(
      supported.assembly.bricks.some((brick) => brick.x - supported.origin.x === 0 && brick.y < 6),
    ).toBe(false);
  });

  it('continues a roof course through a short break, as a roof runs under a chimney', () => {
    const course: VoxelModel = { name: 'Roof', width: 1, depth: 5, layers: 1, cells: [70, 70, null, 70, 70] };
    const covered = (fill: ReturnType<typeof fillVoxelModel>) =>
      fill.assembly.bricks.reduce((sum, brick) => sum + getPart(brick.partId).width * getPart(brick.partId).depth, 0);
    // Without slope hints it is just two walls; with them it is a roof course and is closed.
    expect(covered(fillVoxelModel(course))).toBe(4);
    expect(covered(fillVoxelModel({ ...course, slopes: course.cells.map(() => 'x-') }))).toBe(5);
  });

  it('corbels a gap into the nearest wall course instead of building a column to the ground', () => {
    // A grey chimney stack at x = 3, and a roof course at layer 3 spanning x 0-2 over nothing.
    const cells = Array.from({ length: 4 * 4 }, (_, cell) => {
      const [x, layer] = [cell % 4, Math.floor(cell / 4)];
      if (x === 3) return 72;
      return layer === 3 ? 70 : null;
    });
    const model: VoxelModel = { name: 'Chimney', width: 4, depth: 1, layers: 4, cells };
    expect(fillVoxelModel(model).skippedCells).toBeGreaterThan(0);
    const fill = fillVoxelModel(model, { supportGaps: true });
    expect(validateAssembly(fill.assembly)).toEqual([]);
    expect(fill.skippedCells).toBe(0);
    // The support is one course of grey bonded into the chimney, not a column from the ground.
    const support = fill.assembly.bricks.filter((brick) => brick.y < 9 && brick.x - fill.origin.x < 3);
    expect(support.every((brick) => brick.y === 6 && brick.color === 72)).toBe(true);
  });

  it('rejects malformed models', () => {
    expect(() => fillVoxelModel({ name: 'x', width: 2, depth: 2, layers: 1, cells: [4] })).toThrow('cell count');
    expect(() => fillVoxelModel(room(MAX_BUILD_AREA + 1, 4, 1))).toThrow(`${MAX_BUILD_AREA}-stud board`);
    expect(() => fillVoxelModel(room(4, 4, MAX_VOXEL_LAYERS + 1))).toThrow(`${MAX_VOXEL_LAYERS} brick layers`);
  });

  it('describes layers compactly with a color legend and collapsed repeats', () => {
    const text = describeVoxelModel(room(3, 3, 3, 15), { x: 6, z: 6 });
    expect(text).toContain('Legend: a=White (15); . = empty.');
    expect(text).toContain('x = 6 + column');
    expect(text).toContain('Layers 0-2:\naaa\na.a\naaa');
  });

  it('run-length encodes large models and cuts layers that still do not fit', () => {
    const big = room(64, 64, 20);
    const plain = describeVoxelModel(big, { x: 0, z: 0 }, Infinity);
    expect(plain.length).toBeGreaterThan(4000);
    const encoded = describeVoxelModel(big, { x: 0, z: 0 }, 4000);
    expect(encoded.length).toBeLessThanOrEqual(4000);
    expect(encoded).toContain('run-length encoded');
    expect(encoded).toContain('Layers 0-19:\na64\na.62a');
    // Alternate the layers so none collapse, and the budget runs out part way.
    const striped: VoxelModel = { ...big, cells: big.cells.map((cell, index) => (cell !== null && Math.floor(index / 4096) % 2 ? 15 : cell)) };
    const cut = describeVoxelModel(striped, { x: 0, z: 0 }, 4000);
    expect(cut.length).toBeLessThanOrEqual(4000);
    expect(cut).toMatch(/Layers \d+-19 omitted/);
  });
});
