import { addAreaMap, addBondedMap, addRun, glazeWindows, turnAround } from './layout.ts';
import type { RunKind } from './layout.ts';
import type { ExampleBrickAdder, ExampleDefinition } from './types.ts';
import type { Facing, Rotation } from '../core.ts';
import { layPlateFloor } from '../board.ts';

// The museum again at twice the scale, 0.75 studs to the metre, on the 128-stud board. Plans
// are drawn top-down with the front at high z; the building is symmetric about x = 64. Walls
// are sixteen courses: a rusticated granite plinth, tall round-headed ground-floor windows,
// a string course, upper windows under segmental arches and a dentilled cornice.
const SIZE = 128;

const SANDSTONE = 28;
const TRIM = 19;
const GRANITE = 71;
const SLATE = 72;
const COPPER = 378;
const LAWN = 2;
const LEAVES = 10;
const BLOSSOM = 14;
const BARK = 70;
const WHITE = 15;
const GLASS = 47;
const LAMP = 46;
const BLACK = 0;
const SAND_RED = 335;
const GOLD = 297;
const RED = 4;
const PINK = 13;
const BROWN = 6;

/** Heights: floor top, terrace top, the ceiling at the eaves, the roof base, ridge and tiles. */
const GROUND = 2;
const BASE = GROUND + 7;
const COURSES = 16;
const CEILING = BASE + COURSES * 3;
const ROOF = CEILING + 1;
const ROOF_STEPS = 8;
const FLAT = ROOF + ROOF_STEPS * 3;
const CAP = FLAT + 1;
/** Courses that are tan bands: the sill course, the string course, the cornice and turret top. */
const BANDS = new Set([2, 10, 15, 23]);
const TURRET_COURSES = 24;

/** Main block outline, the entrance pavilion and its front wall. */
const [WEST, EAST, BACK, FRONT] = [16, 111, 34, 61];
const [PAVILION_WEST, PAVILION_EAST] = [52, 75];
const PAVILION_FRONT = 67;

/** Façade bays: 8-stud projections, two studs deep, in front of both long walls. */
const BAYS = [20, 32, 44, 76, 88, 100];
const RECESSES = [28, 40, 84, 96];

const key = (x: number, z: number) => `${x}:${z}`;
const within = (x: number, z: number, x0: number, z0: number, x1: number, z1: number) =>
  x >= x0 && x <= x1 && z >= z0 && z <= z1;
const rim = (x: number, z: number, x0: number, z0: number, x1: number, z1: number) =>
  within(x, z, x0, z0, x1, z1) && (x === x0 || x === x1 || z === z0 || z === z1);
const plan = (cell: (x: number, z: number) => string) =>
  Array.from({ length: SIZE }, (_, z) =>
    Array.from({ length: SIZE }, (_, x) => cell(x, z)).join(''),
  );
/** Every cell of the board where `test` holds, as a set of keys. */
const cellSet = (test: (x: number, z: number) => boolean) => {
  const cells = new Set<string>();
  for (let z = 0; z < SIZE; z++)
    for (let x = 0; x < SIZE; x++) if (test(x, z)) cells.add(key(x, z));
  return cells;
};
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);
const NEIGHBOURS = [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dz) => [dx, dz] as const));

const inBay = (x: number) => BAYS.some((bay) => x >= bay && x <= bay + 7);
/** The cells a bay projects past its long wall. */
const isBay = (x: number, z: number) =>
  inBay(x) && ((z > FRONT && z <= FRONT + 2) || (z >= BACK - 2 && z < BACK));
const bayWall = (x: number, z: number) =>
  BAYS.some(
    (bay) => rim(x, z, bay, FRONT, bay + 7, FRONT + 2) || rim(x, z, bay, BACK - 2, bay + 7, BACK),
  );
/** The long wall doesn't run on behind a bay: each bay opens into the hall. */
const insideBay = (x: number, z: number) =>
  (z === FRONT || z === BACK) && BAYS.some((bay) => x > bay && x < bay + 7);

/** Octagonal corner turrets: 6 x 6 with the corners cut, overlapping the main block's corners. */
const TURRETS = [
  [WEST - 2, FRONT - 3],
  [EAST - 3, FRONT - 3],
  [WEST - 2, BACK - 2],
  [EAST - 3, BACK - 2],
] as const;
const isTurret = (x: number, z: number) =>
  TURRETS.some(
    ([tx, tz]) =>
      within(x, z, tx, tz, tx + 5, tz + 5) &&
      !((x === tx || x === tx + 5) && (z === tz || z === tz + 5)),
  );
const TURRET_WALLS = cellSet(
  (x, z) => isTurret(x, z) && NEIGHBOURS.some(([dx, dz]) => !isTurret(x + dx, z + dz)),
);

/**
 * Half-octagon apses behind the crossing and on both end walls. `cell` maps a stud u along the
 * wall and d out from it to the plan; `out`, `minus` and `plus` are the slope rotations facing
 * away from the wall and towards lower and higher u. Hidden partitions at `partitions` give the
 * ceiling plates a wall to rest on every eight studs.
 */
interface Apse {
  width: number;
  cell: (u: number, d: number) => readonly [number, number];
  out: Rotation;
  minus: Rotation;
  plus: Rotation;
  partitions: readonly number[];
}
const APSES: readonly Apse[] = [
  {
    width: 20,
    cell: (u, d) => [54 + u, BACK - 1 - d],
    out: 0,
    minus: 90,
    plus: 270,
    partitions: [7, 15],
  },
  {
    width: 16,
    cell: (u, d) => [WEST - 1 - d, 40 + u],
    out: 90,
    minus: 0,
    plus: 180,
    partitions: [7],
  },
  {
    width: 16,
    cell: (u, d) => [EAST + 1 + d, 40 + u],
    out: 270,
    minus: 0,
    plus: 180,
    partitions: [7],
  },
];
/** An apse's rows from the wall out, as [from, to] in u: four full rows, then the angled faces. */
const apseRows = (width: number): (readonly [number, number])[] => [
  ...[0, 1, 2, 3].map(() => [0, width - 1] as const),
  ...[1, 2, 3, 4].map((inset) => [inset, width - 1 - inset] as const),
];
const APSE_CELLS = new Set(
  APSES.flatMap(({ width, cell }) =>
    apseRows(width).flatMap(([from, to], d) => range(from, to).map((u) => key(...cell(u, d)))),
  ),
);
const isApse = (x: number, z: number) => APSE_CELLS.has(key(x, z));

const isPavilion = (x: number, z: number) =>
  within(x, z, PAVILION_WEST, FRONT, PAVILION_EAST, PAVILION_FRONT);
/** Everything the ceiling covers. */
const footprint = (x: number, z: number) =>
  (within(x, z, WEST, BACK, EAST, FRONT) || isBay(x, z) || isPavilion(x, z) || isApse(x, z)) &&
  !isTurret(x, z);
/** Cells inside the building's outline at wall height. */
const enclosed = (x: number, z: number) => footprint(x, z) || isTurret(x, z);
const apseWall = (x: number, z: number) =>
  isApse(x, z) && NEIGHBOURS.some(([dx, dz]) => !enclosed(x + dx, z + dz));
const PARTITIONS = new Set(
  APSES.flatMap(({ width, cell, partitions }) =>
    apseRows(width).flatMap(([from, to], d) =>
      partitions
        .filter((u) => u >= from && u <= to)
        .map((u) => cell(u, d))
        .filter(([x, z]) => !apseWall(x, z))
        .map(([x, z]) => key(x, z)),
    ),
  ),
);

/** The pavilion opens into the hall: the front wall doesn't run on behind it. */
const behindEntrance = (x: number, z: number) =>
  z === FRONT && x > PAVILION_WEST && x < PAVILION_EAST;
const WALLS = cellSet(
  (x, z) =>
    !isTurret(x, z) &&
    (((((rim(x, z, WEST, BACK, EAST, FRONT) ||
      rim(x, z, PAVILION_WEST, FRONT, PAVILION_EAST, PAVILION_FRONT)) &&
      !behindEntrance(x, z)) ||
      bayWall(x, z)) &&
      !insideBay(x, z)) ||
      apseWall(x, z) ||
      PARTITIONS.has(key(x, z))),
);
const wall = (x: number, z: number) => WALLS.has(key(x, z));

/**
 * The ways out of a wall cell: [dx, dz], a headlight brick's rotation facing that way, the
 * facing, and where a piece mounted on its side stud sits relative to the cell.
 */
const OUTWARD: readonly (readonly [number, number, Rotation, Facing, number, number])[] = [
  [0, 1, 180, '+z', 0, 0.8],
  [0, -1, 0, '-z', 0, -0.2],
  [-1, 0, 90, '-x', -0.2, 0],
  [1, 0, 270, '+x', 0.8, 0],
];
/** The one way out of a wall cell on a straight stretch of outside wall, if it has one. */
const outward = (x: number, z: number) => {
  const ways = OUTWARD.filter(([dx, dz]) => !enclosed(x + dx, z + dz));
  return ways.length === 1 ? ways[0] : undefined;
};
/** Whether the cell in front of a wall cell has a wall either side, as in an inside corner. */
const inCorner = (x: number, z: number) => {
  const [dx, dz] = outward(x, z)!;
  return enclosed(x + dx + dz, z + dz + dx) || enclosed(x + dx - dz, z + dz - dx);
};
/** Outside corners, where two outside faces meet. */
const isCorner = (x: number, z: number) =>
  OUTWARD.filter(([dx, dz]) => !enclosed(x + dx, z + dz)).length >= 2;
/** Turret and apse corners are round bricks, to soften their outlines. */
const ROUND_CELLS = cellSet(
  (x, z) =>
    (TURRET_WALLS.has(key(x, z)) &&
      OUTWARD.filter(([dx, dz]) => !isTurret(x + dx, z + dz)).length >= 2) ||
    (isApse(x, z) && apseWall(x, z) && isCorner(x, z)),
);

/**
 * Windows: a frame of `width` studs from [x, z] along x (rotation 90) or z (rotation 0), set in
 * at `course`, with an arch over it at `archCourse` whose legs stand on the jambs.
 */
interface Window {
  x: number;
  z: number;
  rotation: 0 | 90;
  width: 2 | 4;
  frame: string;
  course: number;
  arch: string;
  archCourse: number;
}
const FRAME_COURSES: Readonly<Record<string, number>> = {
  '2493b': 5,
  '60594': 3,
  '60593': 3,
  '60592': 2,
};
const ARCH_COURSES: Readonly<Record<string, number>> = { '3307': 2, '92950': 1, '3659': 1 };

/** Window openings in the walls, as [x, z, rotation]: each a tall window and one above it. */
const OPENINGS: readonly (readonly [number, number, 0 | 90])[] = [
  ...BAYS.flatMap((bay) => [[bay + 2, FRONT + 2, 90] as const, [bay + 2, BACK - 2, 90] as const]),
  ...RECESSES.flatMap((x) => [[x, FRONT, 90] as const, [x, BACK, 90] as const]),
  [59, BACK - 8, 90],
  [65, BACK - 8, 90],
  [WEST - 8, 46, 0],
  [EAST + 8, 46, 0],
];
const MAIN_WINDOWS: readonly Window[] = OPENINGS.flatMap(([x, z, rotation]) => [
  { x, z, rotation, width: 4, frame: '2493b', course: 3, arch: '3307', archCourse: 8 },
  { x, z, rotation, width: 4, frame: '60594', course: 11, arch: '92950', archCourse: 14 },
]);
/** Each turret has a window on each outside face at three levels. */
const TURRET_WINDOWS: readonly Window[] = TURRETS.flatMap(([tx, tz]) =>
  (
    [
      [tx, tz + 2, 0, tx - 1, tz + 2],
      [tx + 5, tz + 2, 0, tx + 6, tz + 2],
      [tx + 2, tz, 90, tx + 2, tz - 1],
      [tx + 2, tz + 5, 90, tx + 2, tz + 6],
    ] as const
  )
    .filter(([, , , outsideX, outsideZ]) => !enclosed(outsideX, outsideZ))
    .flatMap(([x, z, rotation]) =>
      [4, 11, 19].map((course): Window => ({
        x,
        z,
        rotation,
        width: 2,
        frame: '60593',
        course,
        arch: '3659',
        archCourse: course + 3,
      })),
    ),
);
/** The pavilion's sides show only three studs past the bays beside it: narrow windows. */
const PAVILION_WINDOWS: readonly Window[] = [PAVILION_WEST, PAVILION_EAST].flatMap((x) =>
  [4, 11].map((course): Window => ({
    x,
    z: FRONT + 3,
    rotation: 0,
    width: 2,
    frame: '60593',
    course,
    arch: '3659',
    archCourse: course + 3,
  })),
);
const WINDOWS = [...MAIN_WINDOWS, ...TURRET_WINDOWS, ...PAVILION_WINDOWS];
const windowCells = (window: Window, from: number, length: number) =>
  range(from, from + length - 1).map((offset) =>
    window.rotation === 90 ? key(window.x + offset, window.z) : key(window.x, window.z + offset),
  );

/** The main door: two leaves under an arch, in the pavilion front. */
const DOOR = [60, 67] as const;
/** Headlight bricks under each tall window read as basement lights in the plinth. */
const BASEMENT_CELLS = new Set(
  MAIN_WINDOWS.filter(({ course }) => course === 3).flatMap((window) => windowCells(window, 0, 4)),
);
/** Cells left out of each course: windows, the arches over them, the door and basement lights. */
const OPEN_CELLS = new Map<number, Set<string>>();
const openCells = (course: number, cells: readonly string[]) => {
  const set = OPEN_CELLS.get(course) ?? new Set<string>();
  for (const cell of cells) set.add(cell);
  OPEN_CELLS.set(course, set);
};
for (const window of WINDOWS) {
  for (let course = window.course; course < window.course + FRAME_COURSES[window.frame]; course++)
    openCells(course, windowCells(window, 0, window.width));
  for (
    let course = window.archCourse;
    course < window.archCourse + ARCH_COURSES[window.arch];
    course++
  )
    openCells(course, windowCells(window, -1, window.width + 2));
}
for (let course = 0; course < 9; course++)
  openCells(
    course,
    range(DOOR[0], DOOR[1]).map((x) => key(x, PAVILION_FRONT)),
  );
openCells(1, [...BASEMENT_CELLS]);
const isOpen = (x: number, z: number, course: number) =>
  OPEN_CELLS.get(course)?.has(key(x, z)) ?? false;
const JAMBS = new Set(
  WINDOWS.flatMap((window) => [
    ...windowCells(window, -1, 1),
    ...windowCells(window, window.width, 1),
  ]),
);

/**
 * Dentils under the cornice: every other cell of straight outside wall in the top band is a
 * headlight brick with a flat tile on its side stud. The portal hides the pavilion front.
 */
const dentil = (x: number, z: number, course: number) =>
  course === COURSES - 1 &&
  (x + z) % 2 === 0 &&
  wall(x, z) &&
  !ROUND_CELLS.has(key(x, z)) &&
  outward(x, z) !== undefined &&
  !inCorner(x, z) &&
  !(z === PAVILION_FRONT && x >= PAVILION_WEST && x <= PAVILION_EAST);

/**
 * Sandstone walls mix plain bricks with patches of masonry profile bricks, rusticated low down
 * and only here and there above, with scattered sand red bricks for the mottled stonework.
 */
const stone = (x: number, z: number, course: number, density: number) => {
  const patch = Math.floor((x + z + (course % 2) * 2) / 4);
  if ((patch * 5 + course * 7 + x * 3 + z) % 11 === 0) return 'r';
  return (patch * 7 + course * 3) % 10 < density ? 'm' : 'w';
};
/**
 * Wall courses: a granite plinth, tan bands, and sandstone between with tan quoins at corners
 * and window jambs on every other course. Hidden partitions are plain sandstone.
 */
const material = (x: number, z: number, course: number) => {
  if (PARTITIONS.has(key(x, z))) return 'w';
  if (course <= 1) return 'p';
  if (BANDS.has(course)) return 'b';
  if (course % 2 === 1 && (isCorner(x, z) || JAMBS.has(key(x, z)))) return 'b';
  return stone(x, z, course, course < 8 ? 6 : course < 10 ? 4 : 3);
};

const WALL_LEGEND: Readonly<Record<string, readonly [RunKind, number]>> = {
  p: ['masonry', GRANITE],
  w: ['brick', SANDSTONE],
  m: ['masonry', SANDSTONE],
  r: ['brick', SAND_RED],
  b: ['brick', TRIM],
};

/** Ceiling areas as [x0, z0, x1, z1]: the main span with a two-stud cornice, the ends, the pavilion. */
const MAIN_CEILING = [WEST + 4, BACK - 2, EAST - 4, FRONT + 2] as const;
const END_CEILINGS = [
  [WEST - 2, BACK + 4, WEST + 3, FRONT - 4],
  [EAST - 3, BACK + 4, EAST + 2, FRONT - 4],
] as const;
const PAVILION_CEILING = [PAVILION_WEST - 2, FRONT + 3, PAVILION_EAST + 2, PAVILION_FRONT] as const;
const CEILINGS = [MAIN_CEILING, ...END_CEILINGS, PAVILION_CEILING];
const inCeiling = (x: number, z: number) => CEILINGS.some((area) => within(x, z, ...area));

/** The central block rising through the roof over the crossing, and the tower on it. */
const CENTRAL = [PAVILION_WEST, 44, PAVILION_EAST, PAVILION_FRONT] as const;
/** The central block's walls, with a hidden cross inside so the flat roof has walls to rest on. */
const centralWall = (x: number, z: number) =>
  rim(x, z, ...CENTRAL) || (within(x, z, ...CENTRAL) && (x === 63 || z === 55));
const TOWER = [58, 42, 69, 53] as const;
const CHIMNEYS = [
  [54, 46],
  [72, 46],
] as const;
const CENTRAL_WINDOWS: readonly Window[] = [
  {
    x: 54,
    z: PAVILION_FRONT,
    rotation: 90,
    width: 4,
    frame: '60594',
    course: 1,
    arch: '92950',
    archCourse: 4,
  },
  {
    x: 70,
    z: PAVILION_FRONT,
    rotation: 90,
    width: 4,
    frame: '60594',
    course: 1,
    arch: '92950',
    archCourse: 4,
  },
  {
    x: 62,
    z: PAVILION_FRONT,
    rotation: 90,
    width: 4,
    frame: '60594',
    course: 3,
    arch: '92950',
    archCourse: 6,
  },
  {
    x: PAVILION_WEST,
    z: FRONT + 3,
    rotation: 0,
    width: 2,
    frame: '60593',
    course: 1,
    arch: '3659',
    archCourse: 4,
  },
  {
    x: PAVILION_EAST,
    z: FRONT + 3,
    rotation: 0,
    width: 2,
    frame: '60593',
    course: 1,
    arch: '3659',
    archCourse: 4,
  },
];
/** Tower windows: two on each face, between the corners and a central pier. */
const TOWER_WINDOWS: readonly Window[] = [
  ...[60, 66].flatMap((x) => [TOWER[1], TOWER[3]].map((z) => ({ x, z, rotation: 90 as const }))),
  ...[44, 50].flatMap((z) => [TOWER[0], TOWER[2]].map((x) => ({ x, z, rotation: 0 as const }))),
].map((opening) => ({
  ...opening,
  width: 2,
  frame: '60593',
  course: 1,
  arch: '3659',
  archCourse: 4,
}));

/** The terrace the museum stands on, and its front steps. */
const TERRACE = [8, 24, 119, 83] as const;
const STEPS = [54, 73] as const;
/** The portal in front of the door: columns either side and a pier beyond each. */
const COLUMNS = [57, 69];
const PIERS = [52, 72];
const PORTAL = PAVILION_FRONT + 1;
const isPortal = (x: number, z: number) =>
  (z === PORTAL || z === PORTAL + 1) &&
  [...COLUMNS.map((x0) => [x0, x0 + 1]), ...PIERS.map((x0) => [x0, x0 + 3])].some(
    ([x0, x1]) => x >= x0 && x <= x1,
  );
/** Balustrade lines along the terrace edge, each a post then four-stud spans, posts at both ends. */
const BALUSTRADE_LINES: readonly (readonly ['x' | 'z', number, number, number])[] = [
  ['x', TERRACE[3], 8, 48],
  ['x', TERRACE[3], 79, 119],
  ['x', TERRACE[1], 8, 63],
  ['x', TERRACE[1], 64, 119],
  ...[TERRACE[0], TERRACE[2]].flatMap((x) => [
    ['z', x, 25, 40] as const,
    ['z', x, 57, 82] as const,
  ]),
];
const BALUSTRADE_CELLS = new Set(
  BALUSTRADE_LINES.flatMap(([axis, line, from, to]) =>
    range(from, to).map((at) => (axis === 'x' ? key(at, line) : key(line, at))),
  ),
);
/** Lamps on the terrace either side of the portal. */
const TERRACE_LAMPS = [
  [44, 76],
  [83, 76],
] as const;

/** A row of 45 degree roof slopes, split into the widest pieces that fit. */
function addSlopeRun(
  add: ExampleBrickAdder,
  from: number,
  to: number,
  y: number,
  line: number,
  rotation: Rotation,
  color = SLATE,
) {
  // Rotations 0 and 180 run along x at z = line; 90 and 270 run along z at x = line.
  for (let at = from; at <= to;) {
    const width = Math.min(4, to - at + 1);
    const partId = { 4: '3037', 3: '3038', 2: '3039', 1: '3040b' }[width]!;
    if (rotation % 180) add(partId, color, line, y, at, rotation);
    else add(partId, color, at, y, line, rotation);
    at += width;
  }
}

/**
 * A faceted slate roof over an apse, a layer a brick high at a time. Each layer steps a stud in
 * from every outside face: straight faces get two-deep slopes whose back row carries the next
 * layer, the angled faces cheese slopes, and the rest of the layer is solid brick underneath.
 */
function addApseRoof(add: ExampleBrickAdder, { width, cell, out, minus, plus }: Apse) {
  const slope = (u0: number, u1: number, d0: number, d1: number, rotation: Rotation, y: number) => {
    // Rotations 90 and 270 run along z, 0 and 180 along x; the line is the other axis.
    const [[x0, z0], [x1, z1]] = [cell(u0, d0), cell(u1, d1)];
    const [along0, along1, across] =
      rotation % 180 ? [z0, z1, Math.min(x0, x1)] : [x0, x1, Math.min(z0, z1)];
    addSlopeRun(add, Math.min(along0, along1), Math.max(along0, along1), y, across, rotation);
  };
  let region = new Set(
    apseRows(width).flatMap(([from, to], d) => range(from, to).map((u) => key(u, d))),
  );
  for (let layer = 0; region.size; layer++) {
    const y = ROOF + layer * 3;
    const has = (u: number, d: number) => region.has(key(u, d));
    const cells = [...region].map((cell) => cell.split(':').map(Number) as [number, number]);
    const next = new Set(
      cells
        .filter(([u, d]) => has(u - 1, d) && has(u + 1, d) && has(u, d + 1))
        .map(([u, d]) => key(u, d)),
    );
    const covered = new Set<string>();
    const faces = {
      out: [] as [number, number][],
      minus: [] as [number, number][],
      plus: [] as [number, number][],
    };
    const cheeses: [number, number, Rotation][] = [];
    // Outer faces first, then the sides; a slope whose back row is taken becomes a cheese slope.
    const rimCells = cells
      .filter(([u, d]) => !next.has(key(u, d)))
      .sort(([, first], [, second]) => second - first);
    for (const [u, d] of rimCells) {
      const exposed = [!has(u, d + 1), !has(u - 1, d), !has(u + 1, d)];
      const single = exposed.filter(Boolean).length === 1;
      const inner = exposed[0] ? [u, d - 1] : exposed[1] ? [u + 1, d] : [u - 1, d];
      const face = exposed[0] ? 'out' : exposed[1] ? 'minus' : 'plus';
      if (single && next.has(key(inner[0], inner[1])) && !covered.has(key(inner[0], inner[1]))) {
        faces[face].push([u, d]);
        covered.add(key(inner[0], inner[1]));
      } else cheeses.push([u, d, exposed[0] ? out : exposed[1] ? minus : plus]);
    }
    // Runs of neighbouring face cells become rows of slopes.
    const runs = (list: [number, number][], along: 0 | 1) => {
      const sorted = list.toSorted((a, b) => a[1 - along] - b[1 - along] || a[along] - b[along]);
      const result: [number, number, number][] = [];
      for (const cell of sorted) {
        const last = result.at(-1);
        if (last && last[2] === cell[1 - along] && last[1] + 1 === cell[along]) last[1]++;
        else result.push([cell[along], cell[along], cell[1 - along]]);
      }
      return result;
    };
    for (const [u0, u1, d] of runs(faces.out, 0)) slope(u0, u1, d - 1, d, out, y);
    for (const [d0, d1, u] of runs(faces.minus, 1)) slope(u, u + 1, d0, d1, minus, y);
    for (const [d0, d1, u] of runs(faces.plus, 1)) slope(u - 1, u, d0, d1, plus, y);
    for (const [u, d, rotation] of cheeses) {
      const [x, z] = cell(u, d);
      add('54200', SLATE, x, y, z, rotation);
    }
    const fill = new Set(
      [...next]
        .filter((uv) => !covered.has(uv))
        .map((uv) => {
          const [u, d] = uv.split(':').map(Number);
          return key(...cell(u, d));
        }),
    );
    if (fill.size)
      addAreaMap(
        add,
        plan((x, z) => (fill.has(key(x, z)) ? 'b' : ' ')),
        y,
        { b: ['brick', SLATE] },
      );
    region = next;
  }
}

/** A small finial: jumper plate along x, a round brick on its centre stud and a cone. */
function addFinial(add: ExampleBrickAdder, x: number, y: number, z: number, tip = COPPER) {
  add('3794b', TRIM, x, y, z, 90);
  add('3062b', TRIM, x + 0.5, y + 1, z);
  add('4589', tip, x + 0.5, y + 4, z);
}

/**
 * A steeple on a 6 x 6 plate: a slate cone, a copper drum and cone, and a gilded point, with
 * small gilded pinnacles at the plate's corners.
 */
function addSteeple(add: ExampleBrickAdder, x: number, y: number, z: number) {
  add('3958', TRIM, x, y, z);
  add('3943b', SLATE, x + 1, y + 1, z + 1);
  add('3941', COPPER, x + 2, y + 7, z + 2);
  add('3942c', COPPER, x + 2, y + 10, z + 2);
  add('3062b', GOLD, x + 2.5, y + 16, z + 2.5);
  add('4589', GOLD, x + 2.5, y + 19, z + 2.5);
  for (const [dx, dz] of [
    [0, 0],
    [5, 0],
    [0, 5],
    [5, 5],
  ]) {
    add('3062b', TRIM, x + dx, y + 1, z + dz);
    add('4589', GOLD, x + dx, y + 4, z + dz);
  }
}

/**
 * A big tree: a round trunk carrying two layers of four leaf canopies, each canopy hooked on one
 * of the trunk's studs, and a single canopy on top. `crowns` colours the layers bottom up.
 */
function addBigTree(
  add: ExampleBrickAdder,
  x: number,
  z: number,
  trunk: number,
  crowns: readonly [number, number, number],
) {
  for (const y of [0, 3, 6, 9]) add('3941', BARK, x, GROUND + y, z);
  let y = GROUND + trunk;
  for (let course = 12; course < trunk; course += 3) add('3941', BARK, x, GROUND + course, z);
  for (const color of crowns.slice(0, 2)) {
    add('2417', color, x - 4, y, z - 5);
    add('2417', color, x + 1, y, z - 5);
    add('2417', color, x + 1, y, z + 1, 180);
    add('2417', color, x - 4, y, z + 1, 180);
    add('3941', BARK, x, y + 1, z);
    y += 4;
  }
  add('2417', crowns[2], x - 2, y, z - 3);
  for (const [dx, dz] of [
    [-1, -2],
    [1, -2],
    [-2, 0],
    [2, 0],
  ])
    add('98138', crowns[2], x + dx, y + 1, z + dz);
}

/** A bush on a jumper, so its centre peg finds a stud on the floor. */
function addBush(add: ExampleBrickAdder, x: number, z: number, y = GROUND) {
  add('87580', LAWN, x + 1, y, z + 1);
  add('6064', LEAVES, x, y + 1, z);
}

/** A cast-iron lamp post with a lantern. */
function addLampPost(add: ExampleBrickAdder, x: number, z: number, y = GROUND) {
  add('2453b', BLACK, x, y, z);
  add('6141', BLACK, x, y + 15, z);
  add('3062b', LAMP, x, y + 16, z);
  add('98138', BLACK, x, y + 19, z);
}

export const nordiskaMuseet2: ExampleDefinition = {
  id: 'nordiska-museet-2',
  name: 'Nordiska Museet 2',
  tags: ['museum', 'landmark', 'stockholm', 'tower', 'stepped-gables', 'copper-roofs', 'park'],
  expectedPieceCount: 8464,
  buildArea: SIZE,
  brickIdPrefix: 'museet2',
  build(drawnAdd) {
    const add = glazeWindows(turnAround(drawnAdd, SIZE));
    const addWallCourse = (cell: (x: number, z: number) => string, y: number, course: number) =>
      addBondedMap(add, plan(cell), y, WALL_LEGEND, course);

    // The 128 x 128 lawn is a two-layer plate floor, so the whole board lifts as one.
    for (const plate of layPlateFloor({ x: 0, z: 0, width: SIZE, depth: SIZE }, LAWN)!.bricks)
      add(plate.partId, plate.color, plate.x, plate.y, plate.z, plate.rotation);

    // Raised terrace: a slate footing, two courses of granite masonry round a brick core, and
    // paving with a tan carpet from the door to the steps.
    const terrace = (x: number, z: number) => within(x, z, ...TERRACE);
    addAreaMap(
      add,
      plan((x, z) => (terrace(x, z) ? 's' : ' ')),
      GROUND,
      { s: ['plate', SLATE] },
    );
    for (const course of [0, 1]) {
      const y = GROUND + 1 + course * 3;
      addBondedMap(
        add,
        plan((x, z) => (rim(x, z, ...TERRACE) ? 'p' : ' ')),
        y,
        WALL_LEGEND,
        course,
      );
      addAreaMap(
        add,
        plan((x, z) => (terrace(x, z) && !rim(x, z, ...TERRACE) ? 'c' : ' ')),
        y,
        { c: ['brick', SLATE] },
      );
    }
    const lampCells = new Set(TERRACE_LAMPS.map(([x, z]) => key(x, z)));
    addAreaMap(
      add,
      plan((x, z) =>
        !terrace(x, z) ||
        enclosed(x, z) ||
        BALUSTRADE_CELLS.has(key(x, z)) ||
        isPortal(x, z) ||
        lampCells.has(key(x, z))
          ? ' '
          : x >= DOOR[0] && x <= DOOR[1] && z > PAVILION_FRONT
            ? 't'
            : 'g',
      ),
      BASE,
      { t: ['tile', TRIM], g: ['tile', GRANITE] },
    );
    for (const [x, z] of TERRACE_LAMPS) addLampPost(add, x, z, BASE);

    // Front steps down from the terrace, a plate each.
    const stepWidth = STEPS[1] - STEPS[0] + 1;
    for (let row = 0; row < 7; row++) {
      const z = TERRACE[3] + 1 + row;
      for (let layer = 0; layer < 6 - row; layer++)
        addRun(add, 'plate', GRANITE, 'x', STEPS[0], GROUND + layer, z, stepWidth);
      addRun(add, 'tile', GRANITE, 'x', STEPS[0], GROUND + 6 - row, z, stepWidth);
    }

    // Walls and turrets, a course at a time: the main walls stop at the cornice, the turrets
    // rise on past the eaves.
    for (let course = 0; course < TURRET_COURSES; course++) {
      const y = BASE + course * 3;
      const main = course < COURSES;
      const standing = (x: number, z: number) =>
        ((main && wall(x, z)) || TURRET_WALLS.has(key(x, z))) &&
        !isOpen(x, z, course) &&
        !dentil(x, z, course);
      addWallCourse(
        (x, z) => (standing(x, z) && !ROUND_CELLS.has(key(x, z)) ? material(x, z, course) : ' '),
        y,
        course,
      );
      for (const cell of ROUND_CELLS) {
        const [x, z] = cell.split(':').map(Number);
        if (standing(x, z)) add('3062b', WALL_LEGEND[material(x, z, course)][1], x, y, z);
      }
      if (course === COURSES - 1)
        for (const cell of WALLS) {
          const [x, z] = cell.split(':').map(Number);
          if (!dentil(x, z, course)) continue;
          const [, , rotation, facing, dx, dz] = outward(x, z)!;
          add('4070', TRIM, x, y, z, rotation);
          add('3070b', TRIM, x + dx, y + 0.5, z + dz, 0, facing);
        }
      if (course === 1)
        for (const cell of BASEMENT_CELLS) {
          const [x, z] = cell.split(':').map(Number);
          add('4070', SLATE, x, y, z, outward(x, z)![2]);
        }
      // The main door: two four-pane leaves in frames, then a plate across them, an arch and
      // two plates up to the next course, before anything rests on them. Behind, a dark panel
      // on two piers fills the half-moon.
      if (course < 6)
        for (const x of [DOOR[0] - 1, DOOR[1] + 1])
          add('3005', SANDSTONE, x, y, PAVILION_FRONT - 1);
      if (course === 0)
        for (const x of [DOOR[0], DOOR[0] + 4]) {
          add('60596', TRIM, x, y, PAVILION_FRONT, 90);
          add('60623', BARK, x, y, PAVILION_FRONT - 0.5, 90);
        }
      if (course === 6) {
        add('3460', TRIM, DOOR[0], y, PAVILION_FRONT, 90);
        add('3308', TRIM, DOOR[0], y + 1, PAVILION_FRONT, 90);
        for (const plate of [7, 8]) add('3460', TRIM, DOOR[0], y + plate, PAVILION_FRONT, 90);
      }
      if (course >= 6 && course < 9) add('6111', BARK, DOOR[0] - 1, y, PAVILION_FRONT - 1, 90);
      for (const window of WINDOWS) {
        if (window.course === course)
          add(window.frame, WHITE, window.x, y, window.z, window.rotation);
        if (window.archCourse === course)
          add(
            window.arch,
            TRIM,
            window.rotation === 90 ? window.x - 1 : window.x,
            y,
            window.rotation === 90 ? window.z : window.z - 1,
            window.rotation,
          );
      }
    }

    // Stone portal: round columns either side of the door carry an entablature, its frieze a
    // row of headlight bricks holding the gilded name band, a projecting cornice and a stepped
    // pediment with white raking edges and a seated figure on the apex.
    for (const x of COLUMNS) {
      add('3022', GRANITE, x, BASE, PORTAL);
      for (let course = 0; course < 13; course++)
        add('3941', course % 4 === 3 ? TRIM : GRANITE, x, BASE + 1 + course * 3, PORTAL);
      add('4032a', TRIM, x, BASE + 40, PORTAL);
      add('3022', TRIM, x, BASE + 41, PORTAL);
    }
    const [portalWest, portalEast] = [COLUMNS[0], COLUMNS[1] + 1];
    const portalWidth = portalEast - portalWest + 1;
    add('91988', GRANITE, portalWest, BASE + 42, PORTAL, 90);
    const frieze = BASE + 43;
    addRun(add, 'brick', GRANITE, 'x', portalWest, frieze, PORTAL, portalWidth);
    for (let x = portalWest; x <= portalEast; x++) {
      add('4070', GRANITE, x, frieze, PORTAL + 1, 180);
      if (x < DOOR[0] || x > DOOR[1]) add('3070b', TRIM, x, frieze + 0.5, PORTAL + 1.8, 0, '+z');
    }
    add('4162', GOLD, DOOR[0], frieze + 0.5, PORTAL + 1.8, 90, '+z');
    add('4282', TRIM, portalWest - 1, frieze + 3, PORTAL, 90);
    const pediment = frieze + 4;
    for (const [layer, partId] of [
      '91988',
      '2445',
      '3832',
      '3034',
      '3795',
      '3020',
      '3022',
    ].entries()) {
      add(
        partId,
        GRANITE,
        portalWest + layer,
        pediment + layer,
        PORTAL,
        partId === '3022' ? 0 : 90,
      );
      if (layer > 0)
        for (const x of [portalWest + layer - 1, portalEast - layer + 1])
          add('3069b', WHITE, x, pediment + layer, PORTAL);
    }
    const apex = pediment + 7;
    add('3069b', WHITE, 63, apex, PORTAL + 1, 90);
    add('3794b', GRANITE, 63, apex, PORTAL, 90);
    add('3062b', WHITE, 63.5, apex + 1, PORTAL);
    add('6141', WHITE, 63.5, apex + 4, PORTAL);
    add('98138', WHITE, 63.5, apex + 5, PORTAL);

    // Piers frame the portal, each with a name plaque, a statue in an arched niche and a
    // lantern spire on its outer half above the entablature.
    for (const x0 of PIERS) {
      const pier = (course: number, color: number) =>
        add('3001', color, x0, BASE + course * 3, PORTAL, 90);
      for (const [course, color] of [
        [0, GRANITE],
        [1, TRIM],
        [2, GRANITE],
        [4, TRIM],
      ] as const)
        pier(course, color);
      // The plaque: headlight bricks in front holding a white tile, a plain brick behind.
      addRun(add, 'brick', GRANITE, 'x', x0, BASE + 9, PORTAL, 4);
      for (let x = x0; x < x0 + 4; x++) add('4070', GRANITE, x, BASE + 9, PORTAL + 1, 180);
      add('2431', WHITE, x0, BASE + 9.5, PORTAL + 1.8, 90, '+z');
      // The niche: jambs either side of a standing white figure, under an arch.
      for (let course = 5; course < 9; course++) {
        const y = BASE + course * 3;
        for (const x of [x0, x0 + 3]) add('3004', GRANITE, x, y, PORTAL);
        add('3004', GRANITE, x0 + 1, y, PORTAL, 90);
      }
      const plinth = BASE + 15;
      add('3023b', GRANITE, x0 + 1, plinth, PORTAL + 1, 90);
      add('3794b', WHITE, x0 + 1, plinth + 1, PORTAL + 1, 90);
      add('3062b', WHITE, x0 + 1.5, plinth + 2, PORTAL + 1);
      add('3062b', WHITE, x0 + 1.5, plinth + 5, PORTAL + 1);
      add('6141', WHITE, x0 + 1.5, plinth + 8, PORTAL + 1);
      add('98138', WHITE, x0 + 1.5, plinth + 9, PORTAL + 1);
      add('3659', TRIM, x0, BASE + 27, PORTAL + 1, 90);
      add('3010', GRANITE, x0, BASE + 27, PORTAL, 90);
      for (const course of [10, 11, 12, 13]) pier(course, course % 2 ? TRIM : GRANITE);
      const outer = x0 < 64 ? x0 : x0 + 2;
      const inner = x0 < 64 ? x0 + 2 : x0;
      add('3068b', TRIM, inner, BASE + 42, PORTAL);
      for (const y of [BASE + 42, BASE + 45]) add('3003', GRANITE, outer, y, PORTAL);
      add('3022', TRIM, outer, BASE + 48, PORTAL);
      add('3941', GRANITE, outer, BASE + 49, PORTAL);
      add('3941', WHITE, outer, BASE + 52, PORTAL);
      add('3942c', GRANITE, outer, BASE + 55, PORTAL);
      add('4589', GOLD, outer + 0.5, BASE + 61, PORTAL + 0.5);
    }

    // Ceiling slab over every wall, overhanging the long walls and the ends by two studs as a
    // cornice. Apses are roofed a row at a time along the wall, each run ending on a wall or a
    // hidden partition; their first two rows lie under the main ceiling.
    addAreaMap(
      add,
      plan((x, z) => (inCeiling(x, z) ? 'c' : ' ')),
      CEILING,
      { c: ['plate', TRIM] },
      (x, z) => wall(x, z) || TURRET_WALLS.has(key(x, z)),
    );
    for (const { width, cell, partitions } of APSES) {
      const axis = cell(1, 0)[0] === cell(0, 0)[0] ? 'z' : 'x';
      for (const [d, [from, to]] of apseRows(width).entries()) {
        if (d < 2) continue;
        const cuts = [from - 1, ...partitions.filter((u) => u >= from && u < to), to];
        for (const [index, end] of cuts.slice(1).entries()) {
          const start = cuts[index] + 1;
          const [[x0, z0], [x1, z1]] = [cell(start, d), cell(end, d)];
          addRun(
            add,
            'plate',
            TRIM,
            axis,
            Math.min(x0, x1),
            CEILING,
            Math.min(z0, z1),
            end - start + 1,
          );
        }
      }
    }
    addAreaMap(
      add,
      plan((x, z) => (inCeiling(x, z) && !enclosed(x, z) ? 't' : ' ')),
      ROOF,
      { t: ['tile', TRIM] },
    );

    // Slate roof: eight slope courses front and back, sandstone gable ends, the front slopes
    // stopping either side of the central block and the lowest four clear of the turrets.
    for (let step = 0; step < ROOF_STEPS; step++) {
      const y = ROOF + step * 3;
      const [from, to] = step < 4 ? [WEST + 4, EAST - 4] : [WEST, EAST];
      addSlopeRun(add, from, to, y, BACK + step, 0);
      addSlopeRun(add, from, PAVILION_WEST - 1, y, FRONT - 1 - step, 180);
      addSlopeRun(add, PAVILION_EAST + 1, to, y, FRONT - 1 - step, 180);
      const [z0, z1] = [Math.max(BACK + 2 + step, BACK + 4), Math.min(FRONT - 2 - step, FRONT - 4)];
      for (const x of [WEST, EAST]) addRun(add, 'brick', SANDSTONE, 'z', x, y, z0, z1 - z0 + 1);
    }
    for (const apse of APSES) addApseRoof(add, apse);

    // Crow-stepped gables over the bays: a window between piers under an arch, then four steps
    // with copper points on their shoulders and a finial on top. A backing wall closes the gap
    // to the roof behind.
    for (const bay of BAYS)
      for (const [face, back] of [
        [FRONT + 2, FRONT + 1],
        [BACK - 2, BACK - 1],
      ]) {
        for (let step = 0; step < 4; step++) {
          const y = ROOF + step * 3;
          addRun(add, 'brick', SANDSTONE, 'x', bay, y, back, 8);
          if (step === 3) continue;
          addRun(add, 'brick', step === 1 ? TRIM : SANDSTONE, 'x', bay, y, face, 2);
          addRun(add, 'brick', step === 1 ? TRIM : SANDSTONE, 'x', bay + 6, y, face, 2);
        }
        add('60594', WHITE, bay + 2, ROOF, face, 90);
        add('92950', TRIM, bay + 1, ROOF + 9, face, 90);
        for (const x of [bay, bay + 7]) add('3005', TRIM, x, ROOF + 9, face);
        add('4162', TRIM, bay, ROOF + 12, back, 90);
        for (const [step, from, length] of [
          [0, bay, 8],
          [1, bay + 1, 6],
          [2, bay + 2, 4],
          [3, bay + 3, 2],
        ] as const) {
          const y = ROOF + 12 + step * 3;
          addRun(add, 'brick', step === 3 ? TRIM : SANDSTONE, 'x', from, y, face, length);
          if (step === 1) for (const x of [bay, bay + 7]) add('3070b', TRIM, x, y, face);
          if (step >= 2) for (const x of [from - 1, from + length]) add('4589', COPPER, x, y, face);
        }
        addFinial(add, bay + 3, ROOF + 24, face);
      }

    // Central block over the crossing, rising through the roof from the pavilion front to the
    // tower, with windows above the pediment and into the pavilion's sides.
    const centralJambs = new Set(
      CENTRAL_WINDOWS.flatMap((window) => [
        ...windowCells(window, -1, 1),
        ...windowCells(window, window.width, 1),
      ]),
    );
    for (let step = 0; step < ROOF_STEPS; step++) {
      const y = ROOF + step * 3;
      const open = (x: number, z: number) =>
        CENTRAL_WINDOWS.some(
          (window) =>
            (step >= window.course &&
              step < window.course + 3 &&
              windowCells(window, 0, window.width).includes(key(x, z))) ||
            (step === window.archCourse &&
              windowCells(window, -1, window.width + 2).includes(key(x, z))),
        );
      const corner = (x: number, z: number) =>
        (x === CENTRAL[0] || x === CENTRAL[2]) && (z === CENTRAL[1] || z === CENTRAL[3]);
      addBondedMap(
        add,
        plan((x, z) => {
          if (!centralWall(x, z) || open(x, z)) return ' ';
          if (!rim(x, z, ...CENTRAL)) return 'w';
          if (step === ROOF_STEPS - 1) return 'b';
          if (step % 2 === 1 && (corner(x, z) || centralJambs.has(key(x, z)))) return 'b';
          return stone(x, z, step, 3);
        }),
        y,
        WALL_LEGEND,
        step,
      );
      for (const window of CENTRAL_WINDOWS) {
        if (window.course === step)
          add(window.frame, WHITE, window.x, y, window.z, window.rotation);
        if (window.archCourse === step)
          add(
            window.arch,
            TRIM,
            window.rotation === 90 ? window.x - 1 : window.x,
            y,
            window.rotation === 90 ? window.z : window.z - 1,
            window.rotation,
          );
      }
    }

    // Flat roof: a slate slab over the ridge and the central block, glass skylights either
    // side under black cresting, the crown, chimneys and tower standing on it.
    const ridge = (x: number, z: number) =>
      within(x, z, WEST, BACK + ROOF_STEPS, EAST, FRONT - ROOF_STEPS);
    const central = (x: number, z: number) =>
      within(x, z, CENTRAL[0], BACK + ROOF_STEPS, CENTRAL[2], CENTRAL[3]);
    addAreaMap(
      add,
      plan((x, z) => (ridge(x, z) || central(x, z) ? 's' : ' ')),
      FLAT,
      { s: ['plate', SLATE] },
      (x, z) =>
        z === BACK + ROOF_STEPS ||
        (z === FRONT - ROOF_STEPS && !central(x, z)) ||
        centralWall(x, z) ||
        x === WEST ||
        x === EAST,
    );
    const skylight = (x: number) => (x >= 18 && x <= 49) || (x >= 78 && x <= 109);
    const crown = (x: number, z: number) =>
      (z === PAVILION_FRONT && x >= 56 && x <= 71) ||
      within(x, z, PAVILION_WEST, PAVILION_FRONT - 1, PAVILION_WEST + 1, PAVILION_FRONT) ||
      within(x, z, PAVILION_EAST - 1, PAVILION_FRONT - 1, PAVILION_EAST, PAVILION_FRONT);
    const chimney = (x: number, z: number) =>
      CHIMNEYS.some(([cx, cz]) => within(x, z, cx, cz, cx + 1, cz + 3));
    addAreaMap(
      add,
      plan((x, z) => {
        if (central(x, z))
          return within(x, z, ...TOWER) || chimney(x, z) || crown(x, z) ? ' ' : 's';
        if (!ridge(x, z)) return ' ';
        if (!skylight(x)) return 's';
        if (z === BACK + ROOF_STEPS + 1 || z === FRONT - ROOF_STEPS - 1) return ' ';
        return z === BACK + ROOF_STEPS || z === FRONT - ROOF_STEPS ? 's' : 'g';
      }),
      CAP,
      { s: ['tile', SLATE], g: ['tile', GLASS] },
    );
    for (const x of [
      ...range(0, 7).map((index) => 18 + index * 4),
      ...range(0, 7).map((index) => 78 + index * 4),
    ])
      for (const z of [BACK + ROOF_STEPS + 1, FRONT - ROOF_STEPS - 1])
        add('3633', BLACK, x, CAP, z, 90);

    // Pavilion crown: a crow-stepped gable with a pair of windows, between two round turrets
    // with copper caps.
    for (let course = 0; course < 8; course++) {
      const step = Math.floor(course / 2);
      const [from, to] = [56 + step * 2, 71 - step * 2];
      const y = CAP + course * 3;
      const open = (x: number) => course < 2 && x >= 62 && x <= 65;
      addBondedMap(
        add,
        plan((x, z) =>
          z === PAVILION_FRONT && x >= from && x <= to && !open(x)
            ? step === 3 || (course === 2 && (x === from || x === to))
              ? 'b'
              : stone(x, z, course, 3)
            : ' ',
        ),
        y,
        WALL_LEGEND,
        course,
      );
      if (course % 2 === 1 && step < 3)
        for (const x of [from, to - 1]) add('3069b', TRIM, x, y + 3, PAVILION_FRONT, 90);
    }
    for (const x of [62, 64]) add('60592', WHITE, x, CAP, PAVILION_FRONT, 90);
    for (const x of [62, 65]) add('3070b', TRIM, x, CAP + 24, PAVILION_FRONT);
    addFinial(add, 63, CAP + 24, PAVILION_FRONT, GOLD);
    for (const x of [PAVILION_WEST, PAVILION_EAST - 1]) {
      for (let course = 0; course < 5; course++)
        add('3941', course % 2 ? TRIM : SANDSTONE, x, CAP + course * 3, PAVILION_FRONT - 1);
      add('4032a', TRIM, x, CAP + 15, PAVILION_FRONT - 1);
      add('3942c', COPPER, x, CAP + 16, PAVILION_FRONT - 1);
      add('4589', GOLD, x + 0.5, CAP + 22, PAVILION_FRONT - 0.5);
    }

    // Tall chimneys flank the tower, with copper pots.
    for (const [x, z] of CHIMNEYS) {
      for (let course = 0; course < 5; course++)
        add('3001', course === 3 ? TRIM : SANDSTONE, x, CAP + course * 3, z);
      add('3020', SLATE, x, CAP + 15, z);
      for (const [dx, dz] of [
        [0, 1],
        [1, 2],
      ]) {
        add('3062b', COPPER, x + dx, CAP + 16, z + dz);
        add('4589', GOLD, x + dx, CAP + 19, z + dz);
      }
    }

    // Central tower: a stone base with arched windows, a balcony with copper railings and
    // gilded posts, an arcaded lantern, a slate dome and a copper spire with a gilded point.
    const towerJambs = new Set(
      TOWER_WINDOWS.flatMap((window) => [
        ...windowCells(window, -1, 1),
        ...windowCells(window, window.width, 1),
      ]),
    );
    const towerCorner = (x: number, z: number) =>
      (x === TOWER[0] || x === TOWER[2]) && (z === TOWER[1] || z === TOWER[3]);
    for (let course = 0; course < 6; course++) {
      const y = CAP + course * 3;
      const open = (x: number, z: number) =>
        TOWER_WINDOWS.some(
          (window) =>
            (course >= window.course &&
              course < window.course + 3 &&
              windowCells(window, 0, 2).includes(key(x, z))) ||
            (course === window.archCourse && windowCells(window, -1, 4).includes(key(x, z))),
        );
      addBondedMap(
        add,
        plan((x, z) => {
          if (!rim(x, z, ...TOWER) || open(x, z)) return ' ';
          if (course === 5) return 'b';
          if (course % 2 === 1 && (towerCorner(x, z) || towerJambs.has(key(x, z)))) return 'b';
          return stone(x, z, course, 3);
        }),
        y,
        WALL_LEGEND,
        course,
      );
      for (const window of TOWER_WINDOWS) {
        if (window.course === course)
          add(window.frame, WHITE, window.x, y, window.z, window.rotation);
        if (window.archCourse === course)
          add(
            window.arch,
            TRIM,
            window.rotation === 90 ? window.x - 1 : window.x,
            y,
            window.rotation === 90 ? window.z : window.z - 1,
            window.rotation,
          );
      }
    }
    const balcony = CAP + 18;
    add('91405', SLATE, 56, balcony, 40);
    const posts = new Set(
      [0, 5, 10, 15].flatMap((at) => [
        key(56 + at, 40),
        key(56 + at, 55),
        key(56, 40 + at),
        key(71, 40 + at),
      ]),
    );
    for (const post of posts) {
      const [x, z] = post.split(':').map(Number);
      add('3062b', SLATE, x, balcony + 1, z);
      const corner = (x === 56 || x === 71) && (z === 40 || z === 55);
      add(corner ? '4589' : '98138', GOLD, x, balcony + 4, z);
    }
    for (const at of [1, 6, 11]) {
      for (const z of [40, 55]) add('3633', COPPER, 56 + at, balcony + 1, z, 90);
      for (const x of [56, 71]) add('3633', COPPER, x, balcony + 1, 40 + at);
    }
    const lantern = balcony + 1;
    for (const [x, z] of [
      [60, 44],
      [66, 44],
      [60, 50],
      [66, 50],
    ])
      for (const y of [0, 3, 6]) add('3941', SLATE, x, lantern + y, z);
    for (const z of [44, 51]) {
      add('60594', WHITE, 62, lantern, z, 90);
      add('92950', TRIM, 61, lantern + 9, z, 90);
    }
    for (const x of [60, 67]) {
      add('60594', WHITE, x, lantern, 46, 0);
      add('92950', TRIM, x, lantern + 9, 45, 0);
    }
    for (const [x, z] of [
      [60, 44],
      [67, 44],
      [60, 51],
      [67, 51],
    ])
      add('3062b', TRIM, x, lantern + 9, z);
    const dome = lantern + 12;
    add('41539', SLATE, 60, dome, 44);
    for (const [x, z] of [
      [60, 44],
      [67, 44],
      [60, 51],
      [67, 51],
    ]) {
      add('3062b', TRIM, x, dome + 1, z);
      add('4589', GOLD, x, dome + 4, z);
    }
    add('3958', SLATE, 61, dome + 1, 45);
    add('3943b', SLATE, 62, dome + 2, 46);
    add('3941', COPPER, 63, dome + 8, 47);
    add('3942c', COPPER, 63, dome + 11, 47);
    add('3062b', GOLD, 63.5, dome + 17, 47.5);
    add('3062b', COPPER, 63.5, dome + 20, 47.5);
    add('4589', GOLD, 63.5, dome + 23, 47.5);

    // Turret steeples.
    for (const [x, z] of TURRETS) addSteeple(add, x, BASE + TURRET_COURSES * 3, z);

    // Terrace balustrade: white spindled spans with tan coping between granite posts.
    for (const [axis, line, from, to] of BALUSTRADE_LINES)
      for (let at = from; at <= to; at++) {
        const [x, z] = axis === 'x' ? [at, line] : [line, at];
        if ((at - from) % 5 === 0) {
          add('3005', GRANITE, x, BASE, z);
          add('3005', GRANITE, x, BASE + 3, z);
          add('3024', TRIM, x, BASE + 6, z);
          add('6141', WHITE, x, BASE + 7, z);
        } else if ((at - from) % 5 === 1) {
          add('30055', WHITE, x, BASE, z, axis === 'x' ? 90 : 0);
          add('2431', TRIM, x, BASE + 6, z, axis === 'x' ? 90 : 0);
        }
      }

    // Grounds: a garden path behind, a path from the steps to the drive across the front, and
    // a round plaza with the equestrian statue.
    const plaza = (x: number, z: number) =>
      z >= 104 && Math.hypot(x + 0.5 - 64, z + 0.5 - 112) <= 9.6;
    const pedestal = (x: number, z: number) => within(x, z, 60, 108, 67, 115);
    addAreaMap(
      add,
      plan((x, z) => {
        if (z >= 98 && z <= 103) return 'd';
        if (
          within(x, z, 58, 91, 69, 97) ||
          (plaza(x, z) && !pedestal(x, z)) ||
          (z >= 18 && z <= 21)
        )
          return 'g';
        return ' ';
      }),
      GROUND,
      { d: ['tile', SLATE], g: ['tile', GRANITE] },
    );
    // Equestrian statue: a granite pedestal under a tan cornice, and a bronze rider on a horse
    // facing away from the museum, towards the street.
    for (const [y, color] of [
      [GROUND, GRANITE],
      [GROUND + 3, GRANITE],
      [GROUND + 6, GRANITE],
    ] as const)
      add('4201', color, 60, y, 108);
    add('41539', TRIM, 60, GROUND + 9, 108);
    const hooves = GROUND + 10;
    for (const x of [62, 65])
      for (const z of [109, 114]) for (const y of [0, 3]) add('3062b', COPPER, x, hooves + y, z);
    add('3035', COPPER, 62, hooves + 6, 108);
    for (const y of [7, 10]) add('3007', COPPER, 63, hooves + y, 108);
    for (const y of [13, 16]) add('3003', COPPER, 63, hooves + y, 114);
    add('3039', COPPER, 63, hooves + 19, 114, 180);
    add('85984', COPPER, 63, hooves + 13, 108);
    add('3022', COPPER, 63, hooves + 13, 110);
    add('3941', COPPER, 63, hooves + 14, 110);
    add('87580', COPPER, 63, hooves + 17, 110);
    add('3062b', COPPER, 63.5, hooves + 18, 110.5);
    add('6141', COPPER, 63.5, hooves + 21, 110.5);
    add('4589', COPPER, 63.5, hooves + 22, 110.5);

    // Benches either side of the plaza, and a ring of flowers round its edge.
    for (const x of [50, 77]) {
      for (const z of [109, 114]) add('3005', BARK, x, GROUND, z);
      add('3666', BARK, x, GROUND + 3, 109);
      add('6636', BROWN, x, GROUND + 4, 109);
    }
    for (let z = 104; z < SIZE; z++)
      for (let x = 48; x < 80; x++) {
        const distance = Math.hypot(x + 0.5 - 64, z + 0.5 - 112);
        if (distance <= 9.6 || distance > 11.6) continue;
        add('98138', [RED, WHITE, BLOSSOM, PINK][(x + z) % 4], x, GROUND, z);
      }

    // Trees all round: oaks and firs behind, laburnums in bloom out front, and smaller trees
    // at the front corners, mirrored about the middle.
    const mirror = (x: number, width: number) => [x, SIZE - x - width];
    for (const x of [5, 28, 46])
      for (const at of mirror(x, 2)) addBigTree(add, at, 9, 12, [LAWN, LEAVES, LEAVES]);
    addBigTree(add, 63, 9, 15, [LAWN, LEAVES, LEAVES]);
    for (const x of [12, 18, 35, 53])
      for (const at of mirror(x, 5)) add('3471', LAWN, at, GROUND, 4);
    for (const at of mirror(34, 2)) addBigTree(add, at, 110, 12, [LEAVES, BLOSSOM, BLOSSOM]);
    for (const [x, z, partId] of [
      [2, 106, '3470'],
      [14, 118, '3470'],
      [2, 118, '3471'],
    ] as const)
      for (const at of mirror(x, 5)) add(partId, LEAVES, at, GROUND, z);

    // Bushes along the sides, and flower beds with bushes at the foot of the terrace.
    for (const z of [26, 34, 42, 50, 58, 66, 74]) for (const x of mirror(0, 4)) addBush(add, x, z);
    const bedBushes = [10, 22, 34, 46].flatMap((x) => mirror(x, 4));
    for (const x of bedBushes) addBush(add, x, 85);
    for (let z = 85; z <= 88; z++)
      for (const x of [...range(10, 49), ...range(78, 117)])
        if (!bedBushes.some((bush) => x >= bush && x < bush + 4))
          add('98138', [RED, WHITE, BLOSSOM, PINK][(x + z * 3) % 4], x, GROUND, z);
    for (const x of [10, 30, 97, 117]) addLampPost(add, x, 95);
    for (const x of [STEPS[0] - 2, STEPS[1] + 2]) addLampPost(add, x, 88);
  },
};
