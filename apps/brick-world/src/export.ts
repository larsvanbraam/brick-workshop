import {
  BUILD_AREA,
  MAX_BUILD_AREA,
  exportLDraw,
  getWorldBounds,
  validateAssembly,
} from '@brick-workshop/engine';
import type { Assembly, Brick } from '@brick-workshop/engine';

/** Pieces a player put down carry this prefix; everything else came with the world. */
export const PLAYER_PREFIX = 'p-';

export const isPlayerPiece = (brick: Brick) => brick.id.startsWith(PLAYER_PREFIX);

/** Studs of ground kept round a build when it is cut out, so it stands on a patch of ground. */
const MARGIN = 3;

/** A box of studs, `[minX, maxX)` by `[minZ, maxZ)`. */
interface Box {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/**
 * Every piece wholly inside a box of the world, moved onto a board of its own, centred. Pieces
 * the box's edge cuts through are left out, and anything left resting on nothing (a tree whose
 * trunk stood outside) goes too, so the cut-out validates like any build.
 */
function cutOut(assembly: Assembly, box: Box, name: string): Assembly | null {
  const { minX, minZ, maxX, maxZ } = box;
  const inside = (brick: Brick) => {
    const bounds = getWorldBounds(brick);
    return (
      bounds.minX >= minX - 1e-6 &&
      bounds.minZ >= minZ - 1e-6 &&
      bounds.maxX <= maxX + 1e-6 &&
      bounds.maxZ <= maxZ + 1e-6
    );
  };
  const board = Math.min(MAX_BUILD_AREA, Math.max(BUILD_AREA, maxX - minX, maxZ - minZ));
  const shiftX = Math.floor((board - (maxX - minX)) / 2) - minX;
  const shiftZ = Math.floor((board - (maxZ - minZ)) / 2) - minZ;
  let bricks = assembly.bricks
    .filter(inside)
    .map((brick) => ({ ...brick, x: brick.x + shiftX, z: brick.z + shiftZ }));
  // Whatever the cut left hanging comes away, round by round, until the rest stands.
  for (let round = 0; round < 20; round++) {
    const issues = validateAssembly({ name, bricks, buildArea: board });
    if (!issues.length) return { name, bricks, buildArea: board };
    const loose = new Set(issues.map((issue) => issue.brickId));
    bricks = bricks.filter((brick) => !loose.has(brick.id));
  }
  return null;
}

/**
 * What the player built, cut out of the world like a diorama: every piece inside a box round the
 * player's pieces, a few studs wider, on a board of its own. Null when nothing has been built.
 */
export function cutOutBuild(assembly: Assembly, name: string): Assembly | null {
  const own = assembly.bricks.filter(isPlayerPiece);
  if (!own.length) return null;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const brick of own) {
    const bounds = getWorldBounds(brick);
    minX = Math.min(minX, bounds.minX);
    minZ = Math.min(minZ, bounds.minZ);
    maxX = Math.max(maxX, bounds.maxX);
    maxZ = Math.max(maxZ, bounds.maxZ);
  }
  const box = {
    minX: Math.floor(minX) - MARGIN,
    minZ: Math.floor(minZ) - MARGIN,
    maxX: Math.ceil(maxX) + MARGIN,
    maxZ: Math.ceil(maxZ) + MARGIN,
  };
  // A build wider than a board keeps its middle.
  for (const [low, high] of [
    ['minX', 'maxX'],
    ['minZ', 'maxZ'],
  ] as const) {
    const over = box[high] - box[low] - MAX_BUILD_AREA;
    if (over > 0) {
      box[low] += Math.floor(over / 2);
      box[high] = box[low] + MAX_BUILD_AREA;
    }
  }
  return cutOut(assembly, box, name);
}

/** The world round a stud, a full board across: the area the walker stands in. */
export function cutOutArea(
  assembly: Assembly,
  centre: { x: number; z: number },
  name: string,
): Assembly | null {
  const half = MAX_BUILD_AREA / 2;
  const x = Math.round(centre.x);
  const z = Math.round(centre.z);
  return cutOut(assembly, { minX: x - half, minZ: z - half, maxX: x + half, maxZ: z + half }, name);
}

/** The workshop's build file, which its File menu opens. */
export function workshopDocument(assembly: Assembly) {
  return JSON.stringify({ version: 1, assembly, parts: [] });
}

export function ldrawDocument(assembly: Assembly) {
  return exportLDraw(assembly);
}

/** Hands a file to the browser to save. */
export function download(contents: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
