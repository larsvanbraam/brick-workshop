import { COLORS, footprint, getPart } from '@brick-workshop/engine';
import type { Brick } from '@brick-workshop/engine';

const OPAQUE = new Set(COLORS.filter((color) => color.alpha === 255).map((color) => color.id));

/**
 * Whether a piece fills its whole box with opaque plastic: a plain brick, plate or tile standing
 * upright, so it both hides what it covers and can be hidden itself. Slopes, rounds, plants and
 * see-through colours leave gaps or show through.
 */
function isSolid(brick: Brick) {
  if (brick.facing || brick.tilt || brick.strung || brick.upsideDown) return false;
  if (!OPAQUE.has(brick.color)) return false;
  const part = getPart(brick.partId);
  return !part.shape && !part.family;
}

/**
 * The pieces not worth drawing: the solid ones boxed in on every side (above, below and all
 * round) by other solid pieces of the same list, which no camera can see. A ground column is
 * filled from the bottom of the world up, so most of a hill or mountain is buried this way.
 *
 * Only the list's own pieces count as cover: a chunk's pieces along its edge stay drawn, since the
 * neighbour that would cover them may not be loaded. Nothing lies under the bottom of the world,
 * so a piece standing on it counts as covered below. Fed the pieces again after an edit, it leaves
 * out whatever the edit uncovered.
 */
export function buriedPieces(pieces: readonly Brick[]): ReadonlySet<Brick> {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const solid: { brick: Brick; width: number; depth: number; height: number }[] = [];
  for (const brick of pieces) {
    if (!isSolid(brick)) continue;
    const { width, depth, height } = footprint(brick);
    solid.push({ brick, width, depth, height });
    minX = Math.min(minX, brick.x);
    minZ = Math.min(minZ, brick.z);
    maxX = Math.max(maxX, brick.x + width);
    maxZ = Math.max(maxZ, brick.z + depth);
    minY = Math.min(minY, brick.y);
    maxY = Math.max(maxY, brick.y + height);
  }
  const buried = new Set<Brick>();
  if (!solid.length) return buried;
  // One cell a stud across and a plate high, numbered from the solid pieces' corner, with a cell
  // of room on every side for the neighbours looked up round the edge.
  const spanX = maxX - minX + 2;
  const spanZ = maxZ - minZ + 2;
  const spanY = maxY - minY + 2;
  const filled = new Uint8Array(spanX * spanZ * spanY);
  const cell = (x: number, y: number, z: number) =>
    ((x - minX + 1) * spanZ + (z - minZ + 1)) * spanY + (y - minY + 1);
  for (const { brick, width, depth, height } of solid)
    for (let x = brick.x; x < brick.x + width; x++)
      for (let z = brick.z; z < brick.z + depth; z++)
        for (let y = brick.y; y < brick.y + height; y++) filled[cell(x, y, z)] = 1;

  for (const { brick, width, depth, height } of solid) {
    const { x: x0, y: y0, z: z0 } = brick;
    const x1 = x0 + width;
    const z1 = z0 + depth;
    const y1 = y0 + height;
    const covered = () => {
      for (let x = x0; x < x1; x++)
        for (let z = z0; z < z1; z++) {
          if (!filled[cell(x, y1, z)]) return false;
          if (y0 > 0 && !filled[cell(x, y0 - 1, z)]) return false;
        }
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++)
          if (!filled[cell(x, y, z0 - 1)] || !filled[cell(x, y, z1)]) return false;
        for (let z = z0; z < z1; z++)
          if (!filled[cell(x0 - 1, y, z)] || !filled[cell(x1, y, z)]) return false;
      }
      return true;
    };
    if (covered()) buried.add(brick);
  }
  return buried;
}
