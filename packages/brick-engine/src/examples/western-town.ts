import { footprint, isMatchingInsertFrame, seatOnSideStuds } from '../core.ts';
import type { Brick, Facing, Rotation } from '../core.ts';
import {
  addAreaMap,
  addBondedMap,
  addRing,
  addRowMap,
  addRun,
  bottomUp,
  glazeWindows,
} from './layout.ts';
import { reflectToFront } from './layout.ts';
import type { RunKind } from './layout.ts';
import type { ExampleBrickAdder, ExampleDefinition } from './types.ts';

// A Western main street on a dusty desert base: a sheriff's office, a two-storey saloon with a
// balcony over the boardwalk and a general store, each behind a square false front, with the
// street in front. Plans are drawn top-down with the front at high z and x running left to
// right as seen from the front; `reflectToFront` turns them to face the default camera.
//
// Buildings stand in a row at z 14..23 (front wall at z 23), on a raised boardwalk at z 24..26.
// The main street runs along x at z 29..38. A sandstone mesa rises behind the store.

const SIZE = 48;
/** Top of the ground, where everything stands. */
const G = 5;

const SAND = 19;
const HARDPAN = 28;
const NOUGAT = 84;
const ORANGE_ROCK = 484;
const TIMBER = 70;
const DARK_TIMBER = 308;
const WHITE = 15;
const BLACK = 0;
const DARK_RED = 320;
const SAND_GREEN = 378;
const OLIVE = 330;
const DARK_STONE = 72;
const STONE = 71;

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

// Pieces the smoothing pass may finish: the rock and sand, keyed by world place.
const NATURAL = new Set<string>();
const naturalKey = (piece: Pick<Brick, 'partId' | 'x' | 'y' | 'z'>) =>
  `${piece.partId}@${piece.x},${piece.y},${piece.z}`;

// ---------------------------------------------------------------------------------------------
// The base: a ragged outline with bays in three strata, each set in a little in places.

const [IX, IZ] = [23.5, 24.5];
const MESA = { x0: 26, x1: 45, z0: 1, z1: 11 };
/** The railway crosses the front of the base, on its own strip of ground. */
const RAIL = { z0: 42, z1: 45 };
/** How far a cell lies towards the base's edge: 1 on the outline. */
function reach(x: number, z: number) {
  const [dx, dz] = [(x + 0.5 - IX) / 22.2, (z + 0.5 - IZ) / 22.2];
  const angle = Math.atan2(dz, dx);
  const wobble =
    1 +
    0.1 * Math.sin(2 * angle + 1.3) +
    0.09 * Math.sin(3 * angle + 0.4) +
    0.06 * Math.sin(5 * angle + 2.1) +
    0.04 * Math.sin(8 * angle + 0.7);
  return (Math.abs(dx) ** 2.8 + Math.abs(dz) ** 2.8) ** (1 / 2.8) / wobble;
}
const SECTORS = 32;
const sector = (x: number, z: number) =>
  Math.floor(((Math.atan2(z + 0.5 - IZ, x + 0.5 - IX) + Math.PI) / (2 * Math.PI)) * SECTORS) %
  SECTORS;
/** Cells the buildings, boardwalks and the mesa need under them, whatever the outline does. */
const required = (x: number, z: number) =>
  within(x, z, 2, 12, 45, 28) ||
  within(x, z, MESA.x0 - 1, MESA.z0 - 1, MESA.x1 + 1, MESA.z1 + 1) ||
  within(x, z, 0, RAIL.z0 - 1, SIZE - 1, RAIL.z1 + 1);
function inLayer(x: number, z: number, layer: number) {
  if (x < 0 || z < 0 || x >= SIZE || z >= SIZE) return false;
  if (required(x, z)) return true;
  let limit = 1;
  for (let level = 1; level <= layer; level++)
    if (hash(sector(x, z), level, 7) < [0, 0.4, 0.5][level]) limit -= 0.9 / 22;
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

/** The street's middle line wanders a little as it runs along x. */
const streetMiddle = (x: number) => 33.2 + 1.6 * Math.sin(x / 5.5);
/** The main street, between the boardwalks and the open desert in front, and a dirt track that
 * wanders off from it towards the railway. */
const street = (x: number, z: number) =>
  (Math.abs(z - streetMiddle(x)) <= 4.3 && x >= 0 && x < SIZE) ||
  (z > 36 && z < RAIL.z0 && Math.abs(x - (26 + 3 * Math.sin((z - 36) / 3))) <= 1.2);

// ---------------------------------------------------------------------------------------------
// The buildings.

interface Opening {
  side: 'front' | 'back' | 'left' | 'right';
  /** The first cell along the wall, x for front and back, z for the sides. */
  at: number;
  width: number;
  /** The first and last courses it cuts through, counting from the boardwalk up. */
  from: number;
  to: number;
  kind: 'window' | 'door';
}

interface Building {
  name: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Wall colours: the base boards, a second shade, a darker one. */
  boards: readonly [number, number, number];
  /** How the walls are laid: boards of any length, or short masonry for brick and adobe. */
  kind: RunKind;
  trim: number;
  roof: readonly [number, number];
  /** Courses of the ground storey, and of an upper storey if there is one. */
  ground: number;
  upper: number;
  /** How many courses the false front rises above the eaves, column by column from x0. */
  front: readonly number[];
  openings: readonly Opening[];
}

const GROUND_FLOOR = G + 1;
/** The wall course at index `k`, counting upwards; ground courses first, then the upper ones. */
const courseY = (b: Building, k: number) =>
  k < b.ground
    ? GROUND_FLOOR + k * 3
    : k < b.ground + b.upper
      ? GROUND_FLOOR + b.ground * 3 + 1 + (k - b.ground) * 3
      : eavesY(b) + 1 + (k - b.ground - b.upper) * 3;
/** The plate course under the eaves, on top of the last wall course. */
const eavesY = (b: Building) => GROUND_FLOOR + b.ground * 3 + (b.upper > 0 ? 1 + b.upper * 3 : 0);

const SHERIFF: Building = {
  name: 'sheriff',
  x0: 4,
  x1: 13,
  z0: 13,
  z1: 23,
  // Adobe: tan and orange brick with dark tan patches.
  boards: [SAND, NOUGAT, HARDPAN],
  kind: 'masonry',
  trim: WHITE,
  roof: [DARK_STONE, BLACK],
  ground: 7,
  upper: 0,
  front: [6, 6, 6, 7, 7, 7, 7, 6, 6, 6],
  openings: [
    { side: 'front', at: 5, width: 2, from: 2, to: 4, kind: 'window' },
    { side: 'front', at: 8, width: 4, from: 1, to: 6, kind: 'door' },
    { side: 'left', at: 17, width: 2, from: 2, to: 4, kind: 'window' },
    { side: 'right', at: 17, width: 2, from: 2, to: 4, kind: 'window' },
    { side: 'back', at: 8, width: 2, from: 2, to: 4, kind: 'window' },
  ],
};

const SALOON: Building = {
  name: 'saloon',
  x0: 17,
  x1: 30,
  z0: 13,
  z1: 23,
  boards: [TIMBER, NOUGAT, DARK_TIMBER],
  kind: 'brick',
  trim: WHITE,
  roof: [DARK_STONE, BLACK],
  ground: 7,
  upper: 6,
  front: [8, 8, 8, 9, 10, 10, 11, 11, 10, 10, 9, 8, 8, 8],
  openings: [
    { side: 'front', at: 18, width: 2, from: 2, to: 4, kind: 'window' },
    { side: 'front', at: 28, width: 2, from: 2, to: 4, kind: 'window' },
    { side: 'front', at: 22, width: 4, from: 1, to: 6, kind: 'door' },
    { side: 'front', at: 18, width: 2, from: 8, to: 10, kind: 'window' },
    { side: 'front', at: 28, width: 2, from: 8, to: 10, kind: 'window' },
    { side: 'front', at: 22, width: 4, from: 7, to: 12, kind: 'door' },
    { side: 'left', at: 17, width: 2, from: 2, to: 4, kind: 'window' },
    { side: 'left', at: 20, width: 2, from: 2, to: 4, kind: 'window' },
    { side: 'right', at: 17, width: 2, from: 2, to: 4, kind: 'window' },
    { side: 'right', at: 20, width: 2, from: 2, to: 4, kind: 'window' },
    { side: 'left', at: 17, width: 2, from: 8, to: 10, kind: 'window' },
    { side: 'left', at: 20, width: 2, from: 8, to: 10, kind: 'window' },
    { side: 'right', at: 17, width: 2, from: 8, to: 10, kind: 'window' },
    { side: 'right', at: 20, width: 2, from: 8, to: 10, kind: 'window' },
    { side: 'back', at: 22, width: 4, from: 1, to: 6, kind: 'door' },
    { side: 'back', at: 19, width: 2, from: 8, to: 10, kind: 'window' },
    { side: 'back', at: 27, width: 2, from: 8, to: 10, kind: 'window' },
  ],
};

const STORE: Building = {
  name: 'store',
  x0: 33,
  x1: 42,
  z0: 13,
  z1: 23,
  // A painted store: sand green boards with olive and dark timber.
  boards: [SAND_GREEN, OLIVE, DARK_TIMBER],
  kind: 'brick',
  trim: WHITE,
  roof: [DARK_STONE, BLACK],
  ground: 7,
  upper: 0,
  front: [7, 7, 6, 6, 6, 6, 6, 6, 7, 7],
  openings: [
    { side: 'front', at: 34, width: 2, from: 2, to: 4, kind: 'window' },
    { side: 'front', at: 38, width: 4, from: 1, to: 6, kind: 'door' },
    { side: 'left', at: 17, width: 2, from: 2, to: 4, kind: 'window' },
    { side: 'right', at: 17, width: 2, from: 2, to: 4, kind: 'window' },
    { side: 'back', at: 36, width: 2, from: 2, to: 4, kind: 'window' },
  ],
};

const BUILDINGS = [SHERIFF, SALOON, STORE];
/** The first and last stud of each boardwalk; the alley between saloon and store stays open. */
const WALKS: Readonly<Record<string, readonly [number, number]>> = {
  sheriff: [2, 13],
  saloon: [14, 30],
  store: [33, 42],
};

/** The course count the walls of a building stand, eaves excluded. */
const wallCourses = (b: Building) => b.ground + b.upper;

/** Whether a wall cell lies in the span of an opening, at the courses it cuts through or above. */
const spans = (b: Building, o: Opening, x: number, z: number) => {
  if (o.side === 'front') return z === b.z1 && x >= o.at && x < o.at + o.width;
  if (o.side === 'back') return z === b.z0 && x >= o.at && x < o.at + o.width;
  if (o.side === 'left') return x === b.x0 && z >= o.at && z < o.at + o.width;
  return x === b.x1 && z >= o.at && z < o.at + o.width;
};
const isOpen = (b: Building, x: number, z: number, k: number) =>
  b.openings.some((o) => k >= o.from && k <= o.to && spans(b, o, x, z));
/** The course above an opening is one beam of dark timber, so every stud of the frame is held. */
const isLintel = (b: Building, x: number, z: number, k: number) =>
  b.openings.some((o) => k === o.to + 1 && spans(b, o, x, z));
/** The course under a window is a white sill band. */
const isSill = (b: Building, x: number, z: number, k: number) =>
  b.openings.some((o) => o.kind === 'window' && k === o.from - 1 && spans(b, o, x, z));
const isCorner = (b: Building, x: number, z: number) =>
  (x === b.x0 || x === b.x1) && (z === b.z0 || z === b.z1);

const onWall = (b: Building, x: number, z: number) =>
  within(x, z, b.x0, b.z0, b.x1, b.z1) && (x === b.x0 || x === b.x1 || z === b.z0 || z === b.z1);

/** Wall boards in three shades, mottled by a hash so no two courses match. */
function board(b: Building, x: number, z: number, k: number) {
  const roll = hash(x, z, k, b.x0);
  return roll < 0.22 ? 'b' : roll < 0.34 ? 'c' : 'a';
}

const legendOf = (b: Building): Record<string, readonly [RunKind, number]> => ({
  a: [b.kind, b.boards[0]],
  b: [b.kind, b.boards[1]],
  c: [b.kind, b.boards[2]],
  l: ['brick', b.boards[2]],
  t: ['brick', b.trim],
});

/** Rows of the plan for the ground-storey and upper wall course `k` of a building. */
const wallRows = (b: Building, k: number) =>
  plan((x, z) =>
    !onWall(b, x, z) || isOpen(b, x, z, k) || isHost(b, x, z, k)
      ? ' '
      : isLintel(b, x, z, k)
        ? 'l'
        : isSill(b, x, z, k)
          ? 't'
          : isCorner(b, x, z) && k % 2 === 0
            ? 'c'
            : board(b, x, z, k),
  );

// Posts under each veranda, at the boardwalk's front edge.
const POSTS: Readonly<Record<string, readonly number[]>> = {
  sheriff: [3, 13],
  saloon: [17, 20, 27, 30],
  store: [33, 36, 42],
};
// Open studs kept on the boardwalk deck, where posts and props stand (x,z cells).
const bare = new Set<string>();
const reserve = (x: number, z: number, width = 1, depth = 1) => {
  for (let dx = 0; dx < width; dx++)
    for (let dz = 0; dz < depth; dz++) bare.add(`${x + dx},${z + dz}`);
};
for (const xs of Object.values(POSTS)) for (const x of xs) reserve(x, 26);
const DECK_BARRELS: readonly (readonly [number, number])[] = [
  [2, 24],
  [16, 24],
  [34, 24],
];
const DECK_CRATES: readonly (readonly [number, number])[] = [[36, 24]];
for (const [x, z] of [...DECK_BARRELS, ...DECK_CRATES]) reserve(x, z, 2, 2);
for (const x of [12, 13]) reserve(x, 25);

/**
 * Side-stud bricks set in the front wall, as [column, course]: wanted posters on the sheriff's
 * solid wall, shutters beside the windows. The wall leaves each cell open for its host.
 */
const HOSTS: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
  sheriff: [
    [12, 3],
    [13, 4],
    [7, 3],
  ],
  saloon: [
    [20, 3],
    [27, 3],
    [20, 9],
    [27, 9],
  ],
  store: [[36, 3]],
};
const isHost = (b: Building, x: number, z: number, k: number) =>
  z === b.z1 && (HOSTS[b.name] ?? []).some(([hx, hk]) => hx === x && hk === k);

const FRONT_LEGEND = (b: Building): Record<string, readonly [RunKind, number]> => ({
  ...legendOf(b),
  w: ['brick', WHITE],
  k: ['brick', BLACK],
  y: ['brick', 14],
  d: ['brick', DARK_RED],
});

/** The brick of a false front at column x, `j` courses above the eaves: boards or the sign. */
function frontChar(b: Building, x: number, j: number) {
  if (b === SHERIFF && x >= 6 && x <= 11 && j >= 2 && j <= 4)
    return (j === 3 && x >= 7 && x <= 10) || (j !== 3 && x >= 8 && x <= 9) ? 'y' : 'w';
  if (b === SALOON && x >= 20 && x <= 27 && j >= 4 && j <= 7) {
    if (j === 4 || j === 7 || x === 20 || x === 27) return 'y';
    return hash(x, j, 77) < 0.55 ? 'k' : 'w';
  }
  if (b === STORE && x >= 34 && x <= 41 && j >= 2 && j <= 3)
    return hash(x, j, 78) < 0.5 ? 'w' : 'd';
  return board(b, x, b.z1, 50 + j);
}

const TWO_WIDE: readonly (readonly [number, string])[] = [
  [12, '2445'],
  [8, '3034'],
  [6, '3795'],
  [4, '3020'],
  [3, '3021'],
  [2, '3022'],
];
/** A cap of two-stud plates along x over `length` studs, the wall under its first row. */
function addCap(
  add: ExampleBrickAdder,
  x: number,
  length: number,
  y: number,
  z: number,
  color: number,
) {
  let offset = 0;
  while (offset < length) {
    const hit = TWO_WIDE.find(([size]) => size <= length - offset);
    if (!hit) {
      add('3023b', color, x + offset, y, z, 0);
      offset++;
    } else {
      add(hit[1], color, x + offset, y, z, hit[0] === 2 ? 0 : 90);
      offset += hit[0];
    }
  }
}

// Open studs kept on the ground, where posts, props and plants stand (x,z cells).
const gbare = new Set<string>();
const greserve = (x: number, z: number, width = 1, depth = 1) => {
  for (let dx = 0; dx < width; dx++)
    for (let dz = 0; dz < depth; dz++) gbare.add(`${x + dx},${z + dz}`);
};
// Hitching rails along the front of the boardwalks: two posts and a rail each.
const RAILS: readonly (readonly [number, number])[] = [
  [5, 8],
  [17, 20],
  [27, 30],
  [40, 43],
];
for (const [a, b] of RAILS) {
  greserve(a, 29);
  greserve(b, 29);
}
// A water trough in front of the store, a lamp at each end of the street.
const TROUGH = { x: 34, z: 30, width: 5, depth: 3 };
greserve(TROUGH.x, TROUGH.z, TROUGH.width, TROUGH.depth);
const LAMPS: readonly (readonly [number, number])[] = [
  [34, 28],
  [2, 28],
];
for (const [x, z] of LAMPS) greserve(x, z, 2, 2);
const BARRELS: readonly (readonly [number, number])[] = [[9, 30]];
for (const [x, z] of BARRELS) greserve(x, z, 2, 2);
const CACTI: readonly (readonly [number, number, number])[] = [
  [6, 39, 6],
  [13, 39, 4],
  [35, 39, 7],
  [38, 35, 5],
  [3, 33, 4],
];
for (const [x, z] of CACTI) greserve(x - 1, z - 1, 4, 3);
const DEAD_TREE = [41, 39] as const;
greserve(DEAD_TREE[0] - 1, DEAD_TREE[1] - 1, 4, 3);
const TOWER = { x: 22, z: 6 };
greserve(TOWER.x, TOWER.z, 4, 4);

/**
 * The mountain: two peaks of grey rock, in vertical strata. Each column of the plan stands as
 * many courses high as its height, which varies from cell to cell, so the face shows ridges.
 */
const PEAKS: readonly (readonly [number, number, number, number, number])[] = [
  // x, z, reach in x, reach in z, height in courses
  [39, 5, 7.2, 5.6, 30],
  [31.5, 6, 6.2, 5.2, 23],
];
function mountainHeight(x: number, z: number) {
  let height = 0;
  if (!within(x, z, MESA.x0, MESA.z0, MESA.x1, MESA.z1)) return 0;
  for (const [px, pz, rx, rz, top] of PEAKS) {
    const d = Math.hypot((x + 0.5 - px) / rx, (z + 0.5 - pz) / rz);
    if (d < 1) height = Math.max(height, top * (1 - d ** 2) ** 0.6);
  }
  // The face round the mine mouth stands high enough to carry its beam.
  if (within(x, z, MINE.x0 - 1, MINE.z0, MINE.x1 + 1, MINE.z1))
    return Math.max(height, MINE.courses + 3);
  if (height < 1) return 0;
  // Each column differs a little, which makes the vertical streaks.
  return Math.max(1, Math.round(height + (hash(x, z, 17) - 0.45) * 4));
}
/** Where the mine goes into the rock: a mouth five courses high, four studs wide. */
const MINE = { x0: 30, x1: 33, z0: 9, z1: 11, courses: 5 };
const inMouth = (x: number, z: number) => within(x, z, MINE.x0, MINE.z0, MINE.x1, MINE.z1);

const SCRUB: readonly (readonly [number, number])[] = [
  [9, 39],
  [19, 39],
  [31, 39],
];
for (const [x, z] of SCRUB) greserve(x, z, 2, 2);
/** Boulders: bands of stacked, narrowing courses at the mesa's foot and the corners of the base. */
const ROCKS: readonly (readonly [number, number, number, number, number, number])[] = [
  [26, 39, 4, 2, NOUGAT, SAND],
];
for (const [x, z, w, d] of ROCKS) greserve(x, z, w, d);

// Horses, each with a saddle on the studs of its back: two stand at the hitching rails, side on, and a
// rider comes down the street head on. x, z and the turn are the horse's; a horse is two studs
// wide and ten long, and faces -z at turn 0.
const HORSES: readonly (readonly [number, number, Rotation, number, boolean])[] = [
  [12, 31, 90, TIMBER, false],
  [24, 31, 270, WHITE, false],
  [22, 32, 180, DARK_TIMBER, true],
];
/** Where the saddle clips on, from the horse's corner, for each way the horse faces. */
const SADDLE: Readonly<Record<Rotation, readonly [number, number]>> = {
  0: [-1, 4],
  90: [4, -1],
  180: [-1, 4],
  270: [4, -1],
};

interface Cowboy {
  /** The torso's corner, and the plan's y of the stand. */
  x: number;
  z: number;
  legs: number;
  shirt: number;
  /** A hat colour, or a bob of hair for the saloon girl. */
  hat: number;
  bob?: true;
}
// Figures facing the street (+z in the plan), with their feet on open studs: two cowboys in the
// street, the sheriff on his boardwalk and a girl on the saloon's balcony.
const COWBOYS: readonly Cowboy[] = [
  { x: 16, z: 36, legs: 272, shirt: 4, hat: TIMBER },
  { x: 41, z: 33, legs: 308, shirt: 14, hat: BLACK },
];
for (const c of COWBOYS) greserve(c.x + 1, c.z, 2, 2);
const SHERIFF_FIGURE: Cowboy = { x: 4, z: 25, legs: 272, shirt: 15, hat: SAND };
reserve(SHERIFF_FIGURE.x + 1, SHERIFF_FIGURE.z, 2, 2);
const SALOON_GIRL: Cowboy = { x: 22, z: 25, legs: DARK_RED, shirt: 4, hat: DARK_TIMBER, bob: true };

export const westernTown: ExampleDefinition = {
  id: 'western-town',
  name: 'Western Main Street',
  tags: ['western', 'desert', 'saloon', 'sheriff', 'general-store', 'boardwalk', 'mesa', 'street'],
  expectedPieceCount: 3265,
  buildArea: SIZE,
  brickIdPrefix: 'western',
  smooth: [{ only: (brick) => NATURAL.has(naturalKey(brick)) }],
  build(drawnAdd) {
    NATURAL.clear();
    const order = bottomUp(drawnAdd);
    let tagging = false;
    const front = reflectToFront((partId, color, x, y, z, rotation, facing, upsideDown) => {
      if (tagging) NATURAL.add(naturalKey({ partId, x, y, z }));
      order.add(partId, color, x, y, z, rotation, facing, upsideDown);
    }, SIZE);
    const plain = glazeWindows(front);
    const add: ExampleBrickAdder = (partId, color, x, y, z, rotation = 0, facing, upsideDown) =>
      plain(partId, color, x, y, z, rotation, facing, upsideDown);
    /** Adds a piece the smoothing pass may finish. */
    const natural: ExampleBrickAdder = (...piece) => {
      tagging = true;
      add(...piece);
      tagging = false;
    };

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

    // ---- The base: sandstone strata, a ledge, then the sand, hardpan and red earth.
    addAreaMap(
      natural,
      plan((x, z) => (inLayer(x, z, 0) ? 'r' : ' ')),
      0,
      { r: ['plate', TIMBER] },
    );
    addAreaMap(
      natural,
      plan((x, z) => {
        if (!inLayer(x, z, 1)) return ' ';
        if (!onEdge(x, z, 1)) return 'i';
        const roll = hash(Math.floor(x / 2), Math.floor(z / 2), 11);
        return roll < 0.35 ? 'o' : roll < 0.65 ? 'n' : roll < 0.85 ? 'r' : 't';
      }),
      1,
      {
        i: ['brick', TIMBER],
        o: ['brick', ORANGE_ROCK],
        n: ['brick', NOUGAT],
        r: ['brick', TIMBER],
        t: ['brick', SAND],
      },
    );
    const ground = plan((x, z) => {
      if (!inLayer(x, z, 2)) return ' ';
      const kept = gbare.has(`${x},${z}`);
      if (street(x, z)) {
        if (kept) return 'q';
        if (Math.abs(z - Math.round(streetMiddle(x))) === 2 && hash(Math.floor(x / 4), z, 6) < 0.7)
          return 'R';
        return hash(Math.floor(x / 5), Math.floor(z / 4), 3) < 0.18 ? 'T' : 'S';
      }
      if (onEdge(x, z, 2)) return hash(Math.floor(x / 3), Math.floor(z / 3), 5) < 0.5 ? 'e' : 's';
      if (within(x, z, MESA.x0 - 3, MESA.z0 - 2, MESA.x1 + 3, MESA.z1 + 4)) return 'n';
      if (z >= RAIL.z0 && z <= RAIL.z1) return 's';
      if (hash(Math.floor(x / 5), Math.floor(z / 5), 9) < 0.16) return 'n';
      if (hash(Math.floor(x / 4), Math.floor(z / 4), 4) < 0.22 && !within(x, z, 2, 12, 45, 28))
        return kept ? 'q' : 'h';
      return 's';
    });
    addAreaMap(add, ground, 4, {
      s: ['plate', SAND],
      e: ['plate', HARDPAN],
      n: ['plate', NOUGAT],
      q: ['plate', HARDPAN],
      S: ['tile', HARDPAN],
      T: ['tile', SAND],
      R: ['tile', TIMBER],
      h: ['tile', HARDPAN],
    });

    // The mountain, a course at a time. Over the mine mouth a timber beam spans the opening.
    const top = Math.max(
      ...Array.from({ length: SIZE * SIZE }, (_, i) =>
        mountainHeight(i % SIZE, Math.floor(i / SIZE)),
      ),
    );
    for (let layer = 0; layer < top; layer++)
      addAreaMap(
        natural,
        plan((x, z) => {
          if (mountainHeight(x, z) <= layer) return ' ';
          if (layer < MINE.courses && inMouth(x, z)) return ' ';
          if (layer === MINE.courses && within(x, z, MINE.x0 - 1, MINE.z0, MINE.x1 + 1, MINE.z1))
            return ' ';
          if (layer < MINE.courses && x >= MINE.x0 && x <= MINE.x1 && z === MINE.z0 - 1) return 'd';
          const roll = hash(Math.floor(x / 2), Math.floor((z + 1) / 2), 77);
          return roll < 0.3 ? 'b' : roll < 0.4 ? 'c' : 'a';
        }),
        G + layer * 3,
        {
          a: ['brick', STONE],
          b: ['brick', DARK_STONE],
          c: ['brick', 151],
          d: ['brick', BLACK],
        },
      );
    for (let z = MINE.z0; z <= MINE.z1; z++)
      addRun(add, 'brick', DARK_TIMBER, 'x', MINE.x0 - 1, G + MINE.courses * 3, z, 6);
    for (const x of [MINE.x0, MINE.x1]) add('2453b', DARK_TIMBER, x, G, MINE.z1);

    // A ladder track from the mine mouth down the alley to the street, and an ore cart.
    for (let z = MINE.z1 + 1; z <= 28; z++)
      if (z < 14 || z > 15) add('3069b', z % 2 ? TIMBER : DARK_STONE, 31, G, z, 90);
    add('3022', TIMBER, 31, G, 14);
    add('3003', BLACK, 31, G + 1, 14);
    for (const [x, z] of [
      [31, 14],
      [32, 15],
      [31, 15],
    ])
      add('3062b', hash(x, z, 5) < 0.5 ? DARK_STONE : BLACK, x, G + 4, z);

    // ---- The buildings.
    for (const b of BUILDINGS) {
      // Foundation ring and the wall courses.
      addRowMap(
        add,
        plan((x, z) => (onWall(b, x, z) ? 'f' : ' ')),
        G,
        { f: ['plate', DARK_STONE] },
      );
      const courses = wallCourses(b);
      for (let k = 0; k < courses; k++) {
        if (k === b.ground && b.upper > 0)
          addRowMap(
            add,
            plan((x, z) => (onWall(b, x, z) ? 'f' : ' ')),
            courseY(b, k) - 1,
            { f: ['plate', b.trim] },
          );
        addBondedMap(add, wallRows(b, k), courseY(b, k), legendOf(b), k);
      }
      // The wall plate under the eaves.
      addRowMap(
        add,
        plan((x, z) => (onWall(b, x, z) ? 'f' : ' ')),
        eavesY(b),
        { f: ['plate', DARK_TIMBER] },
      );
    }

    // ---- Windows and doors.
    for (const b of BUILDINGS)
      for (const o of b.openings) {
        const y = courseY(b, o.from);
        const alongX = o.side === 'front' || o.side === 'back';
        const z = o.side === 'front' ? b.z1 : o.side === 'back' ? b.z0 : o.at;
        const x = o.side === 'left' ? b.x0 : o.side === 'right' ? b.x1 : o.at;
        if (o.kind === 'window') {
          const height = o.to - o.from + 1;
          const part = o.width === 4 ? '60594' : height === 3 ? '60593' : '60592';
          for (let s = 0; s < o.width; s += o.width === 4 ? 4 : 2)
            add(part, b.trim, alongX ? x + s : x, y, alongX ? z : z + s, alongX ? 90 : 0);
        } else {
          addDoor(
            { partId: '60596', color: DARK_TIMBER, x, y, z, rotation: alongX ? 90 : 0 },
            '60623',
            TIMBER,
          );
        }
      }

    // ---- False fronts: the front wall climbs past the roof in steps, with a sign panel.
    for (const b of BUILDINGS) {
      const top = Math.max(...b.front);
      for (let j = 0; j < top; j++) {
        const row = plan((x, z) => {
          const h = b.front[x - b.x0];
          if (z !== b.z1 || h === undefined || j >= h) return ' ';
          return frontChar(b, x, j);
        });
        addBondedMap(add, row, eavesY(b) + 1 + j * 3, FRONT_LEGEND(b), j);
      }
      // A cap of two-stud plates over each step, hanging a stud over the front.
      let i = 0;
      while (i < b.front.length) {
        let end = i;
        while (end + 1 < b.front.length && b.front[end + 1] === b.front[i]) end++;
        const y = eavesY(b) + 1 + b.front[i] * 3;
        addCap(add, b.x0 + i, end - i + 1, y, b.z1, DARK_TIMBER);
        // Finials at the corners of the tallest steps.
        if (b.front[i] === top) {
          if (end - i > 1) add('4589', DARK_TIMBER, b.x0 + i, y + 1, b.z1);
          add('4589', DARK_TIMBER, b.x0 + end, y + 1, b.z1);
        }
        i = end + 1;
      }
    }
    // A flag on the saloon's pediment.
    {
      const y = eavesY(SALOON) + 1 + 11 * 3 + 1;
      add('3957a', 0, 23, y, SALOON.z1);
      add('44676a', 4, 23, y + 6, SALOON.z1, 90);
    }

    // ---- Boardwalks: a raised platform of planks, posts under its front edge and a deck of
    // tiles with open studs where props stand.
    for (const [index, b] of BUILDINGS.entries()) {
      const [x0, x1] = WALKS[b.name];
      const planks = plan((x, z) =>
        z >= 24 && z <= 26 && x >= x0 && x <= x1
          ? z === 26 && (x - x0) % 4 === 1
            ? ' '
            : hash(Math.floor(x / 2), z, 33 + index) < 0.3
              ? 'b'
              : 'a'
          : ' ',
      );
      addRowMap(add, planks, G, { a: ['brick', TIMBER], b: ['brick', DARK_TIMBER] });
      for (let x = x0 + 1; x <= x1; x += 4) add('3062b', DARK_TIMBER, x, G, 26);
      const deck = plan((x, z) => {
        if (z < 24 || z > 26 || x < x0 || x > x1) return ' ';
        if (bare.has(`${x},${z}`)) return 'p';
        const roll = hash(Math.floor((x + z * 2) / 3), z, 35 + index);
        return roll < 0.3 ? 'b' : roll < 0.45 ? 'c' : 'a';
      });
      addRowMap(add, deck, G + 3, {
        a: ['tile', TIMBER],
        b: ['tile', DARK_TIMBER],
        c: ['tile', NOUGAT],
        p: ['plate', TIMBER],
      });
    }

    // ---- Verandas: posts carry a roof over the boardwalk; on the saloon it is the balcony.
    const ROOF_Y = G + 22;
    for (const [index, b] of BUILDINGS.entries()) {
      const [x0, x1] = WALKS[b.name];
      for (const x of POSTS[b.name]) {
        const post = index === 1 ? WHITE : DARK_TIMBER;
        add('2453b', post, x, G + 4, 26);
        add('3005', post, x, G + 19, 26);
      }
      addAreaMap(
        add,
        plan((x, z) => (z >= 24 && z <= 27 && x >= x0 && x <= x1 ? 'p' : ' ')),
        ROOF_Y,
        { p: ['plate', DARK_TIMBER] },
        (x, z) => z === 26 && POSTS[b.name].includes(x),
      );
      if (b === SALOON) {
        for (let x = x0; x < x1; x += 4) add('30055', WHITE, x, ROOF_Y + 1, 27, 90);
        add('30055', WHITE, x0, ROOF_Y + 1, 23);
        add('30055', WHITE, x1, ROOF_Y + 1, 24);
        // Window boxes of red and pink blooms under the upper windows, and a lantern at each end.
        for (const x of [18, 28]) {
          add('3004', DARK_RED, x, ROOF_Y + 1, 24, 90);
          for (const dx of [0, 1]) {
            add('6141', 2, x + dx, ROOF_Y + 4, 24);
            add('98138', (x + dx) % 2 ? 13 : 4, x + dx, ROOF_Y + 5, 24);
          }
        }
        for (const x of [17, 29]) {
          add('3062b', 46, x, ROOF_Y + 1, 26);
          add('4589', BLACK, x, ROOF_Y + 4, 26);
        }
      } else {
        // A sloping awning, in stripes on the store.
        for (let x = x0; x < x1; x += 2) {
          const stripe = b === STORE ? (x - x0) % 4 === 0 : (x - x0) % 8 < 4;
          add(
            '3298',
            b === STORE ? (stripe ? 4 : WHITE) : stripe ? DARK_TIMBER : TIMBER,
            x,
            ROOF_Y + 1,
            24,
            180,
          );
        }
      }
    }

    // ---- Flat roofs behind the false fronts: tar plates on the wall plate, a low parapet round
    // the sides and back, a tile cap, and a chimney or a water barrel on top.
    for (const b of BUILDINGS) {
      const y = eavesY(b) + 1;
      // One plate run along x per row, so every run ends on the wall below.
      for (let z = b.z0; z < b.z1; z++)
        addRun(
          add,
          'plate',
          hash(z, 91, b.x0) < 0.25 ? b.roof[1] : b.roof[0],
          'x',
          b.x0,
          y,
          z,
          b.x1 - b.x0 + 1,
        );
      const parapet = plan((x, z) =>
        within(x, z, b.x0, b.z0, b.x1, b.z1 - 1) && onWall(b, x, z) ? board(b, x, z, 60) : ' ',
      );
      addBondedMap(add, parapet, y + 1, legendOf(b), 0);
      addRowMap(
        add,
        plan((x, z) => (within(x, z, b.x0, b.z0, b.x1, b.z1 - 1) && onWall(b, x, z) ? 'c' : ' ')),
        y + 4,
        { c: ['tile', DARK_TIMBER] },
      );
    }
    {
      // Chimneys of stacked stone, and the saloon's water barrel on a plank stand.
      const stack = (x: number, z: number, y: number, height: number) => {
        for (let i = 0; i < height; i++) add('3003', i % 2 ? DARK_STONE : 71, x, y + i * 3, z);
        add('3022', BLACK, x, y + height * 3, z);
      };
      stack(SHERIFF.x1 - 3, SHERIFF.z0 + 2, eavesY(SHERIFF) + 2, 3);
      stack(SALOON.x0 + 2, SALOON.z0 + 2, eavesY(SALOON) + 2, 4);
      const [bx, bz, by] = [SALOON.x1 - 4, SALOON.z0 + 3, eavesY(SALOON) + 2];
      add('3003', DARK_TIMBER, bx, by, bz);
      add('3941', TIMBER, bx, by + 3, bz);
      add('3941', DARK_TIMBER, bx, by + 6, bz);
      add('3942c', DARK_STONE, bx, by + 9, bz);
    }

    // ---- Props on the boardwalks and in the street.
    const barrel = (x: number, y: number, z: number, color: number) => {
      add('3941', color, x, y, z);
      add('3941', color === TIMBER ? DARK_TIMBER : TIMBER, x, y + 3, z);
      add('14769', DARK_TIMBER, x, y + 6, z);
    };
    DECK_BARRELS.forEach(([x, z], i) => barrel(x, G + 4, z, i % 2 ? DARK_TIMBER : TIMBER));
    BARRELS.forEach(([x, z], i) => barrel(x, G, z, i % 2 ? TIMBER : DARK_TIMBER));
    for (const [x, z] of DECK_CRATES) {
      add('3003', NOUGAT, x, G + 4, z);
      add('3068b', TIMBER, x, G + 7, z);
    }
    // A bench by the sheriff's door.
    for (const x of [12, 13]) add('3005', DARK_TIMBER, x, G + 4, 25);
    add('3069b', TIMBER, 12, G + 7, 25, 90);

    // Hitching rails: two posts and a rail.
    for (const [a, b] of RAILS) {
      for (const x of [a, b]) for (const y of [G, G + 3]) add('3062b', DARK_TIMBER, x, y, 29);
      add('3710', TIMBER, a, G + 6, 29, 90);
    }
    // A water trough: a timber ring with the water low inside.
    addRing(add, 'brick', TIMBER, TROUGH.x, TROUGH.z, TROUGH.width, TROUGH.depth, G, 0);
    add('3623', 73, TROUGH.x + 1, G, TROUGH.z + 1, 90);
    // Street lamps.
    for (const [x, z] of LAMPS) add('2039', BLACK, x, G, z);

    // A wagon with a load of barrels and sacks, parked along the street.
    {
      const [ax, z0] = [8, 33];
      for (const x of [ax, ax + 6]) {
        for (const z of [z0, z0 + 3]) add('4624c01', BLACK, x, G, z, 90);
        add('4600', DARK_TIMBER, x, G + 2, z0, 90);
        add('3003', DARK_TIMBER, x, G + 3, z0 + 1);
      }
      add('3035', TIMBER, ax, G + 6, z0, 90);
      addRing(add, 'brick', DARK_TIMBER, ax, z0, 8, 4, G + 7, 0, (x) => x >= ax + 6);
      barrel(ax + 1, G + 7, z0 + 1, TIMBER);
      add('3003', NOUGAT, ax + 3, G + 7, z0 + 1);
      for (const z of [z0 + 1, z0 + 2]) add('3062b', SAND, ax + 5, G + 7, z);
      add('3003', TIMBER, ax + 6, G + 7, z0 + 1);
      add('3068b', DARK_TIMBER, ax + 6, G + 10, z0 + 1);
    }

    // Cacti and a dead tree: round bricks with arms on rounded plates.
    const plant = (
      x: number,
      z: number,
      bricks: number,
      arms: readonly { at: number; dx: number; dz: number; up: number }[],
      colors: readonly [number, number],
      bloom?: number,
    ) => {
      let y = G;
      for (let i = 0; i < bricks; i++) {
        const arm = arms.find((candidate) => candidate.at === i);
        if (arm) {
          add(
            '35480',
            colors[0],
            arm.dx < 0 ? x - 1 : x,
            y,
            arm.dz < 0 ? z - 1 : z,
            arm.dx !== 0 ? 0 : 90,
          );
          for (let k = 0; k < arm.up; k++)
            add('3062b', colors[(k + i) % 2], x + arm.dx, y + 1 + k * 3, z + arm.dz);
          add('6141', colors[1], x + arm.dx, y + 1 + arm.up * 3, z + arm.dz);
          y++;
        }
        add('3062b', colors[hash(x, z, i) < 0.4 ? 1 : 0], x, y, z);
        y += 3;
      }
      add('6141', colors[0], x, y, z);
      if (bloom !== undefined) add('98138', bloom, x, y + 1, z);
    };
    for (const [x, z, h] of CACTI)
      plant(
        x,
        z,
        h,
        h >= 6
          ? [
              { at: 2, dx: 1, dz: 0, up: 2 },
              { at: 3, dx: -1, dz: 0, up: 2 },
            ]
          : [{ at: 2, dx: hash(x, z, 8) < 0.5 ? 1 : -1, dz: 0, up: 1 }],
        [2, 330],
        hash(x, z, 9) < 0.5 ? 14 : 13,
      );
    plant(
      DEAD_TREE[0],
      DEAD_TREE[1],
      9,
      [
        { at: 3, dx: 1, dz: 0, up: 2 },
        { at: 5, dx: -1, dz: 0, up: 2 },
        { at: 7, dx: 0, dz: 1, up: 1 },
      ],
      [DARK_TIMBER, TIMBER],
    );
    // Dry scrub in tufts.
    for (const [x, z] of SCRUB) {
      add('18674', 330, x, G, z);
      add('4727', hash(x, z, 3) < 0.5 ? 330 : 378, x, G + 1, z);
    }

    // Boulders: staggered courses, narrowing, in two shades.
    for (const [cx, cz, w, d, first, second] of ROCKS)
      for (let layer = 0; layer < 3; layer++) {
        const [rx, rz] = [w / 2 - layer * 0.9, d / 2 - layer * 0.8];
        if (rx < 0.7 || rz < 0.6) break;
        addAreaMap(
          natural,
          plan((x, z) =>
            ((x + 0.5 - cx - w / 2) / rx) ** 2 + ((z + 0.5 - cz - d / 2) / rz) ** 2 <= 1.15
              ? hash(x, z, layer, 5) < 0.4
                ? 'b'
                : 'a'
              : ' ',
          ),
          G + layer * 3,
          { a: ['brick', first], b: ['brick', second] },
        );
      }

    // A water tank on a timber trestle behind the saloon.
    {
      const { x, z } = TOWER;
      for (const [dx, dz] of [
        [0, 0],
        [3, 0],
        [0, 3],
        [3, 3],
      ])
        add('2453b', DARK_TIMBER, x + dx, G, z + dz);
      add('3031', TIMBER, x, G + 15, z);
      [TIMBER, TIMBER, DARK_TIMBER].forEach((color, i) =>
        add('87081', color, x, G + 16 + i * 3, z),
      );
      add('3943b', DARK_STONE, x, G + 25, z);
    }

    // ---- Interiors, seen through the windows: a plank floor on a hidden fill, with furniture
    // standing on the open studs kept for it.
    const furnish = (b: Building, kept: Set<string>) => {
      const inside = (x: number, z: number) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1;
      addAreaMap(
        add,
        plan((x, z) => (inside(x, z) ? 'f' : ' ')),
        G,
        { f: ['brick', DARK_TIMBER] },
      );
      addAreaMap(
        add,
        plan((x, z) => {
          if (!inside(x, z)) return ' ';
          if (kept.has(`${x},${z}`)) return 'p';
          const roll = hash(Math.floor(x / 2), z, 61 + b.x0);
          return roll < 0.3 ? 'b' : roll < 0.5 ? 'c' : 'a';
        }),
        G + 3,
        {
          a: ['tile', TIMBER],
          b: ['tile', DARK_TIMBER],
          c: ['tile', NOUGAT],
          p: ['plate', TIMBER],
        },
      );
    };
    {
      const Y = G + 4;
      const kept = new Set<string>();
      const keep = (x: number, z: number, width = 1, depth = 1) => {
        for (let dx = 0; dx < width; dx++)
          for (let dz = 0; dz < depth; dz++) kept.add(`${x + dx},${z + dz}`);
      };
      keep(18, 15, 1, 6);
      keep(20, 15, 1, 6);
      const tables: readonly (readonly [number, number])[] = [
        [23, 17],
        [26, 17],
      ];
      const stools: readonly (readonly [number, number])[] = [
        [22, 17],
        [23, 19],
        [24, 16],
        [28, 18],
        [26, 19],
        [27, 16],
      ];
      for (const [x, z] of tables) keep(x, z, 2, 2);
      for (const [x, z] of stools) keep(x, z);
      furnish(SALOON, kept);
      // The bar: a counter with a tile top, and a back bar with a row of bottles.
      for (const z of [15, 18]) {
        add('3622', DARK_TIMBER, 18, Y, z, 0);
        add('3622', TIMBER, 20, Y, z, 0);
        add('63864', NOUGAT, 20, Y + 3, z, 0);
      }
      [2, 14, 4, 2, 6, 14].forEach((color, i) => add('3062b', color, 18, Y + 3, 15 + i));
      for (const [x, z] of tables) {
        add('3941', TIMBER, x, Y, z);
        add('4032a', NOUGAT, x, Y + 3, z);
      }
      for (const [x, z] of stools) {
        add('3062b', DARK_TIMBER, x, Y, z);
        add('6141', 4, x, Y + 3, z);
      }
    }

    // The sheriff's office: a desk and chair by the window, and a cell with a cot at the back.
    {
      const Y = G + 4;
      const kept = new Set<string>();
      const keep = (x: number, z: number, width = 1, depth = 1) => {
        for (let dx = 0; dx < width; dx++)
          for (let dz = 0; dz < depth; dz++) kept.add(`${x + dx},${z + dz}`);
      };
      keep(5, 20, 3, 2);
      keep(6, 19, 2, 1);
      keep(9, 14, 1, 4);
      keep(9, 18, 4, 1);
      keep(11, 14, 2, 4);
      furnish(SHERIFF, kept);
      for (const z of [20, 21]) {
        add('3622', TIMBER, 5, Y, z, 90);
        add('63864', DARK_TIMBER, 5, Y + 3, z, 90);
      }
      add('3062b', DARK_TIMBER, 6, Y, 19);
      add('6141', 4, 6, Y + 3, 19);
      add('3062b', 46, 7, Y, 19);
      add('4589', BLACK, 7, Y + 3, 19);
      add('3633', DARK_STONE, 9, Y, 14, 0);
      add('3633', DARK_STONE, 9, Y, 18, 90);
      add('3020', 272, 11, Y, 14);
      add('3023b', WHITE, 12, Y + 1, 14);
    }

    // The general store: a counter, shelves of goods along the back wall, crates and sacks.
    {
      const Y = G + 4;
      const kept = new Set<string>();
      const keep = (x: number, z: number, width = 1, depth = 1) => {
        for (let dx = 0; dx < width; dx++)
          for (let dz = 0; dz < depth; dz++) kept.add(`${x + dx},${z + dz}`);
      };
      keep(35, 18, 6, 1);
      keep(34, 14, 8, 1);
      keep(40, 20, 2, 2);
      keep(34, 21, 2, 1);
      furnish(STORE, kept);
      add('3009', TIMBER, 35, Y, 18, 90);
      add('6636', NOUGAT, 35, Y + 3, 18, 90);
      for (const x of [34, 38]) add('3010', DARK_TIMBER, x, Y, 14, 90);
      [4, 14, 2, 15, 6, 4, 25, 14].forEach((color, i) => add('3062b', color, 34 + i, Y + 3, 14));
      add('3003', NOUGAT, 40, Y, 20);
      add('3068b', TIMBER, 40, Y + 3, 20);
      for (const x of [34, 35]) add('3062b', SAND, x, Y, 21);
    }

    // ---- The railway: sleepers across, two steel rails along, on a strip of sand.
    for (let x = 0; x < SIZE; x += 2) add('3710', TIMBER, x, G, RAIL.z0, 0);
    for (const z of [RAIL.z0 + 1, RAIL.z0 + 3]) {
      addRun(add, 'plate', DARK_STONE, 'x', 0, G + 1, z, SIZE);
    }

    // ---- Horses with saddles, and cowboys: a standing figure is legs, torso, head and a hat,
    // all turned to face the street; the rider's feet stand on the saddle's studs, the saddle on the horse's.
    const figure = (c: Cowboy, y: number) => {
      const lift = 5;
      add('3815c01', c.legs, c.x + 1, y, c.z, 180);
      add('76382p00', c.shirt, c.x, y + lift, c.z, 180);
      add('3626bp01', 14, c.x + 1, y + lift + 4, c.z - 0.5, 180);
      if (c.bob) add('29633', c.hat, c.x + 1, y + lift + 7, c.z - 0.5, 180);
      else add('13565', c.hat, c.x + 0.5, y + lift + 7, c.z - 1, 180);
    };
    for (const [x, z, turn, coat, rider] of HORSES) {
      add('4493c01', coat, x, G, z, turn);
      const [dx, dz] = SADDLE[turn];
      add('4491b', 4, x + dx, G + 7, z + dz, turn);
      if (rider) figure({ x: x - 1, z: z + 5, legs: 272, shirt: DARK_RED, hat: TIMBER }, G + 8);
    }
    for (const c of COWBOYS) figure(c, G);
    figure(SHERIFF_FIGURE, G + 4);
    figure(SALOON_GIRL, G + 23);

    // ---- Side-stud details: a host brick in the wall, then a poster or a shutter on its stud.
    const mount = (host: Piece, partId: string, color: number, facing: Facing) => {
      const seated = seatOnSideStuds(
        { id: 'mount', partId, color, x: host.x, y: host.y, z: host.z, rotation: 0, facing },
        { id: 'host', ...host },
      );
      if (!seated) throw new Error(`Nothing to mount ${partId} on.`);
      add(partId, color, seated.x, seated.y, seated.z, seated.rotation, seated.facing);
    };
    /** A side-stud brick whose stud faces `facing`, at a wall cell. */
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
    for (const b of BUILDINGS)
      for (const [x, k] of HOSTS[b.name]) {
        const poster = b === SHERIFF && x >= 12;
        const host = sideStud(x, courseY(b, k), b.z1, '+z', b.boards[0]);
        mount(
          host,
          poster ? '3070b' : '3069b',
          poster ? WHITE : b === STORE ? DARK_RED : 288,
          '+z',
        );
      }

    order.flush();
  },
};
