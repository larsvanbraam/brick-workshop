import { describe, expect, it } from 'vite-plus/test';
import type { Brick } from './index.ts';
import { layTrack } from './examples/layout.ts';
import type { TrackPoint } from './examples/layout.ts';
import { traceTrack } from './track.ts';

function lay(from: TrackPoint, path: string) {
  const bricks: Brick[] = [];
  layTrack(
    (partId, color, x, y, z, rotation = 0, _facing, _flipped, _tilt, _strung, yaw) => {
      bricks.push({
        id: `t${bricks.length}`,
        partId,
        color,
        x,
        y,
        z,
        rotation,
        ...(yaw ? { yaw } : {}),
      });
    },
    72,
    from,
    path,
  );
  return bricks;
}

describe('traceTrack', () => {
  it('rides a straight line from its open end to the other', () => {
    const path = traceTrack({ bricks: lay({ x: 4, y: 0, z: 10, angle: 0 }, 'SSS') });
    expect(path.closed).toBe(false);
    expect(path.length).toBeCloseTo(48, 1);
    expect(path.pointAt(0).x).toBeCloseTo(4, 1);
    expect(path.pointAt(24)).toMatchObject({ z: expect.closeTo(10, 1), angle: 0 });
    expect(path.pointAt(24).x).toBeCloseTo(28, 1);
    expect(path.pointAt(999).x).toBeCloseTo(52, 1);
    expect(path.pointAt(-5).x).toBeCloseTo(4, 1);
  });

  it('can start from either end', () => {
    const bricks = lay({ x: 4, y: 0, z: 10, angle: 0 }, 'SS');
    const back = traceTrack({ bricks }, { brickId: 't1', end: 1 });
    expect(back.pointAt(0).x).toBeCloseTo(36, 1);
    expect(back.pointAt(back.length).x).toBeCloseTo(4, 1);
    expect(back.pointAt(0).angle).toBeCloseTo(180, 1);
  });

  it('follows a curve through its heading change at the arc length', () => {
    const path = traceTrack({ bricks: lay({ x: 20, y: 0, z: 40, angle: 0 }, 'SRS') });
    expect(path.length).toBeCloseTo(32 + (40 * Math.PI) / 8, 0);
    const start = path.pointAt(16);
    const end = path.pointAt(16 + (40 * Math.PI) / 8);
    expect(start.angle).toBeCloseTo(0, 1);
    expect(end.angle).toBeCloseTo(22.5, 1);
  });

  it('closes a ring of sixteen curves into a loop that wraps', () => {
    const path = traceTrack({ bricks: lay({ x: 60, y: 0, z: 20, angle: 0 }, 'R'.repeat(16)) });
    expect(path.closed).toBe(true);
    expect(path.segments).toHaveLength(16);
    const a = path.pointAt(5);
    const b = path.pointAt(5 + path.length);
    expect(b.x).toBeCloseTo(a.x, 3);
    expect(b.z).toBeCloseTo(a.z, 3);
    expect(b.angle).toBeCloseTo(a.angle, 3);
  });

  it('is continuous along the whole line', () => {
    const path = traceTrack({ bricks: lay({ x: 40, y: 0, z: 40, angle: 0 }, 'SRRRSLLS') });
    let last = path.pointAt(0);
    for (let d = 0.25; d <= path.length; d += 0.25) {
      const next = path.pointAt(d);
      expect(Math.hypot(next.x - last.x, next.z - last.z)).toBeLessThan(0.3);
      last = next;
    }
  });
});
