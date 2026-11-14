import { describe, expect, it } from 'vite-plus/test';
import { MAX_PIECES, validateAssembly } from '@brick-workshop/engine';
import { WORLD_SIZE, generateMap, generateWorld } from './generate.ts';
import { LAND_BIOMES } from './map.ts';
import { isPlant } from './plants.ts';

describe('world generation', () => {
  const world = generateWorld(1234);

  it('builds a valid world that is the same every time for a seed', () => {
    expect(validateAssembly(world.assembly)).toEqual([]);
    expect(world.assembly.buildArea).toBe(WORLD_SIZE);
    expect(world.assembly.bricks.length).toBeLessThan(MAX_PIECES);
    const again = generateWorld(1234);
    expect(again.assembly.bricks).toEqual(world.assembly.bricks);
  });

  it('makes an island: sea all round the edge, land with trees inside', () => {
    const map = generateMap(1234);
    for (let i = 0; i < WORLD_SIZE; i++) {
      expect(map.biomes[i]).toBe('sea');
      expect(map.biomes[(WORLD_SIZE - 1) * WORLD_SIZE + i]).toBe('sea');
    }
    const land = map.biomes.filter((biome) => LAND_BIOMES.has(biome)).length;
    expect(land).toBeGreaterThan(WORLD_SIZE * WORLD_SIZE * 0.25);
    const trees = new Set(
      world.assembly.bricks
        .filter((brick) => brick.id.startsWith('tree'))
        .map((brick) => brick.id.split('-')[0]),
    );
    expect(trees.size).toBeGreaterThan(8);
  });

  it('starts the player on dry, open land', () => {
    const map = generateMap(1234);
    const index = Math.floor(world.spawn.z) * WORLD_SIZE + Math.floor(world.spawn.x);
    expect(LAND_BIOMES.has(map.biomes[index])).toBe(true);
    expect(map.biomes[index]).not.toBe('rock');
    expect(map.water[index]).toBe(0);
  });

  it('keeps every ground piece apart from the plants', () => {
    for (const brick of world.assembly.bricks)
      expect(world.terrain.has(brick.id)).toBe(!isPlant(brick));
  });

  it('varies the biomes from island to island', () => {
    const found = new Set<string>();
    for (const seed of [1, 2, 3, 5]) for (const biome of generateMap(seed).biomes) found.add(biome);
    for (const biome of ['meadow', 'forest', 'desert', 'marsh', 'snow', 'river'])
      expect(found).toContain(biome);
  });

  it('runs rivers from the hills to the sea, their water never climbing', () => {
    let rivers = 0;
    for (const seed of [1, 2, 3]) {
      const map = generateMap(seed);
      for (const course of map.rivers) {
        rivers++;
        const end = course[course.length - 1];
        expect(map.biomes[end.z * WORLD_SIZE + end.x]).toBe('sea');
        let surface = Infinity;
        for (const { x, z } of course) {
          const water = map.water[z * WORLD_SIZE + x];
          if (!water) continue;
          expect(water).toBeLessThanOrEqual(surface);
          surface = water;
        }
      }
    }
    expect(rivers).toBeGreaterThan(2);
  });

  it('shapes a different island for a different seed', () => {
    const other = generateMap(99);
    expect(Buffer.from(other.heights).equals(Buffer.from(generateMap(1234).heights))).toBe(false);
  });
});
