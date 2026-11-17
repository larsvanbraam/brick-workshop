import { describe, expect, it } from 'vite-plus/test';
import { getLDrawTransform, getWorldBounds, validateAssembly } from './index.ts';
import type { Brick } from './index.ts';

const track = (
  id: string,
  x: number,
  z: number,
  yaw?: number,
  y = 0,
  rotation = 90 as const,
): Brick => ({
  id,
  partId: '74746',
  color: 72,
  x,
  y,
  z,
  rotation,
  ...(yaw === undefined ? {} : { yaw }),
});
const assembly = (bricks: Brick[], buildArea = 48) => ({ name: 'yaw', bricks, buildArea });
const codes = (bricks: Brick[], buildArea = 48) =>
  validateAssembly(assembly(bricks, buildArea)).map((issue) => issue.code);

describe('yawed pieces', () => {
  it('stand on the ground at every yaw angle, off the stud grid', () => {
    for (const yaw of [22.5, 45, 67.5]) expect(codes([track('a', 10.37, 12.91, yaw)])).toEqual([]);
  });

  it('are refused for a wrong angle, a part that cannot turn and a position off the 0.01 grid', () => {
    expect(codes([track('a', 10, 10, 30)])).toEqual(['invalid']);
    expect(codes([track('a', 10, 10, 0)])).toEqual(['invalid']);
    expect(codes([track('a', 10.005, 10, 22.5)])).toEqual(['invalid']);
    expect(
      codes([{ id: 'b', partId: '3001', color: 4, x: 1, y: 0, z: 1, rotation: 0, yaw: 22.5 }]),
    ).toEqual(['invalid']);
  });

  it('must keep the whole turned body on the board', () => {
    // 16 studs long turned 45 degrees reaches about 17 studs across, so 8 + 17 fits on 48 but not at the edge.
    expect(codes([track('a', 1, 5, 45)])).toEqual([]);
    expect(codes([track('a', 36, 5, 45)])).toEqual(['invalid']);
    expect(codes([track('a', 1, 1, 45)])).toEqual(['invalid']);
  });

  it('collide with what they cross, and with each other', () => {
    const wall: Brick = { id: 'w', partId: '3001', color: 4, x: 20, y: 0, z: 20, rotation: 0 };
    // The track's box is turned 45 degrees over the wall.
    expect(codes([wall, track('a', 12, 16, 45)])).toContain('collision');
    expect(codes([wall, track('a', 12, 30, 45)])).toEqual([]);
    expect(codes([track('a', 10, 10, 45), track('b', 12, 12, 45)])).toContain('collision');
  });

  it('end to end at an angle stand without a collision', () => {
    // Two 16 stud sections along the 22.5 degree line, the second one a section length on.
    const [cosine, sine] = [Math.cos((22.5 * Math.PI) / 180), Math.sin((22.5 * Math.PI) / 180)];
    // Turned about the middle, a section at rotation 90 runs along (cos, -sin).
    const b = track('b', 10 + 16 * cosine, 10 - 16 * sine, 22.5);
    const [x, z] = [Math.round(b.x * 100) / 100, Math.round(b.z * 100) / 100];
    expect(
      codes(
        [track('a', 10, 10, 22.5), { ...b, x, z: z + 0 }].map((brick) => ({
          ...brick,
          z: brick.z + 8,
        })),
      ),
    ).toEqual([]);
  });

  it('rest on the top of what lies under them, and not above empty ground', () => {
    const plate: Brick = { id: 'p', partId: '3460', color: 2, x: 14, y: 0, z: 14, rotation: 90 };
    expect(codes([plate, track('a', 10, 10, 22.5, 1)])).toEqual([]);
    expect(codes([track('a', 10, 10, 22.5, 1)])).toEqual(['unsupported']);
  });

  it('turn the LDraw model by the yaw on top of the quarter turn', () => {
    const upright = getLDrawTransform(track('a', 10, 10));
    const turned = getLDrawTransform(track('a', 10, 10, 45));
    expect(upright.matrix).toEqual([-1, 0, 0, 0, 1, 0, 0, 0, -1]);
    const root = Math.SQRT1_2;
    expect(turned.matrix[0]).toBeCloseTo(-root, 6);
    expect(turned.matrix[2]).toBeCloseTo(-root, 6);
    // Turned about the middle of its cells: the centre of the track does not move.
    expect(turned.x).toBeCloseTo(upright.x, 3);
    expect(turned.z).toBeCloseTo(upright.z, 3);
  });

  it('have world bounds that hold the turned body', () => {
    const level = getWorldBounds(track('a', 10, 10));
    expect(level.maxX - level.minX).toBe(16);
    const turned = getWorldBounds(track('a', 10, 10, 45));
    expect(turned.maxX - turned.minX).toBeCloseTo((16 + 8) * Math.SQRT1_2, 5);
  });
});
