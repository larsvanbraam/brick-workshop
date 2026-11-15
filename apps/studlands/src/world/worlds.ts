import { ISLAND_SOURCE } from './island/source.ts';
import { STUDLANDS_SOURCE, Terrain } from './terrain.ts';
import type { WorldKind } from './terrain.ts';

/** The terrain of a world of either kind. */
export const createTerrain = (seed: number, world: WorldKind = 'studlands') =>
  new Terrain(seed, world === 'island' ? ISLAND_SOURCE : STUDLANDS_SOURCE);
