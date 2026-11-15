import { describe, expect, it } from 'vite-plus/test';
import { validateAssembly } from '@brick-workshop/engine';
import type { Brick } from '@brick-workshop/engine';
import { CHUNK, withEdits } from './chunks.ts';
import {
  LOAD_RADIUS,
  UNLOAD_RADIUS,
  chunkAt,
  chunkDistance,
  chunksAround,
  plan,
} from './streaming.ts';
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
