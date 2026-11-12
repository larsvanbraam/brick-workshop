import { footprint, getConnectionSites, isMatchingInsertFrame, seatOnSideStuds } from '../core.ts';
import type { Brick, Facing, Rotation } from '../core.ts';
import { addAreaMap, addBondedMap, addRun } from './layout.ts';
import type { RunKind } from './layout.ts';
import { addTree } from './trees.ts';
import type { Box as TreeBox } from './trees.ts';
import type { ExampleBrickAdder, ExampleDefinition } from './types.ts';

// A medieval cottage on a landscaped island, after a fan-built cottage: a stone ground floor
// with light quoins and a round-arched porch, a jettied half-timbered upper floor, a steep
// shingled roof with a cross-gabled dormer, barge boards and a chimney on the ridge, an outside
// stair up the right gable, a well, a broadleaf tree in front and a reedy pond.
//
// Plans are drawn top-down with the front at high z and x running left to right as seen from
// the front; `toFront` reflects them across the board so the front faces the default camera,
// which looks at the low-z side.
//
// Ground floor: stone, x 7..22, z 9..18, porch recessed to z 16 over x 10..13. Upper floor:
// x 7..22, z 8..19, jettied a stud front and back. Roof: x 5..24 (barge boards at 5 and 24),
// eaves at z 7 and 20, ridge along x at z 13..14. Dormer: x 16..21 on the front slope. Chimney:
// x 10..11, z 13..14. Stair: x 23..25 rising from z 18 to a landing at z 9..10.

const SIZE = 32;
/** Top of the island's lawn, where everything stands. */
const G = 6;

const GRASS = 2;
const DARK_GRASS = 288;
const BRIGHT_GREEN = 10;
const LIME = 27;
const OLIVE = 330;
const STONE = 71;
const DARK_STONE = 72;
const LIGHT_STONE = 151;
const TAN = 19;
const DARK_TAN = 28;
const TIMBER = 70;
const DARK_TIMBER = 308;
const PLASTER = 15;
const ROOF = 320;
const ROOF_LIGHT = 4;
const BLUE = 1;
const MEDIUM_BLUE = 73;
const DARK_BLUE = 272;
const RIPPLE = 43;
const CLEAR = 47;
const RED = 4;
const YELLOW = 14;
const WHITE = 15;
const BLACK = 0;
const ORANGE = 25;
const GLOW = 46;

// The house, in plan studs and plates.
const [HX0, HX1, HZ0, HZ1] = [7, 22, 9, 18];
const [UZ0, UZ1] = [8, 19];
const FLOOR = G + 15;
const UPPER = FLOOR + 1;
const EAVES = UPPER + 12;
const RIDGE = EAVES + 18;
const [RX0, RX1] = [5, 24];
const [DX0, DX1] = [16, 21];
const [CX, CZ] = [10, 13];
const [SX0, SX1] = [23, 25];

/** Small deterministic hash in [0, 1), so mottled colours stay the same every build. */
const hash = (...values: number[]) => {
  let seed = 17;
  for (const value of values) seed = Math.imul(seed ^ (value + 0x9e37), 0x85ebca6b) >>> 0;
  seed ^= seed >>> 13;
  seed = Math.imul(seed, 0xc2b2ae35) >>> 0;
  return ((seed ^ (seed >>> 16)) >>> 0) / 4294967296;
};

const plan = (cell: (x: number, z: number) => string) =>
  Array.from({ length: SIZE }, (_, z) =>
    Array.from({ length: SIZE }, (_, x) => cell(x, z)).join(''),
  );
const within = (x: number, z: number, x0: number, z0: number, x1: number, z1: number) =>
  x >= x0 && x <= x1 && z >= z0 && z <= z1;

type Piece = Omit<Brick, 'id'>;

/** A piece's studs and receivers relative to its corner, as sorted keys. */
function sites(piece: Piece, reflect?: number) {
  return (['top', 'bottom'] as const)
    .flatMap((surface) =>
      getConnectionSites({ id: '', ...piece }, surface).map(
        ({ x, z }) =>
          `${surface}:${x - piece.x}:${reflect === undefined ? z - piece.z : reflect - (z - piece.z)}`,
      ),
    )
    .sort()
    .join(' ');
}

/**
 * A plan piece reflected across the board so its front (high z) faces the camera. A mirrored
 * piece is the same piece turned, except for corner pieces and sprigs, whose turn is the one
 * that puts their studs and receivers where the reflection puts them.
 */
function toFront(piece: Piece): Piece {
  const { depth } = footprint({ id: '', ...piece });
  const z = SIZE - piece.z - depth;
  const want = sites(piece, depth);
  const turns = [540, 630, 360, 450].map((turn) => ((turn - piece.rotation) % 360) as Rotation);
  const rotation =
    turns.find((turn) => sites({ ...piece, z, rotation: turn }) === want) ?? turns[0];
  return { ...piece, z, rotation };
}

/** The world facing of a side-mounted piece drawn facing `facing` in the plan. */
const frontFacing = (facing: Facing): Facing =>
  facing === '+z' ? '-z' : facing === '-z' ? '+z' : facing;

// Pieces the smoothing pass may finish: rocks, earth strata and lawn, keyed by world place.
const NATURAL = new Set<string>();
const naturalKey = (piece: Pick<Brick, 'partId' | 'x' | 'y' | 'z'>) =>
  `${piece.partId}@${piece.x},${piece.y},${piece.z}`;

// ---------------------------------------------------------------------------------------------
// The island: an organic outline in four strata, each set in a little in places so the sides
// show ledges like a cut-away: dark rock, mixed grey stone, earth, then the lawn.

/** How far a cell lies towards the island's edge: 1 on the outline. */
function reach(x: number, z: number) {
  const [dx, dz] = [(x + 0.5 - 16) / 14.6, (z + 0.5 - 15.8) / 14.6];
  const angle = Math.atan2(dz, dx);
  const wobble =
    1 +
    0.035 * Math.sin(3 * angle + 0.7) +
    0.025 * Math.sin(5 * angle + 2.1) +
    0.015 * Math.sin(11 * angle + 0.4);
  return Math.cbrt(Math.abs(dx) ** 3 + Math.abs(dz) ** 3) / wobble;
}
const SECTORS = 28;
const sector = (x: number, z: number) =>
  Math.floor(((Math.atan2(z + 0.5 - 15.8, x + 0.5 - 16) + Math.PI) / (2 * Math.PI)) * SECTORS) %
  SECTORS;
/** Cells the buildings and props need under them, whatever the outline does. */
const required = (x: number, z: number) => within(x, z, 3, 18, 6, 21);
function inLayer(x: number, z: number, layer: number) {
  if (x < 0 || z < 0 || x >= SIZE || z >= SIZE) return false;
  if (required(x, z)) return true;
  let limit = 1;
  for (let level = 1; level <= layer; level++)
    if (hash(sector(x, z), level, 7) < [0, 0.3, 0.35, 0.45][level]) limit -= 0.8 / 14.6;
  return reach(x, z) <= limit;
}
const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;
const onEdge = (x: number, z: number, layer: number) =>
  NEIGHBOURS.some(([dx, dz]) => !inLayer(x + dx, z + dz, layer));

/** The pond on the front right: deep in the middle, shallow at the banks. */
function pondDepth(x: number, z: number) {
  const [dx, dz] = [(x + 0.5 - 24.2) / 3.7, (z + 0.5 - 24.6) / 2.7];
  const angle = Math.atan2(dz, dx);
  const wobble = 1 + 0.08 * Math.sin(3 * angle + 1.3) + 0.05 * Math.sin(5 * angle);
  return Math.hypot(dx, dz) / wobble;
}
const pond = (x: number, z: number) =>
  pondDepth(x, z) <= 1 && NEIGHBOURS.every(([dx, dz]) => inLayer(x + dx, z + dz, 3));

/** The path from the porch, wandering down to the front edge, with a branch to the well. */
function path(x: number, z: number) {
  if (within(x, z, 9, 19, 15, 20)) return true;
  if (within(x, z, 7, 19, 8, 21)) return true;
  if (z < 21 || z > 31) return false;
  const centre = 14.6 + 1.3 * Math.sin((z - 21) / 2.6) + (z - 21) * 0.15;
  return Math.abs(x + 0.5 - centre) < 1.6 && inLayer(x, z, 3);
}
const house = (x: number, z: number) =>
  within(x, z, HX0, HZ0, HX1, HZ1) || within(x, z, SX0, HZ0, SX1, HZ1);

// ---------------------------------------------------------------------------------------------
// Walls, drawn as top-down maps a course at a time.

const WALL_LEGEND: Readonly<Record<string, readonly [RunKind, number]>> = {
  a: ['masonry', STONE],
  d: ['short', DARK_STONE],
  h: ['short', LIGHT_STONE],
  q: ['brick', LIGHT_STONE],
  b: ['brick', TIMBER],
  L: ['brick', LIGHT_STONE],
  T: ['brick', DARK_TIMBER],
  w: ['short', PLASTER],
  n: ['short', TAN],
};

/** Light grey stone in clusters of dark grey, with the odd pale block. */
function stoneCell(along: number, course: number, wall: number) {
  const cluster = hash(Math.floor((along + (course % 2)) / 2), Math.floor(course / 2), wall);
  if (cluster < 0.38) return 'd';
  const single = hash(along, course, wall, 5);
  if (single < 0.1) return 'd';
  if (single < 0.14) return 'h';
  return 'a';
}

/** Plaster panels with patches of bare brick, as on an old half-timbered house. */
function infillCell(along: number, course: number, wall: number) {
  const patch = hash(Math.floor(along / 2), Math.floor((course + 1) / 2), wall, 9);
  return patch < 0.12 ? 'n' : 'w';
}

/** Ground-floor openings and pieces that stand in the wall, by course: [x, z, course]. */
const FRONT_WINDOW = [16, 19] as const;
const LEFT_WINDOW = [12, 15] as const;
const BACK_WINDOWS = [12, 17] as const;
const RIGHT_WINDOW = 16;
const PORCH = [10, 13] as const;
const DOOR = 10;
const FRONT_BRACKETS = [15, 21];
const BACK_BRACKETS = [8, 14, 21];

function groundCell(x: number, z: number, n: number): string {
  const ring =
    within(x, z, HX0, HZ0, HX1, HZ1) && (x === HX0 || x === HX1 || z === HZ0 || z === HZ1);
  // The porch: a back wall at z 16 with the door, and short side walls out to the arch.
  const porch =
    (z === 16 && x >= PORCH[0] - 1 && x <= PORCH[1] + 1) ||
    (z === 17 && (x === PORCH[0] - 1 || x === PORCH[1] + 1));
  if (!ring && !porch) return ' ';
  if (z === HZ1 && x >= PORCH[0] && x <= PORCH[1]) return ' ';
  // The arch stands over the porch's mouth in the top two courses.
  if (z === HZ1 && x >= PORCH[0] - 1 && x <= PORCH[1] + 1 && n >= 3) return ' ';
  if (z === 16 && x >= DOOR && x < DOOR + 3 && n <= 3) return ' ';
  if (z === 16 && x === PORCH[1] && n === 2) return ' ';
  if (z === HZ1 && x >= FRONT_WINDOW[0] && x <= FRONT_WINDOW[1] && n <= 3) return ' ';
  if (x === HX0 && z >= LEFT_WINDOW[0] && z <= LEFT_WINDOW[1] && n <= 3) return ' ';
  if (z === HZ0 && BACK_WINDOWS.some((x0) => x >= x0 && x <= x0 + 1) && n <= 2) return ' ';
  if (x === HX1 && z >= RIGHT_WINDOW && z <= RIGHT_WINDOW + 1 && n >= 3) return ' ';
  if (n === 4 && z === HZ1 && FRONT_BRACKETS.includes(x)) return ' ';
  // Pale stone lintels over the lattice windows.
  if (n === 4 && z === HZ1 && x >= FRONT_WINDOW[0] && x <= FRONT_WINDOW[1]) return 'L';
  if (n === 4 && x === HX0 && z >= LEFT_WINDOW[0] && z <= LEFT_WINDOW[1]) return 'L';
  if (n === 4 && z === HZ0 && BACK_BRACKETS.includes(x)) return ' ';
  // The wheel's side-stud brick.
  if (x === HX0 && z === HZ0 && n === 3) return ' ';
  // Quoins: the corner and one more stone, long one way and short the other, swapping each
  // course; dressed jambs either side of the porch arch.
  const corners = [
    [HX0, HZ0],
    [HX1, HZ0],
    [HX0, HZ1],
    [HX1, HZ1],
  ];
  for (const [cx, cz] of corners) {
    if (x === cx && z === cz) return 'q';
    const inward = n % 2 === 0 ? x === cx + (cx === HX0 ? 1 : -1) && z === cz : false;
    const inwardZ = n % 2 === 1 ? z === cz + (cz === HZ0 ? 1 : -1) && x === cx : false;
    if (inward || inwardZ) return 'q';
  }
  if (z === HZ1 && (x === PORCH[0] - 1 || x === PORCH[1] + 1)) return 'q';
  const wall = z === HZ0 ? 0 : z === HZ1 ? 1 : x === HX0 ? 2 : x === HX1 ? 3 : 4;
  return stoneCell(wall < 2 || wall === 4 ? x : z, n, wall);
}

/** Upper-floor openings: windows along each wall and the door from the stair. */
const UPPER_FRONT_WINDOWS = [9, 17] as const;
const UPPER_BACK_WINDOW = 15;
const UPPER_BACK_SMALL = 10;
const UPPER_LEFT_WINDOW = 12;
const UPPER_DOOR = 9;
const UPPER_RIGHT_SMALL = 15;
const POSTS: Readonly<Record<string, readonly number[]>> = {
  front: [7, 13, 16, 21, 22],
  back: [7, 9, 12, 14, 19, 22],
  left: [8, 11, 16, 19],
  right: [8, 12, 14, 17, 19],
};

function upperCell(x: number, z: number, n: number): string {
  if (n <= 3) {
    if (!within(x, z, HX0, UZ0, HX1, UZ1)) return ' ';
    if (!(x === HX0 || x === HX1 || z === UZ0 || z === UZ1)) return ' ';
    const [wall, along] =
      z === UZ1
        ? (['front', x] as const)
        : z === UZ0
          ? (['back', x] as const)
          : x === HX0
            ? (['left', z] as const)
            : (['right', z] as const);
    // Openings.
    if (wall === 'front' && UPPER_FRONT_WINDOWS.some((x0) => along >= x0 && along <= x0 + 3))
      return n === 0 ? ' ' : n <= 3 ? ' ' : 'b';
    if (wall === 'back' && along >= UPPER_BACK_WINDOW && along <= UPPER_BACK_WINDOW + 3) return ' ';
    if (wall === 'back' && along >= UPPER_BACK_SMALL && along <= UPPER_BACK_SMALL + 1 && n >= 2)
      return ' ';
    if (wall === 'left' && along >= UPPER_LEFT_WINDOW && along <= UPPER_LEFT_WINDOW + 3) return ' ';
    if (wall === 'right' && along >= UPPER_DOOR && along <= UPPER_DOOR + 2) return ' ';
    if (wall === 'right' && along >= UPPER_RIGHT_SMALL && along <= UPPER_RIGHT_SMALL + 1 && n >= 2)
      return ' ';
    // The sill beam all round, then posts, braces and plaster.
    if (n === 0) return 'b';
    if (POSTS[wall].includes(along)) return 'b';
    return infillCell(along, n, ['front', 'back', 'left', 'right'].indexOf(wall));
  }
  const k = n - 4;
  // Gables: timber along the rakes and a king post, plaster between.
  if ((x === HX0 || x === HX1) && z >= 9 + k && z <= 18 - k) {
    if (x === HX0 && k === 2 && z === 13) return ' ';
    if (x === HX0 && k === 0 && z >= UPPER_LEFT_WINDOW && z <= UPPER_LEFT_WINDOW + 3) return 'T';
    if (z === 9 + k || z === 18 - k || z === 13 || z === 14) return 'b';
    return hash(z, n, x, 17) < 0.18 ? 'n' : 'w';
  }
  // The dormer: side walls from the front back to the main roof, and its gabled front.
  if (k <= 2 && (x === DX0 || x === DX1) && z >= 16 && z <= UZ1) return 'b';
  if (k <= 2 && z === UZ1 && x > DX0 && x < DX1) {
    if (k === 0) return 'T';
    if (x === 18 || x === 19) return ' ';
    return infillCell(x, n, 8);
  }
  if (k >= 3 && k <= 4 && z === UZ1) {
    const d = k - 3;
    if (x >= DX0 + 1 + d && x <= DX1 - 1 - d) return d === 0 && (x === 17 || x === 20) ? 'b' : 'w';
  }
  return ' ';
}

// ---------------------------------------------------------------------------------------------
// Roof helpers.

const SLOPE_PARTS: Readonly<Record<number, string>> = {
  4: '3037',
  3: '3038',
  2: '3039',
  1: '3040b',
};
const SLOPE_TURN: Readonly<Record<Facing, Rotation>> = { '-z': 0, '-x': 90, '+z': 180, '+x': 270 };
/** Shingles: mostly dark red, a third bright red, never in a pattern. */
const shingle = (...at: number[]) => (hash(...at, 3) < 0.34 ? ROOF_LIGHT : ROOF);

/**
 * Splits [from, to] into slope lengths of two to four, staggered by `seed`, keeping the `fixed`
 * pieces ([start, length]) as given, e.g. where a piece must bridge an overhang.
 */
function split(from: number, to: number, seed: number, fixed: readonly [number, number][] = []) {
  const pieces: [number, number][] = [];
  let at = from;
  while (at <= to) {
    const pinned = fixed.find(([start]) => start === at);
    let size = pinned ? pinned[1] : [2, 3, 4, 3, 2, 4][Math.floor(hash(at, seed) * 6)];
    size = Math.min(size, to - at + 1);
    const next = fixed.find(([start]) => start > at && start < at + size);
    if (next) size = next[0] - at;
    pieces.push([at, size]);
    at += size;
  }
  return pieces;
}

// ---------------------------------------------------------------------------------------------

export const courtyardHouse: ExampleDefinition = {
  id: 'courtyard-house',
  name: 'Courtyard House',
  tags: [
    'demo',
    'medieval',
    'cottage',
    'half-timbered',
    'jettied',
    'dormer',
    'chimney',
    'outside-stair',
    'well',
    'pond',
    'tree',
    'landscape',
  ],
  expectedPieceCount: 1549,
  buildArea: SIZE,
  brickIdPrefix: 'demo',
  smooth: [{ only: (brick) => NATURAL.has(naturalKey(brick)) }],
  build(drawnAdd) {
    NATURAL.clear();
    // Everything laid so far, in plan studs, so plants and the tree's crown grow round it.
    const boxes: TreeBox[] = [];
    // Pieces are handed over at the end, bottom-up and side-mounted pieces last, so each
    // comes after what holds it (the building instructions and disassembly tests rely on it).
    const pending: Piece[] = [];
    const world = (piece: Piece) => {
      const size = footprint({ id: '', ...piece });
      pending.push(piece);
      boxes.push({
        u0: piece.x,
        u1: piece.x + size.width,
        v0: SIZE - piece.z - size.depth,
        v1: SIZE - piece.z,
        y0: piece.y,
        y1: piece.y + size.height,
      });
      return piece;
    };
    const add: ExampleBrickAdder = (partId, color, x, y, z, rotation = 0, facing, upsideDown) => {
      if (facing) throw new Error('Mount side pieces with `mount`.');
      world(toFront({ partId, color, x, y, z, rotation, ...(upsideDown ? { upsideDown } : {}) }));
    };
    /** Adds a piece the smoothing pass may finish. */
    const natural: ExampleBrickAdder = (partId, color, x, y, z, rotation = 0) => {
      const piece = toFront({ partId, color, x, y, z, rotation });
      NATURAL.add(naturalKey(piece));
      world(piece);
    };
    const blocked = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number) =>
      boxes.some(
        (box) =>
          box.u0 < x1 && x0 < box.u1 && box.v0 < z1 && z0 < box.v1 && box.y0 < y1 && y0 < box.y1,
      );
    /** Adds a piece only where its whole box is free. */
    const tryAdd = (
      partId: string,
      color: number,
      x: number,
      y: number,
      z: number,
      rotation: Rotation = 0,
      into: ExampleBrickAdder = add,
    ) => {
      const size = footprint({ id: '', partId, color, x, y, z, rotation });
      if (blocked(x, x + size.width, z, z + size.depth, y, y + size.height)) return false;
      into(partId, color, x, y, z, rotation);
      return true;
    };
    /** Mounts a piece on a side stud of a plan host, facing out of the plan's `facing`. */
    const mount = (host: Piece, partId: string, color: number, facing: Facing) => {
      const target = toFront(host);
      const seated = seatOnSideStuds(
        {
          id: 'mount',
          partId,
          color,
          x: target.x,
          y: target.y,
          z: target.z,
          rotation: 0,
          facing: frontFacing(facing),
        },
        { id: 'host', ...target },
      );
      if (!seated) throw new Error(`Nothing to mount ${partId} on.`);
      const { id: _, ...piece } = seated;
      return world(piece);
    };
    /** A door frame and the door that hangs in it. */
    const addDoor = (frame: Piece, door: string, color: number) => {
      const placed = world(toFront(frame));
      for (const rotation of [placed.rotation, (placed.rotation + 180) % 360] as Rotation[])
        for (const dx of [0, -0.5, 0.5, -1, 1])
          for (const dz of [0, -0.5, 0.5, -1, 1]) {
            const candidate: Brick = {
              id: 'door',
              partId: door,
              color,
              x: placed.x + dx,
              y: placed.y,
              z: placed.z + dz,
              rotation,
            };
            if (isMatchingInsertFrame(candidate, { id: 'frame', ...placed })) {
              world(candidate);
              return;
            }
          }
      throw new Error(`No fit for door ${door}.`);
    };

    // The island's strata.
    addAreaMap(
      natural,
      plan((x, z) => (!inLayer(x, z, 0) ? ' ' : onEdge(x, z, 0) ? 'r' : 'i')),
      0,
      { r: ['plate', DARK_STONE], i: ['plate', DARK_STONE] },
    );
    addAreaMap(
      natural,
      plan((x, z) => {
        if (!inLayer(x, z, 1)) return ' ';
        if (!onEdge(x, z, 1)) return 'i';
        const roll = hash(Math.floor(x / 2), Math.floor(z / 2), 11);
        return roll < 0.25 ? 's' : roll < 0.75 ? 'r' : roll < 0.92 ? 't' : 'b';
      }),
      1,
      {
        i: ['brick', DARK_STONE],
        r: ['brick', DARK_STONE],
        s: ['brick', STONE],
        t: ['brick', DARK_TAN],
        b: ['brick', TIMBER],
      },
    );
    const water = plan((x, z) => {
      if (!pond(x, z)) return ' ';
      const depth = pondDepth(x, z);
      return depth < 0.45 ? 'k' : depth < 0.78 ? 'u' : 'v';
    });
    addAreaMap(add, water, 4, {
      k: ['plate', DARK_BLUE],
      u: ['plate', BLUE],
      v: ['plate', MEDIUM_BLUE],
    });
    addAreaMap(
      natural,
      plan((x, z) => {
        if (!inLayer(x, z, 2) || pond(x, z)) return ' ';
        if (!onEdge(x, z, 2)) return 'i';
        const roll = hash(Math.floor(x / 2), Math.floor(z / 3), 12);
        return roll < 0.5 ? 'd' : roll < 0.85 ? 'b' : 'n';
      }),
      4,
      {
        i: ['plate', DARK_TAN],
        d: ['plate', DARK_TAN],
        b: ['plate', TIMBER],
        n: ['plate', TAN],
      },
    );
    const top = (x: number, z: number) => {
      if (!inLayer(x, z, 3) || pond(x, z)) return ' ';
      if (house(x, z)) return 'c';
      if (path(x, z)) return 'p';
      const worn = Math.hypot(x - 4.5, z - 19.5) < 3 + hash(x, z, 4) || within(x, z, 9, 4, 18, 7);
      if (worn && hash(x, z, 13) < 0.55) return 'e';
      return hash(Math.floor(x / 3), Math.floor(z / 3), 14) < 0.3 ? 'h' : 'g';
    };
    const ground = plan(top);
    addAreaMap(
      (partId, color, x, y, z, rotation) =>
        (color === STONE || color === TAN ? add : natural)(partId, color, x, y, z, rotation),
      ground,
      5,
      {
        c: ['plate', STONE],
        p: ['plate', TAN],
        e: ['plate', DARK_TAN],
        g: ['plate', GRASS],
        h: ['plate', DARK_GRASS],
      },
    );
    // Lighter water at the banks, and ripples.
    for (let z = 0; z < SIZE; z++)
      for (let x = 0; x < SIZE; x++) {
        const cell = water[z][x];
        if (cell === 'v' && hash(x, z, 21) < 0.75) add('3070b', RIPPLE, x, 5, z);
        else if (cell === 'u' && hash(x, z, 22) < 0.18) add('98138', RIPPLE, x, 5, z);
      }

    // Stone ground floor: five courses of light grey masonry mottled with dark grey, pale
    // quoins at the corners and dressed jambs either side of the porch.
    for (let n = 0; n < 5; n++)
      addBondedMap(
        add,
        plan((x, z) => groundCell(x, z, n)),
        G + n * 3,
        WALL_LEGEND,
        n,
      );
    // The porch: a round stone arch, a plank door and a lantern on a black corbel.
    add('3307', LIGHT_STONE, PORCH[0] - 1, G + 9, HZ1, 90);
    addDoor(
      { partId: '3579', color: DARK_TIMBER, x: DOOR, y: G, z: 16, rotation: 90 },
      '3193a',
      TIMBER,
    );
    add('3665a', BLACK, PORCH[1], G + 6, 16, 180);
    add('3062b', GLOW, PORCH[1], G + 9, 17);
    add('98138', BLACK, PORCH[1], G + 12, 17);
    // Checked flags on the porch floor.
    for (let x = PORCH[0]; x <= PORCH[1]; x++)
      for (const z of [17, 18])
        if (z === 18 || x >= DOOR + 3) add('3070b', (x + z) % 2 ? LIGHT_STONE : STONE, x, G, z);

    // Windows: white lattice casements, glass in the small ones, and window boxes on reddish
    // brown corbels planted with one colour of flower each.
    const lattice = (x: number, y: number, z: number, alongX: boolean) => {
      const turn: Rotation = alongX ? 90 : 0;
      add('60594', WHITE, x, y, z, turn);
      add('60607', WHITE, alongX ? x + 2 : x, y, alongX ? z : z + 2, turn);
      add('60607', WHITE, x, y, z, turn, undefined, true);
    };
    const small = (x: number, y: number, z: number, alongX: boolean) => {
      add('60592', WHITE, x, y, z, alongX ? 90 : 0);
      add('60601', CLEAR, x, y, z, alongX ? 90 : 0);
    };
    /** Corbels under a window in the wall course below it, and a planted box on them. */
    const windowBox = (
      x: number,
      y: number,
      z: number,
      out: Facing,
      length: number,
      bloom: number,
    ) => {
      const alongX = out.endsWith('z');
      const [bx, bz] =
        out === '+z' ? [x, z] : out === '-z' ? [x, z - 1] : out === '-x' ? [x - 1, z] : [x, z];
      for (let i = 0; i < length; i++)
        add('3665a', TIMBER, alongX ? bx + i : bx, y, alongX ? bz : bz + i, SLOPE_TURN[out]);
      const [ox, oz] = out === '+z' ? [x, z + 1] : out === '-z' ? [x, z - 1] : [x - 1, z];
      addRun(add, 'brick', DARK_TIMBER, alongX ? 'x' : 'z', ox, y + 3, oz, length);
      for (let i = 0; i < length; i++) {
        const [px, pz] = alongX ? [ox + i, oz] : [ox, oz + i];
        const roll = hash(px, pz, y, 31);
        if (roll < 0.45) add('98138', bloom, px, y + 6, pz);
        else if (roll < 0.8) add('6141', roll < 0.6 ? BRIGHT_GREEN : GRASS, px, y + 6, pz);
        else add('3070b', DARK_TAN, px, y + 6, pz);
      }
    };
    lattice(FRONT_WINDOW[0], G + 3, HZ1, true);
    windowBox(FRONT_WINDOW[0], G, HZ1, '+z', 4, RED);
    lattice(HX0, G + 3, LEFT_WINDOW[0], false);
    windowBox(HX0, G, LEFT_WINDOW[0], '-x', 4, YELLOW);
    for (const x of BACK_WINDOWS) {
      small(x, G + 3, HZ0, true);
      for (const dx of [0, 1]) add('3665a', TIMBER, x + dx, G, HZ0 - 1, 0);
      add('3069b', TIMBER, x, G + 3, HZ0 - 1, 90);
    }
    small(HX1, G + 9, RIGHT_WINDOW, false);

    // Corbels carrying the jettied upper floor.
    for (const x of FRONT_BRACKETS) add('3665a', TIMBER, x, G + 12, HZ1, 180);
    for (const x of BACK_BRACKETS) add('3665a', TIMBER, x, G + 12, HZ0 - 1, 0);

    // A cart wheel hung on the left wall from a side-stud brick at the corner.
    const wheelHost: Piece = {
      partId: '87087',
      color: LIGHT_STONE,
      x: HX0 - 0.5,
      y: G + 9,
      z: HZ0,
      rotation: 0,
    };
    add(
      wheelHost.partId,
      wheelHost.color,
      wheelHost.x,
      wheelHost.y,
      wheelHost.z,
      wheelHost.rotation,
    );
    mount(wheelHost, '60474', TIMBER, '-x');

    // The jetty: a timber floor overhanging the stonework front and back, its edge a band
    // between the storeys.
    addAreaMap(
      add,
      plan((x, z) => (within(x, z, HX0, UZ0, HX1, UZ1) ? 'f' : ' ')),
      FLOOR,
      { f: ['plate', TIMBER] },
      (x, z) =>
        within(x, z, HX0, HZ0, HX1, HZ1) && (x === HX0 || x === HX1 || z === HZ0 || z === HZ1),
    );

    // Half-timbered upper floor, gables and the dormer's walls.
    for (let n = 0; n < 9; n++)
      addBondedMap(
        add,
        plan((x, z) => upperCell(x, z, n)),
        UPPER + n * 3,
        WALL_LEGEND,
        n,
      );
    for (const x of UPPER_FRONT_WINDOWS) {
      lattice(x, UPPER + 3, UZ1, true);
      windowBox(x, UPPER, UZ1, '+z', 4, x < 15 ? YELLOW : WHITE);
    }
    lattice(UPPER_BACK_WINDOW, UPPER + 3, UZ0, true);
    windowBox(UPPER_BACK_WINDOW, UPPER, UZ0, '-z', 4, RED);
    small(UPPER_BACK_SMALL, UPPER + 6, UZ0, true);
    lattice(HX0, UPPER + 3, UPPER_LEFT_WINDOW, false);
    windowBox(HX0, UPPER, UPPER_LEFT_WINDOW, '-x', 4, RED);
    small(HX1, UPPER + 6, UPPER_RIGHT_SMALL, false);
    addDoor(
      { partId: '3579', color: DARK_TIMBER, x: HX1, y: UPPER, z: UPPER_DOOR, rotation: 0 },
      '3193a',
      TIMBER,
    );
    small(18, EAVES + 3, UZ1, true);
    // A painted shield on the left gable.
    const shieldHost: Piece = {
      partId: '87087',
      color: TIMBER,
      x: HX0 - 0.5,
      y: EAVES + 6,
      z: 13,
      rotation: 0,
    };
    add(
      shieldHost.partId,
      shieldHost.color,
      shieldHost.x,
      shieldHost.y,
      shieldHost.z,
      shieldHost.rotation,
    );
    mount(shieldHost, '14769', YELLOW, '-x');

    // Chimney: bonded masonry from the upper floor up through the ridge, a cap and two pots.
    for (let course = 0; course < 13; course++) {
      const y = UPPER + course * 3;
      const color = (salt: number) => (hash(course, salt, 41) < 0.35 ? DARK_STONE : STONE);
      if (course % 2) for (const x of [CX, CX + 1]) add('98283', color(x), x, y, CZ);
      else for (const z of [CZ, CZ + 1]) add('98283', color(z), CX, y, z, 90);
    }
    add('3022', DARK_STONE, CX, UPPER + 39, CZ);
    add('3062b', ORANGE, CX, UPPER + 40, CZ);
    add('3062b', DARK_TAN, CX + 1, UPPER + 40, CZ + 1);

    // Roof: steep shingled slopes stepping in a stud a course, staggered and mottled, with
    // reddish brown barge boards overhanging the gables, cut round the dormer and chimney.
    for (let k = 0; k < 6; k++) {
      const y = EAVES + k * 3;
      for (const [facing, z] of [
        ['-z', UZ0 - 1 + k],
        ['+z', UZ1 - k],
      ] as const) {
        const front = facing === '+z';
        if (k > 0) for (const x of [RX0, RX1]) add('3040b', TIMBER, x, y, z, SLOPE_TURN[facing]);
        const [from, to] = k === 0 ? [RX0, RX1] : [RX0 + 1, RX1 - 1];
        const gaps: [number, number][] = [];
        if (front && k <= 2) gaps.push([DX0, DX1]);
        if (k === 5) gaps.push([CX, CX + 1]);
        let start = from;
        const runs: [number, number][] = [];
        for (const [g0, g1] of gaps) {
          runs.push([start, g0 - 1]);
          start = g1 + 1;
        }
        runs.push([start, to]);
        for (const [r0, r1] of runs) {
          // The eave course bridges the overhang with long slopes; over the dormer the next
          // course is cut onto the dormer's side walls.
          const fixed: [number, number][] = [];
          if (k === 0) fixed.push([r0, Math.min(4, r1 - r0 + 1)], [Math.max(r0 + 4, r1 - 3), 4]);
          if (front && k === 3) fixed.push([DX0, 4], [DX1 - 1, 4]);
          for (const [x, size] of split(r0, r1, k * 2 + (front ? 1 : 0), fixed))
            add(SLOPE_PARTS[size], shingle(x, k, front ? 1 : 0), x, y, z, SLOPE_TURN[facing]);
        }
      }
    }
    for (let x = RX0 + 1; x < RX1; x += 2)
      if (x !== CX) add('3043', hash(x, 51) < 0.3 ? ROOF_LIGHT : ROOF, x, RIDGE, 13);
    for (const x of [RX0, RX1]) {
      add('3004', TIMBER, x, RIDGE, 13);
      add('59900', TIMBER, x, RIDGE + 3, x === RX0 ? 13 : 14);
    }
    // The dormer's own roof, its ridge running out over its gable.
    for (let d = 0; d < 3; d++) {
      const y = EAVES + 9 + d * 3;
      const z = 18 - d;
      for (const [facing, x] of [
        ['-x', DX0 - 1 + d],
        ['+x', DX1 - d],
      ] as const) {
        let at = z;
        for (const size of d === 2 ? [4, 1] : [20 - z + 1]) {
          add(SLOPE_PARTS[size], shingle(x, at, d, 7), x, y, at, SLOPE_TURN[facing]);
          at += size;
        }
      }
    }
    for (let z = 15; z <= 19; z += 2) add('3043', ROOF, 18, RIDGE, z, 90);

    // Outside stair up the right gable: stone steps, a landing at the upper door, and posts
    // along the open side.
    const stepTop = (z: number) => 3 * (Math.floor((HZ1 - z) / 2) + 1);
    for (let course = 0; course < 5; course++)
      addBondedMap(
        add,
        plan((x, z) =>
          within(x, z, SX0, HZ0, SX1, HZ1) && stepTop(z) > course * 3
            ? stoneCell(z + x, course, 9)
            : ' ',
        ),
        G + course * 3,
        WALL_LEGEND,
        course,
      );
    for (let step = 0; step < 5; step++) {
      const [z0, y] = [HZ1 - 1 - step * 2, G + 3 * (step + 1)];
      for (let x = SX0; x < SX1; x++) add('3069b', step % 2 ? LIGHT_STONE : STONE, x, y, z0);
      if (step === 4) {
        add('3069b', STONE, SX1, y, z0);
        continue;
      }
      add('3070b', DARK_STONE, SX1, y, z0);
      add('3062b', DARK_STONE, SX1, y, z0 + 1);
      add('3062b', DARK_STONE, SX1, y + 3, z0 + 1);
      add('6141', TIMBER, SX1, y + 6, z0 + 1);
    }

    // Ivy climbing the left front corner in two ragged stems.
    const ivy = (x: number, z: number, courses: number) => {
      for (let c = 0; c < courses; c++)
        add('3062b', hash(x, c, z) < 0.45 ? DARK_GRASS : GRASS, x, G + c * 3, z);
      add('6141', LIME, x, G + courses * 3, z);
    };
    ivy(HX0 - 1, HZ1 - 1, 3);
    ivy(HX0 - 1, HZ1 - 2, 2);

    // The well: a round stone kerb, timber posts, a little shingled roof and a bucket.
    const [wx, wz] = [3, 18];
    for (const n of [0, 1]) {
      for (const [dx, dz] of [
        [0, 0],
        [3, 0],
        [0, 3],
        [3, 3],
      ])
        add('3062b', n % 2 ? STONE : DARK_STONE, wx + dx, G + n * 3, wz + dz);
      add('98283', hash(n, 1) < 0.5 ? STONE : DARK_STONE, wx + 1, G + n * 3, wz, 90);
      add('98283', STONE, wx + 1, G + n * 3, wz + 3, 90);
      add('98283', hash(n, 2) < 0.5 ? STONE : DARK_STONE, wx, G + n * 3, wz + 1);
      add('98283', STONE, wx + 3, G + n * 3, wz + 1);
    }
    add('3068b', DARK_BLUE, wx + 1, G, wz + 1);
    for (const [dx, dz] of [
      [0, 1],
      [3, 2],
    ])
      for (const n of [2, 3, 4]) add('3062b', TIMBER, wx + dx, G + n * 3, wz + dz);
    add('3031', TIMBER, wx, G + 15, wz);
    for (const [dx, dz, rotation] of [
      [0, 0, 90],
      [1, 0, 0],
      [1, 1, 270],
      [0, 1, 180],
    ] as const)
      add('3045', dx === dz ? ROOF : ROOF_LIGHT, wx + dx * 2, G + 16, wz + dz * 2, rotation);
    add('3688', ROOF, wx + 1, G + 19, wz + 1);
    add('3062b', DARK_STONE, wx, G + 6, wz);
    add('4589', TIMBER, wx + 3, G + 6, wz + 3);

    // Back garden: a woodpile against the wall, a chopping block, barrels and crates.
    for (const [z, y, x0] of [
      [6, G, 13],
      [7, G, 13],
      [6, G + 3, 14],
      [7, G + 3, 13],
    ] as const)
      add('30137', hash(z, y, x0) < 0.5 ? TIMBER : DARK_TIMBER, x0, y, z, 90);
    add('30136', TIMBER, 14, G + 6, 7, 90);
    add('3941', DARK_TIMBER, 18, G, 5);
    add('3070b', DARK_TAN, 18, G + 3, 5);
    const barrel = (x: number, z: number) => {
      add('3941', TIMBER, x, G, z);
      add('3941', TIMBER, x, G + 3, z);
      add('14769', DARK_TIMBER, x, G + 6, z);
    };
    barrel(20, 5);
    barrel(26, 15);
    barrel(18, 20);
    const crate = (x: number, z: number, fruit: number) => {
      add('3022', TIMBER, x, G, z);
      for (const [dx, dz] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        add('3005', dx === dz ? DARK_TIMBER : TIMBER, x + dx, G + 1, z + dz);
        add('98138', fruit, x + dx, G + 4, z + dz);
      }
    };
    crate(9, 5, RED);
    crate(27, 17, BRIGHT_GREEN);

    // A lamppost by the path and a bench looking over the pond.
    add('2039', BLACK, 18, G, 22);
    add('3062b', GLOW, 18.5, G + 21, 22.5);
    add('4589', BLACK, 18.5, G + 24, 22.5);
    for (const z of [26, 28]) add('3004', DARK_TIMBER, 18, G, z);
    add('3021', TIMBER, 18, G + 3, 26);
    add('63864', TIMBER, 18, G + 4, 26);
    add('63864', TIMBER, 19, G + 4, 26);

    // Rock outcrops: stacks of mixed greys, highest in the middle, that smoothing rounds off.
    const rocks = (heights: Map<string, number>, salt: number) => {
      const topAt = new Map<string, number>();
      for (const cell of heights.keys()) topAt.set(cell, G);
      const max = Math.max(...heights.values());
      for (let y = G; y < G + max; y++) {
        const rows = plan((x, z) => {
          const cell = `${x}:${z}`;
          const height = heights.get(cell);
          if (!height || topAt.get(cell) !== y || y >= G + height) return ' ';
          const brick = G + height - y >= 3;
          const roll = hash(Math.floor(x / 2), Math.floor((y - G) / 3), Math.floor(z / 2), salt);
          const tone = roll < 0.35 ? 'a' : roll < 0.92 ? 'd' : 'l';
          return brick ? tone.toUpperCase() : tone;
        });
        addAreaMap(natural, rows, y, {
          A: ['brick', STONE],
          D: ['brick', DARK_STONE],
          L: ['brick', LIGHT_STONE],
          a: ['plate', STONE],
          d: ['plate', DARK_STONE],
          l: ['plate', LIGHT_STONE],
        });
        rows.forEach((row, z) => {
          for (let x = 0; x < SIZE; x++)
            if (row[x] !== ' ')
              topAt.set(`${x}:${z}`, y + (row[x] === row[x].toUpperCase() ? 3 : 1));
        });
      }
    };
    const outcrop = (
      cx: number,
      cz: number,
      rx: number,
      rz: number,
      peak: number,
      salt: number,
    ) => {
      const heights = new Map<string, number>();
      for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++)
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          if (!inLayer(x, z, 3) || pond(x, z) || house(x, z) || path(x, z)) continue;
          const distance = Math.hypot((x + 0.5 - cx) / rx, (z + 0.5 - cz) / rz);
          const height = Math.round((1 - distance) * peak + (hash(x, z, salt) - 0.5) * 3);
          if (height > 0 && !blocked(x, x + 1, z, z + 1, G, G + height))
            heights.set(`${x}:${z}`, height);
        }
      rocks(heights, salt);
    };
    outcrop(4, 5, 3.6, 4.2, 11, 1);
    // Stones along the pond's back bank.
    const bank = new Map<string, number>();
    for (let z = 0; z < SIZE; z++)
      for (let x = 0; x < SIZE; x++) {
        if (pond(x, z) || !inLayer(x, z, 3) || path(x, z) || house(x, z)) continue;
        const shore = NEIGHBOURS.some(([dx, dz]) => pond(x + dx, z + dz));
        if (shore && x > 21 && hash(x, z, 61) < 0.5 && !blocked(x, x + 1, z, z + 1, G, G + 2))
          bank.set(`${x}:${z}`, 1 + Math.floor(hash(x, z, 62) * 2));
      }
    rocks(bank, 3);

    // The tree in front of the porch, its crown leaning over the jetty.
    const around: TreeBox[] = boxes.slice();
    addTree(add, 7, 25, G, [DARK_GRASS, GRASS, GRASS], TIMBER, 3, 4, around);

    // A conifer and bushes at the back, ferns by the rocks, reeds and tall grass at the pond,
    // and flowers in clusters of one colour.
    tryAdd('3471', DARK_GRASS, 22, G, 3);
    // Bushes and ferns stand on a stud between their own cells, so they sit half a stud over.
    tryAdd('6064', DARK_GRASS, 26.5, G, 7.5);
    tryAdd('6064', GRASS, 18.5, G, 1.5);
    tryAdd('6064', GRASS, 1.5, G, 10.5);
    tryAdd('6255', GRASS, 6, G, 1.5);
    tryAdd('6255', DARK_GRASS, 23, G, 19.5);
    // Tall grass stands on its middle stud: [x, z] of that stud and the way the blades run.
    for (const [x, z, rotation] of [
      [27, 21, 90],
      [21, 20, 0],
      [27, 25, 90],
      [2, 15, 90],
      [29, 9, 90],
    ] as const)
      if ('ghe'.includes(ground[z][x]))
        tryAdd(
          '30093',
          hash(x, z) < 0.3 ? DARK_GRASS : OLIVE,
          rotation ? x : x - 1.5,
          G,
          rotation ? z - 1.5 : z,
          rotation,
        );
    // Reeds: stems of olive and sand green on round plates at the water's edge.
    for (let z = 0; z < SIZE; z++)
      for (let x = 0; x < SIZE; x++) {
        if (!pond(x, z) || pondDepth(x, z) < 0.7 || hash(x, z, 71) > 0.35) continue;
        if (blocked(x, x + 1, z, z + 1, 5, 6 + 13)) continue;
        add('6141', OLIVE, x, 5, z);
        add('3957a', OLIVE, x, 6, z);
      }
    // Lily pads on the deep water.
    for (const [x, z] of [
      [23, 24],
      [25, 25],
    ] as const)
      if (!blocked(x, x + 1, z, z + 1, 5, 6)) add('98138', BRIGHT_GREEN, x, 5, z);
    const flowers = (cx: number, cz: number, color: number, count: number, salt: number) => {
      let placed = 0;
      const cells: [number, number, number][] = [];
      for (let z = cz - 2; z <= cz + 2; z++)
        for (let x = cx - 2; x <= cx + 2; x++)
          cells.push([x, z, Math.hypot(x - cx, z - cz) + hash(x, z, salt) * 1.5]);
      cells.sort((a, b) => a[2] - b[2]);
      for (const [x, z] of cells) {
        if (placed >= count) break;
        if (!inLayer(x, z, 3) || pond(x, z) || path(x, z)) continue;
        if (placed === 0 && !blocked(x, x + 2, z, z + 2, G, G + 5) && inLayer(x + 1, z + 1, 3)) {
          add('18674', GRASS, x, G, z);
          add('4727', GRASS, x, G + 1, z);
          add('24866', color, x, G + 4, z);
          placed++;
          continue;
        }
        const piece = hash(x, z, salt + 1) < 0.5 ? '98138' : '6141';
        if (tryAdd(piece, color, x, G, z)) placed++;
      }
    };
    flowers(20, 29, YELLOW, 7, 81);
    flowers(1, 23, RED, 6, 82);
    flowers(12, 29, WHITE, 6, 83);
    flowers(5, 13, YELLOW, 5, 84);
    flowers(27, 23, YELLOW, 5, 85);
    flowers(22, 3, WHITE, 5, 86);
    flowers(10, 2, RED, 5, 87);

    // The lawn and paths dressed last: worn tiles and stepping stones on the paths, flags round
    // the house, and tufts, sprigs and leaves on the grass, leaving no wide bare stud field.
    for (let z = 0; z < SIZE; z++)
      for (let x = 0; x < SIZE; x++) {
        const cell = ground[z][x];
        if (cell === ' ' || blocked(x, x + 1, z, z + 1, G, G + 1)) continue;
        const roll = hash(x, z, 91);
        if (cell === 'p') {
          if (roll < 0.2) continue;
          const tone = hash(x, z, 92);
          const color =
            tone < 0.45 ? TAN : tone < 0.8 ? DARK_TAN : tone < 0.92 ? DARK_STONE : STONE;
          if (roll < 0.35) add('98138', color, x, G, z);
          else if (
            roll < 0.55 &&
            !blocked(x + 1, x + 2, z, z + 1, G, G + 1) &&
            ground[z][x + 1] === 'p'
          )
            add('3069b', color, x, G, z, 90);
          else add('3070b', color, x, G, z);
          continue;
        }
        if (cell === 'c') {
          add('3070b', roll < 0.4 ? DARK_STONE : roll < 0.8 ? STONE : DARK_TAN, x, G, z);
          continue;
        }
        const nearHouse = NEIGHBOURS.some(([dx, dz]) => house(x + dx, z + dz));
        if (nearHouse && roll < 0.45) {
          add(roll < 0.3 ? '3070b' : '98138', roll < 0.2 ? DARK_STONE : DARK_TAN, x, G, z);
          continue;
        }
        if (cell === 'e') {
          if (roll < 0.35) add('3070b', roll < 0.15 ? TIMBER : TAN, x, G, z);
          continue;
        }
        if (roll < 0.06) add('3070b', BRIGHT_GREEN, x, G, z);
        else if (roll < 0.12) add('3070b', cell === 'h' ? GRASS : DARK_GRASS, x, G, z);
        else if (roll < 0.16) add('6141', LIME, x, G, z);
        else if (roll < 0.2)
          tryAdd('32607', hash(x, z, 93) < 0.5 ? GRASS : BRIGHT_GREEN, x, G, z - 1);
        else if (roll < 0.22) add('98138', OLIVE, x, G, z);
      }
    const order = pending.map((piece, index) => ({ piece, index }));
    order.sort(
      (a, b) =>
        Number(!!a.piece.facing) - Number(!!b.piece.facing) ||
        a.piece.y - b.piece.y ||
        a.index - b.index,
    );
    for (const { piece } of order)
      drawnAdd(
        piece.partId,
        piece.color,
        piece.x,
        piece.y,
        piece.z,
        piece.rotation,
        piece.facing,
        piece.upsideDown,
      );
  },
};
