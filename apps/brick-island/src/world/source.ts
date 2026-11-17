import type { WorldSource } from '@brick-workshop/game/world/terrain.ts';
import { islandColumn } from './column.ts';
import { islandStructuresIn } from './structures.ts';

/** Brick Island as a world: its drawn ground, no volcanoes, and its buildings. */
export const ISLAND_SOURCE: WorldSource = {
  column: islandColumn,
  // The crossroads at the foot of Church Street, in the middle of Harbour Town.
  start: { x: 320, z: 392 },
  volcanoIn: () => null,
  caves: true,
  structuresIn: islandStructuresIn,
};
