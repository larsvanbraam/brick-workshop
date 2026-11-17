import type { GameConfig } from '@brick-workshop/game/game.ts';
import { useIslandAddon } from './jobs/addon.tsx';
import { FARM, LANDMARKS, VEHICLE_SPAWNS } from './world/map.ts';
import { MAP_BOUNDS, MAP_STEP, drawIslandMap } from './world/minimap.ts';
import { ISLAND_SOURCE } from './world/source.ts';

/**
 * Brick Island: one hand-drawn island, the same for everyone, for a young child to walk round,
 * with little jobs to do, hats to win and vehicles to drive.
 */
export const BRICK_ISLAND: GameConfig = {
  title: 'Brick Island',
  tagline: 'A harbour town, a farm, a lake and a mountain, all yours to explore.',
  source: ISLAND_SOURCE,
  createWorker: () => new Worker(new URL('./world/worker.ts', import.meta.url), { type: 'module' }),
  savePrefix: 'brick-island-map',
  seed: 7,
  slug: 'brick-island',
  // A game for walking round and doing things, not for building.
  building: false,
  // Always a bright morning: no nights, which suits a game for children.
  fixedTime: 0.42,
  map: { bounds: MAP_BOUNDS, step: MAP_STEP, draw: drawIslandMap, landmarks: LANDMARKS },
  saveSlots: true,
  vehicles: VEHICLE_SPAWNS,
  pastures: [FARM],
  chat: {
    en: [
      'Have you been up to the lighthouse?',
      'There is a volcano on this island. Nobody talks about it.',
      'You can borrow a car if you find one. Everyone does.',
    ],
    nl: [
      'Ben je al bij de vuurtoren geweest?',
      'Op dit eiland zit een vulkaan. Daar praat niemand over.',
      'Je mag een auto lenen als je er een vindt. Dat doet iedereen.',
    ],
  },
  controls: [{ group: 'Hats', action: 'change hat', key: 'H', pad: '▲' }],
  useAddon: useIslandAddon,
};
