import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import type { Brick } from '@brick-workshop/engine';
import type { Edit } from './build.ts';
import {
  SAVE_SLOTS,
  WORLD_VERSION,
  deleteSave,
  deleteWorld,
  listSaves,
  listWorlds,
  loadEdits,
  loadSave,
  loadSlot,
  saveEdits,
  saveSlot,
  storeSave,
} from './save.ts';
import type { SaveGame } from './save.ts';
import { setGame } from './game.ts';
import type { GameConfig } from './game.ts';
import { NOISE_WORLD } from './world/noise-world.ts';

/** A game of endless worlds, like Brick World, with no save slots. */
const WORLDS: GameConfig = {
  title: 'Test World',
  tagline: '',
  source: NOISE_WORLD,
  createWorker: () => {
    throw new Error('no worker in tests');
  },
  savePrefix: 'brick-island',
  slug: 'test-world',
  building: true,
  saveSlots: false,
  vehicles: [],
};

/** A game with save slots, like Brick Island, under its own prefix. */
const SLOTTED: GameConfig = { ...WORLDS, savePrefix: 'brick-island-map', seed: 7, saveSlots: true };

/** Browser storage for the tests, which run without a browser. */
class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
}

const piece = (id: string, x: number, z: number): Brick => ({
  id,
  partId: '3003',
  color: 4,
  x,
  y: 9,
  z,
  rotation: 0,
});

let storage: MemoryStorage;
beforeEach(() => {
  setGame(WORLDS);
  storage = new MemoryStorage();
  (globalThis as { localStorage?: unknown }).localStorage = storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('saved edits', () => {
  const edits: Edit[] = [
    { op: 'add', brick: piece('p-a', 3, 3) },
    { op: 'remove', id: 'model-1', chunk: '2,1' },
    { op: 'add', brick: piece('p-b', 70, 40) },
    { op: 'remove', id: 'p-a', chunk: '0,0' },
  ];

  it('keeps them per chunk and reads them back', () => {
    saveEdits(7, edits);
    const keys = [...storage.items.keys()].filter((key) =>
      key.includes(`edits:v${WORLD_VERSION}:7`),
    );
    expect(keys.sort()).toEqual(
      [
        `brick-island:edits:v${WORLD_VERSION}:7`,
        `brick-island:edits:v${WORLD_VERSION}:7:0,0`,
        `brick-island:edits:v${WORLD_VERSION}:7:2,1`,
      ].sort(),
    );
    const loaded = loadEdits(7);
    expect(loaded).toHaveLength(edits.length);
    expect(new Set(loaded.map((edit) => JSON.stringify(edit)))).toEqual(
      new Set(edits.map((edit) => JSON.stringify(edit))),
    );
    // A piece put down and taken off again is not counted as placed.
    expect(listWorlds()[0]).toMatchObject({ seed: 7, placed: 1, removed: 1, chunks: 1 });
  });

  it('forgets chunks whose edits are gone, and whole worlds', () => {
    saveEdits(7, edits);
    saveEdits(7, edits.slice(0, 1));
    expect(storage.items.has(`brick-island:edits:v${WORLD_VERSION}:7:2,1`)).toBe(false);
    deleteWorld(7);
    expect([...storage.items.keys()].some((key) => key.includes(':7'))).toBe(false);
    expect(loadEdits(7)).toEqual([]);
  });

  it('still reads a save that kept one list of edits', () => {
    storage.setItem(`brick-island:edits:v${WORLD_VERSION}:9`, JSON.stringify(edits));
    expect(loadEdits(9)).toEqual(edits);
  });
});

describe('save games', () => {
  const save: SaveGame = {
    place: { x: 290, y: 4.8, z: 368, yaw: 1.2, pitch: -0.1, flying: false, view: 'third' },
    playSeconds: 754,
    startedAt: '2026-11-14T09:00:00.000Z',
    playedAt: '2026-11-15T09:00:00.000Z',
  };
  beforeEach(() => setGame(SLOTTED));

  it('keeps a game per slot under the game’s own prefix', () => {
    expect(listSaves()).toEqual(Array.from({ length: SAVE_SLOTS }, () => null));
    storeSave(1, save);
    expect(loadSave(1)).toEqual(save);
    expect(loadSave(0)).toBeNull();
    expect(storage.items.has('brick-island-map:saves:v1')).toBe(true);
    deleteSave(1);
    expect(loadSave(1)).toBeNull();
  });

  it('reads a damaged save as an empty slot', () => {
    storage.setItem(
      'brick-island-map:saves:v1',
      JSON.stringify([{ ...save, place: { x: 'here' } }, save]),
    );
    expect(listSaves()).toEqual([null, save, null]);
  });

  it('remembers the slot played last, and ignores one out of range', () => {
    expect(loadSlot()).toBe(0);
    saveSlot(2);
    expect(loadSlot()).toBe(2);
    saveSlot(SAVE_SLOTS);
    expect(loadSlot()).toBe(0);
  });
});
