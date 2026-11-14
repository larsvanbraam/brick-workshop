import { footprint, getConnectionSites, isMatchingInsertFrame, seatOnSideStuds } from '../core.ts';
import type { Brick, Facing, Rotation } from '../core.ts';
import {
  addAreaMap,
  addBondedMap,
  addRowMap,
  addRun,
  bottomUp,
  glazeWindows,
  turnAround,
} from './layout.ts';
import type { RunKind } from './layout.ts';
import { addTree } from './trees.ts';
import type { Box as TreeBox } from './trees.ts';
import type { ExampleBrickAdder, ExampleDefinition } from './types.ts';

// A walled castle on a landscaped island, after the fan-built castles on rocky bases. Four
// round corner towers with dark cones stand at the corners of a crenellated curtain wall on a
// battered plinth, buttressed along the back and sides; a gatehouse with corbelled towers, a
// portcullis and a drawbridge crosses a moat that spills off the island's edge as a waterfall.
// The keep with its two corbelled, red-roofed towers stands against the back wall, a timbered
// house and an arcaded hall either side of a courtyard with a market stall, a well and trees.
//
// The castle is planned on a 64-stud grid with the gate at high z, set OFF studs in on
// an AREA-stud board and turned round so the gate faces the default camera. Plan coordinates
// run from -OFF to AREA - OFF, so the island round the castle has negative coordinates too.
const AREA = 88;
const OFF = 12;
const [LO, HI] = [-OFF, AREA - OFF];

const STONE = 71;
const DARK_STONE = 72;
const CAPS = 151;
const BLACK = 0;
const WHITE = 15;
const RED = 4;
const DARK_RED = 320;
const SAND = 19;
const DARK_SAND = 28;
const TIMBER = 70;
const DARK_TIMBER = 308;
const GRASS = 2;
const LEAF = 10;
const LIME = 27;
const FOREST = 288;
const OLIVE = 330;
const SAND_GREEN = 378;
const BLUE = 1;
const MEDIUM_BLUE = 73;
const DARK_BLUE = 272;
const RIPPLE = 43;
const YELLOW = 14;
const ORANGE = 25;
const GOLD = 297;
const GLOW = 46;
/** The corner towers' cones. */
const SPIRE = 0;
/** Clear glass in the window frames, dark with the rooms behind. */
const PANES = 47;

/** The top of the island's ground plates, where everything stands. */
const G = 6;
const course = (n: number) => G + n * 3;

/** Courses of each part of the castle, counted from the ground. */
const WALL_COURSES = 9;
const TOWER_COURSES = 12;
const GATE_TOWER_COURSES = 14;
const GATE_COURSES = 11;
const KEEP_TOWER_COURSES = 16;
const HALL_COURSES = 14;

const key = (x: number, z: number) => `${x}:${z}`;
const within = (x: number, z: number, x0: number, z0: number, x1: number, z1: number) =>
  x >= x0 && x <= x1 && z >= z0 && z <= z1;
const rim = (x: number, z: number, x0: number, z0: number, x1: number, z1: number) =>
  within(x, z, x0, z0, x1, z1) && (x === x0 || x === x1 || z === z0 || z === z1);
/** A top-down map of the whole board; row and column indices are plan coordinates + OFF. */
const plan = (cell: (x: number, z: number) => string) =>
  Array.from({ length: AREA }, (_, z) =>
    Array.from({ length: AREA }, (_, x) => cell(x + LO, z + LO)).join(''),
  );
/** An adder for map-based helpers, which hand on map indices rather than plan coordinates. */
const fromMap =
  (add: ExampleBrickAdder): ExampleBrickAdder =>
  (partId, color, x, y, z, ...rest) =>
    add(partId, color, x + LO, y, z + LO, ...rest);
const areaMap = (
  add: ExampleBrickAdder,
  cell: (x: number, z: number) => string,
  y: number,
  legend: Readonly<Record<string, readonly ['plate' | 'tile' | 'brick', number]>>,
  anchored?: (x: number, z: number) => boolean,
) =>
  addAreaMap(
    fromMap(add),
    plan(cell),
    y,
    legend,
    anchored && ((x: number, z: number) => anchored(x + LO, z + LO)),
  );
const bondedMap = (
  add: ExampleBrickAdder,
  cell: (x: number, z: number) => string,
  y: number,
  legend: Readonly<Record<string, readonly [RunKind, number]>>,
  n: number,
) => addBondedMap(fromMap(add), plan(cell), y, legend, n);
const rowMap = (
  add: ExampleBrickAdder,
  cell: (x: number, z: number) => string,
  y: number,
  legend: Readonly<Record<string, readonly [RunKind, number]>>,
) => addRowMap(fromMap(add), plan(cell), y, legend);

/** A repeatable 0 to 1 hash of a cell, so the stonework is mottled the same way every time. */
function hash(x: number, z: number, salt = 0) {
  let value = Math.imul(x + 101, 0x27d4eb2d) ^ Math.imul(z + 211, 0x165667b1) ^ (salt * 0x9e3779b9);
  value = Math.imul(value ^ (value >>> 15), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

/**
 * Stone at a wall cell in course `n`: light grey with clusters of tan and dark tan about three
 * studs by two courses, as the reference castles have them, some dark grey low down and the odd
 * masonry or pale block.
 */
function stone(x: number, z: number, n: number): string {
  const along = x + z;
  const cluster = hash(
    Math.floor((along + (n % 3) * 2) / 4),
    Math.floor(n / 3),
    17 + Math.floor((x - z) / 16),
  );
  const single = hash(x, z, n * 13 + 5);
  if (cluster < 0.1) return single < 0.75 ? 't' : 'u';
  if (cluster < 0.17) return single < 0.7 ? 'u' : 't';
  if (cluster < 0.21) return 'd';
  if (n <= 1 && single < 0.2) return 'd';
  if (single < 0.03) return 'd';
  if (single < 0.06) return 'h';
  if (single < 0.28) return 'm';
  return 'a';
}
const STONE_COLOR: Readonly<Record<string, number>> = {
  a: STONE,
  m: STONE,
  d: DARK_STONE,
  t: SAND,
  u: DARK_SAND,
  h: CAPS,
};
const stoneColor = (x: number, z: number, n: number) => STONE_COLOR[stone(x, z, n)];
/** Paving and coping tiles: light grey with dark and pale ones. */
const paving = (x: number, z: number, salt: number) => {
  const roll = hash(x, z, salt);
  return roll < 0.2 ? 'd' : roll < 0.3 ? 'c' : 'a';
};

const LEGEND: Readonly<Record<string, readonly [RunKind, number]>> = {
  a: ['short', STONE],
  m: ['masonry', STONE],
  d: ['short', DARK_STONE],
  t: ['short', SAND],
  u: ['short', DARK_SAND],
  h: ['short', CAPS],
  k: ['brick', BLACK],
  w: ['brick', WHITE],
  n: ['short', SAND],
  b: ['brick', TIMBER],
};
const TILES: Readonly<Record<string, readonly [RunKind, number]>> = {
  a: ['tile', STONE],
  d: ['tile', DARK_STONE],
  c: ['tile', CAPS],
};

/**
 * Curtain walls, four studs thick: [x0, z0, x1, z1] and the way out. Their inner three rows
 * carry a walkway, the outer row a crenellated parapet with arrow slits below.
 */
const WALLS = [
  [15, 8, 48, 11, '-z'],
  [15, 48, 22, 51, '+z'],
  [41, 48, 48, 51, '+z'],
  [8, 15, 11, 44, '-x'],
  [52, 15, 55, 44, '+x'],
] as const;
/** Where a wall cell is: how far in from the outside face (0 to 3) and how far along. */
function wallAt(x: number, z: number) {
  for (const [x0, z0, x1, z1, out] of WALLS) {
    if (!within(x, z, x0, z0, x1, z1)) continue;
    const depth = { '-z': z - z0, '+z': z1 - z, '-x': x - x0, '+x': x1 - x }[out];
    const [start, end] = out.endsWith('z') ? [x0, x1] : [z0, z1];
    return { depth, along: out.endsWith('z') ? x : z, start, end, out };
  }
  return undefined;
}
/** Merlons two studs wide with a one-stud embrasure between. */
const merlon = (along: number) => along % 3 !== 2;
/** Arrow slits every six studs: two courses open, then a 1 x 3 arch rounding off the top. */
const SLIT = [3, 4] as const;
const SLIT_ARCH = 5;
const slitAt = (along: number, start = -Infinity, end = Infinity) =>
  along % 6 === 3 && along > start && along < end;
/** Buttresses: where they start along the back and side walls, two studs wide. */
const BUTTRESSES = [24, 36] as const;

/** Round corner towers, ten studs across: their centres on the stud grid. */
const TOWERS = [
  [10, 10],
  [54, 10],
  [10, 50],
  [54, 50],
] as const;

/** The gatehouse: two square towers either side of an arched gate. */
const GATE_TOWERS = [
  [23, 28],
  [35, 40],
] as const;
const [GATE_BACK, GATE_FRONT] = [46, 53];
const GATE = [29, 34, 48, 51] as const;
const PASSAGE = [30, 33] as const;
/** Courses the gate passage stands open before the arch closes over it. */
const PASSAGE_COURSES = 6;
/** The portcullis hangs a stud in from the arch; the gate doors close the back of the passage. */
const PORTCULLIS_Z = GATE[3] - 1;
/**
 * The portcullis is drawn up: its bottom rail, running in slots in the jambs, sits this many
 * courses up so a minifigure (four bricks) walks under it, with a last grille section above.
 */
const PORTCULLIS_RAISED = 4;
const gateTower = (x: number, z: number) =>
  GATE_TOWERS.some(([x0, x1]) => within(x, z, x0, GATE_BACK, x1, GATE_FRONT));
const gateMiddle = (x: number, z: number) => within(x, z, GATE[0], GATE[2], GATE[1], GATE[3]);

/** The keep: two square towers either side of a hall whose front steps out into the courtyard. */
const KEEP_TOWERS = [
  [20, 27],
  [36, 43],
] as const;
const [KEEP_BACK, KEEP_TOWER_FRONT] = [12, 19];
/** [x0, x1, z0, z1], as for the gate. */
const HALL = [28, 35, 12, 25] as const;
const KEEP_DOOR = 30;
/** The hall's roof runs from the back wall to here; its front is flat behind the parapet. */
const ROOF_FRONT = 21;
const keepTower = (x: number, z: number) =>
  KEEP_TOWERS.some(([x0, x1]) => within(x, z, x0, KEEP_BACK, x1, KEEP_TOWER_FRONT));
const hall = (x: number, z: number) => within(x, z, HALL[0], HALL[2], HALL[1], HALL[3]);
/**
 * Keep windows: [x, z, rotation, first course, [dx, dz] inwards], each a round-topped opening two
 * studs wide under a plate, three courses tall, dark inside, on a sill that steps out.
 */
const KEEP_WINDOWS: readonly (readonly [
  number,
  number,
  Rotation,
  number,
  readonly [number, number],
])[] = [
  ...KEEP_TOWERS.flatMap(([x0]) => [
    [x0 + 3, KEEP_TOWER_FRONT, 90, 5, [0, -1]] as const,
    [x0 + 3, KEEP_TOWER_FRONT, 90, 11, [0, -1]] as const,
  ]),
  [20, 15, 0, 11, [1, 0]],
  [43, 15, 0, 11, [-1, 0]],
];
/** The way out of a face and the turn of an inverted slope overhanging that way. */
const OUT: Readonly<Record<Facing, readonly [number, number, Rotation]>> = {
  '-z': [0, -1, 0],
  '+z': [0, 1, 180],
  '-x': [-1, 0, 90],
  '+x': [1, 0, 270],
};
/**
 * Corbels round the top of a square tower: each rim cell and the way it overhangs, the faces
 * along z taking the corners. A face at `skipX` (against the hall's roof) has none.
 */
function corbels(x0: number, x1: number, z0: number, z1: number, skipX?: number) {
  const cells: (readonly [number, number, Facing])[] = [];
  for (let z = z0; z <= z1; z++)
    for (let x = x0; x <= x1; x++) {
      if (!rim(x, z, x0, z0, x1, z1)) continue;
      const facing: Facing = z === z0 ? '-z' : z === z1 ? '+z' : x === x0 ? '-x' : '+x';
      if (facing.endsWith('x') && x === skipX) continue;
      cells.push([x, z, facing]);
    }
  return cells;
}
/** The corbelled tops of the square towers: corbels, the floor they carry and its parapet. */
const SQUARE_TOPS = [
  ...GATE_TOWERS.map(([x0, x1]) => ({
    tower: [x0, x1, GATE_BACK, GATE_FRONT] as const,
    floor: [x0 - 1, x1 + 1, GATE_BACK - 1, GATE_FRONT + 1] as const,
    corbels: corbels(x0, x1, GATE_BACK, GATE_FRONT),
    courses: GATE_TOWER_COURSES,
    roofed: false,
  })),
  ...KEEP_TOWERS.map(([x0, x1], index) => ({
    tower: [x0, x1, KEEP_BACK, KEEP_TOWER_FRONT] as const,
    floor: [
      index === 0 ? x0 - 1 : x0,
      index === 0 ? x1 : x1 + 1,
      KEEP_BACK - 1,
      KEEP_TOWER_FRONT + 1,
    ] as const,
    corbels: corbels(x0, x1, KEEP_BACK, KEEP_TOWER_FRONT, index === 0 ? x1 : x0),
    courses: KEEP_TOWER_COURSES,
    roofed: true,
  })),
];
const corbelAt = (x: number, z: number, n: number) =>
  SQUARE_TOPS.some(
    (top) => n === top.courses - 1 && top.corbels.some(([cx, cz]) => cx === x && cz === z),
  );

/** The timbered house along the west wall and the hall with an arcade along the east wall. */
const HOUSE = [12, 17, 17, 32] as const;
const HOUSE_COURSES = 5;
const HOUSE_DOOR = 23;
const HOUSE_WINDOWS = [19, 28] as const;
const ARCADE = [44, 51, 18, 29] as const;
const ARCADE_COURSES = 6;
const ARCHES = [20, 24] as const;
const ARCADE_WINDOWS = [21, 25] as const;

/** The well, by the road through the courtyard. */
const WELL = [37, 33] as const;
/** Courtyard trees: where the trunk stands, crown colours, a seed and the trunk's height. */
const TREES = [
  [16, 40, [FOREST, GRASS, LEAF], 3, 2],
  [45, 41, [FOREST, GRASS, GRASS], 8, 2],
] as const;
/** The road of cobbles from the gate to the keep's steps. */
const road = (x: number, z: number) => within(x, z, 30, 29, 33, 51);
/** The market stall's posts: [x0, z0] to [x0 + 5, z0 + 4]. */
const STALL = [21, 39] as const;
const courtyard = (x: number, z: number) => within(x, z, 12, 12, 51, 47);

/**
 * Banners: [x, z, course] of the left of the two headlight bricks they hang on, in a wall
 * facing +z. Each banner stands four studs up in front of a recess three courses tall.
 */
const BANNERS = [
  ...GATE_TOWERS.map(([x0]) => [x0 + 2, GATE_FRONT, 7] as const),
  [31, HALL[3], 9],
] as const;
const behindBanner = (x: number, z: number, n: number) =>
  BANNERS.some(
    ([bx, bz, first]) => z === bz && x >= bx && x <= bx + 1 && n >= first && n <= first + 3,
  );

// ---------------------------------------------------------------------------------------------
// The island: an organic outline round the castle with bays and promontories, in four strata
// set in a little in places so the sides show ledges: dark rock, mixed stone and earth, earth,
// then the turf. The moat lies a plate below the turf and runs out as a stream to a waterfall.

const [IX, IZ, RX, RZ] = [31.5, 33.5, 38, 38];
/** How far a cell lies towards the island's edge: 1 on the outline. */
function reach(x: number, z: number) {
  const [dx, dz] = [(x + 0.5 - IX) / RX, (z + 0.5 - IZ) / RZ];
  const angle = Math.atan2(dz, dx);
  const wobble =
    1 +
    0.06 * Math.sin(2 * angle + 2.2) +
    0.05 * Math.sin(3 * angle + 0.9) +
    0.035 * Math.sin(5 * angle + 2.4) +
    0.025 * Math.sin(9 * angle + 0.3);
  return (Math.abs(dx) ** 3.4 + Math.abs(dz) ** 3.4) ** (1 / 3.4) / wobble;
}
const SECTORS = 56;
const sector = (x: number, z: number) =>
  Math.floor(((Math.atan2(z + 0.5 - IZ, x + 0.5 - IX) + Math.PI) / (2 * Math.PI)) * SECTORS) %
  SECTORS;
/** Bays cut into the outline: [x, z] of the centre and the radius. */
const BAYS = [
  [-4, 30, 8.5],
  [67.5, 26, 8],
  [31, -6, 9],
  [0, 72, 7.5],
  [71, 50, 6],
] as const;
/** Cells the castle needs under it, whatever the outline does. */
const required = (x: number, z: number) =>
  within(x, z, 5, 5, 58, 58) ||
  TOWERS.some(([cx, cz]) => Math.hypot(x + 0.5 - cx, z + 0.5 - cz) <= 8.2) ||
  within(x, z, 13, 50, 50, 62);
function inLayer(x: number, z: number, layer: number) {
  if (x < LO || z < LO || x >= HI || z >= HI) return false;
  if (required(x, z)) return true;
  if (BAYS.some(([bx, bz, r]) => Math.hypot(x + 0.5 - bx, z + 0.5 - bz) < r - (3 - layer) * 0.8))
    return false;
  let limit = 1;
  for (let level = 1; level <= layer; level++)
    if (hash(sector(x, z), level, 7) < [0, 0.4, 0.45, 0.5][level]) limit -= 1 / 36;
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

/** The moat before the front walls, its far bank wandering, its ends rounded. */
const moatFront = (x: number) =>
  58.7 + 1.1 * Math.sin(x * 0.55 + 1) + 0.6 * Math.sin(x * 0.23 + 2) - Math.max(0, 19 - x) * 0.9;
const moatCell = (x: number, z: number) =>
  x >= 16 && x <= 47 && z >= 54 && z + 0.5 < moatFront(x) && !(x === 16 && z === 54);
/** The stream from the moat's right end to the island's edge, where it falls. */
const streamZ = (x: number) => 57.8 + 1.4 * Math.sin((x - 46) / 3.2) + Math.max(0, x - 50) * 0.7;
const streamBand = (x: number, z: number) =>
  x >= 46 && z >= 56 && Math.abs(z + 0.5 - streamZ(x)) < 1.45;
const water = (x: number, z: number) => inLayer(x, z, 3) && (moatCell(x, z) || streamBand(x, z));
/** Where the stream leaves the turf, and where the island's lowest stratum ends below it. */
const edgeAlong = (layer: number) => {
  for (let x = 50; x < HI; x++) if (!inLayer(x, Math.floor(streamZ(x)), layer)) return x;
  return HI;
};
const FALL_X = edgeAlong(3);
const POOL_X = edgeAlong(0);
/** The splash pool on the board at the waterfall's foot. */
const pool = (x: number, z: number) =>
  !inLayer(x, z, 0) &&
  x < HI &&
  z < HI &&
  Math.hypot((x + 0.5 - (POOL_X + 1)) / 3.4, (z + 0.5 - streamZ(POOL_X)) / 2.8) < 1;

/** Water depth: how many cells to the nearest bank, 1 at the edge. */
const DEPTH = (() => {
  const depth = new Map<string, number>();
  let frontier: [number, number][] = [];
  for (let z = LO; z < HI; z++)
    for (let x = LO; x < HI; x++)
      if (water(x, z) && NEIGHBOURS.slice(0, 4).some(([dx, dz]) => !water(x + dx, z + dz))) {
        depth.set(key(x, z), 1);
        frontier.push([x, z]);
      }
  for (let level = 2; frontier.length; level++) {
    const next: [number, number][] = [];
    for (const [x, z] of frontier)
      for (const [dx, dz] of NEIGHBOURS.slice(0, 4)) {
        const [nx, nz] = [x + dx, z + dz];
        if (water(nx, nz) && !depth.has(key(nx, nz))) {
          depth.set(key(nx, nz), level);
          next.push([nx, nz]);
        }
      }
    frontier = next;
  }
  return depth;
})();
const depthAt = (x: number, z: number) => DEPTH.get(key(x, z)) ?? 0;

/** The drawbridge over the moat and the deck on either bank. */
const BRIDGE = [29, 34, 52, 61] as const;
/** Fences line both sides of the bridge over these rows, with a post at each end. */
const BRIDGE_RAIL = [53, 60] as const;
const bridge = (x: number, z: number) => within(x, z, BRIDGE[0], BRIDGE[2], BRIDGE[1], BRIDGE[3]);
/** The worn path from the bridge down to the island's front edge. */
const pathCentre = (z: number) => 31.5 + 2.2 * Math.sin((z - 61) / 2.8);
const path = (x: number, z: number) =>
  z > BRIDGE[3] && Math.abs(x + 0.5 - pathCentre(z)) < 1.9 && inLayer(x, z, 3);
/** Lawn patches in the courtyard: round the trees and along the house front. */
const courtLawn = (x: number, z: number) =>
  TREES.some(([tx, tz]) => Math.hypot(x + 0.5 - tx, z + 0.5 - tz) < 4.3) ||
  within(x, z, 18, 18, 19, 31);
const lawnShade = (x: number, z: number) =>
  hash(Math.floor(x / 4), Math.floor(z / 4), 15) < 0.3 ? 'h' : 'g';
/** What the turf layer is at a cell. */
function topCell(x: number, z: number): string {
  if (bridge(x, z)) return 'b';
  if (!inLayer(x, z, 3) || water(x, z)) return ' ';
  if (road(x, z)) return 'r';
  if (courtyard(x, z)) {
    if (courtLawn(x, z)) return lawnShade(x, z);
    return hash(Math.floor(x / 3), Math.floor(z / 3), 14) < 0.3 ? 'f' : 'e';
  }
  if (path(x, z)) return 'p';
  return lawnShade(x, z);
}

/** One stone course of every wall, tower and building that has stonework at course `n`. */
function courseCell(x: number, z: number, n: number): string {
  if (behindBanner(x, z, n)) return ' ';
  if (corbelAt(x, z, n)) return ' ';
  // Plain courses bridge the slits and banner recesses, so no short brick lands over a gap.
  const bridging =
    (n === 6 && wallAt(x, z) !== undefined) ||
    (n === 11 && gateTower(x, z)) ||
    ((n === 7 || n === 13) && hall(x, z));
  const mottled = () => (bridging ? 'a' : stone(x, z, n));
  const wall = wallAt(x, z);
  if (wall) {
    const { depth, along, start, end } = wall;
    if (n < WALL_COURSES) {
      const inSlit = slitAt(along, start, end) && n >= SLIT[0] && n <= SLIT_ARCH;
      if (inSlit && depth === 1) return 'k';
      if (inSlit && depth === 0) return ' ';
      if (
        n === SLIT_ARCH &&
        depth === 0 &&
        (slitAt(along - 1, start, end) || slitAt(along + 1, start, end))
      )
        return ' ';
      return mottled();
    }
    if (n === WALL_COURSES) return depth === 0 || depth === 3 ? mottled() : ' ';
    if (n === WALL_COURSES + 1) return depth === 0 && merlon(along) ? 'a' : ' ';
    return ' ';
  }
  if (gateTower(x, z)) return n < GATE_TOWER_COURSES ? mottled() : ' ';
  if (gateMiddle(x, z)) {
    const front = z === GATE[3];
    if (n === PORTCULLIS_RAISED && z === PORTCULLIS_Z) return ' ';
    if (n < PASSAGE_COURSES) return x >= PASSAGE[0] && x <= PASSAGE[1] ? ' ' : mottled();
    if (n === PASSAGE_COURSES) return ' ';
    if (n === PASSAGE_COURSES + 1 && front) return ' ';
    if (n < GATE_COURSES) return mottled();
    if (n === GATE_COURSES) return (z === GATE[2] || front) && merlon(x) ? 'a' : ' ';
    return ' ';
  }
  if (keepTower(x, z)) {
    for (const [wx, wz, rotation, first, [ix, iz]] of KEEP_WINDOWS) {
      const at = (ox: number, oz: number) =>
        rotation
          ? x >= wx + ox && x <= wx + ox + 1 && z === wz + oz
          : z >= wz + oz && z <= wz + oz + 1 && x === wx + ox;
      // The sill: an inverted slope stepping out under the opening.
      if (n === first - 1 && at(0, 0)) return ' ';
      if (n < first || n > first + 2) continue;
      if (at(0, 0)) return ' ';
      if (at(ix, iz)) return 'k';
    }
    return n < KEEP_TOWER_COURSES ? mottled() : ' ';
  }
  if (hall(x, z)) {
    const front = z === HALL[3];
    // The door opens into a shallow porch behind its frame.
    if (z >= HALL[3] - 1 && x >= KEEP_DOOR && x <= KEEP_DOOR + 3 && n >= 1 && n <= 6) return ' ';
    if (z === HALL[3] - 1 && x >= KEEP_DOOR - 1 && x <= KEEP_DOOR + 4 && n === 7) return ' ';
    if (front && x >= KEEP_DOOR - 1 && x <= KEEP_DOOR + 4 && (n === 7 || n === 8)) return ' ';
    if (n < HALL_COURSES) return mottled();
    if (n === HALL_COURSES)
      return (front || ((x === HALL[0] || x === HALL[1]) && z > ROOF_FRONT)) && merlon(x + z)
        ? 'a'
        : ' ';
    return ' ';
  }
  if (rim(x, z, HOUSE[0], HOUSE[2], HOUSE[1], HOUSE[3])) {
    if (n >= HOUSE_COURSES) return ' ';
    if (x === HOUSE[1] && z >= HOUSE_DOOR && z <= HOUSE_DOOR + 2 && n < 4) return ' ';
    const window = x === HOUSE[1] && HOUSE_WINDOWS.some((w) => z >= w && z <= w + 1);
    // Corbels for the window boxes go in under the windows.
    if (window && n <= 2) return ' ';
    if (n === 0) return mottled();
    if (n === HOUSE_COURSES - 1) return 'b';
    const corner = (x === HOUSE[0] || x === HOUSE[1]) && (z === HOUSE[2] || z === HOUSE[3]);
    const along = x === HOUSE[0] || x === HOUSE[1] ? z : x;
    if (corner || along % 3 === 0) return 'b';
    return hash(Math.floor(along / 2), n, 9) < 0.15 ? 'n' : 'w';
  }
  if (rim(x, z, ARCADE[0], ARCADE[2], ARCADE[1], ARCADE[3])) {
    if (n >= ARCADE_COURSES) return ' ';
    const court = x === ARCADE[0];
    if (court && ARCHES.some((a) => z >= a + 1 && z <= a + 2) && n < 2) return ' ';
    if (court && ARCHES.some((a) => z >= a && z <= a + 3) && n === 2) return ' ';
    if (court && ARCADE_WINDOWS.some((w) => z >= w && z <= w + 1) && (n === 3 || n === 4))
      return ' ';
    if (n < 3) return mottled();
    if (n === ARCADE_COURSES - 1) return 'b';
    const corner = (x === ARCADE[0] || x === ARCADE[1]) && (z === ARCADE[2] || z === ARCADE[3]);
    const along = x === ARCADE[0] || x === ARCADE[1] ? z : x;
    if (corner || along % 3 === 1) return 'b';
    return hash(Math.floor(along / 2), n, 10) < 0.15 ? 'n' : 'w';
  }
  return ' ';
}

/** Cells some part of the castle stands on at ground level. */
const structure = (x: number, z: number) =>
  wallAt(x, z) !== undefined ||
  gateTower(x, z) ||
  gateMiddle(x, z) ||
  keepTower(x, z) ||
  hall(x, z) ||
  within(x, z, HOUSE[0], HOUSE[2], HOUSE[1], HOUSE[3]) ||
  within(x, z, ARCADE[0], ARCADE[2], ARCADE[1], ARCADE[3]) ||
  TOWERS.some(([cx, cz]) => BASE_CELLS.has(key(x - cx, z - cz)));

/** Ivy climbing the outside of the walls: [x, z] of the stem and how many courses it climbs. */
const IVY = [
  [7, 31, 7],
  [7, 32, 5],
  [7, 30, 3],
  [56, 40, 6],
  [56, 41, 4],
  [42, 7, 7],
  [43, 7, 4],
  [17, 7, 5],
  [16, 52, 4],
] as const;
const ivyAt = (x: number, z: number) => IVY.some(([ix, iz]) => ix === x && iz === z);

/** A buttress cell: how far out from the wall's face (1 or 2), the wall's way out and run. */
function buttressAt(x: number, z: number) {
  for (const [x0, z0, x1, z1, out] of WALLS) {
    if (out === '+z') continue;
    const [ox, oz] = OUT[out];
    for (const offset of [1, 2]) {
      const [fx, fz] = [x - ox * offset, z - oz * offset];
      if (!within(fx, fz, x0, z0, x1, z1) || wallAt(fx, fz)?.depth !== 0) continue;
      const along = out.endsWith('z') ? fx : fz;
      const start = BUTTRESSES.find((b) => along === b || along === b + 1);
      if (start !== undefined) return { offset, out, start, alongX: out.endsWith('z') };
    }
  }
  return undefined;
}

/**
 * The battered plinth: free ground beside the outer face of a curtain wall, gate tower or keep
 * tower, and the way the face looks out. Two courses of dark stone under a cheese slope.
 */
function plinthAt(x: number, z: number): Facing | undefined {
  if (structure(x, z) || water(x, z) || bridge(x, z) || !inLayer(x, z, 3)) return undefined;
  if (buttressAt(x, z) || ivyAt(x, z) || road(x, z)) return undefined;
  if (within(x, z, HALL[0], HALL[3] + 1, HALL[1], HALL[3] + 3)) return undefined;
  for (const facing of ['-z', '+z', '-x', '+x'] as const) {
    const [ox, oz] = OUT[facing];
    const [fx, fz] = [x - ox, z - oz];
    const wall = wallAt(fx, fz);
    if (wall && wall.depth === 0 && wall.out === facing) return facing;
    if (gateTower(fx, fz) || keepTower(fx, fz)) return facing;
  }
  return undefined;
}

/** Slopes by length along the ridge, longest first. */
const SLOPES = [
  [4, '3037'],
  [3, '3038'],
  [2, '3039'],
  [1, '3040b'],
] as const;

/** A roof colour for a piece at a place: a base shade with a lighter one scattered through. */
type Paint = (x: number, y: number, z: number) => number;
const shingles =
  (base: number, light: number, share: number, salt: number): Paint =>
  (x, y, z) =>
    hash(x * 3 + y, z, salt) < share ? light : base;

/**
 * A run of 45 degree slopes `length` studs long, two deep, falling towards `facing`. [x, z] is
 * the run's min corner. The lengths are staggered course by course.
 */
function addSlopeRun(
  add: ExampleBrickAdder,
  paint: Paint,
  facing: Facing,
  x: number,
  y: number,
  z: number,
  length: number,
) {
  const alongX = facing.endsWith('z');
  const rotation = OUT[facing][2];
  let offset = 0;
  while (offset < length) {
    const left = length - offset;
    const pick = hash(x + offset, z + y, 61) < 0.4 ? 2 : 4;
    const [size, partId] = SLOPES.find(([size]) => size <= Math.min(left, pick))!;
    const [px, pz] = [alongX ? x + offset : x, alongX ? z : z + offset];
    add(partId, paint(px, y, pz), px, y, pz, rotation);
    offset += size;
  }
}

/**
 * A gable roof over [x0..x1] x [z0..z1] with its ridge along `axis`, an even number of studs
 * across, stepping in a stud a course. The gable ends are filled with `gable` bricks.
 */
function addGableRoof(
  add: ExampleBrickAdder,
  [x0, x1, z0, z1]: readonly [number, number, number, number],
  axis: 'x' | 'z',
  y: number,
  paint: Paint,
  gable: number,
) {
  const across = axis === 'x' ? z1 - z0 + 1 : x1 - x0 + 1;
  const length = axis === 'x' ? x1 - x0 + 1 : z1 - z0 + 1;
  for (let k = 0; k * 2 + 2 <= across; k++) {
    const level = y + k * 3;
    if (k * 2 + 2 === across) {
      // The ridge: double-sloped bricks along it.
      for (let offset = 0; offset < length; offset += 2) {
        if (axis === 'x') add('3043', paint(x0 + offset, level, 0), x0 + offset, level, z0 + k, 0);
        else add('3043', paint(0, level, z0 + offset), x0 + k, level, z0 + offset, 90);
      }
      break;
    }
    if (axis === 'x') {
      addSlopeRun(add, paint, '-z', x0, level, z0 + k, length);
      addSlopeRun(add, paint, '+z', x0, level, z1 - k - 1, length);
      for (const x of [x0, x1])
        addRun(add, 'brick', gable, 'z', x, level, z0 + k + 2, across - k * 2 - 4);
    } else {
      addSlopeRun(add, paint, '-x', x0 + k, level, z0, length);
      addSlopeRun(add, paint, '+x', x1 - k - 1, level, z0, length);
      for (const z of [z0, z1])
        addRun(add, 'brick', gable, 'x', x0 + k + 2, level, z, across - k * 2 - 4);
    }
  }
}

/** Outside-corner slopes for each corner of a square: [dx, dz] of the corner and the rotation. */
const CORNERS = [
  [0, 0, 90],
  [1, 0, 0],
  [1, 1, 270],
  [0, 1, 180],
] as const;

/**
 * A square pyramid roof `size` studs across (even) from [x, z], stepping in a stud a course,
 * capped by a steep apex, a gilded finial and a pennant on a pole.
 */
function addPyramidRoof(
  add: ExampleBrickAdder,
  x: number,
  z: number,
  y: number,
  size: number,
  paint: Paint,
) {
  let level = y;
  for (let k = 0; size - k * 2 >= 4; k++, level += 3) {
    const [a, span] = [k, size - k * 2];
    for (const [dx, dz, rotation] of CORNERS) {
      const [px, pz] = [x + a + dx * (span - 2), z + a + dz * (span - 2)];
      add('3045', paint(px, level, pz), px, level, pz, rotation);
    }
    if (span > 4) {
      addSlopeRun(add, paint, '-z', x + a + 2, level, z + a, span - 4);
      addSlopeRun(add, paint, '+z', x + a + 2, level, z + a + span - 2, span - 4);
      addSlopeRun(add, paint, '-x', x + a, level, z + a + 2, span - 4);
      addSlopeRun(add, paint, '+x', x + a + span - 2, level, z + a + 2, span - 4);
    }
  }
  const middle = size / 2 - 1;
  add('3688', paint(x, level, z), x + middle, level, z + middle);
  addPennant(add, x + middle + 0.5, level + 6, z + middle + 0.5);
}

/** A gilded cone with a red pennant flying from a pole on it. [x, z] is the cone's corner. */
function addPennant(add: ExampleBrickAdder, x: number, y: number, z: number) {
  add('4589', GOLD, x, y, z);
  add('3957a', GOLD, x, y + 3, z);
  add('2335', RED, x, y + 9, z, 90);
}

/**
 * The rounded corners of a squircle `half` studs from its centre to each side: [dx, dz] of each
 * 4 x 4 corner piece from the centre, and its turn.
 */
const roundCorners = (half: number) =>
  [
    [half - 4, -half, 0],
    [-half, -half, 90],
    [-half, half - 4, 180],
    [half - 4, half - 4, 270],
  ] as const;
/** The straight cross of a squircle: cells level with the flat stretch of one of its sides. */
const inCross = (dx: number, dz: number, half: number) =>
  dx >= -half &&
  dx < half &&
  dz >= -half &&
  dz < half &&
  ((dx >= 4 - half && dx < half - 4) || (dz >= 4 - half && dz < half - 4));
/** The studs a round-cornered square `half` from its centre covers, as offsets from it. */
function squircle(half: number) {
  const cells = new Set<string>();
  for (let dx = -half; dx < half; dx++)
    for (let dz = -half; dz < half; dz++) if (inCross(dx, dz, half)) cells.add(key(dx, dz));
  for (const [dx, dz, rotation] of roundCorners(half)) {
    const corner = { id: 'corner', partId: '2577', color: 0, x: dx + 8, y: 0, z: dz + 8, rotation };
    for (const site of getConnectionSites(corner as Brick, 'top'))
      cells.add(key(Math.floor(site.x) - 8, Math.floor(site.z) - 8));
  }
  return cells;
}
/** Offsets along the flat stretch of a side of a squircle `half` from its centre. */
const flat = (half: number) => Array.from({ length: 2 * half - 8 }, (_, index) => index + 4 - half);
/** The base and battlements are twelve studs across, the shaft between them ten. */
const [SHAFT, BASE_HALF] = [5, 6];
const SHAFT_CELLS = squircle(SHAFT);
const BASE_CELLS = squircle(BASE_HALF);
const PLINTH_COURSES = 3;
/**
 * Loopholes: the first of the three courses each takes, a round-topped window opening across
 * the two-stud flat of a face with a plate over it, dark inside.
 */
const LOOPHOLES = [4, 8] as const;
const CORBEL_COURSE = TOWER_COURSES - 1;
/** Ways out of a tower side: the facing and the inverted slope's turn to overhang that way. */
const SIDES = [
  ['-z', 0],
  ['+z', 180],
  ['-x', 90],
  ['+x', 270],
] as const;

/** Splits of a four or six stud run into short bricks, picked per course for staggered joints. */
const SPLITS: Readonly<Record<number, readonly (readonly number[])[]>> = {
  2: [[2], [1, 1], [2]],
  4: [
    [2, 2],
    [1, 2, 1],
    [3, 1],
    [1, 3],
    [2, 1, 1],
  ],
  6: [
    [2, 2, 2],
    [3, 3],
    [1, 2, 3],
    [2, 3, 1],
    [3, 2, 1],
  ],
};

/**
 * Lays a straight run of `cells` (all in one line, in order) in short bricks, the split varying
 * course by course and the colour following the stonework's patches; `skip` cells are left out.
 */
function addShortRun(
  add: ExampleBrickAdder,
  cells: readonly (readonly [number, number])[],
  y: number,
  salt: number,
  skip: (x: number, z: number) => boolean = () => false,
) {
  const axis = cells.length > 1 && cells[1][0] !== cells[0][0] ? 'x' : 'z';
  const splits = SPLITS[cells.length] ?? [[cells.length]];
  const split = splits[Math.floor(hash(cells[0][0], cells[0][1], salt) * splits.length)];
  const n = Math.round((y - G) / 3);
  let index = 0;
  for (const size of split) {
    const piece = cells.slice(index, index + size);
    index += size;
    let start = 0;
    for (let end = 0; end <= piece.length; end++) {
      if (end < piece.length && !skip(...piece[end])) continue;
      if (end > start) {
        const [x, z] = piece[start];
        const letter = stone(x, z, n);
        const kind = end - start === 2 && letter === 'm' ? 'masonry' : 'short';
        addRun(add, kind, STONE_COLOR[letter], axis, x, y, z, end - start);
      }
      start = end + 1;
    }
  }
}

/**
 * A round corner tower: a wider battered base, a ten-stud shaft of rounded corner bricks joined
 * by flat stretches of short bricks, round-topped loopholes in each free face, and corbels
 * carrying a twelve-stud parapet of merlons round a dark cone.
 */
function addRoundTower(add: ExampleBrickAdder, cx: number, cz: number) {
  const cell = (dx: number, dz: number) => [cx + dx, cz + dz] as const;
  // The faces of the shaft: their four cells, the cell inside each, and whether a wall meets it.
  const faces = SIDES.map(([facing, rotation]) => {
    const [ox, oz] = { '-z': [0, -1], '+z': [0, 1], '-x': [-1, 0], '+x': [1, 0] }[facing];
    const cells = flat(SHAFT).map((t) =>
      ox === 0 ? cell(t, oz < 0 ? -SHAFT : SHAFT - 1) : cell(ox < 0 ? -SHAFT : SHAFT - 1, t),
    );
    const walled = cells.some(([x, z]) => wallAt(x + ox, z + oz) !== undefined);
    return { facing, rotation, ox, oz, cells, walled };
  });
  const isWall = (x: number, z: number) => wallAt(x, z) !== undefined;

  // The base: rounded corners and short-brick sides round a solid core.
  for (let n = 0; n < PLINTH_COURSES; n++) {
    const y = course(n);
    for (const [dx, dz, rotation] of roundCorners(BASE_HALF))
      add(
        '2577',
        hash(cx + dx, cz + dz, n) < 0.2 ? DARK_STONE : STONE,
        cx + dx,
        y,
        cz + dz,
        rotation,
      );
    for (const { ox, oz } of faces) {
      const cells = flat(BASE_HALF).map((t) =>
        ox === 0
          ? cell(t, oz < 0 ? -BASE_HALF : BASE_HALF - 1)
          : cell(ox < 0 ? -BASE_HALF : BASE_HALF - 1, t),
      );
      addShortRun(add, cells, y, n * 7 + 3, isWall);
    }
    areaMap(
      add,
      (x, z) => {
        const [dx, dz] = [x - cx, z - cz];
        const inside = Math.max(dx, dz) < BASE_HALF - 1 && Math.min(dx, dz) > -BASE_HALF;
        return inCross(dx, dz, BASE_HALF) && inside && !isWall(x, z) ? 'i' : ' ';
      },
      y,
      { i: ['brick', DARK_STONE] },
    );
  }
  // The batter: cheese slopes round the ledge where the shaft steps in from the base.
  const shaftBox = (dx: number, dz: number) =>
    inCross(dx, dz, SHAFT) ||
    roundCorners(SHAFT).some(([x0, z0]) => dx >= x0 && dx < x0 + 4 && dz >= z0 && dz < z0 + 4);
  for (const offset of BASE_CELLS) {
    const [dx, dz] = offset.split(':').map(Number);
    const [x, z] = cell(dx, dz);
    if (shaftBox(dx, dz) || isWall(x, z)) continue;
    const [ux, uz] = [dx + 0.5, dz + 0.5];
    const rotation = Math.abs(ux) > Math.abs(uz) ? (ux < 0 ? 90 : 270) : uz < 0 ? 0 : 180;
    add('54200', hash(x, z, 3) < 0.3 ? DARK_STONE : STONE, x, course(PLINTH_COURSES), z, rotation);
  }

  // The shaft.
  for (let n = PLINTH_COURSES; n < TOWER_COURSES; n++) {
    const y = course(n);
    for (const [dx, dz, rotation] of roundCorners(SHAFT))
      add(
        '2577',
        hash(cx + dx, cz + dz, n) < 0.12 ? DARK_STONE : STONE,
        cx + dx,
        y,
        cz + dz,
        rotation,
      );
    for (const { cells, walled, rotation, ox, oz } of faces) {
      if (n === CORBEL_COURSE && !walled) {
        // Corbels: inverted slopes stepping out a stud under the parapet.
        for (const [x, z] of cells)
          add('3665a', STONE, Math.min(x, x + ox), y, Math.min(z, z + oz), rotation);
        continue;
      }
      const loophole = walled ? undefined : LOOPHOLES.find((first) => n >= first && n <= first + 2);
      if (loophole === undefined) addShortRun(add, cells, y, n * 11);
      else if (n === loophole) {
        const [x, z] = cells[0];
        const rotation = oz === 0 ? 0 : 90;
        add('30044', STONE, x, y, z, rotation);
        add('3023b', STONE, x, y + 8, z, rotation);
      }
    }
  }
  // Dark backing behind each loophole, standing on the base's core.
  for (const { cells, walled, ox, oz } of faces) {
    if (walled) continue;
    const [bx, bz] = [cells[0][0] - ox, cells[0][1] - oz];
    for (let n = PLINTH_COURSES; n <= LOOPHOLES[1] + 2; n++)
      add('3004', n < LOOPHOLES[0] ? DARK_STONE : BLACK, bx, course(n), bz, oz === 0 ? 0 : 90);
  }

  // The parapet floor: round corner plates and plates over the cross, a stud out from the shaft.
  const top = course(TOWER_COURSES);
  for (const [dx, dz, rotation] of roundCorners(BASE_HALF))
    add('30565', STONE, cx + dx, top, cz + dz, rotation);
  areaMap(
    add,
    (x, z) => (inCross(x - cx, z - cz, BASE_HALF) ? 'c' : ' '),
    top,
    { c: ['plate', STONE] },
    (x, z) => SHAFT_CELLS.has(key(x - cx, z - cz)),
  );

  // Battlements round the edge: a parapet course, then merlons two studs wide with gaps, all
  // capped in pale tiles; round bricks where the edge curves.
  const edge = [...BASE_CELLS]
    .map((offset) => offset.split(':').map(Number) as [number, number])
    .filter(([dx, dz]) =>
      [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([ex, ez]) => !BASE_CELLS.has(key(dx + ex, dz + ez))),
    )
    .sort(([ax, az], [bx, bz]) => Math.atan2(az + 0.5, ax + 0.5) - Math.atan2(bz + 0.5, bx + 0.5));
  const straight = (dx: number, dz: number) => inCross(dx, dz, BASE_HALF);
  const merlons = new Set(
    edge.filter((_, index) => index % 3 !== 2).map(([dx, dz]) => key(dx, dz)),
  );
  for (const [index, [level, cells]] of (
    [
      [top + 1, edge],
      [top + 4, edge.filter(([dx, dz]) => merlons.has(key(dx, dz)))],
    ] as const
  ).entries()) {
    bondedMap(
      add,
      (x, z) => {
        const [dx, dz] = [x - cx, z - cz];
        return cells.some(([ex, ez]) => ex === dx && ez === dz) && straight(dx, dz)
          ? stone(x, z, TOWER_COURSES + index)
          : ' ';
      },
      level,
      LEGEND,
      level,
    );
    for (const [dx, dz] of cells)
      if (!straight(dx, dz))
        add('3062b', stoneColor(cx + dx, cz + dz, TOWER_COURSES + index), cx + dx, level, cz + dz);
  }
  for (const [dx, dz] of edge) {
    const y = merlons.has(key(dx, dz)) ? top + 7 : top + 4;
    add(straight(dx, dz) ? '3070b' : '98138', CAPS, cx + dx, y, cz + dz);
  }

  // The cone: a round plate and two courses of half-circle bricks, then courses stepping in to
  // cones and a gilded tip.
  add('74611', SPIRE, cx - 4, top + 1, cz - 4);
  for (const y of [top + 2, top + 5]) {
    add('47974', SPIRE, cx - 4, y, cz - 4, 0);
    add('47974', SPIRE, cx - 4, y, cz, 180);
  }
  for (const y of [top + 8, top + 9, top + 10]) add('11213', SPIRE, cx - 3, y, cz - 3);
  add('3943b', SPIRE, cx - 2, top + 11, cz - 2);
  add('3942c', SPIRE, cx - 1, top + 17, cz - 1);
  addPennant(add, cx - 0.5, top + 23, cz - 0.5);
}

/** A piece mounted on a side stud of `host`, slid onto the nearest one from its rough place. */
function mount(add: ExampleBrickAdder, guess: Omit<Brick, 'id'>, host: Omit<Brick, 'id'>) {
  const seated = seatOnSideStuds({ id: 'mount', ...guess }, { id: 'host', ...host });
  if (!seated) throw new Error(`Nothing to mount ${guess.partId} on.`);
  add(seated.partId, seated.color, seated.x, seated.y, seated.z, seated.rotation, seated.facing);
  return seated;
}

/**
 * A red banner with a gold boss, hung on two headlight bricks in a wall facing +z: [x, z] is the
 * left headlight's cell, `y` the course it sits in.
 */
function addBanner(add: ExampleBrickAdder, x: number, y: number, z: number) {
  const lights = [x, x + 1].map((lx) => ({
    partId: '4070',
    color: STONE,
    x: lx,
    y,
    z,
    rotation: 180 as Rotation,
  }));
  for (const light of lights)
    add(light.partId, light.color, light.x, light.y, light.z, light.rotation);
  const banner = mount(
    add,
    { partId: '3020', color: RED, x, y: y + 0.5, z: z + 0.8, rotation: 0, facing: '+z' },
    lights[0],
  );
  mount(
    add,
    {
      partId: '14769',
      color: GOLD,
      x,
      y: banner.y + 2.5,
      z: banner.z + 0.4,
      rotation: 0,
      facing: '+z',
    },
    banner,
  );
  // Smooth tiles over the studs left above and below the boss.
  for (const y of [banner.y, banner.y + 7.5])
    mount(
      add,
      { partId: '3069b', color: RED, x, y, z: banner.z + 0.4, rotation: 90, facing: '+z' },
      banner,
    );
}

/** Fits a door into its frame, trying the places either side of the frame's line. */
function addDoor(add: ExampleBrickAdder, partId: string, color: number, frame: Brick) {
  for (const rotation of [frame.rotation, (frame.rotation + 180) % 360] as Rotation[])
    for (const dx of [0, -0.5, 0.5, -1, 1])
      for (const dz of [0, -0.5, 0.5, -1, 1]) {
        const door: Brick = {
          id: 'door',
          partId,
          color,
          x: frame.x + dx,
          y: frame.y,
          z: frame.z + dz,
          rotation,
        };
        if (isMatchingInsertFrame(door, frame)) {
          add(partId, color, door.x, door.y, door.z, rotation);
          return;
        }
      }
  throw new Error(`No fit for door ${partId} in its frame.`);
}

// Pieces the smoothing pass may finish: strata, rocks and turf, keyed by world place.
const NATURAL = new Set<string>();
const naturalKey = (piece: Pick<Brick, 'partId' | 'x' | 'y' | 'z'>) =>
  `${piece.partId}@${piece.x},${piece.y},${piece.z}`;

export const castle: ExampleDefinition = {
  id: 'castle',
  name: 'Castle',
  tags: [
    'castle',
    'medieval',
    'towers',
    'gatehouse',
    'keep',
    'moat',
    'drawbridge',
    'banners',
    'waterfall',
    'market-stall',
    'landscape',
  ],
  expectedPieceCount: 11038,
  buildArea: AREA,
  brickIdPrefix: 'castle',
  smooth: [{ only: (brick) => NATURAL.has(naturalKey(brick)) }],
  build(drawnAdd) {
    NATURAL.clear();
    // Pieces go out bottom-up, side-mounted ones last, turned so the gate faces the camera.
    const order = bottomUp(drawnAdd);
    let tagging = false;
    const world = glazeWindows(
      turnAround((partId, color, x, y, z, ...rest) => {
        if (tagging) NATURAL.add(naturalKey({ partId, x, y, z }));
        order.add(partId, color, x, y, z, ...rest);
      }, AREA),
      PANES,
    );
    // What stands where, in plan studs, so scenery and plants keep off it.
    const columns = new Map<string, number[]>();
    const boxes: TreeBox[] = [];
    const add: ExampleBrickAdder = (partId, color, x, y, z, rotation = 0, facing, ...rest) => {
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
      for (let cx = Math.floor(x); cx < Math.ceil(x + size.width - 0.01); cx++)
        for (let cz = Math.floor(z); cz < Math.ceil(z + size.depth - 0.01); cz++) {
          const spans = columns.get(key(cx, cz)) ?? [];
          spans.push(y, y + size.height);
          columns.set(key(cx, cz), spans);
        }
      world(partId, color, x + OFF, y, z + OFF, rotation, facing, ...rest);
    };
    const blocked = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number) => {
      for (let cx = Math.floor(x0); cx < Math.ceil(x1 - 0.01); cx++)
        for (let cz = Math.floor(z0); cz < Math.ceil(z1 - 0.01); cz++) {
          const spans = columns.get(key(cx, cz));
          if (!spans) continue;
          for (let index = 0; index < spans.length; index += 2)
            if (spans[index] < y1 && y0 < spans[index + 1]) return true;
        }
      return false;
    };
    /** Adds a piece the smoothing pass may finish. */
    const natural: ExampleBrickAdder = (...piece) => {
      tagging = true;
      add(...piece);
      tagging = false;
    };
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
      // Scenery on the ground needs turf under every cell it covers.
      if (y === G)
        for (let cx = Math.floor(x); cx < Math.ceil(x + size.width - 0.01); cx++)
          for (let cz = Math.floor(z); cz < Math.ceil(z + size.depth - 0.01); cz++)
            if (topCell(cx, cz) === ' ') return false;
      into(partId, color, x, y, z, rotation);
      return true;
    };
    /**
     * A door frame drawn at `frame` and its door. Both go in already turned round, since the
     * turn's own door rule only knows frames that run along x.
     */
    const addFramedDoor = (frame: Omit<Brick, 'id'>, partId: string, color: number) => {
      const { width, depth, height } = footprint({ id: 'frame', ...frame });
      // The door swings half a stud either side of its frame; keep scenery off it.
      for (let cx = frame.x - 1; cx <= frame.x + width; cx++)
        for (let cz = frame.z - 1; cz <= frame.z + depth; cz++) {
          const spans = columns.get(key(cx, cz)) ?? [];
          spans.push(frame.y, frame.y + height);
          columns.set(key(cx, cz), spans);
        }
      const turned: Brick = {
        id: 'frame',
        ...frame,
        x: AREA - (frame.x + OFF) - width,
        z: AREA - (frame.z + OFF) - depth,
        rotation: ((frame.rotation + 180) % 360) as Rotation,
      };
      order.add(turned.partId, turned.color, turned.x, turned.y, turned.z, turned.rotation);
      addDoor(order.add, partId, color, turned);
    };

    // ----------------------------------------------------------------------------------------
    // The island's strata, the water and the turf.

    const band = (x: number, z: number, layer: number) =>
      streamBand(x, z) && x >= FALL_X - 2 && (onEdge(x, z, layer) || !inLayer(x, z, layer + 1));
    areaMap(
      (partId, color, ...rest) => (color === DARK_STONE ? natural : add)(partId, color, ...rest),
      (x, z) => {
        if (!inLayer(x, z, 0)) return ' ';
        return band(x, z, 0) ? 'x' : 'r';
      },
      0,
      { r: ['plate', DARK_STONE], x: ['plate', BLUE] },
    );
    areaMap(
      (partId, color, ...rest) => (color === RIPPLE ? add : natural)(partId, color, ...rest),
      (x, z) => {
        if (!inLayer(x, z, 1)) return ' ';
        if (band(x, z, 1)) return 'x';
        if (!onEdge(x, z, 1)) return 'i';
        const roll = hash(Math.floor(x / 2), Math.floor(z / 2), 11);
        return roll < 0.45 ? 'r' : roll < 0.8 ? 's' : 't';
      },
      1,
      {
        i: ['brick', DARK_STONE],
        r: ['brick', DARK_STONE],
        s: ['brick', STONE],
        t: ['brick', DARK_SAND],
        x: ['brick', RIPPLE],
      },
    );
    // Water a plate below the turf: dark in the middle, lighter towards the banks.
    const WATER: Readonly<Record<string, readonly ['plate', number]>> = {
      k: ['plate', DARK_BLUE],
      u: ['plate', BLUE],
      v: ['plate', MEDIUM_BLUE],
      x: ['plate', RIPPLE],
    };
    areaMap(
      add,
      (x, z) => {
        if (inLayer(x, z, 2) && streamBand(x, z) && !inLayer(x, z, 3)) return 'x';
        const depth = depthAt(x, z);
        return depth === 0 ? ' ' : depth >= 3 ? 'k' : depth === 2 ? 'u' : 'v';
      },
      4,
      WATER,
    );
    areaMap(
      natural,
      (x, z) => {
        if (!inLayer(x, z, 2) || depthAt(x, z) || (streamBand(x, z) && !inLayer(x, z, 3)))
          return ' ';
        if (!onEdge(x, z, 2)) return 'i';
        const roll = hash(Math.floor(x / 3), Math.floor(z / 3), 12);
        return roll < 0.55 ? 'd' : roll < 0.85 ? 'b' : 'n';
      },
      4,
      {
        i: ['plate', DARK_SAND],
        d: ['plate', DARK_SAND],
        b: ['plate', TIMBER],
        n: ['plate', SAND],
      },
    );
    // The splash pool at the waterfall's foot.
    areaMap(
      add,
      (x, z) => {
        if (!pool(x, z)) return ' ';
        return NEIGHBOURS.slice(0, 4).every(([dx, dz]) => pool(x + dx, z + dz)) ? 'u' : 'v';
      },
      0,
      WATER,
    );
    // The turf: lawn in two greens in broad patches, packed earth in the courtyard, a cobbled
    // road, a worn path and the drawbridge's deck.
    areaMap(
      (partId, color, ...rest) =>
        (color === GRASS || color === FOREST ? natural : add)(partId, color, ...rest),
      topCell,
      5,
      {
        e: ['plate', SAND],
        f: ['plate', DARK_SAND],
        r: ['plate', DARK_STONE],
        g: ['plate', GRASS],
        h: ['plate', FOREST],
        p: ['plate', DARK_SAND],
        b: ['plate', TIMBER],
      },
    );
    // Ripples at the banks, a trans tumble down the fall and spray in the pool.
    for (let z = LO; z < HI; z++)
      for (let x = LO; x < HI; x++) {
        const depth = depthAt(x, z);
        if (depth === 1 && !bridge(x, z) && hash(x, z, 21) < 0.45) add('3070b', RIPPLE, x, 5, z);
        else if (depth === 2 && !bridge(x, z) && hash(x, z, 22) < 0.12)
          add('98138', RIPPLE, x, 5, z);
        if (pool(x, z) && hash(x, z, 23) < 0.4) add('98138', RIPPLE, x, 1, z);
      }

    // ----------------------------------------------------------------------------------------
    // Stonework, course by course.

    for (let n = 0; n <= KEEP_TOWER_COURSES; n++)
      bondedMap(add, (x, z) => courseCell(x, z, n), course(n), LEGEND, n);

    for (const [cx, cz] of TOWERS) addRoundTower(add, cx, cz);

    // The battered plinth along the outside of the walls and square towers: two courses of
    // dark stone stepping out a stud, cheese slopes leaning on the wall above.
    for (const n of [0, 1])
      bondedMap(
        add,
        (x, z) => {
          if (!plinthAt(x, z)) return ' ';
          const roll = hash(x, z, n + 40);
          return roll < 0.5 ? 'd' : roll < 0.85 ? 'a' : 'u';
        },
        course(n),
        LEGEND,
        n,
      );
    for (let z = LO; z < HI; z++)
      for (let x = LO; x < HI; x++) {
        const facing = plinthAt(x, z);
        if (!facing) continue;
        const alongX = facing.endsWith('z');
        const [nx, nz] = alongX ? [x + 1, z] : [x, z + 1];
        const [px, pz] = alongX ? [x - 1, z] : [x, z - 1];
        // Pair cells into 1 x 2 cheese slopes from the start of each run.
        let run = 0;
        for (let [rx, rz] = [px, pz]; plinthAt(rx, rz) === facing;) {
          run++;
          if (alongX) rx--;
          else rz--;
        }
        if (run % 2 === 1) continue;
        const color = hash(x, z, 42) < 0.3 ? DARK_STONE : STONE;
        if (plinthAt(nx, nz) === facing) {
          const rotation = OUT[facing][2];
          add('85984', color, x, course(2), z, rotation);
        } else add('54200', color, x, course(2), z, OUT[facing][2]);
      }

    // Buttresses along the back and side walls: a stepped pier two studs wide, sloped twice.
    for (const [x0, z0, x1, , out] of WALLS) {
      if (out === '+z') continue;
      const [ox, oz, rotation] = OUT[out];
      const alongX = out.endsWith('z');
      const face = { '-z': z0, '-x': x0, '+x': x1 }[out];
      for (const start of BUTTRESSES) {
        // The pier's 2 x 2 foot and the 1 x 2 row against the wall above it.
        const [dx, dz] = alongX
          ? [start, Math.min(face + oz, face + oz * 2)]
          : [Math.min(face + ox, face + ox * 2), start];
        const [nx, nz] = alongX ? [start, face + oz] : [face + ox, start];
        for (let n = 0; n < 3; n++) add('3003', stoneColor(dx, dz, n), dx, course(n), dz);
        add('3039', stoneColor(dx, dz, 3), dx, course(3), dz, rotation);
        for (let n = 4; n < 7; n++)
          addRun(add, 'brick', stoneColor(nx, nz, n), alongX ? 'x' : 'z', nx, course(n), nz, 2);
        add('85984', STONE, nx, course(7), nz, rotation);
      }
    }

    // Ivy climbing the walls in ragged stems.
    for (const [x, z, courses] of IVY) {
      for (let c = 0; c < courses; c++)
        add('3062b', hash(x, c, z) < 0.45 ? FOREST : GRASS, x, course(c), z);
      add('6141', LIME, x, course(courses), z);
    }

    // Arrow slits in the curtain walls: a sill at the foot, a little arch rounding the top.
    for (const [x0, z0, x1, z1, out] of WALLS) {
      const alongX = out.endsWith('z');
      const row = { '-z': z0, '+z': z1, '-x': x0, '+x': x1 }[out];
      const [from, to] = alongX ? [x0, x1] : [z0, z1];
      for (let along = from + 1; along < to; along++) {
        if (!slitAt(along, from, to)) continue;
        const [x, z] = alongX ? [along, row] : [row, along];
        add('3070b', STONE, x, course(SLIT[0]), z);
        add(
          '4490',
          STONE,
          alongX ? x - 1 : x,
          course(SLIT_ARCH),
          alongX ? z : z - 1,
          alongX ? 90 : 0,
        );
      }
    }

    // Wall walks, parapet copings and merlon caps.
    rowMap(
      add,
      (x, z) => {
        const wall = wallAt(x, z);
        return wall && (wall.depth === 1 || wall.depth === 2) ? paving(x, z, 99) : ' ';
      },
      course(WALL_COURSES),
      TILES,
    );
    rowMap(add, (x, z) => (wallAt(x, z)?.depth === 3 ? 'c' : ' '), course(WALL_COURSES + 1), TILES);
    rowMap(
      add,
      (x, z) => {
        const wall = wallAt(x, z);
        return wall?.depth === 0 && merlon(wall.along) ? 'c' : ' ';
      },
      course(WALL_COURSES + 2),
      TILES,
    );

    // Square tower tops: corbels stepping out under a floor, a parapet of merlons round it,
    // and a flag on the gate towers.
    for (const { tower, floor, corbels: cells, courses, roofed } of SQUARE_TOPS) {
      const [fx0, fx1, fz0, fz1] = floor;
      const [tx0, tx1, tz0, tz1] = tower;
      for (const [x, z, facing] of cells) {
        const [ox, oz, rotation] = OUT[facing];
        add(
          '3665a',
          STONE,
          Math.min(x, x + ox),
          course(courses - 1),
          Math.min(z, z + oz),
          rotation,
        );
      }
      const top = course(courses);
      areaMap(add, (x, z) => (within(x, z, fx0, fz0, fx1, fz1) ? 'f' : ' '), top, {
        f: ['plate', STONE],
      });
      const ring = (x: number, z: number) =>
        rim(x, z, fx0, fz0, fx1, fz1) && !within(x, z, tx0, tz0, tx1, tz1);
      const along = (x: number, z: number) => (z === fz0 || z === fz1 ? x : z);
      bondedMap(add, (x, z) => (ring(x, z) ? stone(x, z, courses) : ' '), top + 1, LEGEND, courses);
      bondedMap(
        add,
        (x, z) => (ring(x, z) && merlon(along(x, z)) ? stone(x, z, courses + 1) : ' '),
        top + 4,
        LEGEND,
        courses + 1,
      );
      rowMap(add, (x, z) => (ring(x, z) && merlon(along(x, z)) ? 'c' : ' '), top + 7, TILES);
      rowMap(add, (x, z) => (ring(x, z) && !merlon(along(x, z)) ? 'c' : ' '), top + 4, TILES);
      if (!roofed) {
        const [px, pz] = [tx0 + 2, tz0 + 3];
        rowMap(
          add,
          (x, z) =>
            within(x, z, tx0, tz0, tx1, tz1) && !ring(x, z) && !(x === px && z === pz)
              ? paving(x, z, 5)
              : ' ',
          top + 1,
          TILES,
        );
        addPennant(add, px, top + 1, pz);
      }
    }

    // Gatehouse: a tall passage roofed over with long bricks behind a round arch, a black
    // portcullis drawn up just inside it, plank doors at the back and banners on the towers.
    for (let z = GATE[2]; z < GATE[3]; z++)
      addRun(add, 'brick', STONE, 'x', GATE[0], course(PASSAGE_COURSES), z, 6);
    add('3307', CAPS, GATE[0], course(PASSAGE_COURSES), GATE[3], 90);
    add('3009', BLACK, GATE[0], course(PORTCULLIS_RAISED), PORTCULLIS_Z, 90);
    add('3633', BLACK, PASSAGE[0], course(PORTCULLIS_RAISED + 1), PORTCULLIS_Z, 90);
    addFramedDoor(
      { partId: '60596', color: DARK_TIMBER, x: PASSAGE[0], y: G, z: GATE[2], rotation: 90 },
      '60616a',
      TIMBER,
    );
    rowMap(
      add,
      (x, z) => (gateMiddle(x, z) && z > GATE[2] && z < GATE[3] ? paving(x, z, 5) : ' '),
      course(GATE_COURSES),
      TILES,
    );
    rowMap(
      add,
      (x, z) => (gateMiddle(x, z) && (z === GATE[2] || z === GATE[3]) && merlon(x) ? 'c' : ' '),
      course(GATE_COURSES + 1),
      TILES,
    );
    for (const [x, z, first] of BANNERS) addBanner(add, x, course(first), z);

    // Keep: arched door up a flight of steps, windows on sills, a banner over the door, a roof
    // behind the hall's parapet and pyramid roofs on its towers.
    const keepRoof = shingles(DARK_RED, RED, 0.3, 7);
    addFramedDoor(
      { partId: '60596', color: STONE, x: KEEP_DOOR, y: course(1), z: HALL[3], rotation: 90 },
      '60616a',
      TIMBER,
    );
    add('3307', CAPS, KEEP_DOOR - 1, course(7), HALL[3], 90);
    add('3009', STONE, KEEP_DOOR - 1, course(7), HALL[3] - 1, 90);
    for (const [x, z, rotation, first, [ix, iz]] of KEEP_WINDOWS) {
      add('30044', STONE, x, course(first), z, rotation);
      add('3023b', CAPS, x, course(first) + 8, z, rotation);
      const [ox, oz, turn] = OUT[(ix ? (ix > 0 ? '-x' : '+x') : iz > 0 ? '-z' : '+z') as Facing];
      for (const t of [0, 1]) {
        const [cx, cz] = rotation ? [x + t, z] : [x, z + t];
        add('3665a', CAPS, Math.min(cx, cx + ox), course(first - 1), Math.min(cz, cz + oz), turn);
      }
      add('3069b', CAPS, x + ox, course(first), z + oz, rotation);
    }
    add('3009', STONE, KEEP_DOOR - 1, G, HALL[3] + 1, 90);
    for (const y of [G, G + 1]) add('3666', DARK_STONE, KEEP_DOOR - 1, y, HALL[3] + 2, 90);
    add('3666', STONE, KEEP_DOOR - 1, G, HALL[3] + 3, 90);
    rowMap(
      add,
      (x, z) =>
        hall(x, z) && z > ROOF_FRONT && courseCell(x, z, HALL_COURSES) === ' '
          ? paving(x, z, 3)
          : ' ',
      course(HALL_COURSES),
      TILES,
    );
    rowMap(
      add,
      (x, z) => (hall(x, z) && courseCell(x, z, HALL_COURSES) !== ' ' ? 'c' : ' '),
      course(HALL_COURSES + 1),
      TILES,
    );
    addGableRoof(
      add,
      [HALL[0], HALL[1], KEEP_BACK, ROOF_FRONT],
      'x',
      course(HALL_COURSES),
      keepRoof,
      STONE,
    );
    for (const [x0] of KEEP_TOWERS)
      addPyramidRoof(add, x0, KEEP_BACK, course(KEEP_TOWER_COURSES) + 1, 8, keepRoof);

    // The timbered house: a plank door, two windows with planted boxes and a red roof.
    addFramedDoor(
      { partId: '3579', color: TIMBER, x: HOUSE[1], y: G, z: HOUSE_DOOR, rotation: 0 },
      '3193a',
      DARK_TIMBER,
    );
    for (const [index, z] of HOUSE_WINDOWS.entries()) {
      add('60592', WHITE, HOUSE[1], course(1), z, 0);
      for (const dz of [0, 1]) add('3665a', TIMBER, HOUSE[1], course(0), z + dz, 270);
      add('3004', DARK_TIMBER, HOUSE[1] + 1, course(1), z, 0);
      for (const dz of [0, 1]) {
        const roll = hash(z, dz, 31);
        if (roll < 0.6) add('98138', index ? YELLOW : RED, HOUSE[1] + 1, course(2), z + dz);
        else add('6141', LEAF, HOUSE[1] + 1, course(2), z + dz);
      }
    }
    addGableRoof(
      add,
      [HOUSE[0], HOUSE[1], HOUSE[2], HOUSE[3]],
      'z',
      course(HOUSE_COURSES),
      shingles(DARK_RED, RED, 0.3, 8),
      WHITE,
    );

    // The arcade hall: two stone arches below, timbered rooms above and a slate roof.
    for (const z of ARCHES) add('3659', CAPS, ARCADE[0], course(2), z);
    for (const z of ARCADE_WINDOWS) add('60592', WHITE, ARCADE[0], course(3), z, 0);
    addGableRoof(
      add,
      [ARCADE[0], ARCADE[1], ARCADE[2], ARCADE[3]],
      'z',
      course(ARCADE_COURSES),
      shingles(DARK_STONE, STONE, 0.25, 9),
      WHITE,
    );

    // The drawbridge: planks across the deck between spindled fences, a handrail along their
    // tops and stout posts with pale caps at either end.
    for (let z = BRIDGE[2]; z <= BRIDGE[3]; z++)
      addRun(add, 'tile', hash(31, z, 5) < 0.3 ? DARK_TIMBER : TIMBER, 'x', 30, G, z, 4);
    for (const x of [BRIDGE[0], BRIDGE[1]]) {
      for (let z = BRIDGE_RAIL[0]; z <= BRIDGE_RAIL[1]; z += 4) add('30055', TIMBER, x, G, z);
      for (let z = BRIDGE_RAIL[0]; z <= BRIDGE_RAIL[1]; z += 8)
        add('4162', DARK_TIMBER, x, G + 6, z);
      for (const z of [BRIDGE_RAIL[0] - 1, BRIDGE_RAIL[1] + 1]) {
        for (const y of [G, G + 3]) add('3062b', DARK_TIMBER, x, y, z);
        add('3062b', STONE, x, G + 6, z);
        add('6141', WHITE, x, G + 9, z);
        add('4589', WHITE, x, G + 10, z);
      }
    }

    // ----------------------------------------------------------------------------------------
    // The courtyard: cobbles on the road, the well, a market stall, barrels, crates and lamps.

    // Cobbles: grey tiles in three shades with gaps showing the bedding.
    for (let z = LO; z < HI; z++)
      for (let x = LO; x < HI; x++) {
        // The gate's doors swing just inside the passage, so the cobbles stop short of it.
        if (!road(x, z) || z >= GATE[2] - 1 || blocked(x, x + 1, z, z + 1, G, G + 1)) continue;
        const roll = hash(x, z, 51);
        if (roll < 0.3) continue;
        const tone = hash(Math.floor(x / 2), Math.floor(z / 2), 52);
        add(
          roll < 0.45 ? '98138' : '3070b',
          tone < 0.5 ? STONE : tone < 0.85 ? DARK_STONE : CAPS,
          x,
          G,
          z,
        );
      }

    // The well: a round stone kerb, two posts, a little shingled roof and a bucket.
    const [wx, wz] = WELL;
    for (const n of [0, 1]) {
      for (const [dx, dz] of [
        [0, 0],
        [3, 0],
        [0, 3],
        [3, 3],
      ])
        add('3062b', n % 2 ? STONE : DARK_STONE, wx + dx, course(n), wz + dz);
      add('98283', stoneColor(wx, wz, n), wx + 1, course(n), wz, 90);
      add('98283', STONE, wx + 1, course(n), wz + 3, 90);
      add('98283', stoneColor(wz, wx, n), wx, course(n), wz + 1);
      add('98283', STONE, wx + 3, course(n), wz + 1);
    }
    add('3068b', DARK_BLUE, wx + 1, G, wz + 1);
    for (const [dx, dz] of [
      [0, 1],
      [3, 2],
    ])
      for (const n of [2, 3, 4]) add('3062b', TIMBER, wx + dx, course(n), wz + dz);
    add('3031', TIMBER, wx, course(5), wz);
    for (const [dx, dz, rotation] of CORNERS)
      add('3045', dx === dz ? DARK_RED : RED, wx + dx * 2, course(5) + 1, wz + dz * 2, rotation);
    add('3688', DARK_RED, wx + 1, course(5) + 4, wz + 1);
    add('3062b', DARK_STONE, wx, course(2), wz);
    add('4589', TIMBER, wx + 3, course(2), wz + 3);

    // The market stall: timber posts, a counter of fruit and a red and white striped awning.
    const [sx, sz] = STALL;
    for (const [dx, dz] of [
      [0, 0],
      [5, 0],
      [0, 4],
      [5, 4],
    ])
      for (let n = 0; n < 5; n++) add('3062b', TIMBER, sx + dx, course(n), sz + dz);
    for (const n of [0, 1]) add('3010', n ? TIMBER : DARK_TIMBER, sx + 1, course(n), sz + 4, 90);
    add('3710', TIMBER, sx + 1, course(2), sz + 4, 90);
    for (let dx = 1; dx <= 4; dx++)
      add(
        '98138',
        [ORANGE, RED, YELLOW, LEAF][Math.floor(hash(dx, 3, 71) * 4)],
        sx + dx,
        course(2) + 1,
        sz + 4,
      );
    add('3958', TIMBER, sx, course(5), sz);
    for (let dx = 0; dx < 6; dx++) {
      const stripe = dx % 2 ? WHITE : RED;
      add('4286', stripe, sx + dx, course(5) + 1, sz, 0);
      add('4286', stripe, sx + dx, course(5) + 1, sz + 3, 180);
    }
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
    crate(sx - 2, sz + 2, RED);
    crate(sx + 6, sz, LEAF);
    const barrel = (x: number, z: number) => {
      add('3941', TIMBER, x, G, z);
      add('3941', TIMBER, x, G + 3, z);
      add('14769', DARK_TIMBER, x, G + 6, z);
    };
    barrel(40, 22);
    barrel(41, 25);
    barrel(38, 24);
    crate(40, 27, ORANGE);
    // Hay by the house, a bench under the tree and lamps along the road.
    for (const [x, z, n] of [
      [18, 33, 0],
      [18, 35, 0],
      [18, 34, 1],
    ] as const)
      add('3003', n ? SAND : DARK_SAND, x, course(n), z);
    for (const z of [32, 34]) add('3004', DARK_TIMBER, 25, G, z);
    add('3021', TIMBER, 25, G + 3, 32);
    add('63864', TIMBER, 25, G + 4, 32);
    add('63864', TIMBER, 26, G + 4, 32);
    for (const [x, z] of [
      [28, 42],
      [34, 30],
      [36, 62],
    ] as const) {
      add('2039', BLACK, x, G, z);
      add('3062b', GLOW, x + 0.5, G + 21, z + 0.5);
      add('4589', BLACK, x + 0.5, G + 24, z + 0.5);
    }

    // ----------------------------------------------------------------------------------------
    // The landscape: rock outcrops, trees, bushes, reeds and flowers.

    /** Stacks of mixed greys, highest in the middle, that smoothing rounds off. */
    const rocks = (heights: Map<string, number>, salt: number) => {
      const topAt = new Map<string, number>();
      for (const cell of heights.keys()) topAt.set(cell, G);
      const max = Math.max(0, ...heights.values());
      for (let y = G; y < G + max; y++) {
        const cells = new Map<string, string>();
        for (const [cell, height] of heights) {
          if (topAt.get(cell) !== y || y >= G + height) continue;
          const [x, z] = cell.split(':').map(Number);
          const brick = G + height - y >= 3;
          const roll = hash(
            Math.floor(x / 2),
            Math.floor((y - G) / 3) * 7 + Math.floor(z / 2),
            salt,
          );
          const tone = roll < 0.4 ? 'a' : roll < 0.88 ? 'd' : 'l';
          cells.set(cell, brick ? tone.toUpperCase() : tone);
        }
        areaMap(natural, (x, z) => cells.get(key(x, z)) ?? ' ', y, {
          A: ['brick', STONE],
          D: ['brick', DARK_STONE],
          L: ['brick', CAPS],
          a: ['plate', STONE],
          d: ['plate', DARK_STONE],
          l: ['plate', CAPS],
        });
        for (const [cell, tone] of cells)
          topAt.set(cell, y + (tone === tone.toUpperCase() ? 3 : 1));
      }
    };
    const free = (x: number, z: number) =>
      inLayer(x, z, 3) && !water(x, z) && !bridge(x, z) && !path(x, z) && !road(x, z);
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
          if (!free(x, z)) continue;
          const distance = Math.hypot((x + 0.5 - cx) / rx, (z + 0.5 - cz) / rz);
          const height = Math.round((1 - distance) * peak + (hash(x, z, salt) - 0.5) * 3);
          if (height > 0 && !blocked(x, x + 1, z, z + 1, G, G + height))
            heights.set(key(x, z), height);
        }
      rocks(heights, salt);
    };
    for (const [cx, cz, rx, rz, peak, salt] of ROCKS) outcrop(cx, cz, rx, rz, peak, salt);
    // Stones along the moat's far bank and round the fall.
    const bank = new Map<string, number>();
    for (let z = LO; z < HI; z++)
      for (let x = LO; x < HI; x++) {
        if (!free(x, z) || courtyard(x, z)) continue;
        const shore = NEIGHBOURS.some(([dx, dz]) => water(x + dx, z + dz));
        if (shore && z > 55 && hash(x, z, 61) < 0.45 && !blocked(x, x + 1, z, z + 1, G, G + 2))
          bank.set(key(x, z), 1 + Math.floor(hash(x, z, 62) * 2));
      }
    rocks(bank, 3);

    // Trees: two in the courtyard, big broadleaf trees and conifers round the island.
    const near = (x: number, z: number, reachOut: number) =>
      boxes.filter(
        (box) =>
          box.u1 > x - reachOut &&
          box.u0 < x + reachOut &&
          box.v1 > z - reachOut &&
          box.v0 < z + reachOut,
      );
    for (const [x, z, crown, seed, trunk] of [...TREES, ...OUTER_TREES])
      addTree(add, x, z, G, crown, TIMBER, trunk, seed, near(x, z, 12));
    for (const [x, z] of CONIFERS) tryAdd('3471', FOREST, x, G, z);

    // Bushes and ferns stand on a stud between their own cells, so they sit half a stud over.
    for (const [x, z, color] of BUSHES) tryAdd('6064', color, x, G, z);
    for (const [x, z, color] of FERNS) tryAdd('6255', color, x, G, z);
    // Tall grass and reeds along the moat, lily pads on the deep water.
    for (let z = LO; z < HI; z++)
      for (let x = LO; x < HI; x++) {
        const depth = depthAt(x, z);
        if (depth === 1 && !bridge(x, z) && hash(x, z, 71) < 0.1) {
          if (blocked(x, x + 1, z, z + 1, 5, 6 + 13)) continue;
          add('6141', OLIVE, x, 5, z);
          add('3957a', hash(x, z, 72) < 0.5 ? OLIVE : SAND_GREEN, x, 6, z);
        } else if (depth >= 2 && !bridge(x, z) && hash(x, z, 73) < 0.07)
          tryAdd('98138', hash(x, z, 74) < 0.6 ? LEAF : GRASS, x, 5, z);
      }
    for (const [x, z, rotation] of TALL_GRASS)
      tryAdd(
        '30093',
        hash(x, z) < 0.4 ? FOREST : OLIVE,
        rotation ? x : x - 1.5,
        G,
        rotation ? z - 1.5 : z,
        rotation,
      );

    // Flowers in clumps of one colour.
    const grassAt = (x: number, z: number) => 'gh'.includes(topCell(x, z));
    const flowers = (cx: number, cz: number, color: number, count: number, salt: number) => {
      let placed = 0;
      const cells: [number, number, number][] = [];
      for (let z = cz - 2; z <= cz + 2; z++)
        for (let x = cx - 2; x <= cx + 2; x++)
          cells.push([x, z, Math.hypot(x - cx, z - cz) + hash(x, z, salt) * 1.5]);
      cells.sort((a, b) => a[2] - b[2]);
      for (const [x, z] of cells) {
        if (placed >= count) break;
        if (!grassAt(x, z)) continue;
        if (
          placed === 0 &&
          !blocked(x, x + 2, z, z + 2, G, G + 5) &&
          grassAt(x + 1, z + 1) &&
          grassAt(x + 1, z) &&
          grassAt(x, z + 1)
        ) {
          add('18674', GRASS, x, G, z);
          add('4727', GRASS, x, G + 1, z);
          add('24866', color, x, G + 4, z);
          placed++;
          continue;
        }
        if (tryAdd(hash(x, z, salt + 1) < 0.5 ? '98138' : '6141', color, x, G, z)) placed++;
      }
    };
    for (const [x, z, color, count, salt] of FLOWERS) flowers(x, z, color, count, salt);

    // The ground dressed last: tiles and stepping stones on the path, the odd tuft gathered
    // along the edges of the lawns and at the feet of the walls, the middles left plain.
    for (let z = LO; z < HI; z++)
      for (let x = LO; x < HI; x++) {
        const cell = topCell(x, z);
        if (cell === ' ' || cell === 'r' || cell === 'b') continue;
        if (blocked(x, x + 1, z, z + 1, G, G + 1)) continue;
        const roll = hash(x, z, 91);
        if (cell === 'p') {
          if (roll < 0.25) continue;
          const tone = hash(Math.floor(x / 2), Math.floor(z / 2), 92);
          const color = tone < 0.55 ? SAND : DARK_SAND;
          if (roll < 0.45) add('98138', color, x, G, z);
          else add('3070b', color, x, G, z);
          continue;
        }
        const edge = NEIGHBOURS.some(([dx, dz]) => {
          const next = topCell(x + dx, z + dz);
          return (
            next !== cell &&
            !(
              ('gh'.includes(next) && 'gh'.includes(cell)) ||
              ('ef'.includes(next) && 'ef'.includes(cell))
            )
          );
        });
        const foot = NEIGHBOURS.some(([dx, dz]) => structure(x + dx, z + dz));
        if (cell === 'e' || cell === 'f') {
          if ((edge || foot) && roll < 0.08) add('3070b', cell === 'e' ? DARK_SAND : SAND, x, G, z);
          else if (foot && roll < 0.14)
            tryAdd('32607', hash(x, z, 93) < 0.5 ? GRASS : OLIVE, x, G, z - 1);
          continue;
        }
        if (!edge && !foot) {
          if (roll < 0.02) add('3070b', cell === 'h' ? GRASS : FOREST, x, G, z);
          continue;
        }
        if (roll < 0.08) add('3070b', cell === 'h' ? GRASS : FOREST, x, G, z);
        else if (roll < 0.15) tryAdd('32607', hash(x, z, 93) < 0.5 ? GRASS : FOREST, x, G, z - 1);
      }
    order.flush();
  },
};

/** Rock outcrops: [x, z] of the centre, radii, peak in plates and a seed. */
const ROCKS = [
  [-4, 18, 3.5, 4, 10, 1],
  [62, 53, 3, 3, 8, 2],
  [-4, 38, 3, 3.5, 7, 4],
  [46, 64, 3, 2.5, 5, 5],
  [66, 60, 2.5, 2.5, 6, 6],
  [24, -1, 3, 2.5, 6, 7],
] as const;
/** Trees round the island: as for the courtyard's. */
const OUTER_TREES = [
  [3, 59, [FOREST, GRASS, LEAF], 11, 4],
  [-2, 47, [FOREST, GRASS, GRASS], 5, 3],
] as const;
/** Conifers: the min corner of each 5 x 5 tree. */
const CONIFERS = [
  [15, -1],
  [-4, 10],
  [60, 38],
  [41, 61],
  [-6, 26],
] as const;
/** Bushes, half a stud over: [x, z, colour]. */
const BUSHES = [
  [2.5, 18.5, FOREST],
  [2.5, 42.5, GRASS],
  [58.5, 18.5, GRASS],
  [20.5, 2.5, FOREST],
  [44.5, 2.5, GRASS],
  [20.5, 63.5, FOREST],
  [25.5, 63.5, GRASS],
  [59.5, 45.5, FOREST],
  [10.5, 53.5, GRASS],
] as const;
const FERNS = [
  [0.5, 8.5, GRASS],
  [58.5, 50.5, FOREST],
  [-1.5, 35.5, GRASS],
  [-1.5, 21.5, FOREST],
] as const;
/** Tall grass: [x, z] of its middle stud and the way the blades run. */
const TALL_GRASS = [
  [14, 58, 90],
  [48, 61, 0],
  [26, 61, 0],
  [61, 16, 90],
  [1, 30, 90],
  [12, 60, 0],
] as const;
/** Flower clumps: [x, z, colour, count, seed]. */
const FLOWERS = [
  [24, 66, YELLOW, 6, 81],
  [40, 66, RED, 5, 82],
  [2, 40, WHITE, 5, 83],
  [61, 22, YELLOW, 5, 84],
  [19, 22, RED, 4, 85],
  [47, 36, YELLOW, 4, 86],
  [28, 68, WHITE, 4, 87],
  [-1, 14, YELLOW, 5, 88],
  [8, 64, RED, 5, 89],
] as const;
