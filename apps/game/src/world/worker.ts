import { generateWorld } from './generate.ts';
import type { World } from './generate.ts';
import type { Volcano } from './map.ts';

export interface WorldRequest {
  seed: number;
}

/** A world as it crosses from the worker: plain data, the terrain IDs as a list. */
export type WorldMessage = Omit<World, 'terrain' | 'map'> & {
  terrain: string[];
  /** The volcano's crater, if the island has one, for the glow over it. */
  volcano: Volcano | null;
  /** How long generating took, in ms, for the debug window. */
  generationMs: number;
};

self.onmessage = (event: MessageEvent<WorldRequest>) => {
  const start = performance.now();
  const world = generateWorld(event.data.seed);
  const message: WorldMessage = {
    seed: world.seed,
    assembly: world.assembly,
    spawn: world.spawn,
    terrain: [...world.terrain],
    volcano: world.map.volcano,
    generationMs: performance.now() - start,
  };
  self.postMessage(message);
};
