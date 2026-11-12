import { layPlateFloor } from '../board.ts';
import { footprint, getConnectionSites, isMatchingInsertFrame, seatOnSideStuds } from '../core.ts';
import type { Brick, Facing, Rotation } from '../core.ts';
import { addBondedMap, addAreaMap, addRowMap, addRun, glazeWindows, turnAround } from './layout.ts';
import type { RunKind } from './layout.ts';
import { addTree } from './trees.ts';
import type { ExampleBrickAdder, ExampleDefinition } from './types.ts';

// A walled castle on a 64-stud board. Plans are drawn top-down with the gate at high z; the
// build is turned round so the gate faces the default camera. Four round corner towers with
// dark cones stand at the corners of a crenellated curtain wall; a gatehouse with a portcullis
// and drawbridge over a moat guards the front, and the keep with its two red-roofed towers
// stands against the back wall, a timbered house and a hall either side of the courtyard.
const SIZE = 64;

const STONE = 71;
const DARK_STONE = 72;
const CAPS = 151;
const BLACK = 0;
const WHITE = 15;
const RED = 4;
const SAND = 19;
const DARK_SAND = 28;
const TIMBER = 70;
const DARK_TIMBER = 308;
const GRASS = 2;
const LEAF = 10;
const FOREST = 288;
const WATER = 1;
const GOLD = 297;
/** The corner towers' cones. */
const SPIRE = 0;
/** Clear glass in the window frames, dark with the rooms behind. */
const PANES = 47;

/** The top of the ground plates, where everything stands. */
const G = 3;
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
const plan = (cell: (x: number, z: number) => string) =>
  Array.from({ length: SIZE }, (_, z) =>
    Array.from({ length: SIZE }, (_, x) => cell(x, z)).join(''),
  );

/** A repeatable 0 to 1 hash of a cell, so the stonework is mottled the same way every time. */
function hash(x: number, z: number, salt = 0) {
  let value = Math.imul(x + 101, 0x27d4eb2d) ^ Math.imul(z + 211, 0x165667b1) ^ (salt * 0x9e3779b9);
  value = Math.imul(value ^ (value >>> 15), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}
/** Light grey stone with the odd dark block. */
const stone = (x: number, z: number, salt: number) => {
  const roll = hash(x, z, salt);
  return roll < 0.2 ? 'd' : roll < 0.34 ? 'm' : 'a';
};

const LEGEND: Readonly<Record<string, readonly [RunKind, number]>> = {
  a: ['short', STONE],
  m: ['masonry', STONE],
  d: ['short', DARK_STONE],
  k: ['brick', BLACK],
  w: ['brick', WHITE],
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
    return { depth, along: out.endsWith('z') ? x : z, start, end };
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
 * studs wide under a plate, three courses tall, dark inside.
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

/** The timbered house along the west wall and the hall with an arcade along the east wall. */
const HOUSE = [12, 17, 17, 32] as const;
const HOUSE_COURSES = 5;
const HOUSE_DOOR = 23;
const HOUSE_WINDOWS = [19, 28] as const;
const ARCADE = [44, 51, 18, 29] as const;
const ARCADE_COURSES = 6;
const ARCHES = [20, 24] as const;
const ARCADE_WINDOWS = [21, 25] as const;

/** The moat in front of the gate, and the drawbridge over it. */
const WELL = [30, 37] as const;
/** Courtyard trees: where the trunk stands, crown colours and a seed. */
const TREES = [
  [22, 36, [288, 2, 10], 3],
  [44, 41, [288, 2, 2], 8],
] as const;
const BRIDGE = [29, 34, 52, 60] as const;
/** Posts either side of the bridge at these rows carry its rails. */
const BRIDGE_POSTS = [54, 59] as const;
const bridge = (x: number, z: number) => within(x, z, BRIDGE[0], BRIDGE[2], BRIDGE[1], BRIDGE[3]);
const MOAT = [16, 54, 47, 59] as const;
const moat = (x: number, z: number) =>
  within(x, z, ...MOAT) &&
  !bridge(x, z) &&
  !((z === MOAT[1] || z === MOAT[3]) && (x === MOAT[0] || x === MOAT[2]));
const ground = (x: number, z: number) => {
  const [dx, dz] = [Math.max(8 - x, x - 55, 0), Math.max(8 - z, z - 55, 0)];
  return x >= 2 && x <= 61 && z >= 2 && z <= 61 && Math.hypot(dx, dz) <= 6.2;
};
/** Grass in soft clumps round the outside of the walls and along their feet inside. */
const grassy = (x: number, z: number) => {
  const wave = Math.sin(x * 0.7 + z * 0.3) + Math.cos(z * 0.6 - x * 0.25) + hash(x, z, 7);
  const outside = x < 8 || x > 55 || z < 8 || z > 51;
  const foot =
    (x >= 12 && x <= 13) || (x >= 50 && x <= 51) || (z >= 12 && z <= 13) || (z >= 46 && z <= 47);
  return (outside && wave > 0.6) || (foot && wave > 1.3);
};

/**
 * Banners: [x, z, course] of the left of the two headlight bricks they hang on, in a wall
 * facing +z. Each banner stands four studs up in front of a recess three courses tall.
 */
const BANNERS = [
  ...GATE_TOWERS.map(([x0]) => [x0 + 2, GATE_FRONT, 7] as const),
  [31, GATE[3], 7],
  [31, HALL[3], 9],
] as const;
const behindBanner = (x: number, z: number, n: number) =>
  BANNERS.some(
    ([bx, bz, first]) => z === bz && x >= bx && x <= bx + 1 && n >= first && n <= first + 3,
  );

const courtyard = (x: number, z: number) => within(x, z, 12, 12, 51, 47);
/** Cells something stands on at ground level, which the scattered rocks and plants keep off. */
const occupied = (x: number, z: number) =>
  wallAt(x, z) !== undefined ||
  gateTower(x, z) ||
  gateMiddle(x, z) ||
  keepTower(x, z) ||
  hall(x, z) ||
  within(x, z, HALL[0], HALL[3] + 1, HALL[1], HALL[3] + 3) ||
  within(x, z, HOUSE[0], HOUSE[2], HOUSE[1], HOUSE[3]) ||
  within(x, z, ARCADE[0], ARCADE[2], ARCADE[1], ARCADE[3]) ||
  within(x, z, WELL[0], WELL[1], WELL[0] + 3, WELL[1] + 3) ||
  TREES.some(([tx, tz]) => within(x, z, tx - 1, tz - 1, tx, tz)) ||
  TOWERS.some(([cx, cz]) => within(x, z, cx - 6, cz - 6, cx + 5, cz + 5)) ||
  bridge(x, z) ||
  moat(x, z);

/** One stone course of every wall, tower and building that has stonework at course `n`. */
function courseCell(x: number, z: number, n: number): string {
  if (behindBanner(x, z, n)) return ' ';
  // Plain courses bridge the slits and banner recesses, so no short brick lands over a gap.
  const bridging =
    (n === 6 && wallAt(x, z) !== undefined) ||
    (n === 11 && gateTower(x, z)) ||
    ((n === 7 || n === 13) && hall(x, z));
  const mottled = () => (bridging ? 'a' : stone(x, z, n * 13));
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
  if (gateTower(x, z)) {
    const [x0, x1] = GATE_TOWERS.find(([x0, x1]) => x >= x0 && x <= x1)!;
    if (n < GATE_TOWER_COURSES) return mottled();
    if (n === GATE_TOWER_COURSES)
      return rim(x, z, x0, GATE_BACK, x1, GATE_FRONT) && (x + z) % 2 === 0 ? 'a' : ' ';
    return ' ';
  }
  if (gateMiddle(x, z)) {
    const front = z === GATE[3];
    if (n < 4) return x >= PASSAGE[0] && x <= PASSAGE[1] ? ' ' : mottled();
    if (n === 4) return ' ';
    if (n === 5 && front) return ' ';
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
    if (x === HOUSE[1] && HOUSE_WINDOWS.some((w) => z >= w && z <= w + 1) && (n === 1 || n === 2))
      return ' ';
    if (n === 0) return mottled();
    if (n === HOUSE_COURSES - 1) return 'b';
    const corner = (x === HOUSE[0] || x === HOUSE[1]) && (z === HOUSE[2] || z === HOUSE[3]);
    const along = x === HOUSE[0] || x === HOUSE[1] ? z : x;
    return corner || along % 3 === 0 ? 'b' : 'w';
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
    return corner || along % 3 === 1 ? 'b' : 'w';
  }
  return ' ';
}

/** Slopes by length along the ridge, longest first. */
const SLOPES = [
  [4, '3037'],
  [3, '3038'],
  [2, '3039'],
  [1, '3040b'],
] as const;

/**
 * A run of 45 degree slopes `length` studs long, two deep, falling towards `facing`. [x, z] is
 * the run's min corner.
 */
function addSlopeRun(
  add: ExampleBrickAdder,
  color: number,
  facing: Facing,
  x: number,
  y: number,
  z: number,
  length: number,
) {
  const alongX = facing.endsWith('z');
  const rotation = ({ '-z': 0, '-x': 90, '+z': 180, '+x': 270 } as const)[facing];
  let offset = 0;
  while (offset < length) {
    const [size, partId] = SLOPES.find(([size]) => size <= length - offset)!;
    add(partId, color, alongX ? x + offset : x, y, alongX ? z : z + offset, rotation);
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
  color: number,
  gable: number,
) {
  const across = axis === 'x' ? z1 - z0 + 1 : x1 - x0 + 1;
  const length = axis === 'x' ? x1 - x0 + 1 : z1 - z0 + 1;
  for (let k = 0; k * 2 + 2 <= across; k++) {
    const level = y + k * 3;
    if (k * 2 + 2 === across) {
      // The ridge: double-sloped bricks along it.
      for (let offset = 0; offset < length; offset += 2) {
        if (axis === 'x') add('3043', color, x0 + offset, level, z0 + k, 0);
        else add('3043', color, x0 + k, level, z0 + offset, 90);
      }
      break;
    }
    if (axis === 'x') {
      addSlopeRun(add, color, '-z', x0, level, z0 + k, length);
      addSlopeRun(add, color, '+z', x0, level, z1 - k - 1, length);
      for (const x of [x0, x1])
        addRun(add, 'brick', gable, 'z', x, level, z0 + k + 2, across - k * 2 - 4);
    } else {
      addSlopeRun(add, color, '-x', x0 + k, level, z0, length);
      addSlopeRun(add, color, '+x', x1 - k - 1, level, z0, length);
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
  color: number,
) {
  let level = y;
  for (let k = 0; size - k * 2 >= 4; k++, level += 3) {
    const [a, span] = [k, size - k * 2];
    for (const [dx, dz, rotation] of CORNERS)
      add('3045', color, x + a + dx * (span - 2), level, z + a + dz * (span - 2), rotation);
    if (span > 4) {
      addSlopeRun(add, color, '-z', x + a + 2, level, z + a, span - 4);
      addSlopeRun(add, color, '+z', x + a + 2, level, z + a + span - 2, span - 4);
      addSlopeRun(add, color, '-x', x + a, level, z + a + 2, span - 4);
      addSlopeRun(add, color, '+x', x + a + span - 2, level, z + a + 2, span - 4);
    }
  }
  const middle = size / 2 - 1;
  add('3688', color, x + middle, level, z + middle);
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
 * Lays a straight run of `cells` (all in one line, in order) in short bricks, the split and
 * colours varying course by course; `skip` cells are left out and split the run.
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
  let index = 0;
  for (const size of split) {
    const piece = cells.slice(index, index + size);
    index += size;
    let start = 0;
    for (let end = 0; end <= piece.length; end++) {
      if (end < piece.length && !skip(...piece[end])) continue;
      if (end > start) {
        const [x, z] = piece[start];
        const roll = hash(x, z, salt + 1);
        const kind = end - start === 2 && roll > 0.8 ? 'masonry' : 'short';
        addRun(add, kind, roll < 0.22 ? DARK_STONE : STONE, axis, x, y, z, end - start);
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
        hash(cx + dx, cz + dz, n) < 0.25 ? DARK_STONE : STONE,
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
    addAreaMap(
      add,
      plan((x, z) => {
        const [dx, dz] = [x - cx, z - cz];
        const inside = Math.max(dx, dz) < BASE_HALF - 1 && Math.min(dx, dz) > -BASE_HALF;
        return inCross(dx, dz, BASE_HALF) && inside && !isWall(x, z) ? 'i' : ' ';
      }),
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
    add('54200', STONE, x, course(PLINTH_COURSES), z, rotation);
  }

  // The shaft.
  for (let n = PLINTH_COURSES; n < TOWER_COURSES; n++) {
    const y = course(n);
    for (const [dx, dz, rotation] of roundCorners(SHAFT))
      add(
        '2577',
        hash(cx + dx, cz + dz, n) < 0.25 ? DARK_STONE : STONE,
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
  addAreaMap(
    add,
    plan((x, z) => (inCross(x - cx, z - cz, BASE_HALF) ? 'c' : ' ')),
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
  for (const [level, cells] of [
    [top + 1, edge],
    [top + 4, edge.filter(([dx, dz]) => merlons.has(key(dx, dz)))],
  ] as const) {
    addBondedMap(
      add,
      plan((x, z) => {
        const [dx, dz] = [x - cx, z - cz];
        return cells.some(([ex, ez]) => ex === dx && ez === dz) && straight(dx, dz)
          ? stone(x, z, level)
          : ' ';
      }),
      level,
      LEGEND,
      level,
    );
    for (const [dx, dz] of cells)
      if (!straight(dx, dz))
        add('3062b', hash(dx, dz, level) < 0.2 ? DARK_STONE : STONE, cx + dx, level, cz + dz);
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

/**
 * A door frame drawn at `frame` and its door. Both go in already turned round, since the turn's
 * own door rule only knows frames that run along x.
 */
function addFramedDoor(
  drawnAdd: ExampleBrickAdder,
  frame: Omit<Brick, 'id'>,
  partId: string,
  color: number,
) {
  const { width, depth } = footprint({ id: 'frame', ...frame });
  const turned: Brick = {
    id: 'frame',
    ...frame,
    x: SIZE - frame.x - width,
    z: SIZE - frame.z - depth,
    rotation: ((frame.rotation + 180) % 360) as Rotation,
  };
  drawnAdd(turned.partId, turned.color, turned.x, turned.y, turned.z, turned.rotation);
  addDoor(drawnAdd, partId, color, turned);
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

export const castle: ExampleDefinition = {
  id: 'castle',
  name: 'Castle',
  tags: ['castle', 'medieval', 'towers', 'gatehouse', 'keep', 'moat', 'drawbridge', 'banners'],
  expectedPieceCount: 7959,
  buildArea: SIZE,
  brickIdPrefix: 'castle',
  build(drawnAdd) {
    for (const plate of layPlateFloor({ x: 0, z: 0, width: SIZE, depth: SIZE }, STONE)!.bricks)
      drawnAdd(plate.partId, plate.color, plate.x, plate.y, plate.z, plate.rotation);
    const add = glazeWindows(turnAround(drawnAdd, SIZE), PANES);

    // Ground: sand inside a rounded edge, grass round the walls, the moat and the bridge deck.
    addAreaMap(
      add,
      plan((x, z) => {
        if (bridge(x, z)) return 'b';
        if (moat(x, z)) return 'w';
        if (!ground(x, z)) return ' ';
        return grassy(x, z) ? 'g' : 's';
      }),
      2,
      { s: ['plate', SAND], g: ['plate', GRASS], w: ['plate', WATER], b: ['plate', TIMBER] },
    );

    // Stonework, course by course.
    for (let n = 0; n <= KEEP_TOWER_COURSES; n++)
      addBondedMap(
        add,
        plan((x, z) => courseCell(x, z, n)),
        course(n),
        LEGEND,
        n,
      );

    for (const [cx, cz] of TOWERS) addRoundTower(add, cx, cz);

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
    addRowMap(
      add,
      plan((x, z) => {
        const wall = wallAt(x, z);
        return wall && (wall.depth === 1 || wall.depth === 2) ? stone(x, z, 99) : ' ';
      }),
      course(WALL_COURSES),
      TILES,
    );
    addRowMap(
      add,
      plan((x, z) => (wallAt(x, z)?.depth === 3 ? 'c' : ' ')),
      course(WALL_COURSES + 1),
      TILES,
    );
    addRowMap(
      add,
      plan((x, z) => {
        const wall = wallAt(x, z);
        return wall?.depth === 0 && merlon(wall.along) ? 'c' : ' ';
      }),
      course(WALL_COURSES + 2),
      TILES,
    );

    // Gatehouse: the passage roofed over with long bricks behind an arch, a portcullis in it,
    // flat tops behind the merlons and banners on its three fronts.
    for (let z = GATE[2]; z < GATE[3]; z++)
      addRun(add, 'brick', STONE, 'x', GATE[0], course(4), z, 6);
    add('3307', STONE, GATE[0], course(4), GATE[3], 90);
    for (let n = 0; n < 4; n++)
      for (const x of [PASSAGE[0], PASSAGE[0] + 2]) add('2877', BLACK, x, course(n), GATE[3], 90);
    addRowMap(
      add,
      plan((x, z) => {
        if (!gateTower(x, z)) return ' ';
        const [x0, x1] = GATE_TOWERS.find(([x0, x1]) => x >= x0 && x <= x1)!;
        return rim(x, z, x0, GATE_BACK, x1, GATE_FRONT) ? ' ' : stone(x, z, 5);
      }),
      course(GATE_TOWER_COURSES),
      TILES,
    );
    addRowMap(
      add,
      plan((x, z) => {
        if (!gateTower(x, z)) return ' ';
        const [x0, x1] = GATE_TOWERS.find(([x0, x1]) => x >= x0 && x <= x1)!;
        return rim(x, z, x0, GATE_BACK, x1, GATE_FRONT) && (x + z) % 2 === 0 ? 'c' : ' ';
      }),
      course(GATE_TOWER_COURSES + 1),
      TILES,
    );
    addRowMap(
      add,
      plan((x, z) => (gateMiddle(x, z) && z > GATE[2] && z < GATE[3] ? stone(x, z, 5) : ' ')),
      course(GATE_COURSES),
      TILES,
    );
    addRowMap(
      add,
      plan((x, z) =>
        gateMiddle(x, z) && (z === GATE[2] || z === GATE[3]) && merlon(x) ? 'c' : ' ',
      ),
      course(GATE_COURSES + 1),
      TILES,
    );
    for (const [x, z, first] of BANNERS) addBanner(add, x, course(first), z);

    // Keep: arched door up a flight of steps, windows, a banner over the door, a red roof behind
    // the hall's parapet and pyramid roofs on its towers.
    addFramedDoor(
      drawnAdd,
      { partId: '60596', color: STONE, x: KEEP_DOOR, y: course(1), z: HALL[3], rotation: 90 },
      '60616a',
      TIMBER,
    );
    add('3307', STONE, KEEP_DOOR - 1, course(7), HALL[3], 90);
    add('3009', STONE, KEEP_DOOR - 1, course(7), HALL[3] - 1, 90);
    for (const [x, z, rotation, first] of KEEP_WINDOWS) {
      add('30044', STONE, x, course(first), z, rotation);
      add('3023b', STONE, x, course(first) + 8, z, rotation);
    }
    add('3009', STONE, KEEP_DOOR - 1, G, HALL[3] + 1, 90);
    for (const y of [G, G + 1]) add('3666', DARK_STONE, KEEP_DOOR - 1, y, HALL[3] + 2, 90);
    add('3666', STONE, KEEP_DOOR - 1, G, HALL[3] + 3, 90);
    addRowMap(
      add,
      plan((x, z) =>
        hall(x, z) && z > ROOF_FRONT && courseCell(x, z, HALL_COURSES) === ' '
          ? stone(x, z, 3)
          : ' ',
      ),
      course(HALL_COURSES),
      TILES,
    );
    addRowMap(
      add,
      plan((x, z) => (hall(x, z) && courseCell(x, z, HALL_COURSES) !== ' ' ? 'c' : ' ')),
      course(HALL_COURSES + 1),
      TILES,
    );
    addGableRoof(
      add,
      [HALL[0], HALL[1], KEEP_BACK, ROOF_FRONT],
      'x',
      course(HALL_COURSES),
      RED,
      STONE,
    );
    for (const [x0] of KEEP_TOWERS)
      addPyramidRoof(add, x0, KEEP_BACK, course(KEEP_TOWER_COURSES), 8, RED);

    // The timbered house: a plank door, two windows and a red roof.
    addFramedDoor(
      drawnAdd,
      { partId: '3579', color: TIMBER, x: HOUSE[1], y: G, z: HOUSE_DOOR, rotation: 0 },
      '3193a',
      DARK_TIMBER,
    );
    for (const z of HOUSE_WINDOWS) add('60592', TIMBER, HOUSE[1], course(1), z, 0);
    addGableRoof(
      add,
      [HOUSE[0], HOUSE[1], HOUSE[2], HOUSE[3]],
      'z',
      course(HOUSE_COURSES),
      RED,
      WHITE,
    );

    // The arcade hall: two stone arches below, timbered rooms above and a red roof.
    for (const z of ARCHES) add('3659', STONE, ARCADE[0], course(2), z);
    for (const z of ARCADE_WINDOWS) add('60592', TIMBER, ARCADE[0], course(3), z, 0);
    addGableRoof(
      add,
      [ARCADE[0], ARCADE[1], ARCADE[2], ARCADE[3]],
      'z',
      course(ARCADE_COURSES),
      RED,
      WHITE,
    );

    // The well: a round stone kerb, two posts and a little red roof.
    const well = WELL;
    for (const n of [0, 1]) addRing(add, well[0], well[1], course(n), n);
    for (const [dx, dz] of [
      [0, 1],
      [3, 2],
    ])
      for (const n of [2, 3, 4]) add('3062b', TIMBER, well[0] + dx, course(n), well[1] + dz);
    add('3031', TIMBER, well[0], course(5), well[1]);
    for (const [dx, dz, rotation] of CORNERS)
      add('3045', RED, well[0] + dx * 2, course(5) + 1, well[1] + dz * 2, rotation);
    add('3688', RED, well[0] + 1, course(5) + 4, well[1] + 1);

    // Courtyard trees.
    for (const [x, z, crown, seed] of TREES) addTree(add, x, z, G, crown, TIMBER, 2, seed);

    // Drawbridge planks with posts and rails either side.
    for (let z = BRIDGE[2]; z <= BRIDGE[3]; z++) {
      const posts = (BRIDGE_POSTS as readonly number[]).includes(z);
      addRun(add, 'tile', z % 2 ? TIMBER : DARK_TIMBER, 'x', posts ? 30 : 29, G, z, posts ? 4 : 6);
    }
    for (const x of [BRIDGE[0], BRIDGE[1]]) {
      for (const z of BRIDGE_POSTS) for (const y of [G, G + 3]) add('3062b', DARK_TIMBER, x, y, z);
      add('3666', TIMBER, x, G + 6, BRIDGE_POSTS[0]);
    }

    // Lily pads and ripples on the moat, rocks and bushes along its banks.
    for (let z = MOAT[1]; z <= MOAT[3]; z++)
      for (let x = MOAT[0]; x <= MOAT[2]; x++) {
        if (!moat(x, z)) continue;
        const roll = hash(x, z, 41);
        if (roll < 0.06) add('98138', LEAF, x, G, z);
        else if (roll < 0.09) add('98138', 43, x, G, z);
      }

    // Rocks along the moat's outer bank and at the feet of the front towers, shrubs and flowers
    // on the grass, and worn cobbles here and there in the courtyard.
    const taken = new Set<string>();
    const free = (x: number, z: number) => ground(x, z) && !occupied(x, z) && !taken.has(key(x, z));
    for (let z = 0; z < SIZE; z++)
      for (let x = 0; x < SIZE; x++) {
        if (!free(x, z)) continue;
        const roll = hash(x, z, 77);
        const bank =
          (z === MOAT[3] + 1 && x >= MOAT[0] - 1 && x <= MOAT[2] + 1) ||
          (z >= MOAT[1] && z <= MOAT[3] && (x === MOAT[0] - 1 || x === MOAT[2] + 1));
        if (bank && roll < 0.55) {
          taken.add(key(x, z));
          if (roll < 0.2)
            add(
              '54200',
              roll < 0.1 ? DARK_STONE : STONE,
              x,
              G,
              z,
              ([0, 90, 180, 270] as const)[Math.floor(roll * 40) % 4],
            );
          else if (roll < 0.32) {
            add('3062b', DARK_STONE, x, G, z);
            add('54200', STONE, x, G + 3, z, 180);
          } else if (roll < 0.42) add('35464', DARK_STONE, x, G, z);
          else add('98138', STONE, x, G, z);
          continue;
        }
        // A shrub stands on one stud in the middle of its 2 x 2, so it reaches into a 3 x 3.
        const spread = [0, 1, 2].flatMap((dx) => [0, 1, 2].map((dz) => [x + dx, z + dz] as const));
        if (grassy(x, z) && roll < 0.07 && spread.every(([sx, sz]) => free(sx, sz))) {
          for (const [sx, sz] of spread) taken.add(key(sx, sz));
          add('4727', roll < 0.035 ? FOREST : GRASS, x + 0.5, G, z + 0.5);
          continue;
        }
        if (grassy(x, z) && roll < 0.2) {
          taken.add(key(x, z));
          add('98138', roll < 0.14 ? WHITE : 14, x, G, z);
          continue;
        }
        if (!grassy(x, z) && courtyard(x, z) && roll < 0.08) {
          taken.add(key(x, z));
          add('3070b', roll < 0.05 ? DARK_SAND : STONE, x, G, z);
        }
      }
  },
};

/** A 4 x 4 ring of masonry, round bricks at its corners. */
function addRing(add: ExampleBrickAdder, x: number, z: number, y: number, n: number) {
  for (const [dx, dz] of [
    [0, 0],
    [3, 0],
    [0, 3],
    [3, 3],
  ])
    add('3062b', n % 2 ? STONE : DARK_STONE, x + dx, y, z + dz);
  add('98283', STONE, x + 1, y, z, 90);
  add('98283', STONE, x + 1, y, z + 3, 90);
  add('98283', STONE, x, y, z + 1);
  add('98283', STONE, x + 3, y, z + 1);
}
