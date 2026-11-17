import { CHUNK, chunkKey } from './chunks.ts';
import type { ChunkMessage, ChunkRequest, FarMessage } from './world/worker.ts';
import type { WorldKind } from './world/terrain.ts';

/**
 * How far the world reaches round the walker, in chunks: `load` chunks away in any direction are
 * built in full, and past them, out to `far`, chunks are drawn plainly from afar. Each is dropped
 * one chunk further out than it is loaded, so a walker going back and forth over a chunk edge
 * does not drop and rebuild the same chunks.
 */
export interface RenderDistance {
  load: number;
  far: number;
}

export const DISTANCES = {
  short: { load: 1, far: 3 },
  normal: { load: 2, far: 4 },
  far: { load: 2, far: 6 },
  farthest: { load: 3, far: 8 },
} as const satisfies Record<string, RenderDistance>;
export type DistanceName = keyof typeof DISTANCES;
export const DEFAULT_DISTANCE: DistanceName = 'normal';
export const isDistanceName = (name: unknown): name is DistanceName =>
  typeof name === 'string' && Object.hasOwn(DISTANCES, name);

/** Chunks further than this are dropped. */
export const unloadRadius = (distance: RenderDistance) => distance.load + 1;
/** Far chunks further than this are dropped. */
export const farDrop = (distance: RenderDistance) => distance.far + 1;

/** The default reach, as the tests and the rest of the game assume it when none is given. */
export const LOAD_RADIUS = DISTANCES.normal.load;
export const UNLOAD_RADIUS = unloadRadius(DISTANCES.normal);
export const FAR_RADIUS = DISTANCES.normal.far;
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
 * on their way already), and the loaded chunks now far enough away to drop. Likewise for the ring
 * of far chunks past them.
 *
 * A full chunk past the margin is only dropped once its far look is there to take its place (or
 * it is past the far ring too), so a quick flight never leaves a hole where the far chunk is still
 * waiting its turn behind the full ones.
 */
export function plan(
  cx: number,
  cz: number,
  loaded: ReadonlySet<string>,
  far: ReadonlySet<string> = new Set(),
  distance: RenderDistance = DISTANCES[DEFAULT_DISTANCE],
  /** Drop everything past the reach itself, without the margin: for when the reach shrinks. */
  trim = false,
): { request: string[]; unload: string[]; farRequest: string[]; farUnload: string[] } {
  const nearby = chunksAround(cx, cz, distance.load);
  const near = new Set(nearby);
  return {
    request: nearby.filter((key) => !loaded.has(key)),
    unload: [...loaded].filter((key) => {
      const away = chunkDistance(key, cx, cz);
      if (trim) return away > distance.load;
      return away > unloadRadius(distance) && (far.has(key) || away > farDrop(distance));
    }),
    farRequest: chunksAround(cx, cz, distance.far).filter((key) => !near.has(key) && !far.has(key)),
    // A far chunk inside the full ring stays: it fills the gap until the full chunk arrives.
    farUnload: [...far].filter(
      (key) => chunkDistance(key, cx, cz) > (trim ? distance.far : farDrop(distance)),
    ),
  };
}

export interface LoaderActivity {
  /** Chunks waiting to be built in full, and from afar. */
  waiting: number;
  waitingFar: number;
  /** Chunks being built right now. */
  building: number;
  workers: number;
}

/** The scene's frame (see `GameScene`): far chunks are built straight into its coordinates. */
const FRAME = 128;

/** A chunk takes a fraction of a second to build; a worker this slow is taken to be stuck. */
const STALLED_MS = 10_000;

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
  private readonly workers = new Set<Worker>();
  private readonly idle: Worker[] = [];
  /** The job each busy worker is on, and since when. Far jobs are keyed `far:` and the chunk. */
  private readonly busy = new Map<Worker, { job: string; since: number }>();
  /** Jobs waiting: full chunks first, then far ones. */
  private queue: string[] = [];
  /** Jobs asked for or under way. */
  readonly pending = new Set<string>();
  private readonly seed: number;
  private readonly world: WorldKind;
  private readonly onChunk: (chunk: ChunkMessage) => void;
  private readonly onFar: (chunk: FarMessage) => void;
  private readonly watchdog: ReturnType<typeof setInterval>;

  constructor(
    seed: number,
    onChunk: (chunk: ChunkMessage) => void,
    onFar: (chunk: FarMessage) => void = () => {},
    world: WorldKind = 'world',
  ) {
    this.seed = seed;
    this.world = world;
    this.onChunk = onChunk;
    this.onFar = onFar;
    for (let index = 0; index < WORKERS; index++) this.hire();
    // A worker that never answers (it failed to load, or hangs) would hold its job back for
    // good: one taking far longer than a chunk ever should is replaced and its job asked again.
    this.watchdog = setInterval(() => {
      const now = performance.now();
      for (const [worker, busy] of this.busy)
        if (now - busy.since > STALLED_MS) this.replace(worker);
    }, 1000);
  }

  private hire() {
    const worker = new Worker(new URL('./world/worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<ChunkMessage | FarMessage>) => {
      const job = this.busy.get(worker)?.job;
      this.busy.delete(worker);
      if (job) this.pending.delete(job);
      this.idle.push(worker);
      if (event.data.kind === 'far') this.onFar(event.data);
      else this.onChunk(event.data);
      this.pump();
    };
    worker.onerror = (event) => {
      event.preventDefault();
      this.replace(worker);
    };
    this.workers.add(worker);
    this.idle.push(worker);
  }

  /** Lets a worker go and hires another, putting its job back at the front of the queue. */
  private replace(worker: Worker) {
    const busy = this.busy.get(worker);
    worker.terminate();
    this.workers.delete(worker);
    this.busy.delete(worker);
    const at = this.idle.indexOf(worker);
    if (at !== -1) this.idle.splice(at, 1);
    if (busy && this.pending.has(busy.job)) this.queue.unshift(busy.job);
    this.hire();
    this.pump();
  }

  /**
   * The chunks to build in full and those to build only from afar, each nearest first: replaces
   * whatever was still waiting.
   */
  want(keys: readonly string[], far: readonly string[] = []) {
    const underway = new Set([...this.busy.values()].map((busy) => busy.job));
    this.queue = [...keys, ...far.map((key) => `far:${key}`)].filter((job) => !underway.has(job));
    this.pending.clear();
    for (const job of underway) this.pending.add(job);
    for (const job of this.queue) this.pending.add(job);
    this.pump();
  }

  private pump() {
    while (this.idle.length && this.queue.length) {
      const job = this.queue.shift()!;
      const far = job.startsWith('far:');
      const [cx, cz] = parse(far ? job.slice(4) : job);
      const worker = this.idle.pop()!;
      this.busy.set(worker, { job, since: performance.now() });
      worker.postMessage({
        seed: this.seed,
        world: this.world,
        cx,
        cz,
        far,
        frame: FRAME,
      } satisfies ChunkRequest);
    }
  }

  /** What the loader is doing, for the debug window. */
  get activity(): LoaderActivity {
    const far = this.queue.filter((job) => job.startsWith('far:')).length;
    return {
      waiting: this.queue.length - far,
      waitingFar: far,
      building: this.busy.size,
      workers: this.workers.size,
    };
  }

  dispose() {
    clearInterval(this.watchdog);
    for (const worker of this.workers) worker.terminate();
    this.workers.clear();
    this.idle.length = 0;
    this.busy.clear();
    this.queue = [];
    this.pending.clear();
  }
}
