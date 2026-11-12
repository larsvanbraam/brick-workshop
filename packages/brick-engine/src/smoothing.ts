import { footprint, getPart, validateAssembly } from './core.ts';
import type { Assembly, Brick, Rotation } from './core.ts';
import { FLOOR_PART_IDS } from './board.ts';

/** Where the smoothing pass may work: pieces whose minimum corner lies in this box (studs, plates). */
export interface SmoothRegion {
  minX?: number;
  maxX?: number;
  minZ?: number;
  maxZ?: number;
  minY?: number;
  maxY?: number;
}

export interface SmoothOptions {
  /** Only pieces whose minimum corner lies in this box are smoothed or built on. */
  region?: SmoothRegion;
  /** Only these pieces are smoothed or built on (combined with `region`). */
  ids?: ReadonlySet<string>;
  /** Only pieces this accepts are smoothed or built on, e.g. by color (combined with the rest). */
  only?: (brick: Brick) => boolean;
  /** Swap plain 1 x 1 and 2 x 2 pieces on outside corners for round ones. Default true. */
  corners?: boolean;
  /** Slopes and curved slopes against steps that rise two plates or more. Default true. */
  slopes?: boolean;
  /** Tiles on edges, quarter-round tiles on corners and flush tiles on plate steps. Default true. */
  tiles?: boolean;
  /** Small flowers scattered on green tops. Default false: a green figure is not a lawn. */
  accents?: boolean;
  /** Share of open green studs that get a flower, 0 to 1. Default 0.08. */
  accentDensity?: number;
  /** Most pieces the assembly may hold afterwards. */
  maxPieces?: number;
  /** Host color policy, e.g. observed-colors-only. Defaults to allowing every color. */
  colorAllowed?: (partId: string, color: number) => boolean;
  /** IDs for added pieces; defaults to `smooth-<n>`, skipping IDs in use. */
  nextId?: () => string;
}

export interface SmoothCounts {
  /** Plain pieces swapped for round or quarter-circle ones. */
  rounded: number;
  /** Cheese slopes against steps. */
  slopes: number;
  /** Curved slopes running off steps. */
  curves: number;
  /** Square tiles on edges and flush on plate steps. */
  tiles: number;
  /** Quarter-round and round tiles on corners and tips. */
  corners: number;
  /** Flowers on green tops. */
  accents: number;
}

export interface SmoothResult {
  assembly: Assembly;
  counts: SmoothCounts;
  /** Pieces added, in the order they were planned. */
  added: Brick[];
  /** IDs of pieces swapped in place (same ID and position, new part and rotation). */
  swapped: string[];
}

const ROUND_SWAPS: Readonly<Record<string, string>> = { '3024': '6141', '3005': '3062b' };
const QUARTER_PLATE = '7904';
const CHEESE = '54200';
const CURVE = '11477';
const TILE = '3070b';
const QUARTER_TILE = '25269';
const ROUND_TILE = '98138';
const FLOWER = '6141';
const GREENS = new Set([2, 10, 27, 288, 326, 330]);
const FLOWER_COLORS = [4, 14, 15, 5, 1, 13];

type Direction = readonly [dx: number, dz: number];
const DIRECTIONS: readonly Direction[] = [
  [0, -1],
  [-1, 0],
  [0, 1],
  [1, 0],
];
/** The turn that points a slope's low side (its own -z side) along a direction. */
function lowSideRotation([dx, dz]: Direction): Rotation {
  if (dz < 0) return 0;
  if (dx < 0) return 90;
  if (dz > 0) return 180;
  return 270;
}
/** The turn that puts a quarter-circle's rounded corner on a diagonal (it is +x -z unturned). */
function cornerRotation(dx: number, dz: number): Rotation {
  if (dx > 0 && dz < 0) return 0;
  if (dx < 0 && dz < 0) return 90;
  if (dx < 0 && dz > 0) return 180;
  return 270;
}

/** A small, stable integer hash, so scattered details land the same way every time. */
function hash(...values: number[]) {
  let value = 2166136261;
  for (const part of values) {
    value ^= Math.round(part * 2) + 0x9e3779b9 + (value << 6) + (value >>> 2);
    value = Math.imul(value, 16777619) >>> 0;
  }
  return value;
}

/** Upright on whole studs, at a whole or half plate (pieces on a baseplate sit half a plate up). */
function onGrid(brick: Brick) {
  return (
    !brick.facing &&
    !brick.upsideDown &&
    Number.isInteger(brick.x) &&
    Number.isInteger(brick.z) &&
    Number.isInteger(brick.y * 2)
  );
}

/** Baseplates and plate floors: ground that takes flowers, but no tiles or slopes. */
function isGround(brick: Brick) {
  return (
    onGrid(brick) &&
    (getPart(brick.partId).family === 'baseplate' ||
      (FLOOR_PART_IDS as readonly string[]).includes(brick.partId))
  );
}

/** Plain bricks and plates: full rectangles with a stud on every cell, upright on the grid. */
function isPlain(brick: Brick) {
  if (!onGrid(brick)) return false;
  if ((FLOOR_PART_IDS as readonly string[]).includes(brick.partId)) return false;
  const part = getPart(brick.partId);
  if (part.kind === 'tile' || part.shape || (part.family && part.family !== 'tall')) return false;
  if (!Number.isInteger(part.width) || !Number.isInteger(part.depth)) return false;
  return part.connections.topStuds.length === part.width * part.depth;
}

/**
 * Finishes the surfaces of a build the way sets dress a sculpted shape: outside corners of
 * plain 1 x 1 and 2 x 2 pieces become round and quarter-circle pieces, steps get cheese slopes
 * or curved slopes leaning on the riser, plate steps get flush tiles, open edges get tiles and
 * corners quarter-round tiles, and green tops (baseplates and floors too) can get a scatter of
 * flowers. Only exposed studs of plain pieces are built on, besides flowers on the ground, and only plain pieces lean on each other, so doors, windows,
 * floors and detail parts are left alone. Every change is checked by the engine and dropped if
 * it does not fit, so the result is as valid as the input.
 */
export function smoothAssembly(assembly: Assembly, options: SmoothOptions = {}): SmoothResult {
  const counts: SmoothCounts = {
    rounded: 0,
    slopes: 0,
    curves: 0,
    tiles: 0,
    corners: 0,
    accents: 0,
  };
  const unchanged: SmoothResult = { assembly, counts, added: [], swapped: [] };
  if (validateAssembly(assembly).length) return unchanged;
  const allowed = options.colorAllowed ?? (() => true);
  const use = {
    corners: options.corners ?? true,
    slopes: options.slopes ?? true,
    tiles: options.tiles ?? true,
    accents: options.accents ?? false,
  };
  const density = Math.min(1, Math.max(0, options.accentDensity ?? 0.08));
  const region = options.region ?? {};
  const inScope = (brick: Brick) =>
    (!options.ids || options.ids.has(brick.id)) &&
    (!options.only || options.only(brick)) &&
    brick.x >= (region.minX ?? -Infinity) &&
    brick.x <= (region.maxX ?? Infinity) &&
    brick.z >= (region.minZ ?? -Infinity) &&
    brick.z <= (region.maxZ ?? Infinity) &&
    brick.y >= (region.minY ?? -Infinity) &&
    brick.y <= (region.maxY ?? Infinity);

  // Every half-plate cell each piece's envelope reserves, and which plain pieces own which.
  // Half plates, because pieces on a baseplate stand half a plate up.
  const occupied = new Set<string>();
  const plainAt = new Map<string, Brick>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const reserve = (brick: Brick, into = occupied) => {
    const size = footprint(brick);
    for (let h = Math.floor(brick.y * 2); h < Math.ceil((brick.y + size.height) * 2); h += 1)
      for (let z = Math.floor(brick.z); z < Math.ceil(brick.z + size.depth); z += 1)
        for (let x = Math.floor(brick.x); x < Math.ceil(brick.x + size.width); x += 1)
          into.add(key(x, h, z));
  };
  const plain = assembly.bricks.filter(isPlain);
  const ground = assembly.bricks.filter((brick) => isGround(brick) && inScope(brick));
  const scoped = new Set(plain.filter(inScope).map((brick) => brick.id));
  for (const brick of assembly.bricks) reserve(brick);
  for (const brick of plain) {
    const size = footprint(brick);
    for (let h = brick.y * 2; h < (brick.y + size.height) * 2; h += 1)
      for (let z = brick.z; z < brick.z + size.depth; z += 1)
        for (let x = brick.x; x < brick.x + size.width; x += 1) plainAt.set(key(x, h, z), brick);
  }
  /** Whether the plate-tall cell from `y` (in plates) up is empty. */
  const free = (x: number, y: number, z: number) =>
    !occupied.has(key(x, y * 2, z)) && !occupied.has(key(x, y * 2 + 1, z));

  // Corners: round off plain pieces on outside corners, where nothing stands on what changes.
  const swaps = new Map<string, Brick>();
  if (use.corners)
    for (const brick of plain) {
      if (!scoped.has(brick.id)) continue;
      const part = getPart(brick.partId);
      const levels = Array.from({ length: part.height }, (_, index) => brick.y + index);
      const open = (x: number, z: number) => levels.every((y) => free(x, y, z));
      const round = ROUND_SWAPS[brick.partId];
      if (round) {
        const sides = DIRECTIONS.map(([dx, dz]) => open(brick.x + dx, brick.z + dz));
        const corner = sides.some((side, index) => side && sides[(index + 1) % 4]);
        if (corner && allowed(round, brick.color))
          swaps.set(brick.id, { ...brick, partId: round, rotation: 0 });
        continue;
      }
      if (brick.partId !== '3022' || !allowed(QUARTER_PLATE, brick.color)) continue;
      // The corner cell loses its stud and receiver: nothing may stand on it.
      const corners: [number, number, number, number][] = [];
      for (const [cx, dx] of [
        [brick.x, -1],
        [brick.x + 1, 1],
      ] as const)
        for (const [cz, dz] of [
          [brick.z, -1],
          [brick.z + 1, 1],
        ] as const)
          if (
            open(cx + dx, cz) &&
            open(cx, cz + dz) &&
            open(cx + dx, cz + dz) &&
            free(cx, brick.y + 1, cz)
          )
            corners.push([cx, cz, dx, dz]);
      // One rounded corner, picked steadily so mirrored shapes round the same way.
      if (corners.length) {
        const [, , dx, dz] = corners[hash(brick.x, brick.y, brick.z) % corners.length];
        swaps.set(brick.id, {
          ...brick,
          partId: QUARTER_PLATE,
          rotation: cornerRotation(dx, dz),
        });
      }
    }
  const roundedTops = new Set(
    [...swaps.values()].filter((brick) => brick.partId !== QUARTER_PLATE).map((brick) => brick.id),
  );
  const quarterCorner = new Set<string>();
  for (const brick of swaps.values())
    if (brick.partId === QUARTER_PLATE) {
      // The rounded corner's cell, so no tile is planned on the stud it no longer has.
      const [dx, dz] = ({ 0: [1, -1], 90: [-1, -1], 180: [-1, 1], 270: [1, 1] } as const)[
        brick.rotation
      ];
      quarterCorner.add(key(brick.x + (dx > 0 ? 1 : 0), brick.y + 1, brick.z + (dz > 0 ? 1 : 0)));
    }

  // Exposed studs of plain pieces in scope, low to high, front to back.
  // Ground studs only take flowers.
  type Top = { x: number; y: number; z: number; color: number; owner: Brick; ground?: true };
  const tops: Top[] = [];
  for (const brick of [...plain.filter((piece) => scoped.has(piece.id)), ...ground]) {
    const size = footprint(brick);
    const y = brick.y + size.height;
    const flat = ground.includes(brick);
    for (let z = brick.z; z < brick.z + size.depth; z += 1)
      for (let x = brick.x; x < brick.x + size.width; x += 1)
        if (free(x, y, z) && !quarterCorner.has(key(x, y, z)))
          tops.push({ x, y, z, color: brick.color, owner: brick, ...(flat && { ground: true }) });
  }
  tops.sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x);
  const topAt = new Map(tops.map((top) => [key(top.x, top.y, top.z), top]));
  /** Plain plate levels standing in a neighbouring column from `y` up, up to `limit`. */
  const rise = (x: number, y: number, z: number, limit: number) => {
    let count = 0;
    while (
      count < limit &&
      plainAt.has(key(x, (y + count) * 2, z)) &&
      plainAt.has(key(x, (y + count) * 2 + 1, z))
    )
      count += 1;
    return count;
  };

  const added: Brick[] = [];
  const used = new Set(assembly.bricks.map((brick) => brick.id));
  let serial = 0;
  const nextId =
    options.nextId ??
    (() => {
      let id: string;
      do id = `smooth-${++serial}`;
      while (used.has(id));
      return id;
    });
  const budget = (options.maxPieces ?? Infinity) - assembly.bricks.length;
  const claimed = new Set<string>();
  const add = (brick: Omit<Brick, 'id'>) => {
    if (added.length >= budget || !allowed(brick.partId, brick.color)) return false;
    const reserved = new Set<string>();
    reserve({ ...brick, id: '' }, reserved);
    for (const cell of reserved) if (occupied.has(cell)) return false;
    for (const cell of reserved) occupied.add(cell);
    const piece = { ...brick, id: nextId() };
    used.add(piece.id);
    added.push(piece);
    return true;
  };

  // The tallest step beside each stud, and the way it rises.
  const steps = new Map(
    tops.map((top) => {
      let best: { direction: Direction; height: number } | null = null;
      for (const direction of DIRECTIONS) {
        const height = rise(top.x + direction[0], top.y, top.z + direction[1], 3);
        if (height && (!best || height > best.height)) best = { direction, height };
      }
      return [top, best] as const;
    }),
  );
  // Slopes first, so a curve can run over a stud an edge tile would otherwise take.
  for (const pass of ['slopes', 'surface'] as const)
    for (const top of tops) {
      const here = key(top.x, top.y, top.z);
      if (claimed.has(here) || !free(top.x, top.y, top.z)) continue;
      const best = steps.get(top)!;
      if (pass === 'slopes') {
        if (top.ground || !best || best.height < 2 || !use.slopes) continue;
        const [dx, dz] = best.direction;
        // A curved slope runs off the step over two studs when the stud in front is open too.
        const front = topAt.get(key(top.x - dx, top.y, top.z - dz));
        if (
          front &&
          !front.ground &&
          !claimed.has(key(front.x, front.y, front.z)) &&
          front.color === top.color &&
          free(front.x, front.y, front.z) &&
          free(front.x, front.y + 1, front.z) &&
          add({
            partId: CURVE,
            color: top.color,
            x: Math.min(top.x, front.x),
            y: top.y,
            z: Math.min(top.z, front.z),
            rotation: lowSideRotation([-dx, -dz]),
          })
        ) {
          claimed.add(here);
          claimed.add(key(front.x, front.y, front.z));
          counts.curves += 1;
          continue;
        }
        if (
          add({
            partId: CHEESE,
            color: top.color,
            x: top.x,
            y: top.y,
            z: top.z,
            rotation: lowSideRotation([-dx, -dz]),
          })
        ) {
          claimed.add(here);
          counts.slopes += 1;
        }
        continue;
      }
      if (!use.tiles && !use.accents) continue;
      // Open edges: where the neighbouring column drops away below this stud.
      const edges = DIRECTIONS.map(
        ([dx, dz]) =>
          !best && free(top.x + dx, top.y - 1, top.z + dz) && free(top.x + dx, top.y, top.z + dz),
      );
      const edgeCount = edges.filter(Boolean).length;
      if (use.tiles && !top.ground && best?.height === 1) {
        // A plate step: a tile makes this stud flush with the step above.
        if (add({ partId: TILE, color: top.color, x: top.x, y: top.y, z: top.z, rotation: 0 }))
          counts.tiles += 1;
        continue;
      }
      if (use.tiles && !top.ground && edgeCount) {
        if (roundedTops.has(top.owner.id) || edgeCount >= 3) {
          if (
            add({ partId: ROUND_TILE, color: top.color, x: top.x, y: top.y, z: top.z, rotation: 0 })
          )
            counts.corners += 1;
          continue;
        }
        const corner = edges.findIndex((edge, index) => edge && edges[(index + 1) % 4]);
        if (corner !== -1) {
          const [ax, az] = DIRECTIONS[corner];
          const [bx, bz] = DIRECTIONS[(corner + 1) % 4];
          if (
            add({
              partId: QUARTER_TILE,
              color: top.color,
              x: top.x,
              y: top.y,
              z: top.z,
              rotation: cornerRotation(ax + bx, az + bz),
            })
          ) {
            counts.corners += 1;
            continue;
          }
        }
        if (add({ partId: TILE, color: top.color, x: top.x, y: top.y, z: top.z, rotation: 0 }))
          counts.tiles += 1;
        continue;
      }
      // Open studs inside a green top: a few flowers.
      if (
        use.accents &&
        !best &&
        !edgeCount &&
        GREENS.has(top.color) &&
        (hash(top.x, top.y, top.z) % 1000) / 1000 < density
      ) {
        const colors = FLOWER_COLORS.filter((color) => allowed(FLOWER, color));
        if (!colors.length) continue;
        const color = colors[hash(top.z, top.x, top.y) % colors.length];
        if (add({ partId: FLOWER, color, x: top.x, y: top.y, z: top.z, rotation: 0 }))
          counts.accents += 1;
      }
    }

  if (!added.length && !swaps.size) return unchanged;
  // Check everything together; drop additions and undo swaps the engine rejects.
  const name = assembly.name;
  const buildArea = assembly.buildArea;
  let pieces = added;
  let swapped = new Map(swaps);
  for (let pass = 0; pass < 6; pass += 1) {
    const bricks = [...assembly.bricks.map((brick) => swapped.get(brick.id) ?? brick), ...pieces];
    const issues = validateAssembly({ name, buildArea, bricks });
    if (!issues.length) {
      const kept = new Set(pieces.map((piece) => piece.id));
      for (const piece of added)
        if (!kept.has(piece.id)) {
          const kind = piece.partId;
          if (kind === CHEESE) counts.slopes -= 1;
          else if (kind === CURVE) counts.curves -= 1;
          else if (kind === TILE) counts.tiles -= 1;
          else if (kind === QUARTER_TILE || kind === ROUND_TILE) counts.corners -= 1;
          else counts.accents -= 1;
        }
      counts.rounded = swapped.size;
      return {
        assembly: { ...assembly, bricks },
        counts,
        added: pieces,
        swapped: [...swapped.keys()],
      };
    }
    const rejected = new Set(issues.map((issue) => issue.brickId));
    const blamed = [...rejected].filter(
      (id) => !swapped.has(id) && !pieces.some((piece) => piece.id === id),
    );
    // An untouched piece went wrong: a swap took its support, so undo the swaps.
    if (blamed.length) swapped = new Map();
    else swapped = new Map([...swapped].filter(([id]) => !rejected.has(id)));
    pieces = pieces.filter((piece) => !rejected.has(piece.id));
  }
  return unchanged;
}
