import { CHUNK, chunkKey } from './chunks.ts';
import type { ChunkMessage, ChunkRequest } from './world/worker.ts';

/** Chunks this many away from the walker's, in any direction, are kept loaded. */
export const LOAD_RADIUS = 2;
/** Chunks further than this are dropped: a margin over the load radius, so a walker going back
 * and forth over a chunk edge does not drop and rebuild the same chunks. */
export const UNLOAD_RADIUS = 3;
/** Chunks round the start that must be there before the game begins. */
export const START_RADIUS = 1;

/** The chunk holding a stud. */
export const chunkAt = (x: number, z: number) =>
  [Math.floor(x / CHUNK), Math.floor(z / CHUNK)] as const;

const parse = (key: string) => key.split(',').map(Number) as [number, number];

/** How many chunks apart two chunks are, the furthest of the two directions. */
export const chunkDistance = (key: string, cx: number, cz: number) => {
  const [x, z] = parse(key);
  return Math.max(Math.abs(x - cx), Math.abs(z - cz));
};

/** The chunks within `radius` of a chunk, nearest first. */
export function chunksAround(cx: number, cz: number, radius: number): string[] {
  const keys: { key: string; distance: number }[] = [];
  for (let dz = -radius; dz <= radius; dz++)
    for (let dx = -radius; dx <= radius; dx++)
      keys.push({ key: chunkKey(cx + dx, cz + dz), distance: Math.hypot(dx, dz) });
  return keys.sort((a, b) => a.distance - b.distance).map(({ key }) => key);
}

/**
 * What to do as the walker moves: the chunks round it not yet loaded, nearest first (some may be
 * on their way already), and the loaded chunks now far enough away to drop.
 */
export function plan(
  cx: number,
  cz: number,
  loaded: ReadonlySet<string>,
): { request: string[]; unload: string[] } {
  return {
    request: chunksAround(cx, cz, LOAD_RADIUS).filter((key) => !loaded.has(key)),
    unload: [...loaded].filter((key) => chunkDistance(key, cx, cz) > UNLOAD_RADIUS),
  };
}

/** Background threads that build chunks: a few, so chunks are built side by side. */
const WORKERS = Math.max(
  1,
  Math.min(4, (typeof navigator === 'undefined' ? 4 : navigator.hardwareConcurrency || 4) - 1),
);

/**
 * Builds chunks off the main thread with a pool of workers that lasts as long as the game. It is
 * told which chunks are wanted, nearest first, and builds them in that order, a few at a time;
 * a chunk no longer wanted when its turn comes is skipped.
 */
export class ChunkLoader {
  private readonly workers: Worker[] = [];
  private readonly idle: Worker[] = [];
  private queue: string[] = [];
  /** Chunks asked for or being built. */
  readonly pending = new Set<string>();
  private readonly seed: number;
  private readonly onChunk: (chunk: ChunkMessage) => void;

  constructor(seed: number, onChunk: (chunk: ChunkMessage) => void) {
    this.seed = seed;
    this.onChunk = onChunk;
    for (let index = 0; index < WORKERS; index++) {
      const worker = new Worker(new URL('./world/worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<ChunkMessage>) => {
        this.pending.delete(event.data.key);
        this.idle.push(worker);
        this.onChunk(event.data);
        this.pump();
      };
      this.workers.push(worker);
      this.idle.push(worker);
    }
  }

  /** The chunks to build, nearest first: replaces whatever was still waiting. */
  want(keys: readonly string[]) {
    const building = new Set(this.pending);
    for (const key of this.queue) building.delete(key);
    this.queue = keys.filter((key) => !building.has(key));
    this.pending.clear();
    for (const key of building) this.pending.add(key);
    for (const key of this.queue) this.pending.add(key);
    this.pump();
  }

  private pump() {
    while (this.idle.length && this.queue.length) {
      const key = this.queue.shift()!;
      const [cx, cz] = parse(key);
      this.idle.pop()!.postMessage({ seed: this.seed, cx, cz } satisfies ChunkRequest);
    }
  }

  dispose() {
    for (const worker of this.workers) worker.terminate();
    this.workers.length = 0;
    this.idle.length = 0;
    this.queue = [];
    this.pending.clear();
  }
}
