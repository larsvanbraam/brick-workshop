import { farChunk } from './far.ts';
import type { FarChunk } from './far.ts';
import { generateChunk } from './generate.ts';
import type { ChunkResult } from './generate.ts';
import { Terrain } from './terrain.ts';

/** Which chunk of which world to build: in full, or only its far-off look. */
export interface ChunkRequest {
  seed: number;
  cx: number;
  cz: number;
  far?: boolean;
  /** The scene's frame, which far chunks are built in. */
  frame?: number;
}

export type ChunkMessage = ChunkResult & {
  kind: 'chunk';
  /** How long building it took, in ms, for the debug window. */
  ms: number;
};
export type FarMessage = FarChunk & { kind: 'far' };

/**
 * Builds chunks off the main thread, one per message. The terrain is kept between messages for
 * the same seed, so columns and tree spots worked out for one chunk serve its neighbours.
 */
let terrain: Terrain | null = null;

self.onmessage = (event: MessageEvent<ChunkRequest>) => {
  const { seed, cx, cz, far, frame = 128 } = event.data;
  const start = performance.now();
  // A long walk would remember columns without end; past a point the memory starts afresh.
  if (terrain?.seed !== seed || terrain.remembered > 400_000) terrain = new Terrain(seed);
  if (far) {
    const message: FarMessage = { ...farChunk(terrain, cx, cz, frame), kind: 'far' };
    // The arrays move across rather than being copied.
    self.postMessage(message, {
      transfer: [message.positions.buffer, message.normals.buffer, message.colors.buffer],
    });
    return;
  }
  // A streamed world has no edge, so plants are kept wherever they reach.
  const chunk = generateChunk(seed, cx, cz, terrain, Infinity);
  self.postMessage({
    ...chunk,
    kind: 'chunk',
    ms: performance.now() - start,
  } satisfies ChunkMessage);
};
