import { describe, expect, it } from 'vite-plus/test';
import { PLATE_HEIGHT } from '@brick-workshop/engine';
import type { Assembly, Brick } from '@brick-workshop/engine';
import { aimAt, placementFor, replayEdits, tryPlace, tryRemove } from './build.ts';

const AREA = 16;
const brick = (id: string, partId: string, x: number, y: number, z: number): Brick => ({
  id,
  partId,
  color: 4,
  x,
  y,
  z,
  rotation: 0,
});
/** A scene point from build-grid studs and plates (the scene centres the board, z flipped). */
const scene = (x: number, plates: number, z: number) => ({
  x: x - AREA / 2,
  y: plates * PLATE_HEIGHT,
  z: AREA / 2 - z,
});

describe('aiming', () => {
  const base = brick('base', '3003', 4, 0, 4);

  it('finds the top, the sides and the bottom of a piece', () => {
    expect(aimAt(scene(5, 3, 5), base, AREA).face).toBe('top');
    expect(aimAt(scene(4.02, 1.5, 5), base, AREA).face).toBe('x-');
    expect(aimAt(scene(5.98, 1.5, 5), base, AREA).face).toBe('x+');
    expect(aimAt(scene(5, 1.5, 4.02), base, AREA).face).toBe('z-');
    expect(aimAt(scene(5, 1.5, 5.98), base, AREA).face).toBe('z+');
    expect(aimAt(scene(5, 0, 5), base, AREA).face).toBe('bottom');
  });

  it('puts a held piece on top centred under the crosshair, or beside the aimed one', () => {
    const held = { partId: '3003', color: 15, rotation: 0 as const };
    const top = placementFor(aimAt(scene(5.2, 3, 5.4), base, AREA), held, 'new', AREA);
    expect(top).toMatchObject({ x: 4, y: 3, z: 4 });
    const side = placementFor(aimAt(scene(5.98, 1.5, 5), base, AREA), held, 'new', AREA);
    expect(side).toMatchObject({ x: 6, y: 0, z: 4 });
  });

  it('keeps a placement on the board', () => {
    const corner = brick('corner', '3003', 0, 0, 0);
    const held = { partId: '3001', color: 15, rotation: 0 as const };
    const placed = placementFor(aimAt(scene(0.02, 1.5, 1), corner, AREA), held, 'new', AREA);
    expect(placed.x).toBe(0);
  });
});

describe('building', () => {
  const world: Assembly = {
    name: 'test',
    buildArea: AREA,
    bricks: [brick('ground', '3001', 4, 0, 4), brick('flower', '3024', 4, 3, 4)],
  };

  it('places a piece on studs and refuses one in the air or in the way', () => {
    expect(tryPlace(world, brick('on', '3003', 5, 3, 6)).ok).toBe(true);
    expect(tryPlace(world, brick('air', '3003', 10, 6, 10))).toEqual({
      ok: false,
      reason: 'Nothing holds it there.',
    });
    expect(tryPlace(world, brick('clash', '3003', 4, 0, 4))).toEqual({
      ok: false,
      reason: 'Something is in the way.',
    });
  });

  it('takes a piece off with what rests only on it', () => {
    const result = tryRemove(world, 'ground');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.removed.sort()).toEqual(['flower', 'ground']);
      expect(result.assembly.bricks).toEqual([]);
    }
  });

  it('refuses a break that would bring down a whole stack', () => {
    const tower: Brick[] = [brick('foot', '3003', 0, 0, 0)];
    for (let level = 1; level <= 30; level++)
      tower.push(brick(`t${level}`, '3003', 0, level * 3, 0));
    const result = tryRemove({ name: 'tower', buildArea: AREA, bricks: tower }, 'foot');
    expect(result).toEqual({ ok: false, reason: 'Too much rests on it.' });
  });

  it('replays saved edits over the generated world', () => {
    const replayed = replayEdits(world, [
      { op: 'remove', id: 'flower' },
      { op: 'add', brick: brick('mine', '3003', 5, 3, 6) },
    ]);
    expect(replayed.bricks.map((piece) => piece.id)).toEqual(['ground', 'mine']);
  });
});
