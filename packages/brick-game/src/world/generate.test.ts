import { describe, expect, it } from 'vite-plus/test';
import { MAX_PIECES, getWorldBounds, validateAssembly } from '@brick-workshop/engine';
import { CHUNK, chunkOf } from '../chunks.ts';
import { WATER_LAYERS, WORLD_SIZE, generateChunk, generateWorld } from './generate.ts';
import { isPlant } from './plants.ts';
import { START, NOISE_WORLD, landformIn, volcanoAt } from './noise-world.ts';
import { LAND_BIOMES, Terrain } from './terrain.ts';
import type { Biome } from './terrain.ts';

/** Every column of the board, as the terrain gives it. */
function board(seed: number) {
  const terrain = new Terrain(seed, NOISE_WORLD);
  const columns = [];
  for (let z = 0; z < WORLD_SIZE; z++)
    for (let x = 0; x < WORLD_SIZE; x++) columns.push({ x, z, ...terrain.column(x, z) });
  return columns;
}

describe('world generation', () => {
  const world = generateWorld(1234, NOISE_WORLD);

  it('builds chunks on their own that join into one valid world', { timeout: 60_000 }, () => {
    expect(validateAssembly(world.assembly)).toEqual([]);
    expect(world.assembly.bricks.length).toBeLessThan(MAX_PIECES);
    expect(new Set(world.assembly.bricks.map((brick) => brick.id)).size).toBe(
      world.assembly.bricks.length,
    );
  });

  // 192187 once grew two crowns into each other across a chunk edge.
  it('joins chunks into a valid world on other seeds too', { timeout: 120_000 }, () => {
    for (const seed of [192187, 42, 9001])
      expect(validateAssembly(generateWorld(seed, NOISE_WORLD).assembly)).toEqual([]);
  });

  it('builds a chunk the same alone as among its neighbours', () => {
    const alone = generateChunk(1234, 1, 2, new Terrain(1234, NOISE_WORLD));
    const together = world.assembly.bricks.filter((brick) => chunkOf(brick) === '1,2');
    expect(alone.bricks).toEqual(together);
  });

  it('keeps each chunk’s ground inside it, and names the chunk in every piece', () => {
    for (const brick of world.assembly.bricks) {
      const [cx, cz] = chunkOf(brick).split(',').map(Number);
      expect(brick.id.endsWith(`@${cx},${cz}`)).toBe(true);
      if (isPlant(brick)) continue;
      const bounds = getWorldBounds(brick);
      expect(bounds.minX).toBeGreaterThanOrEqual(cx * CHUNK - 1e-6);
      expect(bounds.maxX).toBeLessThanOrEqual((cx + 1) * CHUNK + 1e-6);
      expect(bounds.minZ).toBeGreaterThanOrEqual(cz * CHUNK - 1e-6);
      expect(bounds.maxZ).toBeLessThanOrEqual((cz + 1) * CHUNK + 1e-6);
    }
  });

  it('is the same every time for a seed, and different for another', () => {
    expect(generateChunk(1234, 0, 0, new Terrain(1234, NOISE_WORLD))).toEqual(
      generateChunk(1234, 0, 0, new Terrain(1234, NOISE_WORLD)),
    );
    const heights = (seed: number) => board(seed).map((column) => column.height);
    expect(heights(99)).not.toEqual(heights(1234));
  });

  it('starts the player on dry, open land, clear of trees', () => {
    const terrain = new Terrain(1234, NOISE_WORLD);
    const x = Math.floor(world.spawn.x);
    const z = Math.floor(world.spawn.z);
    const column = terrain.column(x, z);
    expect(LAND_BIOMES.has(column.biome)).toBe(true);
    expect(['rock', 'volcanic', 'lava']).not.toContain(column.biome);
    expect(column.water).toBe(0);
    expect(terrain.treesIn(x - 8, z - 8, x + 9, z + 9)).toEqual([]);
  });

  it('keeps land round the start, and grows trees on it', () => {
    const land = board(1234).filter((column) => LAND_BIOMES.has(column.biome)).length;
    expect(land).toBeGreaterThan(WORLD_SIZE * WORLD_SIZE * 0.25);
    const trees = new Set(
      world.assembly.bricks
        .filter((brick) => brick.id.startsWith('tree'))
        .map((brick) => brick.id.replace(/-\d+@/, '@')),
    );
    expect(trees.size).toBeGreaterThan(5);
  });

  it('keeps every ground piece apart from the plants', () => {
    for (const brick of world.assembly.bricks)
      expect(world.terrain.has(brick.id)).toBe(!isPlant(brick));
  });

  it('goes on past the board: the terrain has columns anywhere', () => {
    const terrain = new Terrain(1234, NOISE_WORLD);
    const far = [terrain.column(-500, 300), terrain.column(2000, -40), terrain.column(300, 900)];
    for (const column of far) expect(column.height).toBeGreaterThan(0);
  });

  it('varies the biomes from seed to seed', () => {
    const found = new Set<Biome>();
    for (const seed of [1, 2, 3, 5]) for (const column of board(seed)) found.add(column.biome);
    for (const biome of ['meadow', 'forest', 'desert', 'marsh', 'snow', 'river'] as const)
      expect(found).toContain(biome);
  });

  it('runs rivers along valleys, a layer under their banks', () => {
    let rivers = 0;
    for (const seed of [1, 2, 3])
      for (const column of board(seed)) {
        if (column.biome !== 'river') continue;
        rivers++;
        expect(column.water).toBe(column.height + 1);
      }
    expect(rivers).toBeGreaterThan(30);
  });

  it('raises a volcano in some regions: a black cone over every peak, lava in its crater', () => {
    const volcano = volcanoAt(8, START.x, START.z)!;
    expect(volcano).not.toBeNull();
    const columns = board(8);
    const crater = columns.find((column) => column.x === volcano.x && column.z === volcano.z)!;
    expect(crater.biome).toBe('lava');
    expect(crater.height).toBe(volcano.lake);
    expect(Math.max(...columns.map((column) => column.height))).toBeGreaterThan(15);
    expect(columns.filter((column) => column.biome === 'volcanic').length).toBeGreaterThan(500);
    // Lava runs down out of the crater, past the rim.
    const flows = columns.filter(
      (column) =>
        column.biome === 'lava' && Math.hypot(column.x - volcano.x, column.z - volcano.z) > 12,
    );
    expect(flows.length).toBeGreaterThan(10);
    expect(volcanoAt(2, START.x, START.z)).toBeNull();
  });

  it('keeps volcanoes rare, and raises mountains, plateaus and canyons more often', () => {
    const counts: Record<string, number> = {};
    for (let seed = 0; seed < 10; seed++)
      for (let rx = -10; rx < 10; rx++)
        for (let rz = -10; rz < 10; rz++) {
          const kind = landformIn(seed, rx, rz)?.kind ?? 'none';
          counts[kind] = (counts[kind] ?? 0) + 1;
        }
    expect(counts.volcano / 4000).toBeLessThan(0.05);
    for (const kind of ['mountain', 'plateau', 'canyon'])
      expect(counts[kind]).toBeGreaterThan(counts.volcano * 3);
  });

  it('raises a mountain whose summit is snowy, above the tallest hills', () => {
    const mountain = landformIn(4, 0, 0)!;
    expect(mountain.kind).toBe('mountain');
    const columns = board(4);
    expect(Math.max(...columns.map((column) => column.height))).toBeGreaterThan(15);
    expect(columns.filter((column) => column.biome === 'snow').length).toBeGreaterThan(100);
    expect(volcanoAt(4, START.x, START.z)).toBeNull();
  });

  it('rings a plateau with cliffs: a sheer drop of several layers at its edge', () => {
    expect(landformIn(2, 0, 0)!.kind).toBe('plateau');
    const terrain = new Terrain(2, NOISE_WORLD);
    let faces = 0;
    for (const column of board(2)) {
      const east = terrain.column(column.x + 1, column.z);
      if (!column.water && !east.water && Math.abs(east.height - column.height) >= 4) faces++;
    }
    expect(faces).toBeGreaterThan(20);
  });

  it('cuts a canyon: a river at the floor between stepped walls', () => {
    const canyon = landformIn(3, 0, 0)!;
    expect(canyon.kind).toBe('canyon');
    const columns = board(3).filter(
      (column) => Math.hypot(column.x - canyon.x, column.z - canyon.z) < canyon.radius * 0.6,
    );
    const river = columns.filter((column) => column.biome === 'river');
    expect(river.length).toBeGreaterThan(50);
    for (const column of river) expect(column.height).toBe(WATER_LAYERS);
    expect(columns.filter((column) => column.height === canyon.top).length).toBeGreaterThan(500);
  });

  it('lets some coasts rise straight out of the sea as cliffs', () => {
    let cliffs = 0;
    for (const seed of [1, 2, 3]) {
      const terrain = new Terrain(seed, NOISE_WORLD);
      for (const column of board(seed)) {
        if (column.biome !== 'sea') continue;
        const neighbours = [
          terrain.column(column.x + 1, column.z),
          terrain.column(column.x - 1, column.z),
          terrain.column(column.x, column.z + 1),
          terrain.column(column.x, column.z - 1),
        ];
        if (neighbours.some((other) => other.height >= WATER_LAYERS + 3)) cliffs++;
      }
    }
    expect(cliffs).toBeGreaterThan(20);
  });
});
