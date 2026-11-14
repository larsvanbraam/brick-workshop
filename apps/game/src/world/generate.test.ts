import { describe, expect, it } from 'vite-plus/test';
import { MAX_PIECES, validateAssembly } from '@brick-workshop/engine';
import { WORLD_SIZE, generateMap, generateWorld } from './generate.ts';

describe('world generation', () => {
  const world = generateWorld(1234);

  it('builds a valid world that is the same every time for a seed', () => {
    expect(validateAssembly(world.assembly)).toEqual([]);
    expect(world.assembly.buildArea).toBe(WORLD_SIZE);
    expect(world.assembly.bricks.length).toBeLessThan(MAX_PIECES);
    const again = generateWorld(1234);
    expect(again.assembly.bricks).toEqual(world.assembly.bricks);
  });

  it('makes an island: sea all round the edge, land with meadows and trees inside', () => {
    const map = generateMap(1234);
    for (let i = 0; i < WORLD_SIZE; i++) {
      expect(map.biomes[i]).toBe('sea');
      expect(map.biomes[(WORLD_SIZE - 1) * WORLD_SIZE + i]).toBe('sea');
    }
    const meadow = map.biomes.filter((biome) => biome === 'meadow').length;
    expect(meadow).toBeGreaterThan(WORLD_SIZE * WORLD_SIZE * 0.15);
    const trees = new Set(
      world.assembly.bricks
        .filter((brick) => brick.id.startsWith('tree'))
        .map((brick) => brick.id.split('-')[0]),
    );
    expect(trees.size).toBeGreaterThan(8);
  });

  it('starts the player on dry land', () => {
    const map = generateMap(1234);
    const { x, z } = world.spawn;
    expect(map.biomes[Math.floor(z) * WORLD_SIZE + Math.floor(x)]).toBe('meadow');
  });

  it('keeps every ground piece apart from the trees', () => {
    for (const brick of world.assembly.bricks)
      expect(world.terrain.has(brick.id)).toBe(!brick.id.startsWith('tree'));
  });

  it('shapes a different island for a different seed', () => {
    const other = generateMap(99);
    expect(Buffer.from(other.heights).equals(Buffer.from(generateMap(1234).heights))).toBe(false);
  });
});
