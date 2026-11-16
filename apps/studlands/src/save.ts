import type { Brick } from '@brick-workshop/engine';
import type { Edit, Held } from './build.ts';
import { chunkOf } from './chunks.ts';
import { game } from './game.ts';

/** Each game keeps its saves under its own prefix (see `GameConfig`). */
const prefix = () => game().savePrefix;

/** Storage may be missing or blocked (private windows, previews); the game then just forgets. */
function read<T>(key: string): T | null {
  try {
    const value = localStorage.getItem(`${prefix()}:${key}`);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(`${prefix()}:${key}`, JSON.stringify(value));
  } catch {
    // Out of space or blocked: the world still plays, it is just not kept.
  }
}

function forget(key: string) {
  try {
    localStorage.removeItem(`${prefix()}:${key}`);
  } catch {
    // Nothing to forget where nothing could be kept.
  }
}

/**
 * Edits are kept per world and per version of the generator: a changed generator shapes a
 * different world from the same seed, which old edits would not fit.
 */
export const WORLD_VERSION = 5;
const editsKey = (seed: number) => `edits:v${WORLD_VERSION}:${seed}`;
// Saved under the game's old name, so worlds played before the rename are still found.
const WORLDS_KEY = `islands:v${WORLD_VERSION}`;

/** A world played before, for the menu's list. */
export interface WorldSummary {
  seed: number;
  /** Pieces placed and taken off, counted from the edits. */
  placed: number;
  removed: number;
  /** Chunks the pieces placed stand in: how spread out the building is. Missing in older saves. */
  chunks?: number;
  /** When it was last played, as an ISO date. */
  playedAt: string;
}

export function listWorlds(): WorldSummary[] {
  const worlds = read<WorldSummary[]>(WORLDS_KEY) ?? [];
  return worlds.toSorted((a, b) => b.playedAt.localeCompare(a.playedAt));
}

function summarise(seed: number, edits: readonly Edit[]): WorldSummary {
  // Only pieces still standing count as placed: one put down and taken off again is gone.
  const added = new Map<string, string>();
  let removed = 0;
  for (const edit of edits) {
    if (edit.op === 'add') added.set(edit.brick.id, chunkOf(edit.brick));
    else if (added.has(edit.id)) added.delete(edit.id);
    else removed++;
  }
  return {
    seed,
    placed: added.size,
    removed,
    chunks: new Set(added.values()).size,
    playedAt: new Date().toISOString(),
  };
}

/** The chunk an edit belongs to: the chunk of the piece put down or taken off. */
export const editChunk = (edit: Edit) =>
  edit.op === 'add' ? chunkOf(edit.brick) : (edit.chunk ?? 'unknown');
const chunkEditsKey = (seed: number, chunk: string) => `${editsKey(seed)}:${chunk}`;

/** The chunks of a world that have edits, or the edits themselves in an older save. */
function storedChunks(seed: number): { chunks: string[]; legacy: Edit[] | null } {
  const stored = read<unknown[]>(editsKey(seed)) ?? [];
  if (stored.some((entry) => typeof entry !== 'string'))
    return { chunks: [], legacy: stored as Edit[] };
  return { chunks: stored as string[], legacy: null };
}

/**
 * A world's edits. They are kept per chunk, so a world too big to load at once can read just
 * the chunks it shows; older saves kept one list, which is read as it is and split on the next
 * save.
 */
export function loadEdits(seed: number): Edit[] {
  const { chunks, legacy } = storedChunks(seed);
  return legacy ?? chunks.flatMap((chunk) => read<Edit[]>(chunkEditsKey(seed, chunk)) ?? []);
}

/** What was last written per key, so saving after an edit only rewrites the chunks it changed. */
const written = new Map<string, string>();

/** Keeps a world's edits, chunk by chunk, and marks it as just played. */
export function saveEdits(seed: number, edits: readonly Edit[]) {
  const byChunk = new Map<string, Edit[]>();
  for (const edit of edits) {
    const chunk = editChunk(edit);
    const list = byChunk.get(chunk);
    if (list) list.push(edit);
    else byChunk.set(chunk, [edit]);
  }
  for (const chunk of storedChunks(seed).chunks)
    if (!byChunk.has(chunk)) {
      forget(chunkEditsKey(seed, chunk));
      written.delete(chunkEditsKey(seed, chunk));
    }
  for (const [chunk, list] of byChunk) {
    const key = chunkEditsKey(seed, chunk);
    const json = JSON.stringify(list);
    if (written.get(key) === json) continue;
    written.set(key, json);
    write(key, list);
  }
  write(editsKey(seed), [...byChunk.keys()].sort());
  const worlds = (read<WorldSummary[]>(WORLDS_KEY) ?? []).filter((world) => world.seed !== seed);
  write(WORLDS_KEY, [...worlds, summarise(seed, edits)]);
}

/** Forgets a world and everything built on it. */
export function deleteWorld(seed: number) {
  for (const chunk of storedChunks(seed).chunks) {
    forget(chunkEditsKey(seed, chunk));
    written.delete(chunkEditsKey(seed, chunk));
  }
  forget(editsKey(seed));
  write(
    WORLDS_KEY,
    (read<WorldSummary[]>(WORLDS_KEY) ?? []).filter((world) => world.seed !== seed),
  );
}

export const loadSeed = () => read<number>('seed');
export const saveSeed = (seed: number) => write('seed', seed);

/** The time of day, kept across visits so the world's day carries on. */
export const loadTime = () => read<number>('time');
export const saveTime = (time: number) => write('time', time);

export const loadDistance = () => read<string>('distance');
export const saveDistance = (name: string) => write('distance', name);

/** How loud the music plays, by the name picked in the settings. */
export const loadMusic = () => read<string>('music');
export const saveMusic = (name: string) => write('music', name);

/** Whether the simple one-stick controls are on, for small children. */
export const loadSimpleControls = () => read<boolean>('simpleControls');
export const saveSimpleControls = (on: boolean) => write('simpleControls', on);

/** Whether the on-screen touch controls show: auto (on touch screens), on or off. */
export const loadTouchControls = () => read<string>('touchControls');
export const saveTouchControls = (name: string) => write('touchControls', name);

export const loadVoices = () => read<string>('voices');
export const saveVoices = (name: string) => write('voices', name);

/** The language people speak, by the code picked in the settings. */
export const loadLocale = () => read<string>('locale');
export const saveLocale = (name: string) => write('locale', name);

export const loadHotbar = () => read<Held[]>('hotbar');
export const saveHotbar = (slots: readonly Held[]) => write('hotbar', slots);

/** A save file: one world's seed and what was changed on it, to back up or move elsewhere. */
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
    throw new Error('This is not a Studlands save file.');
  if (value.version !== 1) throw new Error('This save file is from a newer version of the game.');
  if (value.worldVersion !== WORLD_VERSION)
    throw new Error('This save is from another version of the world generator.');
  if (typeof value.seed !== 'number' || !Number.isInteger(value.seed))
    throw new Error('The save file has no world seed.');
  if (!Array.isArray(value.edits) || !value.edits.every(isEdit))
    throw new Error('The save file’s changes are damaged.');
  return value as unknown as SaveFile;
}

/** Writes an imported save over that world's own edits. */
export function importSaveFile(save: SaveFile) {
  saveEdits(save.seed, save.edits);
}

/** Where the walker was and how it looked round, to pick a game up there again. */
export interface Place {
  /** World studs. */
  x: number;
  z: number;
  /** The minifigure's feet, in scene units. */
  y: number;
  /** The camera's heading and tilt, in radians, as the walk view keeps them. */
  yaw: number;
  pitch: number;
  flying: boolean;
  view: 'first' | 'third';
}

/** Where a vehicle was left: world studs, its wheels' height in scene units and its heading. */
export interface ParkedVehicle {
  id: string;
  x: number;
  z: number;
  y: number;
  yaw: number;
}

/** One save game: a slot's player, where it was and how long it has played. */
export interface SaveGame {
  place: Place;
  /** Where each vehicle was left, and the one being driven. Missing in older saves. */
  vehicles?: ParkedVehicle[];
  driving?: string | null;
  /** Brick Island's jobs: those finished, by ID, and the one being done. Missing in older saves. */
  quests?: { done: string[]; active: unknown; hat?: string };
  /** Seconds spent playing, summed over every visit. */
  playSeconds: number;
  /** When it was first and last played, as ISO dates. */
  startedAt: string;
  playedAt: string;
}

/** Whether a saved vehicle is whole enough to put back. */
export const isParkedVehicle = (value: unknown): value is ParkedVehicle =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  ['x', 'y', 'z', 'yaw'].every(
    (key) => typeof value[key] === 'number' && Number.isFinite(value[key]),
  );

/** How many save games a game with slots keeps. */
export const SAVE_SLOTS = 3;
const SAVES_KEY = 'saves:v1';
const SLOT_KEY = 'slot';

const isPlace = (value: unknown): value is Place =>
  isRecord(value) &&
  ['x', 'y', 'z', 'yaw', 'pitch'].every(
    (key) => typeof value[key] === 'number' && Number.isFinite(value[key]),
  ) &&
  typeof value.flying === 'boolean' &&
  (value.view === 'first' || value.view === 'third');

const isSaveGame = (value: unknown): value is SaveGame =>
  isRecord(value) &&
  isPlace(value.place) &&
  typeof value.playSeconds === 'number' &&
  typeof value.startedAt === 'string' &&
  typeof value.playedAt === 'string';

/** Every slot, empty ones as null; a damaged save reads as an empty slot. */
export function listSaves(): (SaveGame | null)[] {
  const stored = read<unknown[]>(SAVES_KEY);
  return Array.from({ length: SAVE_SLOTS }, (_, slot) => {
    const save = Array.isArray(stored) ? stored[slot] : null;
    return isSaveGame(save) ? save : null;
  });
}

export const loadSave = (slot: number) => listSaves()[slot] ?? null;

export function storeSave(slot: number, save: SaveGame | null) {
  const saves = listSaves();
  saves[slot] = save;
  write(SAVES_KEY, saves);
}

export const deleteSave = (slot: number) => storeSave(slot, null);

/** The slot played last, which the game opens on. */
export function loadSlot() {
  const slot = read<number>(SLOT_KEY);
  return Number.isInteger(slot) && slot! >= 0 && slot! < SAVE_SLOTS ? slot! : 0;
}
export const saveSlot = (slot: number) => write(SLOT_KEY, slot);
