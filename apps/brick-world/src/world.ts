import type { GameConfig } from '@brick-workshop/game/game.ts';
import { NOISE_WORLD } from '@brick-workshop/game/world/noise-world.ts';

/** Brick World: endless land from any seed, and real bricks to build it up with. */
export const BRICK_WORLD: GameConfig = {
  title: 'Brick World',
  tagline: 'Endless land to wander, and real bricks to build it up with.',
  source: NOISE_WORLD,
  createWorker: () => new Worker(new URL('./world-worker.ts', import.meta.url), { type: 'module' }),
  // Keys keep the game's first name, so saves from before the rename still load.
  savePrefix: 'brick-island',
  slug: 'brick-world',
  building: true,
  saveSlots: false,
  vehicles: [],
};
