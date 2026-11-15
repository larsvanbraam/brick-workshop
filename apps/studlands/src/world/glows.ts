import { CHUNK } from '../chunks.ts';
import { carveChunk } from './caves.ts';
import { chunkSight } from './plants.ts';
import { caveGlow } from './sights.ts';
import type { Glow } from './sights.ts';
import type { Terrain } from './terrain.ts';

export type { Glow };

/**
 * The nearest campfire and the nearest cave crystals to a chunk, looking at it and the chunks
 * round it: the two lights the game keeps near the walker. Worked out from the terrain alone,
 * the same way the chunks themselves place them.
 */
export function glowsNear(
  terrain: Terrain,
  cx: number,
  cz: number,
): { fire: Glow | null; crystal: Glow | null } {
  const middle = { x: (cx + 0.5) * CHUNK, z: (cz + 0.5) * CHUNK };
  const distance = (glow: Glow) => Math.hypot(glow.x - middle.x, glow.z - middle.z);
  let fire: Glow | null = null;
  let crystal: Glow | null = null;
  for (let oz = -1; oz <= 1; oz++)
    for (let ox = -1; ox <= 1; ox++) {
      const x0 = (cx + ox) * CHUNK;
      const z0 = (cz + oz) * CHUNK;
      const carving = carveChunk(terrain, x0, z0, CHUNK);
      const sight = chunkSight(terrain, carving, x0, z0, CHUNK)?.glow ?? null;
      if (sight && (!fire || distance(sight) < distance(fire))) fire = sight;
      const cave = caveGlow(terrain, carving);
      if (cave && (!crystal || distance(cave) < distance(crystal))) crystal = cave;
    }
  return { fire, crystal };
}
