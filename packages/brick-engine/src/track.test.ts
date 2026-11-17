import { describe, expect, it } from 'vite-plus/test';
import { SWITCH_TRACKS, createExampleAssembly, trackEnds } from './index.ts';
import type { Brick, Rotation, TrackEnd } from './index.ts';
import { findTrackLinks, trackWarnings } from './track.ts';

const section = (
  id: string,
  x: number,
  z: number,
  rotation: Rotation = 90,
  y = 5,
  yaw?: number,
): Brick => ({
  id,
  partId: '74746',
  color: 72,
  x,
  y,
  z,
  rotation,
  ...(yaw ? { yaw } : {}),
});

/** A straight whose near end meets `end`, so that the line goes on the way `end` leads. */
const straightFrom = (id: string, end: TrackEnd): Brick => {
  const turn = (((-end.angle - 90) % 360) + 360) % 360;
  const yaw = turn % 90;
  const rotation = (turn - yaw) as Rotation;
  const lead = (end.angle * Math.PI) / 180;
  const [cx, cz] = [end.x + 8 * Math.cos(lead), end.z + 8 * Math.sin(lead)];
  const [width, depth] = rotation % 180 ? [16, 8] : [8, 16];
  const round = (value: number) => Math.round(value * 100) / 100;
  return section(id, round(cx - width / 2), round(cz - depth / 2), rotation, end.y, yaw);
};

const ends = (brick: Brick) =>
  trackEnds(brick)
    .map((e) => [e.x, e.z, e.angle])
    .sort();

describe('track links', () => {
  it('gives each straight two ends, leading out along its length', () => {
    expect(ends(section('a', 0, 0))).toEqual([
      [0, 4, 180],
      [16, 4, 0],
    ]);
    expect(ends(section('a', 0, 0, 0))).toEqual([
      [4, 0, 270],
      [4, 16, 90],
    ]);
  });

  it('turns the ends with a yaw', () => {
    const [near, far] = trackEnds(section('a', 10, 10, 90, 5, 45)).toSorted((a, b) => a.x - b.x);
    expect(near!.angle).toBeCloseTo(135, 1);
    expect(far!.angle).toBeCloseTo(315, 1);
    // Eight studs either way from the middle (18, 14), along the turned line.
    expect(far!.x - 18).toBeCloseTo(8 * Math.SQRT1_2, 2);
    expect(far!.z - 14).toBeCloseTo(-8 * Math.SQRT1_2, 2);
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
      section('b', 12, 4, 0),
    ])
      expect(findTrackLinks({ bricks: [section('a', 0, 0), other] }).links).toEqual([]);
  });

  it('links a line that bends at every angle', () => {
    for (const yaw of [22.5, 45, 67.5])
      for (const rotation of [0, 90, 180, 270] as const) {
        const first = section('a', 20, 20, rotation, 5, yaw);
        const [end] = trackEnds(first).toSorted((a, b) => b.x - a.x);
        const second = straightFrom('b', end!);
        const { links } = findTrackLinks({ bricks: [first, second] });
        expect(links, `yaw ${yaw}, rotation ${rotation}`).toEqual([['a', 'b']]);
      }
  });

  it('does not link a line that is a little off the angle', () => {
    const first = section('a', 20, 20, 90, 5, 22.5);
    const [end] = trackEnds(first).toSorted((a, b) => b.x - a.x);
    const slipped = straightFrom('b', { ...end!, angle: end!.angle + 22.5 });
    expect(findTrackLinks({ bricks: [first, slipped] }).links).toEqual([]);
  });

  it('gives a curve ends 22.5 degrees apart', () => {
    const [left, right] = trackEnds({
      id: 'c',
      partId: '74747',
      color: 72,
      x: 10,
      y: 5,
      z: 10,
      rotation: 270,
    }).toSorted((a, b) => a.x - b.x);
    // Turned a quarter, the bend's two ends lead 22.5 degrees apart: 180 - 11.25 and 11.25, rotated.
    const gap = Math.abs(((left!.angle - right!.angle + 540) % 360) - 180);
    expect(gap).toBeCloseTo(157.5, 1);
    expect(Math.hypot(left!.x - right!.x, left!.z - right!.z)).toBeCloseTo(15.6, 1);
  });

  it('links a straight to a switch route and to its branch', () => {
    for (const partId of SWITCH_TRACKS)
      for (const rotation of [0, 90, 180, 270] as const) {
        const switchBrick: Brick = { ...section('s', 30, 30, rotation), partId };
        const all = trackEnds(switchBrick);
        expect(all).toHaveLength(3);
        const straights = all.map((end, index) => straightFrom(`t${index}`, end));
        const { links } = findTrackLinks({ bricks: [switchBrick, ...straights] });
        expect(links, `${partId} at ${rotation}`).toHaveLength(3);
      }
  });

  it('puts the branch to -z for a right switch and +z for a left one', () => {
    // At rotation 270 the part's frame is the world's: its +x and +z are the world's.
    for (const [partId, angle, side] of [
      ['75541-f1', 337.5, -1],
      ['75542-f1', 22.5, 1],
    ] as const) {
      const switchBrick: Brick = { ...section('s', 30, 30, 270), partId };
      const branch = trackEnds(switchBrick).find((end) => Math.abs(end.angle - angle) < 0.1);
      expect(branch, partId).toBeDefined();
      const centre = 30 + 10.5;
      expect(Math.sign(branch!.z - centre)).toBe(side);
    }
  });

  it('warns about near misses, not about line open ends', () => {
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

  it('runs the Western railway as one unbroken line', () => {
    const { links, loose } = findTrackLinks(createExampleAssembly('western-town'));
    expect(links).toHaveLength(2);
    expect(loose).toHaveLength(2);
    expect(trackWarnings(createExampleAssembly('western-town'))).toEqual([]);
  });
});
