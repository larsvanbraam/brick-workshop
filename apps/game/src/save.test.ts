import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import type { Brick } from '@brick-workshop/engine';
import type { Edit } from './build.ts';
import { WORLD_VERSION, deleteWorld, listWorlds, loadEdits, saveEdits } from './save.ts';

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
