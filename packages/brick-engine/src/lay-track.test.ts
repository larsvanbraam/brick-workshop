import { describe, expect, it } from 'vite-plus/test';
import { validateAssembly } from './index.ts';
import type { Brick } from './index.ts';
import { layTrack } from './examples/layout.ts';
import type { TrackPoint } from './examples/layout.ts';
import { findTrackLinks, trackWarnings } from './track.ts';

function lay(from: TrackPoint, path: string) {
  const bricks: Brick[] = [];
  const result = layTrack(
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
  return { bricks, ...result };
}

describe('layTrack', () => {
  it('lays a straight line that the engine validates and links', () => {
    const { bricks, end } = lay({ x: 4, y: 0, z: 10, angle: 0 }, 'SSS');
    expect(bricks).toHaveLength(3);
    expect(end.x).toBeCloseTo(52, 1);
    expect(end.z).toBeCloseTo(10, 1);
    expect(findTrackLinks({ bricks }).links).toHaveLength(2);
    expect(validateAssembly({ name: 't', bricks, buildArea: 64 })).toEqual([]);
  });

  it('runs along any heading, and validates a straight line at an angle', () => {
    for (const angle of [90, 180, 270, 22.5, 45, 67.5, 135, 315]) {
      const start: TrackPoint = { x: 40, y: 0, z: 40, angle };
      const { bricks, end } = lay(start, 'SS');
      const lead = (angle * Math.PI) / 180;
      expect(end.x, `${angle}`).toBeCloseTo(start.x + 32 * Math.cos(lead), 1);
      expect(end.z, `${angle}`).toBeCloseTo(start.z + 32 * Math.sin(lead), 1);
      expect(end.angle, `${angle}`).toBeCloseTo(angle, 1);
      expect(findTrackLinks({ bricks }).links, `${angle}`).toHaveLength(1);
      expect(validateAssembly({ name: 't', bricks, buildArea: 96 }), `${angle}`).toEqual([]);
    }
  });

  it('closes a ring of sixteen curves where it began, heading the same way', () => {
    const from: TrackPoint = { x: 60, y: 0, z: 20, angle: 0 };
    const { bricks, end } = lay(from, 'R'.repeat(16));
    expect(bricks).toHaveLength(16);
    expect(end.x).toBeCloseTo(from.x, 1);
    expect(end.z).toBeCloseTo(from.z, 1);
    expect(((end.angle % 360) + 360) % 360).toBeCloseTo(0, 1);
    // Every curve meets the next, and the last meets the first, so none is left loose.
    const { links, loose } = findTrackLinks({ bricks });
    expect(links).toHaveLength(16);
    expect(loose).toEqual([]);
  });

  it('turns left with L and right with R', () => {
    const right = lay({ x: 10, y: 0, z: 40, angle: 0 }, 'R').end;
    const left = lay({ x: 10, y: 0, z: 40, angle: 0 }, 'L').end;
    expect(right.angle).toBeCloseTo(22.5, 1);
    expect(left.angle).toBeCloseTo(337.5, 1);
    expect(right.z).toBeGreaterThan(40);
    expect(left.z).toBeLessThan(40);
  });

  it('makes an S bend that ends parallel to where it began', () => {
    const { end, bricks } = lay({ x: 10, y: 0, z: 40, angle: 0 }, 'SRLS');
    expect(((end.angle % 360) + 360) % 360).toBeCloseTo(0, 1);
    expect(end.z).toBeGreaterThan(40);
    expect(findTrackLinks({ bricks }).links).toHaveLength(3);
    expect(trackWarnings({ bricks })).toEqual([]);
  });

  it('lays a branch from a switch', () => {
    const { bricks, end, branches } = lay({ x: 4, y: 0, z: 30, angle: 0 }, 'SrS');
    expect(branches).toHaveLength(1);
    expect(end.angle).toBeCloseTo(0, 1);
    const spur = lay(branches[0]!, 'SS');
    expect(spur.bricks).toHaveLength(2);
    const all = [...bricks, ...spur.bricks.map((brick) => ({ ...brick, id: `s${brick.id}` }))];
    // The route: straight, switch, straight; the spur's two straights; one link into the branch.
    expect(findTrackLinks({ bricks: all }).links).toHaveLength(4);
    expect(spur.end.angle).toBeCloseTo(337.5, 1);
  });

  it('refuses a letter it does not know', () => {
    expect(() => lay({ x: 4, y: 0, z: 4, angle: 0 }, 'SX')).toThrow(/Unknown track step/);
  });
});

describe('track collisions', () => {
  const codes = (bricks: Brick[], buildArea = 96) =>
    validateAssembly({ name: 't', bricks, buildArea }).map((issue) => issue.code);

  it('lets a whole ring of curves stand, joints and all', () => {
    // A ring of radius 40 studs, so it needs the larger board.
    const { bricks } = lay({ x: 60, y: 0, z: 20, angle: 0 }, 'R'.repeat(16));
    expect(codes(bricks, 128)).toEqual([]);
  });

  it('lets an S bend and a switch with its branch stand', () => {
    expect(codes(lay({ x: 10, y: 0, z: 40, angle: 0 }, 'SRLS').bricks)).toEqual([]);
    const { bricks, branches } = lay({ x: 4, y: 0, z: 40, angle: 0 }, 'SrS');
    const spur = lay(branches[0]!, 'SS').bricks.map((brick) => ({ ...brick, id: `s${brick.id}` }));
    expect(codes([...bricks, ...spur])).toEqual([]);
  });

  it('lets a brick stand in the empty corner of a switch box, but not on the rails', () => {
    // A right switch at (10, 10): its box reaches the branch side, where the route's far
    // corner is open ground.
    const { bricks } = lay({ x: 4, y: 0, z: 40, angle: 0 }, 'r');
    const sw = bricks[0]!;
    const brick = (id: string, x: number, z: number): Brick => ({
      id,
      partId: '3001',
      color: 4,
      x,
      y: 0,
      z,
      rotation: 0,
    });
    // A switch's route runs through z = 40 from x = 4; its branch leaves toward -z.
    expect(codes([sw, brick('on', 20, 38)])).toContain('collision');
    expect(codes([sw, brick('corner', 36, 55)])).toEqual([]);
  });

  it('still collides with a brick across a curve', () => {
    const { bricks } = lay({ x: 40, y: 0, z: 40, angle: 0 }, 'R');
    const brick: Brick = { id: 'w', partId: '3001', color: 4, x: 48, y: 0, z: 38, rotation: 0 };
    expect(codes([...bricks, brick])).toContain('collision');
  });

  it('still collides with track that does not join it', () => {
    const { bricks } = lay({ x: 4, y: 0, z: 40, angle: 0 }, 'S');
    const crossing = lay({ x: 12, y: 0, z: 30, angle: 90 }, 'S').bricks.map((brick) => ({
      ...brick,
      id: `x${brick.id}`,
    }));
    expect(codes([...bricks, ...crossing])).toContain('collision');
  });
});
