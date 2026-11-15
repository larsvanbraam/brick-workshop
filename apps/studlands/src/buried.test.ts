import { describe, expect, it } from 'vite-plus/test';
import type { Brick } from '@brick-workshop/engine';
import { buriedPieces } from './buried.ts';
import { generateChunk } from './world/generate.ts';
import { Terrain } from './world/terrain.ts';

const brick = (x: number, y: number, z: number, partId = '3005', color = 71): Brick => ({
  id: `${partId}:${x},${y},${z}`,
  partId,
  color,
  x,
  y,
  z,
  rotation: 0,
});

/** A cube of 1 x 1 bricks, three studs a side and three bricks high, on the bottom of the world. */
function cube(y0 = 0) {
  const pieces: Brick[] = [];
  for (let y = y0; y < y0 + 9; y += 3)
    for (let z = 0; z < 3; z++) for (let x = 0; x < 3; x++) pieces.push(brick(x, y, z));
  return pieces;
}
const hidden = (pieces: readonly Brick[]) => {
  const buried = buriedPieces(pieces);
  return pieces.filter((piece) => buried.has(piece)).map((piece) => piece.id);
};

describe('buried pieces', () => {
  it('leaves out the pieces boxed in on every side', () => {
    // The middle column's top brick shows; the two below are covered, the lowest by the world.
    expect(hidden(cube())).toEqual(['3005:1,0,1', '3005:1,3,1']);
  });

  it('draws a piece off the bottom of the world that nothing holds from below', () => {
    expect(hidden(cube(3))).toEqual(['3005:1,6,1']);
  });

  it('draws whatever an edit uncovers', () => {
    const pieces = cube().filter((piece) => piece.id !== '3005:1,3,0');
    expect(hidden(pieces)).toEqual(['3005:1,0,1']);
  });

  it('counts neither see-through nor shaped pieces as cover', () => {
    const glass = cube().map((piece) =>
      piece.id === '3005:1,6,1' ? { ...piece, color: 43 } : piece,
    );
    expect(hidden(glass)).toEqual(['3005:1,0,1']);
    const sloped = cube().map((piece) =>
      piece.id === '3005:1,6,1' ? brick(1, 6, 1, '54200') : piece,
    );
    expect(hidden(sloped)).toEqual(['3005:1,0,1']);
  });

  it('buries nothing in a list with no solid piece', () => {
    expect(hidden([brick(4, 0, 0, '3062b')])).toEqual([]);
  });

  it('leaves out much of a generated chunk, and only plain solid pieces', () => {
    const terrain = new Terrain(1234);
    let total = 0;
    let drawn = 0;
    let ms = 0;
    for (const [cx, cz] of [
      [0, 0],
      [3, -2],
      [-4, 5],
      [6, 6],
    ]) {
      const { bricks } = generateChunk(1234, cx, cz, terrain, Infinity);
      const start = performance.now();
      const buried = buriedPieces(bricks);
      ms = Math.max(ms, performance.now() - start);
      total += bricks.length;
      drawn += bricks.length - buried.size;
      // Never a plant, a slope or a piece of water.
      for (const piece of buried)
        expect([
          '3005',
          '3004',
          '3622',
          '3010',
          '3009',
          '3008',
          '2456',
          '3001',
          '3002',
          '3003',
          '3023b',
          '3022',
          '3020',
          '3795',
        ]).toContain(piece.partId);
    }
    console.log(`buried: drew ${drawn} of ${total} pieces, slowest chunk ${ms.toFixed(1)} ms`);
    expect(drawn).toBeLessThan(total);
  });
});
