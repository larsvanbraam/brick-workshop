import { ISLAND_SOURCE } from './island/source.ts';
import { BRICK_WORLD_SOURCE, Terrain } from './terrain.ts';
import type { WorldKind } from './terrain.ts';

/** The terrain of a world of either kind. */
export const createTerrain = (seed: number, world: WorldKind = 'world') =>
  new Terrain(seed, world === 'island' ? ISLAND_SOURCE : BRICK_WORLD_SOURCE);
