import { describe, expect, it } from 'vite-plus/test';
import { PadPresses, REPEAT, isPadActive, nextBox, readPads } from './gamepad.ts';
import type { PadButton } from './gamepad.ts';
import type { PadLike } from '@brick-workshop/walk/walk-gamepad';

function pad(
  axes: number[] = [0, 0, 0, 0],
  down: number[] = [],
  values: Record<number, number> = {},
): PadLike {
  return {
    connected: true,
    axes,
    buttons: Array.from({ length: 17 }, (_, index) => ({
      pressed: down.includes(index),
      value: values[index] ?? (down.includes(index) ? 1 : 0),
    })),
  };
}

const box = (left: number, top: number, size = 50) => ({
  left,
  top,
  right: left + size,
  bottom: top + size,
});

describe('brick-world gamepad', () => {
  it('reads buttons, triggers and the right stick from every pad', () => {
    expect(readPads([null])).toBeNull();
    const state = readPads([pad([0, 0, 0, 1], [2]), pad([0, 0, 0, 0], [], { 7: 0.5 })])!;
    expect([...state.down].sort()).toEqual(['rt', 'x']);
    expect(state.scroll.y).toBe(1);
  });

  it('counts a left stick pushed well over as the d-pad in panels', () => {
    expect([...readPads([pad([0.9, 0.2])], true)!.down]).toEqual(['right']);
    expect([...readPads([pad([0.1, -0.9])], true)!.down]).toEqual(['up']);
    expect(readPads([pad([0.4, 0])], true)!.down.size).toBe(0);
  });

  it('leaves the left stick to walking while playing', () => {
    expect(readPads([pad([0, 0.9])])!.down.size).toBe(0);
    expect(readPads([pad([-0.9, 0])])!.down.size).toBe(0);
  });

  it('counts the controller as in use only while a button is down or a stick pushed', () => {
    expect(isPadActive([pad()])).toBe(false);
    expect(isPadActive([null, pad([0.05, -0.1, 0, 0])])).toBe(false);
    // Triggers some browsers report as axes, resting at -1.
    expect(isPadActive([pad([0, 0, 0, 0, -1, -1])])).toBe(false);
    expect(isPadActive([pad([0, 0, 0, 0.8])])).toBe(true);
    expect(isPadActive([pad(undefined, [1])])).toBe(true);
    expect(isPadActive([{ ...pad(undefined, [1]), connected: false }])).toBe(false);
  });

  it('presses once on the way down and repeats only repeating buttons', () => {
    const presses = new PadPresses();
    const repeating = new Set<PadButton>(['rt']);
    const down = new Set<PadButton>(['rt', 'a']);
    expect([...presses.update(down, 0, repeating)].sort()).toEqual(['a', 'rt']);
    expect(presses.update(down, 100, repeating).size).toBe(0);
    expect([...presses.update(down, REPEAT.delay, repeating)]).toEqual(['rt']);
    expect(presses.update(down, REPEAT.delay + 10, repeating).size).toBe(0);
    expect([...presses.update(down, REPEAT.delay + REPEAT.every, repeating)]).toEqual(['rt']);
    presses.update(new Set(), 1000, repeating);
    expect([...presses.update(new Set<PadButton>(['a']), 1010, repeating)]).toEqual(['a']);
  });

  it('moves to the nearest box that way, preferring one straight ahead', () => {
    // A grid of three columns and two rows.
    const grid = [box(0, 0), box(60, 0), box(120, 0), box(0, 60), box(60, 60), box(120, 60)];
    const others = (index: number) => grid.filter((_, at) => at !== index);
    const move = (index: number, direction: 'up' | 'down' | 'left' | 'right') => {
      const list = others(index);
      const found = nextBox(grid[index], list, direction);
      return found < 0 ? -1 : grid.indexOf(list[found]);
    };
    expect(move(0, 'right')).toBe(1);
    expect(move(1, 'down')).toBe(4);
    expect(move(4, 'left')).toBe(3);
    expect(move(5, 'up')).toBe(2);
    expect(move(2, 'right')).toBe(-1);
    expect(move(0, 'up')).toBe(-1);
  });
});
