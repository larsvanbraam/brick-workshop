import { footprint, getPart, hasStudConnection } from './core.ts';
import type { Assembly, Brick, Rotation } from './core.ts';

/** Plates a floor is laid from, by their footprint along x and z. */
const FLOOR_PARTS: Readonly<Record<string, { partId: string; rotation: Rotation }>> = {
  '16x16': { partId: '91405', rotation: 0 },
  '8x16': { partId: '92438', rotation: 0 },
  '16x8': { partId: '92438', rotation: 90 },
  '8x8': { partId: '41539', rotation: 0 },
};
export const FLOOR_PART_IDS = Object.freeze(['91405', '92438', '41539'] as const);
/** Floors are laid in whole 16 x 16 modules. */
export const FLOOR_MODULE = 16;

/** The cuts of one floor layer along an axis: whole modules, or shifted half a module. */
function cuts(start: number, length: number, shifted: boolean) {
  const edges = [start];
  for (
    let at = start + (shifted ? FLOOR_MODULE / 2 : FLOOR_MODULE);
    at < start + length;
    at += FLOOR_MODULE
  )
    edges.push(at);
  edges.push(start + length);
  return edges.slice(1).map((end, index) => ({ at: edges[index], size: end - edges[index] }));
}

/**
 * A floor the whole build can be lifted by, laid the way large boards are: a top layer of
 * 16 x 16 plates, on a second layer shifted half a module both ways, so every seam and corner
 * of the top layer sits over the middle of a plate below and every plate holds its
 * neighbours. A single module needs only its one plate. Returns null when the area is not
 * whole modules or a plate is not allowed in the color.
 */
export function layPlateFloor(
  area: { x: number; z: number; width: number; depth: number },
  color: number,
  options: { colorAllowed?: (partId: string, color: number) => boolean; id?: () => string } = {},
): { bricks: Brick[]; height: number } | null {
  const { x, z, width, depth } = area;
  if (width < FLOOR_MODULE || depth < FLOOR_MODULE || width % FLOOR_MODULE || depth % FLOOR_MODULE)
    return null;
  const single = width === FLOOR_MODULE && depth === FLOOR_MODULE;
  const layers = single ? [false] : [true, false];
  let next = 1;
  const id = options.id ?? (() => `floor-${next++}`);
  const bricks: Brick[] = [];
  for (const [y, shifted] of layers.entries())
    for (const column of cuts(x, width, shifted))
      for (const row of cuts(z, depth, shifted)) {
        const plate = FLOOR_PARTS[`${column.size}x${row.size}`];
        if (!plate || !(options.colorAllowed?.(plate.partId, color) ?? true)) return null;
        bricks.push({
          id: id(),
          partId: plate.partId,
          color,
          x: column.at,
          y,
          z: row.at,
          rotation: plate.rotation,
        });
      }
  return { bricks, height: layers.length };
}

/** A plate of a floor laid by `layPlateFloor`: the ground a model stands on. */
export function isFloorPlate(brick: Brick) {
  return (
    !brick.facing &&
    !brick.tilt &&
    brick.y < 2 &&
    (FLOOR_PART_IDS as readonly string[]).includes(brick.partId)
  );
}

/** Two baseplates lying edge to edge, and the pieces on top that hold them together. */
export interface BaseplateSeam {
  /** The baseplate IDs on the low and high side of the seam. */
  plates: readonly [string, string];
  /** 'x' when the seam is a line of constant x, 'z' for constant z. */
  axis: 'x' | 'z';
  /** The seam's x (axis 'x') or z (axis 'z'). */
  at: number;
  /** The shared edge along the seam, from `start` to `end` studs. */
  start: number;
  end: number;
  /** Pieces whose underside connects to studs of both baseplates. */
  ties: readonly string[];
}

export interface BaseplateJoins {
  seams: BaseplateSeam[];
  /** Groups of baseplates held together through tied seams; one group when all are joined. */
  groups: string[][];
  joined: boolean;
}

const isBaseplate = (brick: Brick) =>
  !brick.facing && !brick.tilt && brick.y === 0 && getPart(brick.partId).family === 'baseplate';

/**
 * Finds where baseplates lie edge to edge and which seams are tied: baseplates have nothing
 * underneath to connect to, so they only hold together through pieces that sit across a seam
 * with studs of both plates under them.
 */
export function getBaseplateJoins(assembly: Assembly): BaseplateJoins {
  const plates = assembly.bricks.filter(isBaseplate);
  const resting = assembly.bricks.filter(
    (brick) =>
      !brick.facing &&
      !brick.tilt &&
      !isBaseplate(brick) &&
      plates.some((plate) => brick.y === getPart(plate.partId).height),
  );
  const seams: BaseplateSeam[] = [];
  for (const low of plates)
    for (const high of plates) {
      if (low === high) continue;
      const [a, b] = [footprint(low), footprint(high)];
      for (const axis of ['x', 'z'] as const) {
        const along = axis === 'x' ? 'z' : 'x';
        const size = (shape: typeof a) => (axis === 'x' ? shape.width : shape.depth);
        const length = (shape: typeof a) => (axis === 'x' ? shape.depth : shape.width);
        if (low[axis] + size(a) !== high[axis]) continue;
        const start = Math.max(low[along], high[along]);
        const end = Math.min(low[along] + length(a), high[along] + length(b));
        if (end - start < 2) continue;
        const at = high[axis];
        const ties = resting
          .filter((piece) => {
            const spans = piece[axis] < at && piece[axis] + size(footprint(piece)) > at;
            return spans && hasStudConnection(low, piece) && hasStudConnection(high, piece);
          })
          .map((piece) => piece.id);
        seams.push({ plates: [low.id, high.id], axis, at, start, end, ties });
      }
    }
  // Plates sharing a tied seam belong together.
  const group = new Map(plates.map((plate) => [plate.id, plate.id]));
  const root = (id: string): string => {
    const parent = group.get(id)!;
    return parent === id ? id : root(parent);
  };
  for (const seam of seams)
    if (seam.ties.length) group.set(root(seam.plates[0]), root(seam.plates[1]));
  const groups = new Map<string, string[]>();
  for (const plate of plates)
    groups.set(root(plate.id), [...(groups.get(root(plate.id)) ?? []), plate.id]);
  return { seams, groups: [...groups.values()], joined: groups.size <= 1 };
}
