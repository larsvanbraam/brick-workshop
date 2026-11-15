import type { Brick } from '@brick-workshop/engine';

/** Studs along a chunk's side: the world is cut into squares this big. */
export const CHUNK = 32;

/** A chunk's key, from its place in the grid of chunks. */
export const chunkKey = (cx: number, cz: number) => `${cx},${cz}`;

/** The chunk a piece belongs to: the one holding its corner nearest the origin. */
export const chunkOf = (brick: Pick<Brick, 'x' | 'z'>) =>
  chunkKey(Math.floor(brick.x / CHUNK), Math.floor(brick.z / CHUNK));

/** The pieces of a world, by chunk. Chunks with no pieces are left out. */
export type Chunks = ReadonlyMap<string, readonly Brick[]>;

export function splitIntoChunks(bricks: Iterable<Brick>): Map<string, Brick[]> {
  const chunks = new Map<string, Brick[]>();
  for (const brick of bricks) {
    const key = chunkOf(brick);
    const pieces = chunks.get(key);
    if (pieces) pieces.push(brick);
    else chunks.set(key, [brick]);
  }
  return chunks;
}

/** Every piece of every chunk, in one list. */
export function allBricks(chunks: Chunks): Brick[] {
  const bricks: Brick[] = [];
  for (const pieces of chunks.values()) bricks.push(...pieces);
  return bricks;
}

/**
 * The chunks after pieces are added and taken off: only the chunks that change get new lists, so
 * whatever is drawn or walked per chunk can tell which chunks to redo.
 */
export function applyToChunks(
  chunks: Chunks,
  added: readonly Brick[],
  removed: readonly Brick[],
): { chunks: Map<string, readonly Brick[]>; changed: Set<string> } {
  const next = new Map(chunks);
  const changed = new Set<string>();
  const gone = new Set(removed.map((brick) => brick.id));
  for (const brick of removed) changed.add(chunkOf(brick));
  for (const brick of added) changed.add(chunkOf(brick));
  for (const key of changed) {
    const pieces = (chunks.get(key) ?? []).filter((brick) => !gone.has(brick.id));
    pieces.push(...added.filter((brick) => chunkOf(brick) === key));
    if (pieces.length) next.set(key, pieces);
    else next.delete(key);
  }
  return { chunks: next, changed };
}
