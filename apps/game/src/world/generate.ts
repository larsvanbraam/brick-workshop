import { fillVoxelModel, smoothAssembly } from '@brick-workshop/engine';
import type { Assembly } from '@brick-workshop/engine';
import { LAND_BIOMES, MAX_LAYERS, WATER_LAYERS, WORLD_SIZE, generateMap } from './map.ts';
import type { WorldMap } from './map.ts';
import { cellColor, waterColor } from './palette.ts';
import { plantIsland } from './plants.ts';

export { WATER_LAYERS, WORLD_SIZE, generateMap };
export type { WorldMap };

export interface World {
  seed: number;
  assembly: Assembly;
  map: WorldMap;
  /** Where to start: a stud on dry land near the middle, in build-grid coordinates. */
  spawn: { x: number; z: number };
  /** IDs of the pieces that form the ground, as opposed to plants and what players add. */
  terrain: ReadonlySet<string>;
}

/**
 * The whole world for a seed: the island as brick layers, the sea, rivers and pools as blue
 * bricks up to their surface, the plants of each biome, then slopes and round corners where the
 * ground steps and flowers in the meadows. Every piece rests on the one below, so the result
 * validates like any build.
 */
export function generateWorld(seed: number): World {
  const map = generateMap(seed);
  const { size, heights, water } = map;
  const layers = MAX_LAYERS;
  const cells: (number | null)[] = new Array(size * size * layers).fill(null);
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) {
      const index = z * size + x;
      const height = heights[index];
      for (let layer = 0; layer < height; layer++)
        cells[(layer * size + z) * size + x] = cellColor(map, x, z, height - 1 - layer, layer);
      // Water up to its surface, darker where it is deeper.
      const surface = water[index];
      if (surface > height) {
        const color = waterColor(map, x, z, surface - height);
        for (let layer = height; layer < surface; layer++)
          cells[(layer * size + z) * size + x] = color;
      }
    }
  const fill = fillVoxelModel(
    { name: `World ${seed}`, width: size, depth: size, layers, cells },
    { buildArea: size, details: false },
  );
  let assembly: Assembly = { ...fill.assembly, name: `World ${seed}` };
  const terrain = new Set(assembly.bricks.map((brick) => brick.id));
  // Plants first, on bare ground, so smoothing then works round their roots.
  assembly = { ...assembly, bricks: [...assembly.bricks, ...plantIsland(map, assembly.bricks)] };

  // Round the land off: slopes against steps, round corners and flowers on green tops, with
  // studs left open to build on. Only the ground counts, so the plants keep their shape.
  const smoothed = smoothAssembly(assembly, {
    ids: terrain,
    tiles: false,
    accents: true,
    accentDensity: 0.04,
    nextId: counter('ground'),
  });
  assembly = smoothed.assembly;
  for (const brick of smoothed.added) terrain.add(brick.id);
  return { seed, assembly, map, spawn: findSpawn(map), terrain };
}

function counter(prefix: string) {
  let next = 0;
  return () => `${prefix}-${next++}`;
}

/** The dry stud closest to the middle of the island, on open ground rather than rock or water. */
function findSpawn(map: WorldMap): { x: number; z: number } {
  const { size, biomes, water } = map;
  const centre = Math.floor(size / 2);
  const open = (index: number) =>
    LAND_BIOMES.has(biomes[index]) &&
    !['rock', 'volcanic', 'lava'].includes(biomes[index]) &&
    !water[index];
  for (let radius = 0; radius < size / 2; radius++)
    for (let dz = -radius; dz <= radius; dz++)
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const x = centre + dx;
        const z = centre + dz;
        if (open(z * size + x)) return { x: x + 0.5, z: z + 0.5 };
      }
  return { x: centre, z: centre };
}
