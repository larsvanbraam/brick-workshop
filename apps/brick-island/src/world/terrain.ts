import { Terrain } from '@brick-workshop/game/world/terrain.ts';
import { ISLAND_SOURCE } from './source.ts';

/** Brick Island's terrain for one seed. */
export const islandTerrain = (seed: number) => new Terrain(seed, ISLAND_SOURCE);
