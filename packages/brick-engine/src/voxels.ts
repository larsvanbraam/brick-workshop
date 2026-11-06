import { BUILD_AREA, COLORS, MAX_BUILD_AREA, MAX_HEIGHT, MAX_PIECES, getPart, validateAssembly } from './core.ts';
import type { Assembly, Brick } from './core.ts';

export type VoxelDirection = 'x+' | 'x-' | 'z+' | 'z-';

/** A door or window found in a wall of the source model. */
export interface VoxelOpening {
  kind: 'door' | 'window';
  /** Lowest cell of the opening; the wall plane is this cell's x (axis 'z') or z (axis 'x'). */
  x: number;
  z: number;
  layer: number;
  /** Cells along the wall, and brick layers tall. */
  width: number;
  height: number;
  /** The horizontal axis the wall runs along. */
  axis: 'x' | 'z';
  /** The side the wall faces, when known: the outside of a door. */
  facing?: VoxelDirection;
}

/**
 * A model sampled into brick-sized cells: one stud across, one brick (three plates) tall.
 * `cells[(layer * depth + z) * width + x]` holds an LDraw color ID, or null when empty.
 */
export interface VoxelModel {
  name: string;
  width: number;
  depth: number;
  layers: number;
  cells: readonly (number | null)[];
  /** Per cell, the downhill direction of a sloped roof surface there, or null. */
  slopes?: readonly (VoxelDirection | null)[];
  /** Doors and windows to frame. */
  openings?: readonly VoxelOpening[];
}

export interface VoxelFillOptions {
  /** Minimum board size; grown up to MAX_BUILD_AREA to fit the model. */
  buildArea?: number;
  /**
   * Builds walls from short, varied bricks (at most four studs, mixed lengths) and splits roof
   * slopes into staggered shingles, the way sets texture stone and thatch, instead of using the
   * longest piece everywhere.
   */
  texture?: boolean;
  /**
   * Cells the fill still leaves out get a support column straight down inside the building
   * (enclosed by the model on all four sides, so it is not seen) and the fill runs again.
   */
  supportGaps?: boolean;
  maxPieces?: number;
  /** Host color policy, e.g. observed-colors-only. Defaults to allowing every color. */
  colorAllowed?: (partId: string, color: number) => boolean;
}

export interface VoxelFill {
  assembly: Assembly;
  origin: { x: number; z: number };
  filledCells: number;
  skippedCells: number;
  /** Empty model cells filled to carry an overhang, as on a stepped roof. */
  addedCells: number;
  /** Detail pieces placed: roof slopes, window and door frames and railings. */
  details: { slopes: number; windows: number; doors: number; railings: number };
  /** True when maxPieces ran out before every cell was filled. */
  truncated: boolean;
}

/** How many courses down a corbel may step to reach support. */
const MAX_CORBEL_DEPTH = 4;
/** How many cells one corbel search may visit before giving up on that cell. */
const MAX_CORBEL_SEARCH = 400;
/** The longest break in a roof course (a chimney or dormer passing through) that is bridged. */
const MAX_ROOF_BREAK = 16;
/** How far an overhanging cell may be widened sideways to reach the course below. */
const MAX_OVERHANG_REACH = 2;

/** Upright wall bricks used for shells, largest first. */
export const VOXEL_FILL_PART_IDS = Object.freeze([
  '2456', '3001', '3002', '3003', '3008', '3009', '3010', '3622', '3004', '3005',
]);
/** 45-degree slopes 1 to 4 studs wide; studs on the high row only. */
const SLOPE_PART_IDS = ['3040b', '3039', '3038', '3037'];
const WINDOW_PART_IDS = ['60592', '60593', '60594'];
const DOOR_PART_IDS = ['3579', '60596'];
const RAILING_PART_IDS = ['30055', '3633'];
/** Colors tried, in order, when a detail part is not allowed in the color of its cells. */
const DETAIL_FALLBACK_COLORS = [15, 72, 71, 0, 19, 70];
export const MAX_VOXEL_LAYERS = Math.floor(MAX_HEIGHT / 3);

const DIRECTIONS: readonly [VoxelDirection, number, number][] = [
  ['x+', 1, 0], ['x-', -1, 0], ['z+', 0, 1], ['z-', 0, -1],
];

/** A small, stable integer hash, so textures look random but convert the same way every time. */
function hash(...values: number[]) {
  let value = 2166136261;
  for (const part of values) {
    value ^= part + 0x9e3779b9 + (value << 6) + (value >>> 2);
    value = Math.imul(value, 16777619) >>> 0;
  }
  return value;
}

export function validateVoxelModel(model: VoxelModel) {
  const sizes = [model.width, model.depth, model.layers];
  if (sizes.some((size) => !Number.isInteger(size) || size < 1))
    throw new Error('Voxel model dimensions must be positive integers.');
  if (model.width > MAX_BUILD_AREA || model.depth > MAX_BUILD_AREA)
    throw new Error(`Voxel models must fit a ${MAX_BUILD_AREA}-stud board.`);
  if (model.layers > MAX_VOXEL_LAYERS)
    throw new Error(`Voxel models are limited to ${MAX_VOXEL_LAYERS} brick layers.`);
  if (model.cells.length !== model.width * model.depth * model.layers)
    throw new Error('Voxel cell count does not match the model dimensions.');
  if (model.slopes && model.slopes.length !== model.cells.length)
    throw new Error('Voxel slope count does not match the model dimensions.');
}

interface PlannedPiece {
  partId: string;
  color: number;
  rotation: 0 | 90 | 180 | 270;
  /** Grid position of the rotated footprint's minimum corner. */
  x: number;
  z: number;
  layer: number;
  width: number;
  depth: number;
  cells: number[];
}

/**
 * Deterministically fills each layer of a voxel shell with the largest wall bricks that fit,
 * favouring bricks that bridge seams in the layer below. A cell with nothing underneath is
 * widened by up to two empty cells toward the nearest cell below, so sloped roofs step like a
 * real brick roof, and each step's exposed edge gets a 45-degree slope (only where `slopes`
 * marks a roof running that way, when the model has slope hints). Openings get the nearest
 * standard window or door frame. Cells still unsupported, or with no allowed part in their
 * color, are skipped, and anything the engine still rejects is removed.
 */
export function fillVoxelModel(model: VoxelModel, options: VoxelFillOptions = {}): VoxelFill {
  let fill = fillOnce(model, options);
  // A fill that ran out of pieces is over budget anyway; supporting everything it never
  // reached would only cost time.
  if (!options.supportGaps || fill.result.truncated) return fill.result;
  const { width, depth } = model;
  const cells = [...model.cells];
  const at = (layer: number, x: number, z: number) => cells[(layer * depth + z) * width + x];
  // Inside the building: the model has something in every horizontal direction. One sweep per
  // direction marks it for every cell, so the check is a lookup.
  const sides = new Uint8Array(model.cells.length);
  for (let layer = 0; layer < model.layers; layer += 1) {
    for (let z = 0; z < depth; z += 1) {
      for (let [x, seen] = [0, false]; x < width; x += 1) {
        if (seen) sides[(layer * depth + z) * width + x] |= 1;
        if (model.cells[(layer * depth + z) * width + x] !== null) seen = true;
      }
      for (let [x, seen] = [width - 1, false]; x >= 0; x -= 1) {
        if (seen) sides[(layer * depth + z) * width + x] |= 2;
        if (model.cells[(layer * depth + z) * width + x] !== null) seen = true;
      }
    }
    for (let x = 0; x < width; x += 1) {
      for (let [z, seen] = [0, false]; z < depth; z += 1) {
        if (seen) sides[(layer * depth + z) * width + x] |= 4;
        if (model.cells[(layer * depth + z) * width + x] !== null) seen = true;
      }
      for (let [z, seen] = [depth - 1, false]; z >= 0; z -= 1) {
        if (seen) sides[(layer * depth + z) * width + x] |= 8;
        if (model.cells[(layer * depth + z) * width + x] !== null) seen = true;
      }
    }
  }
  const enclosed = (layer: number, x: number, z: number) => sides[(layer * depth + z) * width + x] === 15;
  let total = 0;
  const position = (layer: number, x: number, z: number) => (layer * depth + z) * width + x;
  const inside = (layer: number, x: number, z: number) =>
    layer >= 0 && x >= 0 && z >= 0 && x < width && z < depth;
  /**
   * Corbelling: the shortest staircase of empty cells under a left-out cell, at most two
   * studs sideways per course (in a straight line, so one brick covers it) and four courses
   * down, that ends on something solid or against a wall it can bond into, like a brick laid
   * into a chimney's course under a roof. The steps take the colour of what they bond into.
   */
  const corbel = (x: number, z: number, layer: number): { cells: number[]; color: number } | null => {
    const start = [layer - 1, x, z] as const;
    if (!inside(...start) || at(...start) !== null) return null;
    // Steps point back to the step they came from; the path is rebuilt only for the answer.
    type Step = { layer: number; x: number; z: number; dir: number; run: number; parent: number };
    const queue: Step[] = [{ layer: start[0], x, z, dir: -1, run: 0, parent: -1 }];
    const pathTo = (head: number) => {
      const path: number[] = [];
      for (let at = head; at !== -1; at = queue[at].parent) path.unshift(position(queue[at].layer, queue[at].x, queue[at].z));
      return path;
    };
    // Each cell is visited once, and the search stops after MAX_CORBEL_SEARCH cells: a lattice
    // can leave thousands of cells out, and each search must stay small.
    const seen = new Set([position(...start)]);
    for (let head = 0; head < queue.length && head < MAX_CORBEL_SEARCH; head += 1) {
      const step = queue[head];
      // Resting on a solid cell, or on the ground inside the building (never a post outside).
      if (
        at(step.layer - 1, step.x, step.z) !== null ||
        (step.layer === 0 && pathTo(head).every((cell) => enclosed(Math.floor(cell / (width * depth)), cell % width, Math.floor(cell / width) % depth)))
      )
        return { cells: pathTo(head), color: cells[position(layer, x, z)]! };
      // Sideways first: between equally short staircases, bonding into a wall beats going down.
      // Up to two empty steps sideways, plus the wall cell the run bonds into.
      const moves: [number, number, number, number][] = [];
      if (step.run <= MAX_OVERHANG_REACH)
        DIRECTIONS.forEach(([, dx, dz], dir) => {
          if (step.dir === -1 || step.dir === dir) moves.push([step.layer, step.x + dx, step.z + dz, dir]);
        });
      if (step.layer - 1 >= layer - 1 - MAX_CORBEL_DEPTH) moves.push([step.layer - 1, step.x, step.z, -1]);
      for (const [nextLayer, nx, nz, dir] of moves) {
        if (!inside(nextLayer, nx, nz)) continue;
        const value = at(nextLayer, nx, nz);
        if (value !== null) {
          // Bonding sideways into a wall course that stands on something.
          if (dir !== -1 && (nextLayer === 0 || at(nextLayer - 1, nx, nz) !== null))
            return { cells: pathTo(head), color: value };
          continue;
        }
        const run = dir === -1 ? 0 : step.run + 1;
        if (run > MAX_OVERHANG_REACH) continue;
        const key = position(nextLayer, nx, nz);
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push({ layer: nextLayer, x: nx, z: nz, dir: dir === -1 ? -1 : dir, run, parent: head });
      }
    }
    return null;
  };
  // A new layout can leave other cells out, so repeat while support still helps.
  for (let round = 0; round < 4 && fill.leftOut.length; round += 1) {
    let columns = 0;
    for (const cell of fill.leftOut) {
      const [x, z, layer] = [cell % width, Math.floor(cell / width) % depth, Math.floor(cell / (width * depth))];
      if (layer === 0 || cells[cell] === null) continue;
      const steps = corbel(x, z, layer);
      if (steps) {
        for (const target of steps.cells) if (cells[target] === null) cells[target] = steps.color;
        columns += steps.cells.length;
        continue;
      }
      // Last resort: a hidden column straight down inside the building.
      const column: number[] = [];
      let below = layer - 1;
      while (below >= 0 && at(below, x, z) === null && enclosed(below, x, z)) {
        column.push((below * depth + z) * width + x);
        below -= 1;
      }
      // Only a column that reaches something solid (or the ground) helps.
      if (!column.length || (below >= 0 && at(below, x, z) === null)) continue;
      for (const target of column) cells[target] = cells[cell];
      columns += column.length;
    }
    if (!columns) break;
    total += columns;
    fill = fillOnce({ ...model, cells }, options);
  }
  // Unused support cells are not part of the model, so only model cells count as left out.
  const skippedCells = fill.leftOut.filter((cell) => model.cells[cell] !== null).length;
  return { ...fill.result, skippedCells, addedCells: fill.result.addedCells + total };
}

function fillOnce(model: VoxelModel, options: VoxelFillOptions): { result: VoxelFill; leftOut: number[] } {
  validateVoxelModel(model);
  const { width, depth, layers } = model;
  const cells = [...model.cells];
  const buildArea = Math.min(
    MAX_BUILD_AREA,
    Math.max(options.buildArea ?? BUILD_AREA, BUILD_AREA, width, depth),
  );
  const origin = { x: Math.floor((buildArea - width) / 2), z: Math.floor((buildArea - depth) / 2) };
  const maxPieces = Math.min(options.maxPieces ?? MAX_PIECES, MAX_PIECES);
  const allowed = options.colorAllowed ?? (() => true);
  const parts = VOXEL_FILL_PART_IDS.map((id) => getPart(id));
  const shapes = parts.flatMap((part) =>
    (part.width === part.depth ? [0] : [0, 90]).map((rotation) => ({
      part,
      rotation: rotation as 0 | 90,
      width: rotation ? part.depth : part.width,
      depth: rotation ? part.width : part.depth,
    })),
  );
  const index = (layer: number, x: number, z: number) => (layer * depth + z) * width + x;
  const at = (layer: number, x: number, z: number) =>
    layer < 0 || layer >= layers || x < 0 || z < 0 || x >= width || z >= depth ? null : cells[index(layer, x, z)];

  let addedCells = 0;
  if (model.slopes) for (let layer = 0; layer < layers; layer += 1) addedCells += continueRoof(layer);
  for (let layer = 1; layer < layers; layer += 1) addedCells += widenOverhangs(layer);

  /**
   * A roof course broken by something passing through it (a chimney, a dormer) leaves the
   * course above without support, so short breaks between two cells of the same roof colour
   * and slope are filled, as a real roof runs on under the chimney.
   */
  function continueRoof(layer: number) {
    let added = 0;
    for (const alongX of [true, false])
      for (let line = 0; line < (alongX ? depth : width); line += 1) {
        const cell = (u: number) => (alongX ? index(layer, u, line) : index(layer, line, u));
        let last = -1;
        for (let u = 0; u < (alongX ? width : depth); u += 1) {
          if (cells[cell(u)] === null) continue;
          const gap = u - last - 1;
          if (
            last >= 0 &&
            gap > 0 &&
            gap <= MAX_ROOF_BREAK &&
            cells[cell(u)] === cells[cell(last)] &&
            model.slopes![cell(u)] !== null &&
            model.slopes![cell(u)] === model.slopes![cell(last)]
          )
            for (let fill = last + 1; fill < u; fill += 1) {
              cells[cell(fill)] = cells[cell(u)];
              added += 1;
            }
          last = u;
        }
      }
    return added;
  }

  // Detail pieces are planned on the grid first; the brick fill then works around them.
  const reserved = new Int32Array(cells.length).fill(-1);
  const planned: PlannedPiece[] = [];
  const reserve = (piece: PlannedPiece) => {
    if (piece.cells.some((cell) => reserved[cell] !== -1)) return false;
    for (const cell of piece.cells) reserved[cell] = planned.length;
    planned.push(piece);
    return true;
  };
  const detailColor = (partId: string, preferred: number) =>
    [preferred, ...DETAIL_FALLBACK_COLORS].find((color) => allowed(partId, color));
  for (let layer = 1; layer < layers; layer += 1) planRailings(layer);
  for (const opening of model.openings ?? []) planFrame(snapToWall(opening));
  for (let layer = 0; layer < layers; layer += 1) planSlopes(layer);

  // owner[cell] is the brick index covering it, or -1.
  const owner = new Int32Array(cells.length).fill(-1);
  const bricks: Brick[] = [];
  const brickCells: number[][] = [];
  const rects: { x: number; z: number; width: number; depth: number }[] = [];
  const add = (brick: Omit<Brick, 'id'>, rect: (typeof rects)[number], covered: number[]) => {
    for (const cell of covered) owner[cell] = bricks.length;
    rects.push(rect);
    brickCells.push(covered);
    bricks.push({ id: `model-${bricks.length + 1}`, ...brick });
  };
  for (let layer = 0; layer < layers && bricks.length < maxPieces; layer += 1) {
    for (const piece of planned)
      if (piece.layer === layer && bricks.length < maxPieces)
        add(
          {
            partId: piece.partId,
            color: piece.color,
            x: origin.x + piece.x,
            y: layer * 3,
            z: origin.z + piece.z,
            rotation: piece.rotation,
          },
          piece,
          piece.cells,
        );
    if (layer > 0) placeOverhangsFirst(layer);
    for (let z = 0; z < depth; z += 1)
      for (let x = 0; x < width; x += 1) {
        const color = cells[index(layer, x, z)];
        if (color === null || owner[index(layer, x, z)] !== -1 || reserved[index(layer, x, z)] !== -1)
          continue;
        if (bricks.length >= maxPieces) continue;
        let best: { shape: (typeof shapes)[number]; score: number } | null = null;
        const wall = options.texture && !model.slopes?.[index(layer, x, z)];
        for (const shape of shapes) {
          if (x + shape.width > width || z + shape.depth > depth) continue;
          if (!allowed(shape.part.id, color)) continue;
          if (wall && Math.max(shape.width, shape.depth) > 4) continue;
          let fits = true;
          let supported = 0;
          const below = new Set<number>();
          for (let dz = 0; dz < shape.depth && fits; dz += 1)
            for (let dx = 0; dx < shape.width; dx += 1) {
              const cell = index(layer, x + dx, z + dz);
              if (cells[cell] !== color || owner[cell] !== -1 || reserved[cell] !== -1) {
                fits = false;
                break;
              }
              if (layer > 0) {
                const under = owner[index(layer - 1, x + dx, z + dz)];
                if (under !== -1) {
                  supported += 1;
                  below.add(under);
                }
              }
            }
          if (!fits || (layer > 0 && !supported)) continue;
          const area = shape.width * shape.depth;
          const stacked =
            below.size === 1 &&
            (() => {
              const rect = rects[[...below][0]];
              return rect.x === x && rect.z === z && rect.width === shape.width && rect.depth === shape.depth;
            })();
          // On textured walls a fixed per-position preference mixes 1 x 2, 1 x 3 and 1 x 4
          // stones instead of always taking the longest.
          const variety = wall && area > 1 ? hash(x, layer, z, shape.width * 8 + shape.depth) % 16 : 0;
          const score =
            area * 10 + Math.max(0, below.size - 1) * 6 - (area - supported) - (stacked ? 15 : 0) + variety;
          if (!best || score > best.score) best = { shape, score };
        }
        if (!best) continue;
        const { shape } = best;
        const covered: number[] = [];
        for (let dz = 0; dz < shape.depth; dz += 1)
          for (let dx = 0; dx < shape.width; dx += 1) covered.push(index(layer, x + dx, z + dz));
        add(
          {
            partId: shape.part.id,
            color,
            x: origin.x + x,
            y: layer * 3,
            z: origin.z + z,
            rotation: shape.rotation,
          },
          { x, z, width: shape.width, depth: shape.depth },
          covered,
        );
      }
    addedCells += bridgeLeftovers(layer);
  }
  const truncated = bricks.length >= maxPieces && cells.some((cell, position) => cell !== null && owner[position] === -1);

  /**
   * Cells with nothing under them get their bricks before the rest of the course, so a brick
   * can still reach from them onto a supported cell (a bridge, or a corbel bonding into a wall)
   * before the ordinary fill takes that cell.
   */
  function placeOverhangsFirst(layer: number) {
    for (let z = 0; z < depth; z += 1)
      for (let x = 0; x < width; x += 1) {
        const cell = index(layer, x, z);
        const color = cells[cell];
        if (color === null || owner[cell] !== -1 || reserved[cell] !== -1 || cells[index(layer - 1, x, z)] !== null)
          continue;
        if (bricks.length >= maxPieces) return;
        let best: { shape: (typeof shapes)[number]; x: number; z: number; covered: number[]; score: number } | null = null;
        for (const shape of shapes) {
          if (!allowed(shape.part.id, color)) continue;
          for (let sz = z - shape.depth + 1; sz <= z; sz += 1)
            for (let sx = x - shape.width + 1; sx <= x; sx += 1) {
              if (sx < 0 || sz < 0 || sx + shape.width > width || sz + shape.depth > depth) continue;
              const covered: number[] = [];
              let supported = 0;
              let fits = true;
              for (let dz = 0; dz < shape.depth && fits; dz += 1)
                for (let dx = 0; dx < shape.width; dx += 1) {
                  const target = index(layer, sx + dx, sz + dz);
                  if (cells[target] !== color || owner[target] !== -1 || reserved[target] !== -1) {
                    fits = false;
                    break;
                  }
                  if (owner[index(layer - 1, sx + dx, sz + dz)] !== -1) supported += 1;
                  covered.push(target);
                }
              if (!fits || !supported) continue;
              // The most support first, then the smallest brick that gets it.
              const score = supported * 100 - covered.length;
              if (!best || score > best.score) best = { shape, x: sx, z: sz, covered, score };
            }
        }
        if (!best) continue;
        add(
          {
            partId: best.shape.part.id,
            color,
            x: origin.x + best.x,
            y: layer * 3,
            z: origin.z + best.z,
            rotation: best.shape.rotation,
          },
          { x: best.x, z: best.z, width: best.shape.width, depth: best.shape.depth },
          best.covered,
        );
      }
  }

  /**
   * A cell the fill could not support gets a straight brick through at most two empty cells
   * (or unfilled cells of its color) that reaches a stud below, like a builder bridging an overhang.
   */
  function bridgeLeftovers(layer: number) {
    if (layer === 0) return 0;
    let added = 0;
    const straight = shapes.filter((shape) => (shape.width === 1 || shape.depth === 1) && shape.width * shape.depth > 1);
    for (let z = 0; z < depth; z += 1)
      for (let x = 0; x < width; x += 1) {
        const cell = index(layer, x, z);
        const color = cells[cell];
        if (color === null || owner[cell] !== -1 || reserved[cell] !== -1 || bricks.length >= maxPieces) continue;
        let best: { shape: (typeof straight)[number]; x: number; z: number; covered: number[]; score: number } | null =
          null;
        for (const shape of straight) {
          if (!allowed(shape.part.id, color)) continue;
          // Every placement of the shape that includes this cell.
          for (let sz = z - shape.depth + 1; sz <= z; sz += 1)
            for (let sx = x - shape.width + 1; sx <= x; sx += 1) {
              if (sx < 0 || sz < 0 || sx + shape.width > width || sz + shape.depth > depth) continue;
              const covered: number[] = [];
              let supported = 0;
              let empty = 0;
              let fits = true;
              for (let dz = 0; dz < shape.depth && fits; dz += 1)
                for (let dx = 0; dx < shape.width; dx += 1) {
                  const target = index(layer, sx + dx, sz + dz);
                  const value = cells[target];
                  if (owner[target] !== -1 || reserved[target] !== -1 || (value !== null && value !== color)) {
                    fits = false;
                    break;
                  }
                  if (value === null) empty += 1;
                  if (owner[index(layer - 1, sx + dx, sz + dz)] !== -1) supported += 1;
                  covered.push(target);
                }
              if (!fits || !supported || empty > MAX_OVERHANG_REACH) continue;
              // Fewest invented cells, then the most support.
              const score = -empty * 10 + supported;
              if (!best || score > best.score) best = { shape, x: sx, z: sz, covered, score };
            }
        }
        if (!best) continue;
        for (const target of best.covered)
          if (cells[target] === null) {
            cells[target] = color;
            added += 1;
          }
        add(
          {
            partId: best.shape.part.id,
            color,
            x: origin.x + best.x,
            y: layer * 3,
            z: origin.z + best.z,
            rotation: best.shape.rotation,
          },
          { x: best.x, z: best.z, width: best.shape.width, depth: best.shape.depth },
          best.covered,
        );
      }
    return added;
  }

  function widenOverhangs(layer: number) {
    let added = 0;
    const supported = (x: number, z: number) => cells[index(layer - 1, x, z)] !== null;
    const overhangs: [number, number][] = [];
    for (let z = 0; z < depth; z += 1)
      for (let x = 0; x < width; x += 1)
        if (cells[index(layer, x, z)] !== null && !supported(x, z)) overhangs.push([x, z]);
    for (const [x, z] of overhangs) {
      const color = cells[index(layer, x, z)];
      // Nearest reach first; each step must be an empty cell in this layer.
      search: for (let reach = 1; reach <= MAX_OVERHANG_REACH; reach += 1)
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const steps = Array.from({ length: reach }, (_, step) => [x + dx * (step + 1), z + dz * (step + 1)]);
          if (steps.some(([sx, sz]) => sx < 0 || sz < 0 || sx >= width || sz >= depth)) continue;
          const [tx, tz] = steps[reach - 1];
          if (!supported(tx, tz)) continue;
          if (steps.slice(0, -1).some(([sx, sz]) => cells[index(layer, sx, sz)] !== null && cells[index(layer, sx, sz)] !== color))
            continue;
          // An occupied target bridges only in the same color, which the fill already does.
          if (cells[index(layer, tx, tz)] !== null) continue;
          for (const [sx, sz] of steps)
            if (cells[index(layer, sx, sz)] === null) {
              cells[index(layer, sx, sz)] = color;
              added += 1;
            }
          break search;
        }
    }
    return added;
  }

  /** Moves an opening onto whichever neighbouring wall plane has the most wall around it. */
  function snapToWall(opening: VoxelOpening): VoxelOpening {
    const across = opening.axis === 'x' ? 'z' : 'x';
    // Wall around the opening counts for a plane, anything inside the opening against it.
    const score = (plane: number) => {
      let filled = 0;
      for (let layer = opening.layer - 1; layer <= opening.layer + opening.height; layer += 1)
        for (let offset = -1; offset <= opening.width; offset += 1) {
          const along = (opening.axis === 'x' ? opening.x : opening.z) + offset;
          const [x, z] = opening.axis === 'x' ? [along, plane] : [plane, along];
          const inside =
            layer >= opening.layer && layer < opening.layer + opening.height && offset >= 0 && offset < opening.width;
          if (at(layer, x, z) !== null) filled += inside ? -1 : 1;
        }
      return filled;
    };
    const plane = [0, 1, -1]
      .map((offset) => opening[across] + offset)
      .reduce((best, candidate) => (score(candidate) > score(best) ? candidate : best));
    return { ...opening, [across]: plane };
  }

  /**
   * The opening as the empty cells of the wall plane show it. The side view behind which it was
   * found can merge it with what is in front (a stair, a railing) or clip it, so the frame is
   * sized from the plane's own void around the opening's centre column.
   */
  function openingVoid(opening: VoxelOpening): VoxelOpening | null {
    const along = opening.axis === 'x' ? 'x' : 'z';
    const plane = (layer: number, u: number) => {
      const [x, z] = opening.axis === 'x' ? [u, opening.z] : [opening.x, u];
      return x < 0 || z < 0 || x >= width || z >= depth ? undefined : model.cells[index(layer, x, z)];
    };
    const [u0, u1] = [opening[along], opening[along] + opening.width - 1];
    const [top, bottom] = [opening.layer + opening.height - 1, opening.layer];
    // The run of empty layers, in any of the opening's columns or the one beside them (a
    // stair can hide most of a doorway), that overlaps it the most.
    let best: [number, number, number] | null = null;
    let bestOverlap = 0;
    for (let u = u0 - 1; u <= u1 + 1; u += 1)
      for (let layer = 0; layer < layers; ) {
        if (plane(layer, u) !== null) {
          layer += 1;
          continue;
        }
        let end = layer;
        while (end + 1 < layers && plane(end + 1, u) === null) end += 1;
        // Most overlap first; between equal overlaps the taller void is the doorway (the
        // space under a stair is short).
        const overlap = Math.min(end, top) - Math.max(layer, bottom) + 1;
        const score = overlap > 0 ? overlap * 100 + (end - layer + 1) : 0;
        if (score > bestOverlap) [best, bestOverlap] = [[u, layer, end], score];
        layer = end + 1;
      }
    if (!best) return opening;
    const [centre, low, high] = best;
    // An arch narrows the top, so a column counts when its bottom and most of it are open.
    const open = (u: number) =>
      plane(low, u) === null &&
      Array.from({ length: high - low + 1 }, (_, step) => plane(low + step, u)).filter((cell) => cell === null).length >=
        (high - low + 1) / 2;
    // Follow the void sideways from that column, as far as the widest frame (the detected
    // patch can be a sliver of a doorway partly hidden from the side).
    let [a, b] = [centre, centre];
    while (a - 1 >= Math.min(u0, centre - 3) && open(a - 1)) a -= 1;
    while (b + 1 <= Math.max(u1, centre + 3) && open(b + 1)) b += 1;
    // A real door or window has wall over it, at least three courses up to the roof; a gap in a
    // railing has a top rail of a course or two and then open sky.
    const walled = (layer: number) =>
      Array.from({ length: b - a + 1 }, (_, step) => plane(layer, a + step)).filter(
        (cell) => cell !== null && cell !== undefined,
      ).length >= (b - a + 1) / 2;
    if (![1, 2, 3].every((above) => walled(high + above))) return null;
    // Tall enough for a door and standing on the ground or on a step in front: a door, even
    // when the side view only saw part of it.
    const [outX, outZ] = opening.facing ? DIRECTIONS.find(([direction]) => direction === opening.facing)!.slice(1) : [0, 0];
    // A step is solid down to the ground (at least at its sides); a balcony floor in front of
    // an upper window or door has open space under it.
    const stepInFront = Array.from({ length: b - a + 3 }, (_, step) => {
      const [x, z] = opening.axis === 'x' ? [a - 1 + step, opening.z] : [opening.x, a - 1 + step];
      return Array.from({ length: low }, (_, layer) => at(layer, x + (outX as number), z + (outZ as number))).every(
        (cell) => cell !== null,
      );
    }).some(Boolean) && low > 0;
    const kind = high - low + 1 >= 3 && b - a >= 1 && (low <= 1 || stepInFront) ? 'door' : opening.kind;
    return { ...opening, kind, [along]: a, width: b - a + 1, layer: low, height: high - low + 1 };
  }

  function planFrame(detected: VoxelOpening) {
    const opening = openingVoid(detected);
    if (!opening) return;
    const partId =
      opening.kind === 'door'
        ? opening.width <= 3 ? '3579' : '60596'
        : opening.width <= 2 ? (opening.height <= 2 ? '60592' : '60593') : '60594';
    const part = getPart(partId);
    const along = part.depth;
    const tall = part.height / 3;
    const alongAxis = opening.axis === 'x' ? opening.x : opening.z;
    const start = Math.round(alongAxis + opening.width / 2 - along / 2);
    const centered =
      opening.kind === 'door' ? opening.layer : Math.max(0, Math.round(opening.layer + opening.height / 2 - tall / 2));
    const limit = opening.axis === 'x' ? width : depth;
    if (start < 0 || start + along > limit) return;
    const position = (layer: number, offset: number) =>
      opening.axis === 'x' ? index(layer, start + offset, opening.z) : index(layer, opening.x, start + offset);
    // Most of the frame's bottom must sit on the model itself (not on cells added to carry
    // overhangs), not just a corner.
    const resting = (layer: number) =>
      layer === 0 ||
      Array.from({ length: along }, (_, offset) => position(layer - 1, offset)).filter(
        (cell) => model.cells[cell] !== null,
      ).length >= along / 2;
    const touching = (layer: number) =>
      layer === 0 ||
      Array.from({ length: along }, (_, offset) => position(layer - 1, offset)).some((cell) => model.cells[cell] !== null);
    // Nothing directly outside the doorway at a layer: not a step or stair in front of it.
    const [outX, outZ] = opening.facing
      ? DIRECTIONS.find(([direction]) => direction === opening.facing)!.slice(1)
      : [0, 0];
    const clearInFront = (layer: number) =>
      !opening.facing ||
      Array.from({ length: along }, (_, offset) => {
        const [x, z] = opening.axis === 'x' ? [start + offset, opening.z] : [opening.x, start + offset];
        return at(layer, x + (outX as number), z + (outZ as number));
      }).every((cell) => cell === null);
    // Wall on both sides of the frame at a layer: still inside the doorway, not open space.
    const flanked = (layer: number) => {
      const original = (x: number, z: number) =>
        x < 0 || z < 0 || x >= width || z >= depth ? null : model.cells[index(layer, x, z)];
      const [before, after] =
        opening.axis === 'x'
          ? [original(start - 1, opening.z), original(start + along, opening.z)]
          : [original(opening.x, start - 1), original(opening.x, start + along)];
      return before !== null && after !== null;
    };
    // Doors follow their doorway down to the floor between its jambs, but not behind a step or
    // stair in front of them; windows may shift a layer onto a sill.
    const tries = [centered];
    if (opening.kind === 'door')
      for (let layer = centered; layer > 0 && !resting(layer) && flanked(layer - 1) && clearInFront(layer - 1); layer -= 1)
        tries.push(layer - 1);
    else tries.push(centered - 1, centered + 1);
    // Failing that, a frame may stand on a single stud, as on a narrow threshold.
    const bottom =
      tries.find((candidate) => candidate >= 0 && candidate + tall <= layers && resting(candidate)) ??
      (centered + tall <= layers && touching(centered) ? centered : undefined);
    if (bottom === undefined) return;
    const covered: number[] = [];
    for (let layer = bottom; layer < bottom + tall; layer += 1)
      for (let offset = 0; offset < along; offset += 1) covered.push(position(layer, offset));
    const counts = new Map<number, number>();
    for (const cell of covered) if (cells[cell] !== null) counts.set(cells[cell]!, (counts.get(cells[cell]!) ?? 0) + 1);
    const color = detailColor(partId, [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 15);
    if (color === undefined) return;
    const piece: PlannedPiece = {
      partId,
      color,
      rotation: opening.axis === 'x' ? 90 : 0,
      x: opening.axis === 'x' ? start : opening.x,
      z: opening.axis === 'x' ? opening.z : start,
      layer: bottom,
      width: opening.axis === 'x' ? along : 1,
      depth: opening.axis === 'x' ? 1 : along,
      cells: covered,
    };
    if (!reserve(piece)) return;
    for (const cell of covered) cells[cell] = color;
    // Above a frame shorter than its opening (an arched doorway), wall closes the gap.
    for (let layer = bottom + tall; layer < layers && flanked(layer); layer += 1) {
      const gap = Array.from({ length: along }, (_, offset) => position(layer, offset)).filter((cell) => cells[cell] === null);
      if (!gap.length) break;
      const wall = opening.axis === 'x' ? at(layer, start - 1, opening.z) : at(layer, opening.x, start - 1);
      for (const cell of gap) {
        cells[cell] = wall;
        addedCells += 1;
      }
    }
    // A door threshold on a floor slab over the hollow interior needs a column down to
    // something solid, hidden inside the building.
    if (opening.kind === 'door')
      for (let offset = 0; offset < along; offset += 1) {
        const threshold = position(bottom - 1, offset);
        if (bottom === 0 || cells[threshold] === null) continue;
        let layer = bottom - 2;
        while (layer >= 0 && cells[position(layer, offset)] === null) layer -= 1;
        for (let fill = layer + 1; fill < bottom - 1; fill += 1) {
          cells[position(fill, offset)] = cells[threshold];
          addedCells += 1;
        }
      }
  }

  /**
   * Posts on every other stud over a solid course, one stud thick, read as a railing; a
   * balustrade (two courses, when a top rail follows) or a lattice railing replaces them.
   */
  function planRailings(layer: number) {
    for (const runsAlongX of [true, false]) {
      const lines = runsAlongX ? depth : width;
      const span = runsAlongX ? width : depth;
      for (let line = 0; line < lines; line += 1) {
        const cell = (l: number, u: number, side = 0) =>
          runsAlongX ? at(l, u, line + side) : at(l, line + side, u);
        const railing = (u: number) =>
          cell(layer - 1, u) !== null && cell(layer, u, -1) === null && cell(layer, u, 1) === null;
        let u = 0;
        while (u < span) {
          // A run alternating post, gap, post... over a solid course.
          let end = u;
          while (
            end + 1 < span &&
            railing(end + 1) &&
            (cell(layer, end + 1) === null) !== (cell(layer, end) === null)
          )
            end += 1;
          const posts = Array.from({ length: end - u + 1 }, (_, step) => cell(layer, u + step)).filter((value) => value !== null);
          if (!railing(u) || end - u + 1 < 5 || posts.length < 3) {
            u = end + 1;
            continue;
          }
          // A railing has open air above its top rail; a row of holes in a wall does not.
          const openAbove = [1, 2, 3].some((above) =>
            Array.from({ length: end - u + 1 }, (_, step) => cell(layer + above, u + step)).every((value) => value === null),
          );
          if (!openAbove) {
            u = end + 1;
            continue;
          }
          const color = posts[0]!;
          const topRail = Array.from({ length: end - u + 1 }, (_, step) => cell(layer + 1, u + step)).every((value) => value !== null);
          const partId = topRail ? '30055' : '3633';
          const tall = topRail ? 2 : 1;
          for (let start = u; start + 4 <= end + 1; start += 4) {
            const covered: number[] = [];
            for (let l = layer; l < layer + tall; l += 1)
              for (let step = 0; step < 4; step += 1)
                covered.push(runsAlongX ? index(l, start + step, line) : index(l, line, start + step));
            const allowedColor = detailColor(partId, color);
            if (allowedColor === undefined) continue;
            if (
              reserve({
                partId,
                color: allowedColor,
                rotation: runsAlongX ? 90 : 0,
                x: runsAlongX ? start : line,
                z: runsAlongX ? line : start,
                layer,
                width: runsAlongX ? 4 : 1,
                depth: runsAlongX ? 1 : 4,
                cells: covered,
              })
            )
              for (const target of covered) cells[target] = allowedColor;
          }
          u = end + 1;
        }
      }
    }
  }

  function planSlopes(layer: number) {
    // A step edge: the cell is uncovered, its inner neighbour carries the next course, and
    // nothing is outside it. A slope over both, high side inward, keeps that course's studs.
    for (const [, dx, dz] of DIRECTIONS) {
      const downhill = DIRECTIONS.find(([, ex, ez]) => ex === -dx && ez === -dz)![0];
      const runsAlongX = dx === 0;
      const edge = (x: number, z: number) => {
        const cell = index(layer, x, z);
        const inner = index(layer, x + dx, z + dz);
        if (cells[cell] === null || at(layer + 1, x, z) !== null || reserved[cell] !== -1) return false;
        if (at(layer, x + dx, z + dz) === null || at(layer + 1, x + dx, z + dz) === null || reserved[inner] !== -1)
          return false;
        if (at(layer, x - dx, z - dz) !== null) return false;
        return !model.slopes || model.slopes[cell] === downhill || model.slopes[inner] === downhill;
      };
      for (let line = 0; line < (runsAlongX ? depth : width); line += 1) {
        let run: [number, number][] = [];
        const flush = () => {
          while (run.length) {
            // Textured roofs mix slope widths per course, staggered like shingles.
            const size = options.texture ? 1 + (hash(layer, line, run.length, 7) % 4) : 4;
            const chunk = run.splice(0, Math.min(size, run.length));
            const [x, z] = chunk[0];
            const partId = SLOPE_PART_IDS[chunk.length - 1];
            const color = cells[index(layer, x, z)]!;
            if (!allowed(partId, color)) continue;
            const covered = chunk.flatMap(([cx, cz]) => [index(layer, cx, cz), index(layer, cx + dx, cz + dz)]);
            // At rotation 0 the studs (high side) face +z; quarter turns follow the engine.
            const rotation = ({ 'z-': 0, 'x-': 90, 'z+': 180, 'x+': 270 } as const)[downhill];
            reserve({
              partId,
              color,
              rotation,
              x: Math.min(x, x + dx),
              z: Math.min(z, z + dz),
              layer,
              width: runsAlongX ? chunk.length : 2,
              depth: runsAlongX ? 2 : chunk.length,
              cells: covered,
            });
          }
        };
        for (let along = 0; along < (runsAlongX ? width : depth); along += 1) {
          const [x, z] = runsAlongX ? [along, line] : [line, along];
          const last = run.at(-1);
          if (edge(x, z) && (!last || cells[index(layer, ...last)] === cells[index(layer, x, z)])) run.push([x, z]);
          else {
            flush();
            if (edge(x, z)) run.push([x, z]);
          }
        }
        flush();
      }
    }
  }

  let assembly: Assembly = { name: model.name, buildArea, bricks };
  // Removing a rejected brick can strand the bricks it supported, so repeat until stable.
  for (let pass = 0; pass < MAX_VOXEL_LAYERS + 1; pass += 1) {
    const rejected = new Set(validateAssembly(assembly).map((issue) => issue.brickId));
    if (!rejected.size) break;
    assembly = { ...assembly, bricks: assembly.bricks.filter((brick) => !rejected.has(brick.id)) };
  }
  const kept = new Set(assembly.bricks.map((brick) => brick.id));
  const placed = new Set<number>();
  bricks.forEach((brick, position) => {
    if (kept.has(brick.id)) for (const cell of brickCells[position]) placed.add(cell);
  });
  const filled = cells.filter((cell) => cell !== null).length;
  const count = (ids: string[]) => assembly.bricks.filter((brick) => ids.includes(brick.partId)).length;
  const leftOut = cells.flatMap((cell, position) => (cell !== null && !placed.has(position) ? [position] : []));
  return { leftOut, result: {
    assembly,
    origin,
    filledCells: filled,
    skippedCells: leftOut.length,
    addedCells,
    details: {
      slopes: count(SLOPE_PART_IDS),
      windows: count(WINDOW_PART_IDS),
      doors: count(DOOR_PART_IDS),
      railings: count(RAILING_PART_IDS),
    },
    truncated,
  } };
}

/** Longest layer description sent to Claude; larger models are run-length encoded, then cut. */
export const MAX_VOXEL_DESCRIPTION_CHARS = 60_000;

/**
 * Compact text maps of a voxel model for Claude: one row of characters per z, one letter per
 * color, '.' for empty. Identical consecutive layers are collapsed. When that exceeds `maxChars`,
 * rows are run-length encoded, and layers that still do not fit are listed as omitted.
 */
export function describeVoxelModel(
  model: VoxelModel,
  origin = { x: 0, z: 0 },
  maxChars = MAX_VOXEL_DESCRIPTION_CHARS,
) {
  validateVoxelModel(model);
  const used = [...new Set(model.cells.filter((cell): cell is number => cell !== null))];
  const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (used.length > letters.length) throw new Error('Voxel models are limited to 52 colors.');
  const letter = new Map(used.map((color, position) => [color, letters[position]]));
  const legend = used
    .map((color) => `${letter.get(color)}=${COLORS.find((entry) => entry.id === color)?.name ?? 'Unknown'} (${color})`)
    .join(', ');
  const header = [
    `Model "${model.name}": ${model.width} x ${model.depth} studs, ${model.layers} brick layers.`,
    `Board position: x = ${origin.x} + column, z = ${origin.z} + row, y = layer * 3 plates.`,
    `Legend: ${legend}; . = empty.`,
  ];
  const describe = (encoded: boolean) => {
    const lines = encoded
      ? [...header, 'Rows are run-length encoded: a symbol followed by its repeat count, e.g. ".3a5" is 3 empty then 5 a.']
      : [...header];
    let length = lines.join('\n').length;
    const runs: { start: number; end: number; text: string }[] = [];
    for (let layer = 0; layer < model.layers; layer += 1) {
      const rows: string[] = [];
      for (let z = 0; z < model.depth; z += 1) {
        let row = '';
        for (let x = 0; x < model.width; x += 1) {
          const cell = model.cells[(layer * model.depth + z) * model.width + x];
          row += cell === null ? '.' : letter.get(cell);
        }
        rows.push(encoded ? row.replace(/(.)\1*/g, (run, symbol: string) => (run.length > 1 ? symbol + run.length : symbol)) : row);
      }
      const text = rows.join('\n');
      const last = runs.at(-1);
      if (last?.text === text) last.end = layer;
      else runs.push({ start: layer, end: layer, text });
    }
    for (const [position, { start, end, text }] of runs.entries()) {
      const label = end > start ? `Layers ${start}-${end}:` : `Layer ${start}:`;
      const omitted = `Layers ${start}-${model.layers - 1} omitted: the model is too large to describe.`;
      // Keep room for the omission note itself.
      if (length + label.length + text.length + 2 + (position < runs.length - 1 ? omitted.length + 1 : 0) > maxChars) {
        lines.push(omitted);
        return lines.join('\n');
      }
      lines.push(label, text);
      length += label.length + text.length + 2;
    }
    return lines.join('\n');
  };
  const plain = describe(false);
  return plain.length <= maxChars && !plain.includes(' omitted: ') ? plain : describe(true);
}

const CELL_LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** A voxel model as one character per cell ('.' empty, letters index `colors`), for transport. */
export interface EncodedVoxelModel {
  name: string;
  width: number;
  depth: number;
  layers: number;
  colors: number[];
  cells: string;
}

export function encodeVoxelModel(model: VoxelModel): EncodedVoxelModel {
  validateVoxelModel(model);
  const colors = [...new Set(model.cells.filter((cell): cell is number => cell !== null))];
  if (colors.length > CELL_LETTERS.length) throw new Error('Voxel models are limited to 52 colors.');
  const letter = new Map(colors.map((color, position) => [color, CELL_LETTERS[position]]));
  const { name, width, depth, layers } = model;
  return { name, width, depth, layers, colors, cells: model.cells.map((cell) => (cell === null ? '.' : letter.get(cell))).join('') };
}

export function decodeVoxelModel(encoded: EncodedVoxelModel): VoxelModel {
  const { name, width, depth, layers, colors, cells } = encoded;
  if (!Array.isArray(colors) || colors.length > CELL_LETTERS.length || typeof cells !== 'string')
    throw new Error('Invalid encoded voxel model.');
  const decoded = [...cells].map((character) => {
    if (character === '.') return null;
    const color = colors[CELL_LETTERS.indexOf(character)];
    if (color === undefined) throw new Error('Invalid encoded voxel model.');
    return color;
  });
  const model = { name, width, depth, layers, cells: decoded };
  validateVoxelModel(model);
  return model;
}

/** Grid cells (index into the model) that bricks of the assembly occupy. */
function coveredCells(model: VoxelModel, origin: { x: number; z: number }, assembly: Assembly) {
  const covered = new Uint8Array(model.cells.length);
  for (const brick of assembly.bricks) {
    const part = getPart(brick.partId);
    const [width, depth] = brick.rotation % 180 ? [part.depth, part.width] : [part.width, part.depth];
    const top = Math.ceil((brick.y + part.height) / 3);
    for (let layer = Math.floor(brick.y / 3); layer < Math.min(top, model.layers); layer += 1)
      for (let dz = 0; dz < Math.ceil(depth); dz += 1)
        for (let dx = 0; dx < Math.ceil(width); dx += 1) {
          const [x, z] = [Math.floor(brick.x) - origin.x + dx, Math.floor(brick.z) - origin.z + dz];
          if (x >= 0 && z >= 0 && x < model.width && z < model.depth)
            covered[(layer * model.depth + z) * model.width + x] = 1;
        }
  }
  return covered;
}

export interface VoxelGap {
  cells: number;
  /** Board coordinates of the gap's bounding box: studs for x/z, plates for y. */
  x: [number, number];
  z: [number, number];
  y: [number, number];
  color: number;
  /**
   * How its lowest cells can be carried: 'supported' when a built piece is directly under one,
   * 'bridgeable' when one is within two free studs (a longer brick can reach back onto it), and
   * 'unsupported' when upright bricks cannot reach it without first building support.
   */
  support: 'supported' | 'bridgeable' | 'unsupported';
}

/**
 * Parts of the reference model the build does not cover yet, as connected regions, largest
 * first: a short work list instead of the whole model.
 */
export function findVoxelGaps(
  model: VoxelModel,
  origin: { x: number; z: number },
  assembly: Assembly,
  limit = 25,
) {
  validateVoxelModel(model);
  const { width, depth, layers, cells } = model;
  const covered = coveredCells(model, origin, assembly);
  const open = (cell: number) => cells[cell] !== null && !covered[cell];
  const seen = new Uint8Array(cells.length);
  const gaps: VoxelGap[] = [];
  let total = 0;
  for (let first = 0; first < cells.length; first += 1) {
    if (!open(first) || seen[first]) continue;
    const region: number[] = [];
    const queue = [first];
    seen[first] = 1;
    while (queue.length) {
      const cell = queue.pop()!;
      region.push(cell);
      const x = cell % width;
      const z = Math.floor(cell / width) % depth;
      const layer = Math.floor(cell / (width * depth));
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const [nx, ny, nz] = [x + dx, layer + dy, z + dz];
        if (nx < 0 || nz < 0 || ny < 0 || nx >= width || nz >= depth || ny >= layers) continue;
        const next = (ny * depth + nz) * width + nx;
        if (open(next) && !seen[next]) {
          seen[next] = 1;
          queue.push(next);
        }
      }
    }
    total += region.length;
    const xs = region.map((cell) => cell % width);
    const zs = region.map((cell) => Math.floor(cell / width) % depth);
    const ls = region.map((cell) => Math.floor(cell / (width * depth)));
    const lowest = Math.min(...ls);
    const counts = new Map<number, number>();
    for (const cell of region) counts.set(cells[cell]!, (counts.get(cells[cell]!) ?? 0) + 1);
    gaps.push({
      cells: region.length,
      x: [origin.x + Math.min(...xs), origin.x + Math.max(...xs)],
      z: [origin.z + Math.min(...zs), origin.z + Math.max(...zs)],
      y: [lowest * 3, (Math.max(...ls) + 1) * 3],
      color: [...counts].sort((a, b) => b[1] - a[1])[0][0],
      support: gapSupport(region.filter((_, position) => ls[position] === lowest), lowest),
    });
  }
  // Gaps that can be closed come first; the rest need support built before any brick fits.
  const rank = { supported: 0, bridgeable: 1, unsupported: 2 } as const;
  gaps.sort((a, b) => rank[a.support] - rank[b.support] || b.cells - a.cells);
  const unsupported = gaps.filter((gap) => gap.support === 'unsupported');
  return {
    missingCells: total,
    unsupportedCells: unsupported.reduce((sum, gap) => sum + gap.cells, 0),
    regions: gaps.slice(0, limit),
    moreRegions: Math.max(0, gaps.length - limit),
  };

  function gapSupport(bottom: number[], lowest: number): VoxelGap['support'] {
    if (lowest === 0) return 'supported';
    const below = (x: number, z: number) =>
      x >= 0 && z >= 0 && x < width && z < depth && covered[((lowest - 1) * depth + z) * width + x] === 1;
    // Free in the gap's own layer, so a new brick can run through it.
    const free = (x: number, z: number) =>
      x >= 0 && z >= 0 && x < width && z < depth && !covered[(lowest * depth + z) * width + x];
    let support: VoxelGap['support'] = 'unsupported';
    for (const cell of bottom) {
      const [x, z] = [cell % width, Math.floor(cell / width) % depth];
      if (below(x, z)) return 'supported';
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
        for (let reach = 1; reach <= 2 && free(x + dx * reach, z + dz * reach); reach += 1)
          if (below(x + dx * reach, z + dz * reach)) support = 'bridgeable';
    }
    return support;
  }
}

/**
 * One layer of the reference model next to the same layer of the build, one character per
 * stud: a color letter, '.' empty; in the build map '#' marks a piece in a color the model
 * does not use there.
 */
export function describeVoxelLayer(
  model: VoxelModel,
  origin: { x: number; z: number },
  assembly: Assembly,
  layer: number,
) {
  validateVoxelModel(model);
  if (!Number.isInteger(layer) || layer < 0 || layer >= model.layers)
    throw new Error(`Layer must be 0-${model.layers - 1}.`);
  const { width, depth } = model;
  const colors = [...new Set(model.cells.filter((cell): cell is number => cell !== null))];
  const letter = new Map(colors.map((color, position) => [color, CELL_LETTERS[position]]));
  const built = new Map<number, number>();
  for (const brick of assembly.bricks) {
    const part = getPart(brick.partId);
    if (brick.y > layer * 3 + 2 || brick.y + part.height <= layer * 3) continue;
    const [w, d] = brick.rotation % 180 ? [part.depth, part.width] : [part.width, part.depth];
    for (let dz = 0; dz < Math.ceil(d); dz += 1)
      for (let dx = 0; dx < Math.ceil(w); dx += 1) {
        const [x, z] = [Math.floor(brick.x) - origin.x + dx, Math.floor(brick.z) - origin.z + dz];
        if (x >= 0 && z >= 0 && x < width && z < depth) built.set(z * width + x, brick.color);
      }
  }
  const rows = (cell: (x: number, z: number) => string) =>
    Array.from({ length: depth }, (_, z) => Array.from({ length: width }, (_, x) => cell(x, z)).join('')).join('\n');
  const legend = colors
    .map((color) => `${letter.get(color)}=${COLORS.find((entry) => entry.id === color)?.name ?? 'Unknown'} (${color})`)
    .join(', ');
  return [
    `Layer ${layer} (y = ${layer * 3} plates). Column c is x = ${origin.x} + c, row r is z = ${origin.z} + r.`,
    `Legend: ${legend}; . = empty; # = a color the model does not use.`,
    'Model:',
    rows((x, z) => {
      const cell = model.cells[(layer * depth + z) * width + x];
      return cell === null ? '.' : letter.get(cell)!;
    }),
    'Build:',
    rows((x, z) => {
      const color = built.get(z * width + x);
      return color === undefined ? '.' : (letter.get(color) ?? '#');
    }),
  ].join('\n');
}

/** Plain bricks swapped for masonry-profile bricks of the same size on stone walls. */
const MASONRY_SWAPS: Readonly<Record<string, string>> = { '3004': '98283', '3010': '15533' };
/** Stone colours: bricks in these become masonry bricks on walls. */
const STONE_COLORS = new Set([72, 71, 8, 7, 19, 28]);
/**
 * Shades mixed into a material the way sets break up a flat colour, by base colour: each entry
 * is a shade and its share in percent. Stone greys pick up the other grey and a little tan,
 * brown roofs and thatch a darker brown and dark tan.
 */
const MATERIAL_SHADES: Readonly<Record<number, readonly (readonly [number, number])[]>> = {
  72: [[71, 18], [28, 6]],
  71: [[72, 18], [19, 6]],
  8: [[7, 18]],
  7: [[8, 18]],
  19: [[28, 15], [84, 6]],
  28: [[19, 15], [72, 6]],
  70: [[308, 20], [28, 4]],
  308: [[70, 20]],
  84: [[70, 15], [19, 8]],
  4: [[320, 15]],
  320: [[4, 15]],
};
/** Parts whose colour can vary: plain bricks, masonry and roof slopes. */
const SHADED_PART_IDS = new Set([...VOXEL_FILL_PART_IDS, '98283', '15533', ...SLOPE_PART_IDS]);
/** Tiles by footprint ("width x depth" before rotation), for capping exposed tops. */
const CAP_TILES: Readonly<Record<string, string>> = {
  '1x1': '3070b', '1x2': '3069b', '1x3': '63864', '1x4': '2431', '1x6': '6636', '1x8': '4162',
  '2x2': '3068b', '2x3': '26603', '2x4': '87079', '2x6': '69729',
};
const PLAIN_PART_IDS = new Set([...VOXEL_FILL_PART_IDS, ...Object.values(MASONRY_SWAPS)]);
const RIDGE_PART_ID = '35464';
/** Window glass and doors that fit the frames the fill places. */
const FRAME_INSERTS: Readonly<Record<string, { partId: string; colors: number[] }>> = {
  '60592': { partId: '60601', colors: [47] },
  '60593': { partId: '60602', colors: [47] },
  '60594': { partId: '86210', colors: [47] },
  '3579': { partId: '3193a', colors: [70, 308, 0] },
  '60596': { partId: '60616a', colors: [70, 308, 0] },
};
const BASEPLATE_COLORS = [2, 288, 72, 0];

export interface VoxelStyle {
  masonry: number;
  accents: number;
  caps: number;
  ridges: number;
  inserts: number;
  baseplates: number;
}

/**
 * Finishes a voxel fill the way a set would be: masonry bricks and a lighter accent shade on
 * stone walls, glass and doors in the frames, tiles on exposed wall tops, a ridge along the
 * roof, and baseplates underneath. Every addition is checked by the engine and dropped if it
 * does not fit, so the result stays as valid as the fill.
 */
export function styleVoxelFill(
  fill: VoxelFill,
  model: VoxelModel,
  options: { colorAllowed?: (partId: string, color: number) => boolean } = {},
): VoxelFill & { style: VoxelStyle } {
  const allowed = options.colorAllowed ?? (() => true);
  const { origin } = fill;
  const style: VoxelStyle = { masonry: 0, accents: 0, caps: 0, ridges: 0, inserts: 0, baseplates: 0 };
  let next = 1;
  const id = (kind: string) => `style-${kind}-${next++}`;
  const footprint = (brick: Brick) => {
    const part = getPart(brick.partId);
    return brick.rotation % 180 ? { width: part.depth, depth: part.width } : { width: part.width, depth: part.depth };
  };
  // Stone walls: grey bricks that are not part of a roof.
  const roofCell = (brick: Brick, dx: number, dz: number) => {
    const [x, z, layer] = [brick.x - origin.x + dx, brick.z - origin.z + dz, Math.floor(brick.y / 3)];
    if (x < 0 || z < 0 || x >= model.width || z >= model.depth || layer >= model.layers) return false;
    return Boolean(model.slopes?.[(layer * model.depth + z) * model.width + x]);
  };
  const isRoof = (brick: Brick) => {
    const { width, depth } = footprint(brick);
    for (let dz = 0; dz < depth; dz += 1) for (let dx = 0; dx < width; dx += 1) if (roofCell(brick, dx, dz)) return true;
    return false;
  };
  let bricks = fill.assembly.bricks.map((brick) => {
    if (!SHADED_PART_IDS.has(brick.partId)) return brick;
    let styled = brick;
    const masonry = MASONRY_SWAPS[brick.partId];
    if (masonry && STONE_COLORS.has(brick.color) && !isRoof(brick) && allowed(masonry, brick.color)) {
      styled = { ...styled, partId: masonry };
      style.masonry += 1;
    }
    // A fixed, scattered pick so the pattern does not change between conversions.
    const roll = hash(brick.x, brick.y, brick.z) % 100;
    let threshold = 0;
    for (const [shade, share] of MATERIAL_SHADES[brick.color] ?? []) {
      threshold += share;
      if (roll < threshold) {
        if (allowed(styled.partId, shade)) {
          styled = { ...styled, color: shade };
          style.accents += 1;
        }
        break;
      }
    }
    return styled;
  });

  // Exposed tops, from which bricks cover which grid cells.
  const top = new Set<string>();
  for (const brick of bricks) {
    const { width, depth } = footprint(brick);
    const part = getPart(brick.partId);
    for (let dz = 0; dz < Math.ceil(depth); dz += 1)
      for (let dx = 0; dx < Math.ceil(width); dx += 1)
        for (let y = brick.y; y < brick.y + part.height; y += 1) top.add(`${Math.floor(brick.x) + dx},${Math.floor(y)},${Math.floor(brick.z) + dz}`);
  }
  const exposed = (brick: Brick) => {
    const { width, depth } = footprint(brick);
    const y = brick.y + getPart(brick.partId).height;
    for (let dz = 0; dz < depth; dz += 1) for (let dx = 0; dx < width; dx += 1) if (top.has(`${brick.x + dx},${y},${brick.z + dz}`)) return false;
    return true;
  };
  const additions: Brick[] = [];
  for (const brick of bricks) {
    if (!PLAIN_PART_IDS.has(brick.partId) || !exposed(brick)) continue;
    const part = getPart(brick.partId);
    const y = brick.y + part.height;
    if (isRoof(brick)) {
      // Ridge pieces go on the roof's top line: studs with no higher roof course beside them
      // (the exposed treads of the stepped roof below are not the ridge).
      if (!allowed(RIDGE_PART_ID, brick.color)) continue;
      const { width, depth } = footprint(brick);
      const layer = Math.floor(brick.y / 3) + 1;
      for (let dz = 0; dz < depth; dz += 1)
        for (let dx = 0; dx < width; dx += 1) {
          const [x, z] = [brick.x - origin.x + dx, brick.z - origin.z + dz];
          let higher = false;
          for (let nz = -1; nz <= 1 && !higher; nz += 1)
            for (let nx = -1; nx <= 1; nx += 1) {
              const [cx, cz] = [x + nx, z + nz];
              if (cx < 0 || cz < 0 || cx >= model.width || cz >= model.depth || layer >= model.layers) continue;
              if (model.cells[(layer * model.depth + cz) * model.width + cx] !== null) higher = true;
            }
          if (!higher)
            additions.push({ id: id('ridge'), partId: RIDGE_PART_ID, color: brick.color, x: brick.x + dx, y, z: brick.z + dz, rotation: 0 });
        }
      continue;
    }
    const tile = CAP_TILES[`${part.width}x${part.depth}`];
    if (tile && allowed(tile, brick.color))
      additions.push({ id: id('cap'), partId: tile, color: brick.color, x: brick.x, y, z: brick.z, rotation: brick.rotation });
  }
  // Inserts sit half a stud into their frame; the side depends on the frame's turn, so the
  // engine decides between the candidate offsets.
  const inserts: Brick[][] = [];
  for (const frame of bricks) {
    const insert = FRAME_INSERTS[frame.partId];
    if (!insert) continue;
    const color = insert.colors.find((candidate) => allowed(insert.partId, candidate));
    if (color === undefined) continue;
    const across = frame.rotation % 180 ? 'z' : 'x';
    const along = across === 'x' ? 'z' : 'x';
    const candidates: Brick[] = [];
    for (const shift of [0.5, -0.5, 0])
      for (const slide of [0, -0.5])
        candidates.push({
          id: id('insert'),
          partId: insert.partId,
          color,
          x: frame.x,
          y: frame.y,
          z: frame.z,
          rotation: frame.rotation,
          [across]: frame[across] + shift,
          [along]: frame[along] + slide,
        } as Brick);
    inserts.push(candidates);
  }

  // Baseplates under the ground course; everything else rises half a plate onto their studs.
  const ground = bricks.filter((brick) => brick.y === 0);
  const plates: Brick[] = [];
  const plateColor = BASEPLATE_COLORS.find((color) => allowed('3867', color));
  // The board grows (to the engine maximum) so whole baseplates fit under the footprint.
  let boardArea = fill.assembly.buildArea ?? BUILD_AREA;
  if (ground.length && plateColor !== undefined) {
    const extent = (values: number[]) => Math.ceil((Math.max(...values) - Math.min(...values) + 2) / 16) * 16;
    const needed = Math.max(
      extent(ground.flatMap((brick) => [brick.x, brick.x + footprint(brick).width])),
      extent(ground.flatMap((brick) => [brick.z, brick.z + footprint(brick).depth])),
    );
    if (needed <= MAX_BUILD_AREA) boardArea = Math.max(boardArea, needed);
  }
  // Growing the board keeps the build centred.
  const shift = Math.floor((boardArea - (fill.assembly.buildArea ?? BUILD_AREA)) / 2);
  if (shift) {
    bricks = bricks.map((brick) => ({ ...brick, x: brick.x + shift, z: brick.z + shift }));
    for (const brick of [...additions, ...inserts.flat()]) {
      brick.x += shift;
      brick.z += shift;
    }
  }
  const shiftedGround = bricks.filter((brick) => brick.y === 0);
  if (shiftedGround.length && plateColor !== undefined) {
    const buildArea = boardArea;
    const ground = shiftedGround;
    const xs = ground.flatMap((brick) => [brick.x, brick.x + footprint(brick).width]);
    const zs = ground.flatMap((brick) => [brick.z, brick.z + footprint(brick).depth]);
    const span = (low: number, high: number) => {
      const count = Math.ceil((high - low + 2) / 16);
      const start = Math.max(0, Math.min(buildArea - count * 16, Math.floor((low + high) / 2 - count * 8)));
      return { start, count: Math.min(count, Math.floor(buildArea / 16)) };
    };
    const [sx, sz] = [span(Math.min(...xs), Math.max(...xs)), span(Math.min(...zs), Math.max(...zs))];
    for (let i = 0; i < sx.count; i += 1)
      for (let j = 0; j < sz.count; j += 1)
        plates.push({ id: id('base'), partId: '3867', color: plateColor, x: sx.start + i * 16, y: 0, z: sz.start + j * 16, rotation: 0 });
  }

  const name = fill.assembly.name;
  const buildArea = boardArea;
  const valid = (candidate: Brick[]) => validateAssembly({ name, buildArea, bricks: candidate });
  if (plates.length) {
    const raised = [...plates, ...bricks.map((brick) => ({ ...brick, y: brick.y + 0.5 }))];
    if (!valid(raised).length) {
      bricks = raised;
      style.baseplates = plates.length;
      for (const addition of additions) addition.y += 0.5;
      for (const candidates of inserts) for (const candidate of candidates) candidate.y += 0.5;
    }
  }
  // Inserts one by one (each needs its frame free), then caps and ridges together; anything
  // the engine rejects is dropped.
  for (const candidates of inserts)
    for (const candidate of candidates)
      if (!valid([...bricks, candidate]).length) {
        bricks = [...bricks, candidate];
        style.inserts += 1;
        break;
      }
  let decorated = [...bricks, ...additions];
  for (let pass = 0; pass < 4; pass += 1) {
    const rejected = new Set(valid(decorated).map((issue) => issue.brickId));
    if (!rejected.size) break;
    // Only additions are dropped; if a styled original is rejected, fall back to the fill.
    if ([...rejected].some((brickId) => !brickId.startsWith('style-cap') && !brickId.startsWith('style-ridge')))
      return { ...fill, style: { masonry: 0, accents: 0, caps: 0, ridges: 0, inserts: 0, baseplates: 0 } };
    decorated = decorated.filter((brick) => !rejected.has(brick.id));
  }
  style.caps = decorated.filter((brick) => brick.id.startsWith('style-cap')).length;
  style.ridges = decorated.filter((brick) => brick.id.startsWith('style-ridge')).length;
  return {
    ...fill,
    origin: { x: origin.x + shift, z: origin.z + shift },
    assembly: { ...fill.assembly, buildArea, bricks: decorated },
    style,
  };
}
