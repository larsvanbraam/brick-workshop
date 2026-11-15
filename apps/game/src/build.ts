import { PLATE_HEIGHT, footprint, placeBrick, validateAssembly } from '@brick-workshop/engine';
import type { Assembly, Brick, Issue, Rotation } from '@brick-workshop/engine';

export type Face = 'top' | 'bottom' | 'x-' | 'x+' | 'z-' | 'z+';

/** What the crosshair rests on: a piece, the face hit, and the hit in grid studs and plates. */
export interface Aim {
  brick: Brick;
  face: Face;
  x: number;
  y: number;
  z: number;
}

/**
 * Turns a hit in scene space into the face of the piece it lands on, from the piece's footprint
 * rather than the mesh normal, so studs, slopes and LDraw's mirrored transforms all resolve the
 * same way. The scene centres the board and runs z the other way (see `worldZ`).
 */
export function aimAt(
  point: { x: number; y: number; z: number },
  brick: Brick,
  buildArea: number,
): Aim {
  const x = point.x + buildArea / 2;
  const z = buildArea / 2 - point.z;
  const y = point.y / PLATE_HEIGHT;
  const size = footprint(brick);
  if (y >= brick.y + size.height - 0.3) return { brick, face: 'top', x, y, z };
  if (y <= brick.y + 0.05) return { brick, face: 'bottom', x, y, z };
  const sides = [
    ['x-', x - brick.x],
    ['x+', brick.x + size.width - x],
    ['z-', z - brick.z],
    ['z+', brick.z + size.depth - z],
  ] as const;
  const [face] = sides.reduce((nearest, side) => (side[1] < nearest[1] ? side : nearest));
  return { brick, face, x, y, z };
}

/** A stable key for an aim, so the ghost is only worked out again when it would move. */
export function aimKey(aim: Aim | null) {
  return aim
    ? `${aim.brick.id}:${aim.face}:${Math.floor(aim.x * 2)}:${Math.floor(aim.z * 2)}:${Math.floor(aim.y)}`
    : '';
}

export interface Held {
  partId: string;
  color: number;
  rotation: Rotation;
}

/**
 * Where a held piece goes against the aimed face: on top, centred under the crosshair; under it;
 * or beside it, level with the aimed piece's bottom. Kept on the board, and on the stud grid
 * shifted by `snap`, for pieces such as plants that sit half a stud over (see `getSnap`).
 */
export function placementFor(
  aim: Aim,
  held: Held,
  id: string,
  buildArea: number,
  snap: { dx: number; dz: number } = { dx: 0, dz: 0 },
): Brick {
  const probe: Brick = { id, ...held, x: 0, y: 0, z: 0 };
  const size = footprint(probe);
  const target = footprint(aim.brick);
  const centred = (at: number, span: number) => at - span / 2;
  let x = centred(aim.x, size.width);
  let z = centred(aim.z, size.depth);
  let y = aim.brick.y;
  switch (aim.face) {
    case 'top':
      y = aim.brick.y + target.height;
      break;
    case 'bottom':
      y = aim.brick.y - size.height;
      break;
    case 'x-':
      x = aim.brick.x - size.width;
      break;
    case 'x+':
      x = aim.brick.x + target.width;
      break;
    case 'z-':
      z = aim.brick.z - size.depth;
      break;
    case 'z+':
      z = aim.brick.z + target.depth;
      break;
  }
  const grid = (at: number, offset: number, span: number) => {
    const snapped = Math.round(at - offset) + offset;
    // A world without edges (`buildArea` of `Infinity`) keeps the piece where it is.
    return Number.isFinite(buildArea)
      ? Math.max(offset, Math.min(buildArea - span, snapped))
      : snapped;
  };
  x = grid(x, snap.dx, size.width);
  z = grid(z, snap.dz, size.depth);
  return { ...probe, x, y: Math.max(0, y), z };
}

/** One change a player made, replayed over the generated world when it loads again. */
export type Edit =
  | { op: 'add'; brick: Brick }
  /** `chunk` says which chunk the piece taken off belonged to, so edits are kept by chunk. */
  | { op: 'remove'; id: string; chunk?: string };

export type EditResult = { ok: true; assembly: Assembly } | { ok: false; reason: string };

const REASONS: Record<Issue['code'], string> = {
  collision: 'Something is in the way.',
  unsupported: 'Nothing holds it there.',
  invalid: 'It does not fit there.',
};

/** Adds a piece if it rests on studs and clears everything else. */
export function tryPlace(assembly: Assembly, brick: Brick): EditResult {
  const result = placeBrick(assembly, brick);
  return result.ok ? result : { ok: false, reason: REASONS[result.issues[0].code] };
}

/** The most pieces one break may bring down with it: a flower or a slope, not a whole tree. */
const MAX_CASCADE = 24;

export type RemoveResult =
  | { ok: true; assembly: Assembly; removed: string[] }
  | { ok: false; reason: string };

/**
 * Takes a piece off, with whatever then rests on nothing (the flowers and slopes on a ground
 * brick), unless that would bring down more than a handful of pieces.
 */
export function tryRemove(assembly: Assembly, id: string): RemoveResult {
  const gone = new Set([id]);
  // Anything loose is reported at once; another round catches what rested only on that.
  for (let round = 0; round < 4; round++) {
    const next = { ...assembly, bricks: assembly.bricks.filter((brick) => !gone.has(brick.id)) };
    const issues = validateAssembly(next);
    if (!issues.length) return { ok: true, assembly: next, removed: [...gone] };
    if (issues.some((issue) => issue.code !== 'unsupported'))
      return { ok: false, reason: REASONS[issues[0].code] };
    for (const issue of issues) gone.add(issue.brickId);
    if (gone.size > MAX_CASCADE) break;
  }
  return { ok: false, reason: 'Too much rests on it.' };
}

/** Applies saved edits in order, skipping any that no longer apply. */
export function replayEdits(assembly: Assembly, edits: readonly Edit[]): Assembly {
  const bricks = new Map(assembly.bricks.map((brick) => [brick.id, brick]));
  for (const edit of edits) {
    if (edit.op === 'add') bricks.set(edit.brick.id, edit.brick);
    else bricks.delete(edit.id);
  }
  return { ...assembly, bricks: [...bricks.values()] };
}
