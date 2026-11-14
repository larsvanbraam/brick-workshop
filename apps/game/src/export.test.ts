import { describe, expect, it } from 'vite-plus/test';
import { exportLDraw, validateAssembly } from '@brick-workshop/engine';
import type { Assembly, Brick } from '@brick-workshop/engine';
import { cutOutBuild, workshopDocument } from './export.ts';
import { createSaveFile, readSaveFile } from './save.ts';

const piece = (id: string, partId: string, x: number, y: number, z: number): Brick => ({
  id,
  partId,
  color: 2,
  x,
  y,
  z,
  rotation: 0,
});

/** A 32-stud board covered in 2 x 4 bricks, with a player's tower standing on it. */
function island(): Assembly {
  const bricks: Brick[] = [];
  for (let x = 0; x < 32; x += 2)
    for (let z = 0; z < 32; z += 4) bricks.push(piece(`g-${x}-${z}`, '3001', x, 0, z));
  bricks.push(piece('p-a', '3003', 20, 3, 20), piece('p-b', '3003', 20, 6, 20));
  return { name: 'island', bricks, buildArea: 32 };
}

describe('exporting a build', () => {
  it('cuts the build out with the ground under it, onto a board of its own', () => {
    const cut = cutOutBuild(island(), 'My build');
    expect(cut).not.toBeNull();
    if (!cut) return;
    expect(validateAssembly(cut)).toEqual([]);
    expect(cut.buildArea).toBe(16);
    const ids = cut.bricks.map((brick) => brick.id);
    expect(ids).toEqual(expect.arrayContaining(['p-a', 'p-b', 'g-20-20']));
    // Only ground within a few studs of the build comes along.
    expect(ids).not.toContain('g-0-0');
    expect(cut.bricks.length).toBeLessThan(island().bricks.length / 4);
    expect(exportLDraw(cut)).toContain('3003.dat');
  });

  it('has nothing to cut out before anything is built', () => {
    const untouched = island();
    expect(
      cutOutBuild(
        { ...untouched, bricks: untouched.bricks.filter((b) => !b.id.startsWith('p-')) },
        'x',
      ),
    ).toBeNull();
  });

  it('writes the workshop’s build file', () => {
    const document = JSON.parse(workshopDocument(island()));
    expect(document).toMatchObject({ version: 1, parts: [] });
    expect(document.assembly.bricks).toHaveLength(island().bricks.length);
  });
});

describe('save files', () => {
  it('round-trips an island’s changes', () => {
    const save = createSaveFile(42, [
      { op: 'add', brick: piece('p-a', '3003', 1, 3, 1) },
      { op: 'remove', id: 'g-0-0' },
    ]);
    expect(readSaveFile(JSON.parse(JSON.stringify(save)))).toEqual(save);
  });

  it('refuses files that are not saves, or are damaged', () => {
    expect(() => readSaveFile({ assembly: {} })).toThrow('not a Brick Island save');
    const save = createSaveFile(42, []);
    expect(() => readSaveFile({ ...save, seed: 'x' })).toThrow('no island seed');
    expect(() => readSaveFile({ ...save, edits: [{ op: 'add', brick: { id: 1 } }] })).toThrow(
      'damaged',
    );
    expect(() => readSaveFile({ ...save, worldVersion: 99 })).toThrow('generator');
  });
});
