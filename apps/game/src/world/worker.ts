import { generateChunk } from './generate.ts';
import type { ChunkResult } from './generate.ts';
import { Terrain } from './terrain.ts';

/** Which chunk of which world to build. */
export interface ChunkRequest {
  seed: number;
  cx: number;
  cz: number;
}

export type ChunkMessage = ChunkResult & {
  /** How long building it took, in ms, for the debug window. */
  ms: number;
};

/**
 * Builds chunks off the main thread, one per message. The terrain is kept between messages for
 * the same seed, so columns and tree spots worked out for one chunk serve its neighbours.
 */
let terrain: Terrain | null = null;

self.onmessage = (event: MessageEvent<ChunkRequest>) => {
  const { seed, cx, cz } = event.data;
  const start = performance.now();
  if (terrain?.seed !== seed) terrain = new Terrain(seed);
  const chunk = generateChunk(seed, cx, cz, terrain);
  const message: ChunkMessage = { ...chunk, ms: performance.now() - start };
  self.postMessage(message);
};
