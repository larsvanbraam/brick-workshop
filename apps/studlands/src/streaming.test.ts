import { describe, expect, it } from 'vite-plus/test';
import { validateAssembly } from '@brick-workshop/engine';
import type { Brick } from '@brick-workshop/engine';
import { CHUNK, withEdits } from './chunks.ts';
import {
  DISTANCES,
  FAR_RADIUS,
  LOAD_RADIUS,
  UNLOAD_RADIUS,
  chunkAt,
  chunkDistance,
  chunksAround,
  isDistanceName,
  plan,
} from './streaming.ts';
import { farChunk } from './world/far.ts';
import { generateChunk } from './world/generate.ts';
import { Terrain } from './world/terrain.ts';

describe('streaming', () => {
  it('finds the chunk of any stud, below zero too', () => {
    expect(chunkAt(0, 0)).toEqual([0, 0]);
    expect(chunkAt(31.5, 32)).toEqual([0, 1]);
    expect(chunkAt(-0.5, -33)).toEqual([-1, -2]);
  });

  it('asks for the chunks round the walker nearest first, and drops only those well away', () => {
    const around = chunksAround(10, -4, LOAD_RADIUS);
    expect(around).toHaveLength((LOAD_RADIUS * 2 + 1) ** 2);
    expect(around[0]).toBe('10,-4');
    const loaded = new Set([
      '10,-4',
      '11,-4',
      `${10 + UNLOAD_RADIUS},-4`,
      `${11 + UNLOAD_RADIUS},-4`,
    ]);
    const { request, unload } = plan(10, -4, loaded);
    expect(request).not.toContain('10,-4');
    expect(request[0]).toMatch(/^(9|10|11),(-5|-4|-3)$/);
    expect(unload).toEqual([`${11 + UNLOAD_RADIUS},-4`]);
    expect(chunkDistance('13,-1', 10, -4)).toBe(3);
  });
});

describe('far chunks', () => {
  it('plans a ring of them past the chunks loaded in full', () => {
    const { request, farRequest, farUnload } = plan(0, 0, new Set(), new Set(['9,0', '3,0']));
    expect(request).toHaveLength((LOAD_RADIUS * 2 + 1) ** 2);
    for (const key of farRequest) {
      expect(chunkDistance(key, 0, 0)).toBeGreaterThan(LOAD_RADIUS);
      expect(chunkDistance(key, 0, 0)).toBeLessThanOrEqual(FAR_RADIUS);
    }
    expect(farRequest).not.toContain('3,0');
    expect(farUnload).toEqual(['9,0']);
  });

  it('reaches as far as the render distance picked', () => {
    for (const distance of Object.values(DISTANCES)) {
      const { request, farRequest } = plan(0, 0, new Set(), new Set(), distance);
      expect(request).toHaveLength((distance.load * 2 + 1) ** 2);
      expect(farRequest).toHaveLength((distance.far * 2 + 1) ** 2 - request.length);
    }
    // Shortening the reach drops what is now too far, a chunk past the new edge.
    const loaded = new Set(['0,0', '2,0', '3,0']);
    const far = new Set(['4,0', '5,0']);
    const { unload, farUnload } = plan(0, 0, loaded, far, DISTANCES.short);
    expect(unload).toEqual(['3,0']);
    expect(farUnload).toEqual(['5,0']);
    // Switching to it trims to the reach itself, without the margin.
    const trimmed = plan(0, 0, loaded, far, DISTANCES.short, true);
    expect(trimmed.unload).toEqual(['2,0', '3,0']);
    expect(trimmed.farUnload).toEqual(['4,0', '5,0']);
    expect(isDistanceName('far')).toBe(true);
    expect(isDistanceName('toString')).toBe(false);
  });

  it('draws the same ground the full chunk is built from', () => {
    const terrain = new Terrain(1234);
    const far = farChunk(terrain, 1, 2, 128);
    expect(far.key).toBe('1,2');
    // Six vertices a quad, three numbers each, and one colour and normal per vertex.
    expect(far.positions.length % 18).toBe(0);
    expect(far.normals.length).toBe(far.positions.length);
    expect(far.colors.length).toBe(far.positions.length);
    // Every top sits at its column's surface: the highest point matches the tallest column.
    let top = 0;
    for (let z = 2 * CHUNK; z < 3 * CHUNK; z += 2)
      for (let x = CHUNK; x < 2 * CHUNK; x += 2) {
        const column = terrain.column(x, z);
        top = Math.max(top, Math.max(column.height, column.water));
      }
    let highest = 0;
    for (let index = 1; index < far.positions.length; index += 3)
      highest = Math.max(highest, far.positions[index]);
    expect(highest).toBeGreaterThanOrEqual(top * 1.2 - 1e-4);
    expect(farChunk(new Terrain(1234), 1, 2, 128).positions).toEqual(far.positions);
  });
});

describe('a chunk coming back', () => {
  it('brings back what the player built and leaves out what they took off', () => {
    const piece = (id: string, x: number, z: number): Brick => ({
      id,
      partId: '3003',
      color: 4,
      x,
      y: 9,
      z,
      rotation: 0,
    });
    const generated = [piece('model-1@2,3', 70, 100), piece('model-2@2,3', 72, 100)];
    const back = withEdits('2,3', generated, [
      { op: 'remove', id: 'model-1@2,3', chunk: '2,3' },
      { op: 'add', brick: piece('p-a', 71, 101) },
      // Edits to other chunks are theirs.
      { op: 'add', brick: piece('p-b', 5, 5) },
      { op: 'remove', id: 'model-2@2,3', chunk: '0,0' },
      // A piece put down and taken off again stays gone.
      { op: 'add', brick: piece('p-c', 73, 101) },
      { op: 'remove', id: 'p-c', chunk: '2,3' },
    ]);
    expect(back.map((brick) => brick.id).sort()).toEqual(['model-2@2,3', 'p-a']);
  });
});

describe('a world without edges', () => {
  it('joins chunks far from the start into a valid world', { timeout: 60_000 }, () => {
    // Nine chunks round one well away from the start, below zero on one axis.
    const terrain = new Terrain(4242);
    const bricks: Brick[] = [];
    for (let cz = 6; cz <= 8; cz++)
      for (let cx = -5; cx <= -3; cx++)
        bricks.push(...generateChunk(4242, cx, cz, terrain, Infinity).bricks);
    // Onto a board for the engine, which wants studs from zero; nothing may reach past it.
    const shiftX = 5 * CHUNK + 16;
    const shiftZ = -6 * CHUNK + 16;
    const moved = bricks.map((brick) => ({ ...brick, x: brick.x + shiftX, z: brick.z + shiftZ }));
    const issues = validateAssembly({ name: 'far', bricks: moved, buildArea: 128 });
    expect(issues).toEqual([]);
    expect(bricks.length).toBeGreaterThan(1000);
  });
});
