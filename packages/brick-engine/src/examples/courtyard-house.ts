import { footprint, isMatchingInsertFrame, seatOnSideStuds } from '../core.ts';
import type { Brick, Facing, Rotation } from '../core.ts';
import { addAreaMap, addBondedMap, addRun, bottomUp, reflectToFront } from './layout.ts';
import type { RunKind } from './layout.ts';
import { addTree } from './trees.ts';
import type { Box as TreeBox } from './trees.ts';
import type { ExampleBrickAdder, ExampleDefinition } from './types.ts';

// A medieval cottage on a landscaped island, after a fan-built cottage: a stone ground floor
// with pale quoins and a round-arched porch, a jettied half-timbered upper floor, and a steep
// roof of overlapping shingles (angled tiles on a stepped shell) with a cross-gabled dormer,
// brown barge boards and a chimney. An outside stair with a balustrade climbs the right gable;
// a big broadleaf tree stands before the porch, a well by the left corner, a pond on the right.
//
// Plans are drawn top-down with the front at high z and x running left to right as seen from
// the front; `reflectToFront` turns them to face the default camera.
//
// Ground floor: stone, x 10..29, z 11..22, porch recessed to z 20 over x 17..20. Upper floor:
// x 10..29, z 10..23, jettied a stud front and back. Roof: a height field over x 9..30,
// z 9..24, a course (three plates) higher for every stud in from the eaves, so 50 degrees;
// the dormer's field over x 18..27 rises the same way from its own eaves. Chimney: x 13..14,
// z 13..14. Stair: x 30..32, rising from z 22 to a landing at z 10..14.

const SIZE = 40;
/** Top of the island's lawn, where everything stands. */
const G = 6;

const GRASS = 2;
const DARK_GRASS = 288;
const BRIGHT_GREEN = 10;
const LIME = 27;
const OLIVE = 330;
const SAND_GREEN = 378;
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
const [HX0, HX1, HZ0, HZ1] = [10, 29, 11, 22];
const [UZ0, UZ1] = [10, 23];
const FLOOR = G + 15;
const UPPER = FLOOR + 1;
/** The timber wall plate the roof stands on, and the roof's first course. */
const PLATE = UPPER + 12;
const EAVES = PLATE + 1;
// Roof field: main roof over x RX0..RX1 between the back eave row B and the front eave row
// F - 1; the dormer's over x DX0..DX1.
const [RX0, RX1, B, F] = [9, 30, 9, 25];
const [DX0, DX1] = [18, 27];
const [CX, CZ] = [13, 13];
const [SX0, SX1] = [30, 32];

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

// Pieces the smoothing pass may finish: rocks, earth strata and lawn, keyed by world place.
const NATURAL = new Set<string>();
const naturalKey = (piece: Pick<Brick, 'partId' | 'x' | 'y' | 'z'>) =>
  `${piece.partId}@${piece.x},${piece.y},${piece.z}`;

// ---------------------------------------------------------------------------------------------
// The island: an organic outline with bays and promontories in four strata, each set in a
// little in places so the sides show ledges like a cut-away: dark rock, mixed stone and earth,
// earth, then the lawn.

const [IX, IZ] = [20, 20.5];
/** How far a cell lies towards the island's edge: 1 on the outline. */
function reach(x: number, z: number) {
  const [dx, dz] = [(x + 0.5 - IX) / 18.6, (z + 0.5 - IZ) / 18.4];
  const angle = Math.atan2(dz, dx);
  const wobble =
    1 +
    0.09 * Math.sin(2 * angle + 2.2) +
    0.09 * Math.sin(3 * angle + 0.9) +
    0.05 * Math.sin(5 * angle + 2.4) +
    0.035 * Math.sin(8 * angle + 0.3);
  return (Math.abs(dx) ** 2.6 + Math.abs(dz) ** 2.6) ** (1 / 2.6) / wobble;
}
const SECTORS = 32;
const sector = (x: number, z: number) =>
  Math.floor(((Math.atan2(z + 0.5 - IZ, x + 0.5 - IX) + Math.PI) / (2 * Math.PI)) * SECTORS) %
  SECTORS;
/** Cells the house, stair and props need under them, whatever the outline does. */
const required = (x: number, z: number) =>
  within(x, z, HX0 - 1, UZ0 - 1, SX1 + 1, UZ1 + 1) || within(x, z, 3, 24, 8, 29);
function inLayer(x: number, z: number, layer: number) {
  if (x < 0 || z < 0 || x >= SIZE || z >= SIZE) return false;
  if (required(x, z)) return true;
  let limit = 1;
  for (let level = 1; level <= layer; level++)
    if (hash(sector(x, z), level, 7) < [0, 0.35, 0.4, 0.5][level]) limit -= 0.9 / 18.5;
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
  const [dx, dz] = [(x + 0.5 - 32.5) / 4.4, (z + 0.5 - 30.5) / 3.4];
  const angle = Math.atan2(dz, dx);
  const wobble = 1 + 0.1 * Math.sin(3 * angle + 1.3) + 0.06 * Math.sin(5 * angle);
  return Math.hypot(dx, dz) / wobble;
}
const pond = (x: number, z: number) =>
  pondDepth(x, z) <= 1 && NEIGHBOURS.every(([dx, dz]) => inLayer(x + dx, z + dz, 3));

/** The path from the porch, wandering down to the front edge, and flags before the stair. */
function path(x: number, z: number) {
  if (within(x, z, 16, 23, 21, 24)) return true;
  if (z < 25) return false;
  const centre = 19 + 1.6 * Math.sin((z - 25) / 2.4) - (z - 25) * 0.12;
  return Math.abs(x + 0.5 - centre) < 1.7 - (z > 33 ? 0.2 : 0) && inLayer(x, z, 3);
}
/** Grey flags: the porch apron, round the well and at the foot of the stair. */
const flags = (x: number, z: number) =>
  within(x, z, 17, 21, 20, 22) ||
  within(x, z, SX0, 23, SX1, 24) ||
  (Math.hypot(x + 0.5 - 5.5, z + 0.5 - 26.5) < 3.4 && !within(x, z, 4, 25, 7, 28));
/** A vegetable bed in the back garden. */
const bed = (x: number, z: number) => within(x, z, 19, 3, 25, 6);
const house = (x: number, z: number) =>
  within(x, z, HX0, HZ0, HX1, HZ1) || within(x, z, SX0, UZ0, SX1, HZ1);

// ---------------------------------------------------------------------------------------------
// The roof as a height field: how many courses stand over each cell, counting the eave row as
// one. Each course is a shell two studs deep (the course's exposed row and the row the next
// course stands on), so the roof is hollow, and its exposed row carries the shingles.

type Dir = '+x' | '-x' | '+z' | '-z';
const STEP: Readonly<Record<Dir, readonly [number, number]>> = {
  '+x': [1, 0],
  '-x': [-1, 0],
  '+z': [0, 1],
  '-z': [0, -1],
};
const mainT = (x: number, z: number) =>
  x >= RX0 && x <= RX1 && z >= B && z < F ? Math.min(F - z, z - B + 1) : 0;
const dormerT = (x: number, z: number) =>
  x >= DX0 && x <= DX1 && z >= F - 8 && z < F ? Math.min(x - DX0 + 1, DX1 - x + 1) : 0;
const chimney = (x: number, z: number) => within(x, z, CX, CZ, CX + 1, CZ + 1);
const roofT = (x: number, z: number) => (chimney(x, z) ? 0 : Math.max(mainT(x, z), dormerT(x, z)));
/** Whether a cell belongs to the dormer's roof (ties go to the dormer, so valleys bond). */
const isDormer = (x: number, z: number) => dormerT(x, z) > 0 && dormerT(x, z) >= mainT(x, z);
/** The way the roof falls from a cell. */
const downhill = (x: number, z: number): Dir =>
  isDormer(x, z) ? (x - DX0 < DX1 - x ? '-x' : '+x') : F - z < z - B + 1 ? '+z' : '-z';
const RIDGE_COURSE = Math.max(...Array.from({ length: SIZE }, (_, z) => mainT(RX0, z))) - 1;
const DORMER_RIDGE_COURSE = Math.floor((DX1 - DX0 + 2) / 2) - 1;

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
  if (cluster < 0.22) return 'd';
  const single = hash(along, course, wall, 5);
  if (single < 0.06) return 'd';
  if (single < 0.1) return 'h';
  return 'a';
}

/** Plaster panels with patches of bare brick, as on an old half-timbered house. */
function infillCell(along: number, course: number, wall: number) {
  const patch = hash(Math.floor(along / 2), Math.floor((course + 1) / 2), wall, 9);
  return patch < 0.14 ? 'n' : 'w';
}

/** Ground-floor openings. */
const FRONT_WINDOWS = [12, 23] as const;
const LEFT_WINDOW = 14;
const BACK_WINDOWS = [14, 23] as const;
const PORCH = [17, 20] as const;
const PORCH_BACK = 20;
const DOOR = 17;
const FRONT_CORBELS = [11, 22, 28];
const BACK_CORBELS = [12, 19, 27];

function groundCell(x: number, z: number, n: number): string {
  const ring =
    within(x, z, HX0, HZ0, HX1, HZ1) && (x === HX0 || x === HX1 || z === HZ0 || z === HZ1);
  // The porch: a back wall with the door, and side walls out to the arch.
  const porch =
    (z === PORCH_BACK && x >= PORCH[0] - 1 && x <= PORCH[1] + 1) ||
    (z > PORCH_BACK && z < HZ1 && (x === PORCH[0] - 1 || x === PORCH[1] + 1));
  if (!ring && !porch) return ' ';
  if (z === HZ1 && x >= PORCH[0] && x <= PORCH[1]) return ' ';
  // The arch stands over the porch's mouth, jambs and all, in the top two courses.
  if (z === HZ1 && x >= PORCH[0] - 1 && x <= PORCH[1] + 1 && n >= 3) return ' ';
  if (z === PORCH_BACK && x >= DOOR && x < DOOR + 3 && n <= 3) return ' ';
  if (z === HZ1 && FRONT_WINDOWS.some((x0) => x >= x0 && x <= x0 + 3) && n <= 3) return ' ';
  if (x === HX0 && z >= LEFT_WINDOW && z <= LEFT_WINDOW + 3 && n <= 3) return ' ';
  if (z === HZ0 && BACK_WINDOWS.some((x0) => x >= x0 && x <= x0 + 1) && n <= 2) return ' ';
  if (z === PORCH_BACK && x === PORCH[1] && n === 2) return ' ';
  if (n === 4 && z === HZ1 && FRONT_CORBELS.includes(x)) return ' ';
  if (n === 4 && z === HZ0 && BACK_CORBELS.includes(x)) return ' ';
  // Pale stone lintels over the lattice windows.
  if (n === 4 && z === HZ1 && FRONT_WINDOWS.some((x0) => x >= x0 && x <= x0 + 3)) return 'L';
  if (n === 4 && x === HX0 && z >= LEFT_WINDOW && z <= LEFT_WINDOW + 3) return 'L';
  if (n === 3 && z === HZ0 && BACK_WINDOWS.some((x0) => x >= x0 && x <= x0 + 1)) return 'L';
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

/** Upper-floor openings and timbers. */
const UPPER_FRONT_WINDOWS = [12, 21] as const;
const UPPER_BACK_WINDOW = 16;
const UPPER_BACK_SMALL = 24;
const UPPER_LEFT_WINDOW = 14;
const UPPER_DOOR = 11;
const UPPER_RIGHT_SMALL = 18;
const WHEEL = 26;
const POSTS: Readonly<Record<string, readonly number[]>> = {
  front: [10, 17, 19, 29],
  back: [10, 14, 21, 29],
  left: [12, 19, 22],
  right: [15, 21],
};

function upperCell(x: number, z: number, n: number): string {
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
  const opening = (x0: number, width: number, from = 0) =>
    along >= x0 && along < x0 + width && n >= from;
  if (wall === 'front' && UPPER_FRONT_WINDOWS.some((x0) => opening(x0, 4))) return ' ';
  if (wall === 'front' && along === WHEEL && n === 1) return ' ';
  if (wall === 'back' && opening(UPPER_BACK_WINDOW, 4)) return ' ';
  if (wall === 'back' && opening(UPPER_BACK_SMALL, 2, 1) && n <= 2) return ' ';
  if (wall === 'left' && opening(UPPER_LEFT_WINDOW, 4)) return ' ';
  if (wall === 'right' && opening(UPPER_DOOR, 3)) return ' ';
  if (wall === 'right' && opening(UPPER_RIGHT_SMALL, 2, 1) && n <= 2) return ' ';
  // The sill beam all round, then posts and plaster, and dark lintels over the small windows.
  if (n === 0) return 'b';
  if (n === 3 && wall === 'back' && opening(UPPER_BACK_SMALL, 2)) return 'T';
  if (n === 3 && wall === 'right' && opening(UPPER_RIGHT_SMALL, 2)) return 'T';
  if (POSTS[wall].includes(along)) return 'b';
  return infillCell(along, n, ['front', 'back', 'left', 'right'].indexOf(wall));
}

/** Gables under the roof: timber along the rafters and a king post, plaster between. */
const GABLE_WINDOWS: readonly (readonly [number, number, number])[] = [
  // [x, z, course] of each small window's lower left cell.
  [HX0, 18, 1],
  [HX1, 13, 1],
];
const DORMER_WINDOW = 22;
function gableCell(x: number, z: number, c: number): string {
  const t = roofT(x, z);
  const main = (x === HX0 || x === HX1) && z > UZ0 && z < UZ1 && !isDormer(x, z);
  const dormer = z === UZ1 && isDormer(x, z) && dormerT(x, z) > 2;
  if ((!main && !dormer) || c > t - 3) return ' ';
  if (main) {
    for (const [wx, wz, wc] of GABLE_WINDOWS)
      if (x === wx && (z === wz || z === wz + 1) && (c === wc || c === wc + 1)) return ' ';
    if (x === HX0 && z === 16 && c === 4) return ' ';
    if (c === t - 3 || ((z === 16 || z === 17) && c >= 2) || (c === 0 && (z === 12 || z === 21)))
      return 'b';
    return hash(z, c, x, 17) < 0.16 ? 'n' : 'w';
  }
  if ((x === DORMER_WINDOW || x === DORMER_WINDOW + 1) && c <= 1) return ' ';
  if (c === t - 3) return 'b';
  return 'w';
}

// ---------------------------------------------------------------------------------------------
// Roof helpers.

const SLOPE_TURN: Readonly<Record<Facing, Rotation>> = { '-z': 0, '-x': 90, '+z': 180, '+x': 270 };
/** Shingles: mostly dark red, a third bright red, never in a pattern. */
const shingle = (...at: number[]) => {
  const roll = hash(...at, 3);
  return roll < 0.3 ? ROOF_LIGHT : ROOF;
};
const BRICK_OF: Readonly<Record<number, string>> = { 1: '3004', 2: '3003', 3: '3002', 4: '3001' };

/** Splits [from, to] into lengths of one to four, staggered by `seed`. */
function split(from: number, to: number, seed: number) {
  const pieces: [number, number][] = [];
  let at = from;
  while (at <= to) {
    const size = Math.min([2, 3, 4, 3, 2, 4][Math.floor(hash(at, seed) * 6)], to - at + 1);
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
  expectedPieceCount: 2069,
  buildArea: SIZE,
  brickIdPrefix: 'demo',
  smooth: [{ only: (brick) => NATURAL.has(naturalKey(brick)) }],
  build(drawnAdd) {
    NATURAL.clear();
    // Pieces go out bottom-up, side-mounted ones last, reflected so the front faces the camera.
    const order = bottomUp(drawnAdd);
    let tagging = false;
    const front = reflectToFront((partId, color, x, y, z, rotation, facing, upsideDown) => {
      if (tagging) NATURAL.add(naturalKey({ partId, x, y, z }));
      order.add(partId, color, x, y, z, rotation, facing, upsideDown);
    }, SIZE);
    // Everything laid so far, in plan studs, so plants and the tree's crown grow round it.
    const boxes: TreeBox[] = [];
    const add: ExampleBrickAdder = (partId, color, x, y, z, rotation = 0, facing, upsideDown) => {
      const size = footprint({
        id: '',
        partId,
        color,
        x,
        y,
        z,
        rotation,
        ...(facing ? { facing } : {}),
      });
      boxes.push({
        u0: x,
        u1: x + size.width,
        v0: z,
        v1: z + size.depth,
        y0: y,
        y1: y + size.height,
      });
      front(partId, color, x, y, z, rotation, facing, upsideDown);
    };
    /** Adds a piece the smoothing pass may finish. */
    const natural: ExampleBrickAdder = (...piece) => {
      tagging = true;
      add(...piece);
      tagging = false;
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
    /** Mounts a piece on a side stud of a host, facing out of the plan's `facing`. */
    const mount = (host: Piece, partId: string, color: number, facing: Facing) => {
      const seated = seatOnSideStuds(
        { id: 'mount', partId, color, x: host.x, y: host.y, z: host.z, rotation: 0, facing },
        { id: 'host', ...host },
      );
      if (!seated) throw new Error(`Nothing to mount ${partId} on.`);
      add(partId, color, seated.x, seated.y, seated.z, seated.rotation, seated.facing);
    };
    /** A side-stud brick whose studs face `facing`, at a wall cell. */
    const sideStud = (x: number, y: number, z: number, facing: Facing, color: number): Piece => {
      for (const rotation of [0, 90, 180, 270] as Rotation[])
        for (const [dx, dz] of [
          [0, 0],
          [-0.5, 0],
          [0, -0.5],
        ]) {
          const host: Piece = { partId: '87087', color, x: x + dx, y, z: z + dz, rotation };
          const size = footprint({ id: '', ...host });
          const body = facing.endsWith('x')
            ? facing === '-x'
              ? host.x === x - 0.5
              : host.x === x && size.width === 1.5
            : facing === '-z'
              ? host.z === z - 0.5
              : host.z === z && size.depth === 1.5;
          if (!body) continue;
          const probe = seatOnSideStuds(
            { id: 'p', partId: '3024', color, x: 0, y, z: 0, rotation: 0, facing },
            { id: 'h', ...host },
          );
          if (!probe) continue;
          add(host.partId, color, host.x, host.y, host.z, host.rotation);
          return host;
        }
      throw new Error(`No side stud facing ${facing}.`);
    };
    /** A door frame and the door that hangs in it. */
    /** Where a plan piece lands on the board. */
    const toWorld = (piece: Piece) => {
      let placed: Piece | undefined;
      reflectToFront((partId, color, x, y, z, rotation = 0) => {
        placed = { partId, color, x, y, z, rotation };
      }, SIZE)(piece.partId, piece.color, piece.x, piece.y, piece.z, piece.rotation);
      return placed!;
    };
    /**
     * A door frame and the door that hangs in it. Doors are handed, so the door is fitted to
     * the frame as it lands on the board and handed on as it is.
     */
    const addDoor = (frame: Piece, door: string, color: number) => {
      add(frame.partId, frame.color, frame.x, frame.y, frame.z, frame.rotation);
      const placed = toWorld(frame);
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
              order.add(door, color, candidate.x, candidate.y, candidate.z, rotation);
              return;
            }
          }
      throw new Error(`No fit for door ${door}.`);
    };

    // The island's strata.
    addAreaMap(
      natural,
      plan((x, z) => (!inLayer(x, z, 0) ? ' ' : 'r')),
      0,
      { r: ['plate', DARK_STONE] },
    );
    addAreaMap(
      natural,
      plan((x, z) => {
        if (!inLayer(x, z, 1)) return ' ';
        if (!onEdge(x, z, 1)) return 'i';
        const roll = hash(Math.floor(x / 2), Math.floor(z / 2), 11);
        return roll < 0.45 ? 'r' : roll < 0.8 ? 's' : 't';
      }),
      1,
      {
        i: ['brick', DARK_STONE],
        r: ['brick', DARK_STONE],
        s: ['brick', STONE],
        t: ['brick', DARK_TAN],
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
        const roll = hash(Math.floor(x / 3), Math.floor(z / 3), 12);
        return roll < 0.55 ? 'd' : roll < 0.85 ? 'b' : 'n';
      }),
      4,
      {
        i: ['plate', DARK_TAN],
        d: ['plate', DARK_TAN],
        b: ['plate', TIMBER],
        n: ['plate', TAN],
      },
    );
    // The top: lawn in two greens in broad patches, an earth path, grey flags, stone under the
    // house.
    const top = (x: number, z: number) => {
      if (!inLayer(x, z, 3) || pond(x, z)) return ' ';
      if (house(x, z)) return 'c';
      if (flags(x, z)) return 'f';
      if (path(x, z)) return 'p';
      if (bed(x, z)) return 'v';
      return hash(Math.floor(x / 4), Math.floor(z / 4), 14) < 0.28 ? 'h' : 'g';
    };
    const ground = plan(top);
    addAreaMap(
      (partId, color, x, y, z, rotation) =>
        (color === GRASS || color === DARK_GRASS ? natural : add)(partId, color, x, y, z, rotation),
      ground,
      5,
      {
        c: ['plate', STONE],
        f: ['plate', DARK_STONE],
        p: ['plate', DARK_TAN],
        v: ['plate', DARK_TAN],
        g: ['plate', GRASS],
        h: ['plate', DARK_GRASS],
      },
    );
    // Lighter water at the banks, and ripples.
    for (let z = 0; z < SIZE; z++)
      for (let x = 0; x < SIZE; x++) {
        const cell = water[z][x];
        if (cell === 'v' && hash(x, z, 21) < 0.75) add('3070b', RIPPLE, x, 5, z);
        else if (cell === 'u' && hash(x, z, 22) < 0.15) add('98138', RIPPLE, x, 5, z);
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
      { partId: '3579', color: DARK_TIMBER, x: DOOR, y: G, z: PORCH_BACK, rotation: 90 },
      '3193a',
      TIMBER,
    );
    add('3665a', BLACK, PORCH[1], G + 6, PORCH_BACK, 180);
    add('3062b', GLOW, PORCH[1], G + 9, PORCH_BACK + 1);
    add('98138', BLACK, PORCH[1], G + 12, PORCH_BACK + 1);
    // Checked flags on the porch floor.
    for (let x = PORCH[0]; x <= PORCH[1]; x++)
      for (let z = PORCH_BACK + 1; z <= HZ1; z++)
        if (z > PORCH_BACK + 1 || x >= DOOR + 3)
          add('3070b', (x + z) % 2 ? LIGHT_STONE : STONE, x, G, z);

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
      const [ox, oz] =
        out === '+z'
          ? [x, z + 1]
          : out === '-z'
            ? [x, z - 1]
            : out === '-x'
              ? [x - 1, z]
              : [x + 1, z];
      addRun(add, 'brick', DARK_TIMBER, alongX ? 'x' : 'z', ox, y + 3, oz, length);
      for (let i = 0; i < length; i++) {
        const [px, pz] = alongX ? [ox + i, oz] : [ox, oz + i];
        const roll = hash(px, pz, y, 31);
        if (roll < 0.5) add('98138', bloom, px, y + 6, pz);
        else if (roll < 0.85) add('6141', roll < 0.65 ? BRIGHT_GREEN : GRASS, px, y + 6, pz);
        else add('3070b', DARK_TAN, px, y + 6, pz);
      }
    };
    lattice(FRONT_WINDOWS[0], G + 3, HZ1, true);
    windowBox(FRONT_WINDOWS[0], G, HZ1, '+z', 4, RED);
    lattice(FRONT_WINDOWS[1], G + 3, HZ1, true);
    windowBox(FRONT_WINDOWS[1], G, HZ1, '+z', 4, YELLOW);
    lattice(HX0, G + 3, LEFT_WINDOW, false);
    windowBox(HX0, G, LEFT_WINDOW, '-x', 4, WHITE);
    for (const x of BACK_WINDOWS) {
      small(x, G + 3, HZ0, true);
      for (const dx of [0, 1]) add('3665a', TIMBER, x + dx, G, HZ0 - 1, 0);
      add('3069b', TIMBER, x, G + 3, HZ0 - 1, 90);
    }

    // Corbels carrying the jettied upper floor.
    for (const x of FRONT_CORBELS) add('3665a', TIMBER, x, G + 12, HZ1, 180);
    for (const x of BACK_CORBELS) add('3665a', TIMBER, x, G + 12, HZ0 - 1, 0);

    // The jetty: a timber floor overhanging the stonework front and back, its edge a band
    // between the storeys.
    const groundRing = (x: number, z: number) =>
      within(x, z, HX0, HZ0, HX1, HZ1) && (x === HX0 || x === HX1 || z === HZ0 || z === HZ1);
    addAreaMap(
      add,
      plan((x, z) => (within(x, z, HX0, UZ0, HX1, UZ1) ? 'f' : ' ')),
      FLOOR,
      { f: ['plate', TIMBER] },
      groundRing,
    );

    // Half-timbered upper floor.
    for (let n = 0; n < 4; n++)
      addBondedMap(
        add,
        plan((x, z) => upperCell(x, z, n)),
        UPPER + n * 3,
        WALL_LEGEND,
        n,
      );
    for (const x of UPPER_FRONT_WINDOWS) {
      lattice(x, UPPER + 3, UZ1, true);
      windowBox(x, UPPER, UZ1, '+z', 4, x < 15 ? YELLOW : RED);
    }
    lattice(UPPER_BACK_WINDOW, UPPER + 3, UZ0, true);
    windowBox(UPPER_BACK_WINDOW, UPPER, UZ0, '-z', 4, RED);
    small(UPPER_BACK_SMALL, UPPER + 3, UZ0, true);
    lattice(HX0, UPPER + 3, UPPER_LEFT_WINDOW, false);
    windowBox(HX0, UPPER, UPPER_LEFT_WINDOW, '-x', 4, YELLOW);
    small(HX1, UPPER + 3, UPPER_RIGHT_SMALL, false);
    addDoor(
      { partId: '3579', color: DARK_TIMBER, x: HX1, y: UPPER, z: UPPER_DOOR, rotation: 0 },
      '3193a',
      TIMBER,
    );
    // A cart wheel hung on the front between the windows.
    const wheelHost = sideStud(WHEEL, UPPER + 3, UZ1, '+z', TIMBER);
    mount(wheelHost, '60474', TIMBER, '+z');

    // The wall plate: a timber band round the top of the walls, running out under the eaves
    // and past the gables to carry the barge boards.
    addAreaMap(
      add,
      plan((x, z) =>
        within(x, z, RX0, B, RX1, B + 1) ||
        within(x, z, RX0, F - 2, RX1, F - 1) ||
        ((x === HX0 || x === HX1) && z > UZ0 && z < UZ1)
          ? 'p'
          : ' ',
      ),
      PLATE,
      { p: ['plate', TIMBER] },
      (x, z) => within(x, z, HX0, UZ0, HX1, UZ1),
    );

    // Gables: the end walls and the dormer's front, rising under the roof.
    for (let c = 0; c <= RIDGE_COURSE; c++)
      addBondedMap(
        add,
        plan((x, z) => gableCell(x, z, c)),
        EAVES + c * 3,
        WALL_LEGEND,
        c + 1,
      );
    for (const [x, z, c] of GABLE_WINDOWS) small(x, EAVES + c * 3, z, false);
    small(DORMER_WINDOW, EAVES, UZ1, true);
    // A painted shield high on the left gable.
    const shieldHost = sideStud(HX0, EAVES + 12, 16, '-x', TIMBER);
    mount(shieldHost, '14769', YELLOW, '-x');

    // Chimney: bonded masonry from the upper floor up past the ridge, a cap and two pots.
    for (let course = 0; course < 14; course++) {
      const y = UPPER + course * 3;
      const color = (salt: number) => (hash(course, salt, 41) < 0.3 ? DARK_STONE : STONE);
      if (course % 2) for (const x of [CX, CX + 1]) add('98283', color(x), x, y, CZ);
      else for (const z of [CZ, CZ + 1]) add('98283', color(z), CX, y, z, 90);
    }
    add('3022', DARK_STONE, CX, UPPER + 42, CZ);
    add('3062b', ORANGE, CX, UPPER + 43, CZ);
    add('3062b', DARK_TAN, CX + 1, UPPER + 43, CZ + 1);

    // Roof shell: each course pairs a cell of its exposed row with the cell uphill of it, in
    // bricks two studs deep running across the slope; barge boards at the gable ends.
    const shell = new Set<string>();
    const cellKey = (x: number, z: number, c: number) => `${x},${z},${c}`;
    // What already carries a course-0 cell: the wall plate.
    const onPlate = (x: number, z: number) =>
      within(x, z, RX0, B, RX1, B + 1) ||
      within(x, z, RX0, F - 2, RX1, F - 1) ||
      ((x === HX0 || x === HX1) && z > UZ0 && z < UZ1);
    const gableAt = (x: number, z: number, c: number) => c >= 0 && gableCell(x, z, c) !== ' ';
    const held = (x: number, z: number, c: number) =>
      c === 0
        ? onPlate(x, z) || shell.has(cellKey(x, z, -1))
        : shell.has(cellKey(x, z, c - 1)) || gableAt(x, z, c - 1);
    type Pair = { cells: (readonly [number, number])[]; dir: Dir | 'ridge'; axis: 'x' | 'z' };
    const barge = (x: number, z: number) =>
      (!isDormer(x, z) && (x === RX0 || x === RX1)) || (isDormer(x, z) && z === F - 1);
    /** Pillars inside the attic for shell cells nothing would carry. */
    const pillar = (x: number, z: number, c: number) => {
      let from = c - 1;
      while (from >= 0 && !shell.has(cellKey(x, z, from)) && !gableAt(x, z, from)) from--;
      if (from < 0) {
        for (let y = UPPER; y < PLATE; y += 3) add('3005', DARK_TIMBER, x, y, z);
        add('3024', DARK_TIMBER, x, PLATE, z);
      }
      for (let k = from + 1; k < c; k++) {
        add('3005', DARK_TIMBER, x, EAVES + k * 3, z);
        shell.add(cellKey(x, z, k));
      }
    };
    for (let c = 0; c <= RIDGE_COURSE; c++) {
      const y = EAVES + c * 3;
      const claimed = new Set<string>();
      const pairs: Pair[] = [];
      const singles: [number, number][] = [];
      for (let z = 0; z < SIZE; z++)
        for (let x = 0; x < SIZE; x++) {
          if (roofT(x, z) !== c + 1 || claimed.has(`${x},${z}`)) continue;
          const dir = downhill(x, z);
          const [sx, sz] = STEP[dir];
          const [ux, uz] = [x - sx, z - sz];
          const uphill = roofT(ux, uz);
          if (!claimed.has(`${ux},${uz}`) && (uphill === c + 2 || uphill === c + 1)) {
            claimed.add(`${x},${z}`);
            claimed.add(`${ux},${uz}`);
            pairs.push({
              cells: [
                [x, z],
                [ux, uz],
              ],
              dir: uphill === c + 1 ? 'ridge' : dir,
              axis: sx ? 'x' : 'z',
            });
          }
        }
      for (let z = 0; z < SIZE; z++)
        for (let x = 0; x < SIZE; x++) {
          const t = roofT(x, z);
          if ((t === c + 1 || t === c + 2) && !claimed.has(`${x},${z}`)) singles.push([x, z]);
        }
      // Runs of pairs side by side across the slope become longer bricks.
      const runs = new Map<string, Pair[]>();
      for (const pair of pairs) {
        const [[x0, z0], [x1, z1]] = pair.cells;
        const at = pair.axis === 'z' ? Math.min(z0, z1) : Math.min(x0, x1);
        const special = barge(x0, z0) ? `b${pair.axis === 'z' ? x0 : z0}` : '';
        const key = `${pair.axis}:${pair.dir}:${at}:${special}`;
        runs.set(key, [...(runs.get(key) ?? []), pair]);
      }
      const place = (
        partId: string,
        color: number,
        px: number,
        pz: number,
        rotation: Rotation,
        cells: [number, number][],
      ) => {
        if (!cells.some(([cx, cz]) => held(cx, cz, c))) pillar(cells[0][0], cells[0][1], c);
        add(partId, color, px, y, pz, rotation);
        for (const [cx, cz] of cells) shell.add(cellKey(cx, cz, c));
      };
      for (const run of runs.values()) {
        const alongX = run[0].axis === 'z';
        run.sort((a, b) =>
          alongX ? a.cells[0][0] - b.cells[0][0] : a.cells[0][1] - b.cells[0][1],
        );
        // Split into stretches of neighbouring pairs.
        const stretches: Pair[][] = [];
        for (const pair of run) {
          const last = stretches.at(-1);
          const prev = last?.at(-1);
          const step = alongX
            ? pair.cells[0][0] - (prev?.cells[0][0] ?? -9)
            : pair.cells[0][1] - (prev?.cells[0][1] ?? -9);
          if (last && step === 1) last.push(pair);
          else stretches.push([pair]);
        }
        for (const stretch of stretches) {
          const [[x0, z0], [x1, z1]] = stretch[0].cells;
          const isBarge = barge(x0, z0);
          const ridge = stretch[0].dir === 'ridge';
          const lo = alongX ? Math.min(z0, z1) : Math.min(x0, x1);
          const first = alongX ? x0 : z0;
          const last = alongX ? stretch.at(-1)!.cells[0][0] : stretch.at(-1)!.cells[0][1];
          const pieces = isBarge
            ? stretch.map(
                (pair) => [alongX ? pair.cells[0][0] : pair.cells[0][1], 1] as [number, number],
              )
            : split(first, last, c * 7 + lo);
          for (const [at, size] of pieces) {
            const [px, pz] = alongX ? [at, lo] : [lo, at];
            const cells: [number, number][] = [];
            for (let i = 0; i < size; i++)
              for (let j = 0; j < 2; j++) cells.push(alongX ? [at + i, lo + j] : [lo + j, at + i]);
            if (isBarge && !ridge) {
              const dir = stretch[0].dir as Dir;
              add('3040b', TIMBER, px, y, pz, SLOPE_TURN[dir]);
              if (!cells.some(([cx, cz]) => held(cx, cz, c))) pillar(cells[0][0], cells[0][1], c);
              for (const [cx, cz] of cells) shell.add(cellKey(cx, cz, c));
              continue;
            }
            const partId = BRICK_OF[size];
            const rotation: Rotation =
              size === 1 ? (alongX ? 0 : 90) : size === 2 ? 0 : alongX ? 90 : 0;
            place(partId, isBarge ? TIMBER : ROOF, px, pz, rotation, cells);
          }
        }
      }
      for (const [x, z] of singles) place('3005', ROOF, x, z, 0, [[x, z]]);
    }

    // Ridge caps along both ridges, brown at the barge ends.
    for (let x = RX0; x < RX1; x += 2)
      add(
        '3043',
        x === RX0 || x + 1 === RX1 ? TIMBER : ROOF,
        x,
        EAVES + (RIDGE_COURSE + 1) * 3,
        F - 1 - RIDGE_COURSE,
        0,
      );
    const dormerRidge = DX0 + DORMER_RIDGE_COURSE;
    for (let z = F - 2; z >= 0; z -= 2) {
      if (!isDormer(dormerRidge, z) || roofT(dormerRidge, z) !== DORMER_RIDGE_COURSE + 1) break;
      add('3043', ROOF, dormerRidge, EAVES + (DORMER_RIDGE_COURSE + 1) * 3, z, 90);
    }

    // Shingles: on each course's exposed row, angled tiles two studs wide hang their points
    // over the course below, staggered course by course; single studs take a shorter tile.
    // An angled tile's point turns like a slope's low side (0 points -z, 90 -x, 180 +z,
    // 270 +x), so each shingle points downhill, towards its eaves.
    const shingleTurn = (dir: Dir) => SLOPE_TURN[dir];
    for (let c = 0; c <= RIDGE_COURSE; c++) {
      const y = EAVES + c * 3 + 3;
      const open = (x: number, z: number) =>
        roofT(x, z) === c + 1 &&
        !barge(x, z) &&
        roofT(x - STEP[downhill(x, z)][0], z - STEP[downhill(x, z)][1]) === c + 2;
      const done = new Set<string>();
      for (let z = 0; z < SIZE; z++)
        for (let x = 0; x < SIZE; x++) {
          if (!open(x, z) || done.has(`${x},${z}`)) continue;
          const dir = downhill(x, z);
          const [sx, sz] = STEP[dir];
          // The neighbour across the slope, for a two-wide tile, staggered by course.
          const [ax, az] = sx ? [0, 1] : [1, 0];
          const along = sx ? z : x;
          const pairUp = (along + c + (isDormer(x, z) ? 1 : 0)) % 2 === 0;
          const [nx, nz] = [x + ax, z + az];
          const color = shingle(x, z, c);
          if (pairUp && open(nx, nz) && downhill(nx, nz) === dir && !done.has(`${nx},${nz}`)) {
            const x0 = sx > 0 ? x : sx < 0 ? x - 2 : x;
            const z0 = sz > 0 ? z : sz < 0 ? z - 2 : z;
            if (tryAdd('22385', color, x0, y, z0, shingleTurn(dir))) {
              done.add(`${x},${z}`);
              done.add(`${nx},${nz}`);
              continue;
            }
          }
          if (done.has(`${x},${z}`)) continue;
          const x1 = sx < 0 ? x - 1 : x;
          const z1 = sz < 0 ? z - 1 : z;
          if (tryAdd('3069b', color, x1, y, z1, sx ? 90 : 0)) {
            done.add(`${x},${z}`);
            continue;
          }
          if (tryAdd('54200', color, x, y, z, SLOPE_TURN[dir])) done.add(`${x},${z}`);
          else tryAdd('3070b', color, x, y, z);
          done.add(`${x},${z}`);
        }
    }

    // Outside stair up the right gable: stone steps two studs deep, a landing at the upper
    // door, and a spindled balustrade on a stepped stringer along the open side.
    const stepOf = (z: number) => (z <= 14 ? 4 : Math.floor((HZ1 - z) / 2));
    for (let course = 0; course < 5; course++)
      addBondedMap(
        add,
        plan((x, z) => {
          if (!within(x, z, SX0, UZ0, SX1, HZ1)) return ' ';
          const step = stepOf(z);
          const stringer = x === SX1 ? (step >= 4 ? 4 : step | 1) : step;
          return stringer >= course ? stoneCell(z + x, course, 9) : ' ';
        }),
        G + course * 3,
        WALL_LEGEND,
        course,
      );
    for (let z = UZ0; z <= HZ1; z++) {
      const step = stepOf(z);
      const y = G + 3 * (step + 1);
      for (let x = SX0; x < SX1; x++)
        add('3070b', (x + z + step) % 3 ? STONE : LIGHT_STONE, x, y, z);
    }
    for (const [z0, step] of [
      [19, 1],
      [15, 3],
      [UZ0 + 1, 4],
    ] as const) {
      const y = G + 3 * (Math.min(step, 4) + 1);
      addRun(add, 'plate', DARK_STONE, 'z', SX1, y, z0, 4);
      add('30055', STONE, SX1, y + 1, z0);
      add('2431', TIMBER, SX1, y + 7, z0);
    }
    add('3024', DARK_STONE, SX1, G + 15, UZ0);
    add('3062b', STONE, SX1, G + 16, UZ0);
    add('3062b', STONE, SX1, G + 19, UZ0);
    add('4589', TIMBER, SX1, G + 22, UZ0);

    // Ivy climbing the left front corner in two ragged stems.
    const ivy = (x: number, z: number, courses: number) => {
      for (let c = 0; c < courses; c++)
        add('3062b', hash(x, c, z) < 0.45 ? DARK_GRASS : GRASS, x, G + c * 3, z);
      add('6141', LIME, x, G + courses * 3, z);
    };
    ivy(HX0 - 1, HZ1 - 1, 4);
    ivy(HX0 - 1, HZ1 - 2, 2);
    ivy(HX0 - 1, HZ0 + 1, 3);

    // The well: a round stone kerb, timber posts, a little shingled roof and a bucket.
    const [wx, wz] = [4, 25];
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
      add('3045', dx === dz ? ROOF : DARK_TIMBER, wx + dx * 2, G + 16, wz + dz * 2, rotation);
    add('3688', ROOF, wx + 1, G + 19, wz + 1);
    add('3062b', DARK_STONE, wx, G + 6, wz);
    add('4589', TIMBER, wx + 3, G + 6, wz + 3);

    // Back garden: a woodpile against the wall, a chopping block, barrels and crates.
    for (const [z, y, x0] of [
      [HZ0 - 2, G, 16],
      [HZ0 - 3, G, 16],
      [HZ0 - 2, G + 3, 17],
      [HZ0 - 3, G + 3, 16],
    ] as const)
      add('30137', hash(z, y, x0) < 0.5 ? TIMBER : DARK_TIMBER, x0, y, z, 90);
    add('30136', TIMBER, 17, G + 6, HZ0 - 2, 90);
    add('3941', DARK_TIMBER, 22, G, 6);
    add('3070b', DARK_TAN, 22, G + 3, 6);
    const barrel = (x: number, z: number) => {
      add('3941', TIMBER, x, G, z);
      add('3941', TIMBER, x, G + 3, z);
      add('14769', DARK_TIMBER, x, G + 6, z);
    };
    barrel(25, 7);
    barrel(33, 9);
    barrel(27, 24);
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
    crate(12, 7, RED);
    crate(27, 9, BRIGHT_GREEN);

    // A lamppost by the path and a bench looking over the pond.
    add('2039', BLACK, 23, G, 31);
    add('3062b', GLOW, 23.5, G + 21, 31.5);
    add('4589', BLACK, 23.5, G + 24, 31.5);
    for (const z of [32, 34]) add('3004', DARK_TIMBER, 26, G, z);
    add('3021', TIMBER, 26, G + 3, 32);
    add('63864', TIMBER, 26, G + 4, 32);
    add('63864', TIMBER, 27, G + 4, 32);

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
          const tone = roll < 0.4 ? 'a' : roll < 0.9 ? 'd' : 'l';
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
          if (!inLayer(x, z, 3) || pond(x, z) || house(x, z) || path(x, z) || flags(x, z)) continue;
          const distance = Math.hypot((x + 0.5 - cx) / rx, (z + 0.5 - cz) / rz);
          const height = Math.round((1 - distance) * peak + (hash(x, z, salt) - 0.5) * 3);
          if (height > 0 && !blocked(x, x + 1, z, z + 1, G, G + height))
            heights.set(`${x}:${z}`, height);
        }
      rocks(heights, salt);
    };
    outcrop(5, 6, 4.4, 4.6, 13, 1);
    outcrop(36, 15, 2.6, 3.4, 6, 2);
    // Stones along the pond's back bank.
    const bank = new Map<string, number>();
    for (let z = 0; z < SIZE; z++)
      for (let x = 0; x < SIZE; x++) {
        if (pond(x, z) || !inLayer(x, z, 3) || path(x, z) || house(x, z) || flags(x, z)) continue;
        const shore = NEIGHBOURS.some(([dx, dz]) => pond(x + dx, z + dz));
        if (shore && z < 30 && hash(x, z, 61) < 0.6 && !blocked(x, x + 1, z, z + 1, G, G + 2))
          bank.set(`${x}:${z}`, 1 + Math.floor(hash(x, z, 62) * 2));
      }
    rocks(bank, 3);

    // The tree in front of the house, left of the porch, its crown spreading over the jetty.
    const around: TreeBox[] = boxes.slice();
    addTree(add, 14, 29, G, [DARK_GRASS, GRASS, GRASS], TIMBER, 4, 4, around);

    // Conifers at the back, bushes along the walls, ferns by the rocks, reeds and tall grass
    // at the pond, flowers in clumps of one colour.
    tryAdd('3471', DARK_GRASS, 27, G, 5);
    tryAdd('3471', DARK_GRASS, 2, G, 11);
    // Bushes and ferns stand on a stud between their own cells, so they sit half a stud over.
    for (const [x, z, color] of [
      [8.5, 9.5, DARK_GRASS],
      [24.5, 8.5, GRASS],
      [33.5, 25.5, DARK_GRASS],
      [8.5, 21.5, GRASS],
      [35.5, 21.5, GRASS],
      [3.5, 19.5, DARK_GRASS],
    ] as const)
      tryAdd('6064', color, x, G, z);
    tryAdd('6255', GRASS, 10, G, 3.5);
    tryAdd('6255', DARK_GRASS, 30, G, 26.5);
    // Tall grass stands on its middle stud: [x, z] of that stud and the way the blades run.
    for (const [x, z, rotation] of [
      [36, 28, 90],
      [29, 30, 90],
      [37, 33, 90],
      [10, 33, 0],
    ] as const)
      if ('gh'.includes(ground[z][x]))
        tryAdd(
          '30093',
          hash(x, z) < 0.4 ? DARK_GRASS : OLIVE,
          rotation ? x : x - 1.5,
          G,
          rotation ? z - 1.5 : z,
          rotation,
        );
    // Reeds: stems of olive and sand green on round plates at the water's edge.
    for (let z = 0; z < SIZE; z++)
      for (let x = 0; x < SIZE; x++) {
        if (!pond(x, z) || pondDepth(x, z) < 0.72 || hash(x, z, 71) > 0.35) continue;
        if (blocked(x, x + 1, z, z + 1, 5, 6 + 13)) continue;
        add('6141', OLIVE, x, 5, z);
        add('3957a', hash(x, z, 72) < 0.5 ? OLIVE : SAND_GREEN, x, 6, z);
      }
    // Lily pads on the deep water.
    for (const [x, z] of [
      [31, 30],
      [33, 31],
      [32, 29],
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
        if (!'gh'.includes(ground[z]?.[x] ?? ' ')) continue;
        if (
          placed === 0 &&
          !blocked(x, x + 2, z, z + 2, G, G + 5) &&
          'gh'.includes(ground[z + 1]?.[x + 1] ?? ' ')
        ) {
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
    flowers(9, 25, RED, 6, 82);
    flowers(29, 26, YELLOW, 6, 81);
    flowers(29, 34, WHITE, 5, 83);
    flowers(4, 13, YELLOW, 5, 84);
    flowers(34, 19, RED, 4, 85);
    flowers(16, 36, YELLOW, 4, 86);

    // The ground dressed last: tiles and stepping stones on the path, worn flags, and a few
    // tufts gathered along the edges of the lawn, its middle left plain.
    const edgeOf = (x: number, z: number) =>
      NEIGHBOURS.some(([dx, dz]) => {
        const next = ground[z + dz]?.[x + dx] ?? ' ';
        return next !== 'g' && next !== 'h';
      });
    for (let z = 0; z < SIZE; z++)
      for (let x = 0; x < SIZE; x++) {
        const cell = ground[z][x];
        if (cell === ' ' || cell === 'c' || blocked(x, x + 1, z, z + 1, G, G + 1)) continue;
        const roll = hash(x, z, 91);
        if (cell === 'p') {
          if (roll < 0.25) continue;
          const tone = hash(Math.floor(x / 2), Math.floor(z / 2), 92);
          const color = tone < 0.55 ? TAN : DARK_TAN;
          if (roll < 0.4) add('98138', color, x, G, z);
          else if (
            roll < 0.6 &&
            !blocked(x, x + 1, z + 1, z + 2, G, G + 1) &&
            ground[z + 1]?.[x] === 'p'
          )
            add('3069b', color, x, G, z);
          else add('3070b', color, x, G, z);
          continue;
        }
        if (cell === 'v') {
          // Rows of lettuces and the odd pumpkin, with bare earth between.
          if (z % 2 === 0) continue;
          if (roll < 0.15) add('98138', ORANGE, x, G, z);
          else add('6141', roll < 0.6 ? GRASS : roll < 0.85 ? BRIGHT_GREEN : DARK_GRASS, x, G, z);
          continue;
        }
        if (cell === 'f') {
          if (roll < 0.15) continue;
          add('3070b', roll < 0.45 ? DARK_STONE : roll < 0.9 ? STONE : LIGHT_STONE, x, G, z);
          continue;
        }
        if (!edgeOf(x, z) && !NEIGHBOURS.some(([dx, dz]) => house(x + dx, z + dz))) {
          if (roll < 0.03) add('3070b', cell === 'h' ? GRASS : DARK_GRASS, x, G, z);
          continue;
        }
        if (roll < 0.1) add('3070b', cell === 'h' ? GRASS : DARK_GRASS, x, G, z);
        else if (roll < 0.17)
          tryAdd('32607', hash(x, z, 93) < 0.5 ? GRASS : DARK_GRASS, x, G, z - 1);
      }
    order.flush();
  },
};
