import type { Brick } from '@brick-workshop/engine';
import type { Edit, Held } from './build.ts';

const PREFIX = 'brick-island';

/** Storage may be missing or blocked (private windows, previews); the game then just forgets. */
function read<T>(key: string): T | null {
  try {
    const value = localStorage.getItem(`${PREFIX}:${key}`);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(`${PREFIX}:${key}`, JSON.stringify(value));
  } catch {
    // Out of space or blocked: the world still plays, it is just not kept.
  }
}

function forget(key: string) {
  try {
    localStorage.removeItem(`${PREFIX}:${key}`);
  } catch {
    // Nothing to forget where nothing could be kept.
  }
}

/**
 * Edits are kept per island and per version of the generator: a changed generator shapes a
 * different island from the same seed, which old edits would not fit.
 */
export const WORLD_VERSION = 1;
const editsKey = (seed: number) => `edits:v${WORLD_VERSION}:${seed}`;
const ISLANDS_KEY = `islands:v${WORLD_VERSION}`;

/** An island played before, for the menu's list. */
export interface IslandSummary {
  seed: number;
  /** Pieces placed and taken off, counted from the edits. */
  placed: number;
  removed: number;
  /** When it was last played, as an ISO date. */
  playedAt: string;
}

export function listIslands(): IslandSummary[] {
  const islands = read<IslandSummary[]>(ISLANDS_KEY) ?? [];
  return islands.toSorted((a, b) => b.playedAt.localeCompare(a.playedAt));
}

function summarise(seed: number, edits: readonly Edit[]): IslandSummary {
  // Only pieces still standing count as placed: one put down and taken off again is gone.
  const added = new Set<string>();
  let removed = 0;
  for (const edit of edits) {
    if (edit.op === 'add') added.add(edit.brick.id);
    else if (added.has(edit.id)) added.delete(edit.id);
    else removed++;
  }
  return { seed, placed: added.size, removed, playedAt: new Date().toISOString() };
}

export const loadEdits = (seed: number) => read<Edit[]>(editsKey(seed)) ?? [];

/** Keeps an island's edits and marks it as just played. */
export function saveEdits(seed: number, edits: readonly Edit[]) {
  write(editsKey(seed), edits);
  const islands = (read<IslandSummary[]>(ISLANDS_KEY) ?? []).filter(
    (island) => island.seed !== seed,
  );
  write(ISLANDS_KEY, [...islands, summarise(seed, edits)]);
}

/** Forgets an island and everything built on it. */
export function deleteIsland(seed: number) {
  forget(editsKey(seed));
  write(
    ISLANDS_KEY,
    (read<IslandSummary[]>(ISLANDS_KEY) ?? []).filter((island) => island.seed !== seed),
  );
}

export const loadSeed = () => read<number>('seed');
export const saveSeed = (seed: number) => write('seed', seed);

/** The time of day, kept across visits so the island's day carries on. */
export const loadTime = () => read<number>('time');
export const saveTime = (time: number) => write('time', time);

export const loadHotbar = () => read<Held[]>('hotbar');
export const saveHotbar = (slots: readonly Held[]) => write('hotbar', slots);

/** A save file: one island's seed and what was changed on it, to back up or move elsewhere. */
export interface SaveFile {
  format: 'brick-island-save';
  version: 1;
  worldVersion: number;
  seed: number;
  edits: Edit[];
  savedAt: string;
}

export function createSaveFile(seed: number, edits: readonly Edit[]): SaveFile {
  return {
    format: 'brick-island-save',
    version: 1,
    worldVersion: WORLD_VERSION,
    seed,
    edits: [...edits],
    savedAt: new Date().toISOString(),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function isBrick(value: unknown): value is Brick {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.partId === 'string' &&
    ['color', 'x', 'y', 'z', 'rotation'].every((key) => typeof value[key] === 'number')
  );
}

function isEdit(value: unknown): value is Edit {
  if (!isRecord(value)) return false;
  if (value.op === 'add') return isBrick(value.brick);
  return value.op === 'remove' && typeof value.id === 'string';
}

/** Reads a save file, or throws with a reason a player can act on. */
export function readSaveFile(value: unknown): SaveFile {
  if (!isRecord(value) || value.format !== 'brick-island-save')
    throw new Error('This is not a Brick Island save file.');
  if (value.version !== 1) throw new Error('This save file is from a newer version of the game.');
  if (value.worldVersion !== WORLD_VERSION)
    throw new Error('This save is from another version of the island generator.');
  if (typeof value.seed !== 'number' || !Number.isInteger(value.seed))
    throw new Error('The save file has no island seed.');
  if (!Array.isArray(value.edits) || !value.edits.every(isEdit))
    throw new Error('The save file’s changes are damaged.');
  return value as unknown as SaveFile;
}

/** Writes an imported save over that island's own edits. */
export function importSaveFile(save: SaveFile) {
  saveEdits(save.seed, save.edits);
}
