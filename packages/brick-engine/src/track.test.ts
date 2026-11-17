import { describe, expect, it } from 'vite-plus/test';
import { createExampleAssembly } from './index.ts';
import type { Brick } from './index.ts';
import { findTrackLinks, trackEnds, trackWarnings } from './track.ts';

const section = (
  id: string,
  x: number,
  z: number,
  rotation: 0 | 90 | 180 | 270 = 90,
  y = 5,
): Brick => ({
  id,
  partId: '74746',
  color: 72,
  x,
  y,
  z,
  rotation,
});

describe('track links', () => {
  it('gives each straight two ends along its length', () => {
    expect(trackEnds(section('a', 0, 0)).map((e) => [e.x, e.z, e.heading])).toEqual([
      [0, 4, '-x'],
      [16, 4, '+x'],
    ]);
    expect(trackEnds(section('a', 0, 0, 0)).map((e) => [e.x, e.z, e.heading])).toEqual([
      [4, 0, '-z'],
      [4, 16, '+z'],
    ]);
  });

  it("links sections laid end to end and leaves the line's ends loose", () => {
    const { links, loose } = findTrackLinks({
      bricks: [section('a', 0, 0), section('b', 16, 0), section('c', 32, 0)],
    });
    expect(links).toEqual([
      ['a', 'b'],
      ['b', 'c'],
    ]);
    expect(loose.map((e) => e.brickId).sort()).toEqual(['a', 'c']);
  });

  it('does not link a gap, a step, a sideways slip or a crosswise section', () => {
    for (const other of [
      section('b', 17, 0),
      section('b', 16, 0, 90, 6),
      section('b', 16, 1),
      section('b', 16, 0, 0),
    ])
      expect(findTrackLinks({ bricks: [section('a', 0, 0), other] }).links).toEqual([]);
  });

  it('runs the Western railway as one unbroken line', () => {
    const { links, loose } = findTrackLinks(createExampleAssembly('western-town'));
    expect(links).toHaveLength(2);
    expect(loose).toHaveLength(2);
  });

  it("warns about near misses, not about a line's open ends", () => {
    expect(trackWarnings({ bricks: [section('a', 0, 0), section('b', 16, 0)] })).toEqual([]);
    expect(trackWarnings({ bricks: [section('a', 0, 0), section('b', 100, 0)] })).toEqual([]);
    for (const other of [
      section('b', 17, 0),
      section('b', 15, 0),
      section('b', 16, 0, 90, 6),
      section('b', 16, 1),
      section('b', 12, 4, 0),
    ]) {
      const warnings = trackWarnings({ bricks: [section('a', 0, 0), other] });
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]!.brickIds).toEqual(['a', 'b']);
    }
  });

  it('has no warnings in the Western town', () => {
    expect(trackWarnings(createExampleAssembly('western-town'))).toEqual([]);
  });
});
