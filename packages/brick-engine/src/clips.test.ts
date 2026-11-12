import { describe, expect, it } from 'vite-plus/test';
import {
  applyPatch,
  assessPhysicalFeasibility,
  footprint,
  getMountHosts,
  hasClipConnection,
  placeBrick,
  planInstructionSteps,
  removeBrick,
  seatOnSideStuds,
  validateAddition,
  validateAssembly,
} from './index.ts';
import type { Assembly, Brick, Rotation } from './index.ts';

const board: Assembly = { name: 'Clips', buildArea: 16, bricks: [] };
const piece = (id: string, partId: string, x: number, y: number, z: number, more = {}): Brick => ({
  id,
  partId,
  color: 0,
  x,
  y,
  z,
  rotation: 0,
  ...more,
});

/** A 2 x 2 brick with an antenna on its corner stud: the antenna's shaft runs 4.5 to 14.5 up. */
const flagpole = [piece('base', '3003', 0, 0, 0), piece('pole', '3957a', 0, 3, 0)];
const flag = (y: number, more = {}) => piece('flag', '2335', 0, y, 0, more);

/** Two clip plates on 1 x 1 bricks, their clips three studs apart in the row in front. */
const clipRow = [
  piece('left-post', '3005', 6, 0, 1),
  piece('right-post', '3005', 9, 0, 1),
  piece('left-clip', '4081b', 6, 3, 0),
  piece('right-clip', '4081b', 9, 3, 0),
];
/** A loose 4L bar laid level along x through both clips: its axis 1.25 plates up its height. */
const bar = piece('bar', '30374', 6, 2.5, 0, { facing: '+x' });

describe('clips and bars', () => {
  it('hangs a flag by its clips anywhere up an antenna, but not off it or past its ends', () => {
    for (const y of [4, 7, 10]) {
      const hung = { ...board, bricks: [...flagpole, flag(y)] };
      expect(validateAssembly(hung), `flag at ${y}`).toEqual([]);
      expect(hasClipConnection(hung.bricks[2], hung.bricks[1])).toBe(true);
    }
    // Either clip alone holds it; with both past the antenna's tip, neither does.
    for (const y of [3.5, 10.5])
      expect(validateAssembly({ ...board, bricks: [...flagpole, flag(y)] })).toEqual([]);
    for (const y of [14.5, 18])
      expect(validateAssembly({ ...board, bricks: [...flagpole, flag(y)] })).toContainEqual(
        expect.objectContaining({ brickId: 'flag', code: 'unsupported' }),
      );
    // Off the bar's line, or turned so its clips miss it, nothing holds the flag.
    for (const off of [{ x: 1 }, { z: 0.5 }, { rotation: 180 as Rotation }])
      expect(validateAssembly({ ...board, bricks: [...flagpole, flag(6, off)] })).toContainEqual(
        expect.objectContaining({ brickId: 'flag', code: 'unsupported' }),
      );
    // Turned a quarter, the cloth flies the other way off the same pole.
    expect(
      validateAssembly({ ...board, bricks: [...flagpole, flag(6, { rotation: 90 })] }),
    ).toEqual([]);
    // The pole can't come out from under the flag.
    const hung = { ...board, bricks: [...flagpole, flag(6)] };
    expect(removeBrick(hung, 'pole').ok).toBe(false);
    expect(removeBrick(hung, 'flag').ok).toBe(true);
  });

  it('lays a loose bar level between two clips, held while either still grips it', () => {
    const held = { ...board, bricks: [...clipRow, bar] };
    expect(validateAssembly(held)).toEqual([]);
    expect(footprint(bar)).toEqual({ width: 4, depth: 1, height: 2.5 });
    expect(removeBrick(held, 'left-clip').ok).toBe(true);
    const oneClip = { ...board, bricks: held.bricks.filter((brick) => brick.id !== 'left-clip') };
    expect(removeBrick(oneClip, 'right-clip').ok).toBe(false);
    // Upright, or a plate too high, the clips miss it; nothing else holds a loose bar.
    for (const missed of [{ facing: undefined }, { y: 3 }])
      expect(
        validateAssembly({ ...board, bricks: [...clipRow, { ...bar, ...missed }] }),
      ).toContainEqual(expect.objectContaining({ brickId: 'bar', code: 'unsupported' }));
  });

  it('keeps clips and the bars they grip from colliding, but not other pieces', () => {
    expect(
      validateAssembly({
        ...board,
        bricks: [...flagpole, flag(6), piece('block', '3005', 0, 9, 1)],
      }),
    ).toContainEqual(expect.objectContaining({ brickId: 'block', code: 'collision' }));
  });

  it('turns a held flag with the rest of the build', () => {
    const hung = [...flagpole, flag(6)];
    const turned = hung.map((brick) => ({
      ...brick,
      x: 16 - brick.x - footprint(brick).width,
      z: 16 - brick.z - footprint(brick).depth,
      rotation: ((brick.rotation + 180) % 360) as Rotation,
    }));
    expect(validateAssembly({ ...board, bricks: turned })).toEqual([]);
  });

  it('reports what holds each hanging piece, for gravity and building order', () => {
    const hung = { ...board, bricks: [...flagpole, flag(6), ...clipRow, bar] };
    const hosts = getMountHosts(hung.bricks);
    expect(hosts.get('flag')).toEqual(['pole']);
    expect(new Set(hosts.get('bar'))).toEqual(new Set(['left-clip', 'right-clip']));
    expect(hosts.has('pole')).toBe(false);
    const assessment = assessPhysicalFeasibility(hung, { estimateMissingMasses: true });
    expect(assessment.reasons.join(' ')).not.toContain('no upright host');
    // The bar clamps its two clip posts together: they stand or fall as one.
    const row = assessment.groundedGroups.find((group) => group.pieceCount === 5);
    expect(row?.support.map(({ x }) => x).sort((a, b) => a - b)).toEqual([6, 6, 10, 10]);
    expect(assessment.connections.some((joint) => joint.studCount === 0)).toBe(false);
    const order = planInstructionSteps(hung, { maxPiecesPerStep: 1 }).flatMap(
      (step) => step.brickIds,
    );
    expect(order.indexOf('flag')).toBeGreaterThan(order.indexOf('pole'));
    expect(order.indexOf('bar')).toBeGreaterThan(order.indexOf('right-clip'));
  });

  it('places clip and bar pieces one at a time with the same result as in full', () => {
    let assembly: Assembly = board;
    for (const brick of [...flagpole, flag(6), ...clipRow, bar]) {
      const placed = placeBrick(assembly, brick);
      expect(placed.ok, brick.id).toBe(true);
      if (placed.ok) assembly = placed.assembly;
    }
    expect(validateAddition(assembly, piece('extra', '2335', 4, 0, 4))).toBeNull();
    expect(validateAssembly({ ...assembly, bricks: [...assembly.bricks] })).toEqual([]);
  });

  it('slides a held flag up and down its pole half a plate at a time', () => {
    let assembly: Assembly = { ...board, bricks: [...flagpole, flag(6)] };
    for (const y of [6.5, 7, 7.5, 7, 6.5]) {
      const moved = applyPatch(assembly, {
        operations: [{ type: 'update', id: 'flag', changes: { y } }],
      });
      expect(moved.ok, `flag to ${y}`).toBe(true);
      if (moved.ok) assembly = moved.assembly;
    }
    const tooHigh = applyPatch(assembly, {
      operations: [{ type: 'update', id: 'flag', changes: { y: 18 } }],
    });
    expect(tooHigh.ok).toBe(false);
  });

  it('tips a held bar over, and reads a cleared facing as standing it upright', () => {
    const held: Assembly = { ...board, bricks: [...clipRow, bar] };
    const tipped = applyPatch(held, {
      operations: [{ type: 'update', id: 'bar', changes: { facing: '-x' } }],
    });
    expect(tipped.ok && tipped.assembly.bricks.at(-1)?.facing).toBe('-x');
    // Upright the clips miss the bar: refused for that, not as a malformed patch.
    const upright = applyPatch(held, {
      operations: [{ type: 'update', id: 'bar', changes: { facing: null } }],
    });
    expect(upright.ok).toBe(false);
    if (!upright.ok) {
      expect(upright.error.code).toBe('geometry_rejected');
      expect(upright.error.issues).toContainEqual(
        expect.objectContaining({ brickId: 'bar', code: 'unsupported' }),
      );
    }
  });

  it('seats a piece tipped against a wall onto the nearest side stud facing its way', () => {
    for (const rotation of [0, 90, 180, 270] as Rotation[]) {
      const host = piece('host', '87087', 8, 0, 8, { rotation });
      const facing = (['-x', '+z', '+x', '-z'] as const)[rotation / 90];
      // Flush against the host's footprint, a plate low: off the stud, until seated.
      const near = piece('brick', '3004', 6, 0, 6, { facing });
      const seated = seatOnSideStuds(near, host);
      expect(seated, `rotation ${rotation}`).not.toBeNull();
      expect(validateAssembly({ ...board, bricks: [host, seated!] })).toEqual([]);
      // Facing another way, nothing on the host can take it.
      const across = facing.endsWith('x') ? '-z' : '-x';
      expect(seatOnSideStuds({ ...near, facing: across }, host)).toBeNull();
    }
  });
});
