import type { Brick } from '@brick-workshop/engine';

/** Studs along a chunk's side: the world is cut into squares this big. */
export const CHUNK = 32;

/** A chunk's key, from its place in the grid of chunks. */
export const chunkKey = (cx: number, cz: number) => `${cx},${cz}`;

/**
 * The chunk a piece belongs to. A generated piece names the chunk that grew it after an `@` in
 * its ID, so a tree leaning over an edge stays with its trunk; anything else, such as a piece a
 * player put down, belongs to the chunk holding its corner nearest the origin.
 */
export function chunkOf(brick: Pick<Brick, 'x' | 'z'> & { id?: string }) {
  const at = brick.id?.lastIndexOf('@') ?? -1;
  if (at !== -1) return brick.id!.slice(at + 1);
  return chunkKey(Math.floor(brick.x / CHUNK), Math.floor(brick.z / CHUNK));
}

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

/**
 * A chunk's pieces as the player left them: the generated pieces with the player's edits to that
 * chunk laid over them in order, pieces put down added and pieces taken off gone.
 */
export function withEdits(
  key: string,
  bricks: readonly Brick[],
  edits: readonly ({ op: 'add'; brick: Brick } | { op: 'remove'; id: string; chunk?: string })[],
): Brick[] {
  const pieces = new Map(bricks.map((brick) => [brick.id, brick]));
  for (const edit of edits) {
    if (edit.op === 'add') {
      if (chunkOf(edit.brick) === key) pieces.set(edit.brick.id, edit.brick);
    } else if ((edit.chunk ?? key) === key) pieces.delete(edit.id);
  }
  return [...pieces.values()];
}
