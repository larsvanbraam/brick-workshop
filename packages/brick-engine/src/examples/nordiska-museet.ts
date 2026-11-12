import { addAreaMap, addBondedMap, addRun, glazeWindows, turnAround } from './layout.ts';
import type { RunKind } from './layout.ts';
import type { ExampleBrickAdder, ExampleDefinition } from './types.ts';
import { getConnectionSites, getPart, isMatchingInsertFrame } from '../core.ts';
import type { Facing, Rotation } from '../core.ts';
import { layPlateFloor } from '../board.ts';
import { addTree } from './trees.ts';

// The museum again at twice the scale, 0.75 studs to the metre, on the 128-stud board. Plans
// are drawn top-down with the front at high z; the building is symmetric about x = 64. Walls
// are sixteen courses: a rusticated granite plinth, tall round-headed ground-floor windows,
// a string course, upper windows under segmental arches and a dentilled cornice. It stands on
// a granite terrace on an island quay, with water round it, as on the box of the smaller one.
const SIZE = 128;

const SANDSTONE = 28;
const TRIM = 19;
const GRANITE = 71;
const SLATE = 72;
/** The steep roofs, spires and dome are dark grey slate with visible tile rows, as on the box. */
const ROOFING = 72;
const COPPER = 378;
const LAWN = 2;
const FOREST = 288;
const BARK = 70;
const WATER = 1;
const NAVY = 272;
const WHITE = 15;
/** Trans-black glass, dark behind the window frames as in the real museum's deep reveals. */
const PANES = 40;
/** Window frames and casements are medium nougat: wood a shade darker than the stone, as on the box. */
const JOINERY = 84;
/** A warmer stone that turns up here and there among the sandstone blocks. */
const NOUGAT = 84;
const BLACK = 0;
const GOLD = 297;

/**
 * Heights: water level, the quay top, the lawn on it, the terrace top (building base), the
 * ceiling at the eaves, the roof base, the ridge and the top of the tiles on it. The roof rises
 * thirteen slope courses to the ridge.
 */
const GROUND = 2;
const QUAY = GROUND + 7;
const LAWN_TOP = QUAY + 1;
const BASE = QUAY + 7;
const COURSES = 16;
const CEILING = BASE + COURSES * 3;
const ROOF = CEILING + 1;
const ROOF_STEPS = 13;
const FLAT = ROOF + ROOF_STEPS * 3;
const CAP = FLAT + 1;
/** The turrets stand clear of the roof, as high as its ridge. */
const TURRET_COURSES = COURSES + ROOF_STEPS;
/** Courses that are tan bands: the sill course, the string course, the cornice and the turrets'. */
const BANDS = new Set([2, 10, 15, 22, TURRET_COURSES - 1]);

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

/**
 * Octagonal corner towers: 8 x 8 with a stud cut from each corner, standing four studs proud
 * of the main block's corners. Facet bricks chamfer the cut corners into straight faces.
 */
const TURRET = 8;
const TURRETS = [
  [WEST - 4, FRONT - 3],
  [EAST - 3, FRONT - 3],
  [WEST - 4, BACK - 4],
  [EAST - 3, BACK - 4],
] as const;
const isTurret = (x: number, z: number) =>
  TURRETS.some(([tx, tz]) => {
    const [dx, dz] = [x - tx, z - tz].map((at) => Math.min(at, TURRET - 1 - at));
    return dx >= 0 && dz >= 0 && dx + dz >= 1;
  });
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
/**
 * The end apses rise this many courses past the eaves, so their roofs climb to the ridge and
 * close the ends of the main roof instead of stopping halfway up its gables.
 */
const APSE_RISE = 5;
const END_APSES = APSES.slice(1);

const isPavilion = (x: number, z: number) =>
  within(x, z, PAVILION_WEST, FRONT, PAVILION_EAST, PAVILION_FRONT);
/** Everything the ceiling covers. */
const footprint = (x: number, z: number) =>
  (within(x, z, WEST, BACK, EAST, FRONT) || isBay(x, z) || isPavilion(x, z) || isApse(x, z)) &&
  !isTurret(x, z);
/** Cells inside the building's outline at wall height. */
const enclosed = (x: number, z: number) => footprint(x, z) || isTurret(x, z);
/**
 * Each 2 x 2 facet brick, turned by `rotation`, as its box's corner cell that the chamfer
 * crosses (the turret's cut corner) and the cell inside the corner that it leaves hollow.
 */
const FACET_CELLS: Readonly<Record<Rotation, readonly [cut: Cell, hollow: Cell]>> = {
  0: [
    [1, 0],
    [0, 1],
  ],
  90: [
    [0, 0],
    [1, 1],
  ],
  180: [
    [0, 1],
    [1, 0],
  ],
  270: [
    [1, 1],
    [0, 0],
  ],
};
type Cell = readonly [number, number];
/**
 * Facet bricks on the turrets' outer corners as [x, z, rotation], one a course: each covers
 * the two cells either side of the cut corner and chamfers across it. Corners inside the main
 * block keep plain walls.
 */
const FACETS = TURRETS.flatMap(([tx, tz]) =>
  (
    [
      [0, 0, 90],
      [TURRET - 2, 0, 0],
      [0, TURRET - 2, 180],
      [TURRET - 2, TURRET - 2, 270],
    ] as const
  )
    .map(([dx, dz, rotation]) => [tx + dx, tz + dz, rotation] as const)
    .filter(([x, z, rotation]) => {
      const [cx, cz] = FACET_CELLS[rotation][0];
      return !enclosed(x + cx, z + cz);
    }),
);
/** Every cell a facet's box takes: no wall brick or round brick goes there. */
const FACET_BOXES = new Set(
  FACETS.flatMap(([x, z]) => [0, 1].flatMap((dx) => [0, 1].map((dz) => key(x + dx, z + dz)))),
);
for (const [x, z, rotation] of FACETS) {
  const [hx, hz] = FACET_CELLS[rotation][1];
  TURRET_WALLS.delete(key(x + hx, z + hz));
}
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
      !FACET_BOXES.has(key(x, z)) &&
      OUTWARD.filter(([dx, dz]) => !isTurret(x + dx, z + dz)).length >= 2) ||
    (isApse(x, z) && apseWall(x, z) && isCorner(x, z)),
);

/**
 * Windows: `width` studs from [x, z] along x (rotation 90) or z (rotation 0), set in at `course`,
 * with an arch or lintel over them at `archCourse` whose ends stand on the jambs. `frame` is a
 * frame part or one of the styles in LIGHTS, which divide the opening into lights.
 */
interface Window {
  x: number;
  z: number;
  rotation: 0 | 90;
  width: 2 | 4 | 6;
  frame: string;
  course: number;
  arch: string;
  archCourse: number;
}
const FRAME_COURSES: Readonly<Record<string, number>> = {
  tall: 6,
  wide: 2,
  casements: 3,
  rounded: 3,
  '60593': 3,
  '60592': 2,
};
/**
 * Window styles as rows of [frame part, 'casements' or 'transom', plates above the sill]. Frames
 * repeat along the opening. Casements are a 1 x 4 x 3 frame with a two-bar casement hung at
 * each end in place of glass, the far one upside down: a grid of six lights like the many
 * small panes of the real upper windows. A transom is a tan brick across the opening, between
 * the lights below and above it.
 */
const LIGHTS: Readonly<Record<string, readonly (readonly [string, number])[]>> = {
  // Three tall lights, like the real ground-floor windows.
  tall: [['57894', 0]],
  wide: [['60592', 0]],
  casements: [['casements', 0]],
  // A tan sill plate under a window whose own rounded head fills its top, with no arch to
  // leave a gap.
  rounded: [
    ['3023b', 0],
    ['30044', 1],
  ],
};
const ARCH_COURSES: Readonly<Record<string, number>> = {
  /** A window with its own head, under plain wall. */
  none: 0,
  /** A tan 1 x 6 lintel squares off the head, as over the real upper windows. */
  '3009': 1,
  /** Over a half-round fanlight that fills its opening, so the head has no gap. */
  '15254': 2,
};

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
  // The ground-floor lights start at the sill course: tall, square-headed under a tan lintel.
  { x, z, rotation, width: 4, frame: 'tall', course: 2, arch: '3009', archCourse: 8 },
  { x, z, rotation, width: 4, frame: 'casements', course: 11, arch: '3009', archCourse: 14 },
]);
/** Each turret has a window on each outside face at four levels, two of them above the eaves. */
const TURRET_WINDOWS: readonly Window[] = TURRETS.flatMap(([tx, tz]) =>
  (
    [
      [tx, tz + 3, 0, tx - 1, tz + 3],
      [tx + 7, tz + 3, 0, tx + 8, tz + 3],
      [tx + 3, tz, 90, tx + 3, tz - 1],
      [tx + 3, tz + 7, 90, tx + 3, tz + 8],
    ] as const
  )
    .filter(([, , , outsideX, outsideZ]) => !enclosed(outsideX, outsideZ))
    .flatMap(([x, z, rotation]) =>
      [4, 11, 18, 24].map((course): Window => ({
        x,
        z,
        rotation,
        width: 2,
        frame: 'rounded',
        course,
        arch: 'none',
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
    frame: 'rounded',
    course,
    arch: 'none',
    archCourse: course + 3,
  })),
);
const WINDOWS = [...MAIN_WINDOWS, ...TURRET_WINDOWS, ...PAVILION_WINDOWS];
const windowCells = (window: Window, from: number, length: number) =>
  range(from, from + length - 1).map((offset) =>
    window.rotation === 90 ? key(window.x + offset, window.z) : key(window.x, window.z + offset),
  );

/** Whether one of `windows`, or the arch over it, opens the cell in this course. */
const opens = (windows: readonly Window[], x: number, z: number, course: number) =>
  windows.some(
    (window) =>
      (course >= window.course &&
        course < window.course + FRAME_COURSES[window.frame] &&
        windowCells(window, 0, window.width).includes(key(x, z))) ||
      (course >= window.archCourse &&
        course < window.archCourse + ARCH_COURSES[window.arch] &&
        windowCells(window, -1, window.width + 2).includes(key(x, z))),
  );
/**
 * A 1 x 4 x 3 frame with a two-bar casement at each end, through `open`, which glazes nothing:
 * each pane goes in whichever half and way up the engine says its pins fit.
 */
function addCasements(open: ExampleBrickAdder, x: number, y: number, z: number, rotation: 0 | 90) {
  const frame = { id: 'frame', partId: '60594', color: JOINERY, x, y, z, rotation };
  open('60594', JOINERY, x, y, z, rotation);
  for (const offset of [0, 2])
    for (const upsideDown of [false, true]) {
      const pane = {
        ...frame,
        id: 'pane',
        partId: '60608',
        x: rotation === 90 ? x + offset : x,
        z: rotation === 90 ? z : z + offset,
        ...(upsideDown ? { upsideDown: true as const } : {}),
      };
      if (isMatchingInsertFrame(pane, frame))
        open('60608', JOINERY, pane.x, y, pane.z, rotation, undefined, upsideDown);
    }
}

/**
 * Sets in the frames and arches of `windows` that start in this course; `open` adds pieces
 * without glazing them.
 */
function addWindows(
  add: ExampleBrickAdder,
  open: ExampleBrickAdder,
  windows: readonly Window[],
  course: number,
  y: number,
) {
  for (const window of windows) {
    const { x, z, rotation, width } = window;
    if (window.course === course)
      for (const [partId, rise] of LIGHTS[window.frame] ?? [[window.frame, 0]])
        if (partId === 'transom')
          addRun(add, 'brick', TRIM, rotation === 90 ? 'x' : 'z', x, y + rise, z, width);
        else
          for (
            let offset = 0;
            offset < width;
            offset += partId === 'casements' ? 4 : getPart(partId).depth
          ) {
            const [atX, atZ] = rotation === 90 ? [x + offset, z] : [x, z + offset];
            if (partId === 'casements') addCasements(open, atX, y + rise, atZ, rotation);
            else add(partId, partId === '3023b' ? TRIM : JOINERY, atX, y + rise, atZ, rotation);
          }
    if (window.archCourse === course && window.arch !== 'none') {
      // A half-round fanlight fills the opening first, then the arch comes down over it.
      if (window.arch === '15254') open('20309', JOINERY, x, y, z, rotation);
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
}

/** The main door: two leaves under an arch, in the pavilion front. */
const DOOR = [60, 67] as const;
/** Headlight bricks under each tall window read as basement lights in the plinth. */
const BASEMENT_CELLS = new Set(
  MAIN_WINDOWS.filter(({ frame }) => frame === 'tall').flatMap((window) =>
    windowCells(window, 0, 4),
  ),
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
/** The banner hung over the door: these courses of the pavilion front, between the jambs. */
const BANNER = [62, 65] as const;
const BANNER_COURSES = [9, 13] as const;
for (let course = BANNER_COURSES[0]; course <= BANNER_COURSES[1]; course++)
  openCells(
    course,
    range(BANNER[0], BANNER[1]).map((x) => key(x, PAVILION_FRONT)),
  );
const isOpen = (x: number, z: number, course: number) =>
  OPEN_CELLS.get(course)?.has(key(x, z)) ?? false;

/**
 * Corbels under the cornice: every other cell of straight outside wall in the top band is a
 * 1 x 2 brick laid across the wall, standing a stud proud of it under the overhanging ceiling,
 * so the row reads as blocks with shadows between. The portal hides the pavilion front.
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
 * Sandstone walls are small ashlar blocks of mixed tones, like the real museum's stonework:
 * along each course blocks two and three studs long alternate, their joints shifting from course
 * to course. Every other block is tan; the rest are dark tan, now and then a warmer nougat. As
 * neighbouring blocks never match they stay separate bricks, never long runs.
 */
const stone = (x: number, z: number, course: number) => {
  const at = x + z + course * 2;
  const block = Math.floor(at / 5) * 2 + (at % 5 < 2 ? 0 : 1);
  if (block % 2) return 'l';
  return (Math.imul(block * 31 + course, 2654435761) >>> 0) % 10 < 3 ? 'n' : 'w';
};
/**
 * Wall courses: a granite plinth, tan bands, and even sandstone between with tan quoins at
 * corners on every other course. Hidden partitions are plain sandstone.
 */
const material = (x: number, z: number, course: number) => {
  if (PARTITIONS.has(key(x, z))) return 'w';
  if (course <= 1) return 'p';
  // The towers wear copper bands at the eaves and under their steeples.
  if (TURRET_WALLS.has(key(x, z)) && (course === COURSES - 1 || course === TURRET_COURSES - 1))
    return 'c';
  if (BANDS.has(course)) return 'b';
  if (course % 2 === 1 && isCorner(x, z)) return 'b';
  return stone(x, z, course);
};

const WALL_LEGEND: Readonly<Record<string, readonly [RunKind, number]>> = {
  p: ['masonry', GRANITE],
  q: ['masonry', SLATE],
  w: ['brick', SANDSTONE],
  l: ['brick', TRIM],
  n: ['brick', NOUGAT],
  d: ['brick', SLATE],
  c: ['brick', COPPER],
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

/**
 * The tower rises through the roof at the crossing, centred on the ridge: a square shaft hidden
 * under the slopes, and above the ridge a slate octagon with three studs cut from each corner.
 */
const TOWER = [58, 42, 69, 53] as const;
const inTower = (x: number, z: number) =>
  within(x, z, ...TOWER) &&
  Math.min(x - TOWER[0], TOWER[2] - x) + Math.min(z - TOWER[1], TOWER[3] - z) >= 3;
const TOWER_RIM = cellSet(
  (x, z) => inTower(x, z) && NEIGHBOURS.some(([dx, dz]) => !inTower(x + dx, z + dz)),
);
const TOWER_ROUND = cellSet(
  (x, z) =>
    TOWER_RIM.has(key(x, z)) && OUTWARD.filter(([dx, dz]) => !inTower(x + dx, z + dz)).length >= 2,
);
/** The first course of roof slopes that reaches the tower, front and back alike. */
const CROSSING = TOWER[1] - BACK - 1;
/** The pavilion's walls rise this many courses past the eaves before its own roof starts. */
const ATTIC = 2;
/**
 * The pavilion's crow-stepped gable starts stepping in this many courses past the eaves, so it
 * stands as a parapet clear above its roof and the main ridge, leading the eye up to the tower.
 */
const GABLE_ATTIC = 5;
const GABLE_COURSES = ROOF_STEPS + GABLE_ATTIC - ATTIC;
/** Each bay's dormer has walls this many courses high under its own little roof. */
const DORMER = 4;
/** Chimneys astride the ridge either side of the tower, by their western stud. */
const CHIMNEYS = [53, 73];
/**
 * Windows in the pavilion's gable, by course above the eaves: the great arched window over
 * the portal and a smaller one either side of it.
 */
const GABLE_WINDOWS: readonly Window[] = [
  ...[55, 69].map((x): Window => ({
    x,
    z: PAVILION_FRONT,
    rotation: 90,
    width: 4,
    frame: 'wide',
    course: 1,
    arch: '15254',
    archCourse: 3,
  })),
  {
    x: 62,
    z: PAVILION_FRONT,
    rotation: 90,
    width: 4,
    frame: 'tall',
    course: 4,
    arch: '15254',
    archCourse: 10,
  },
];
/** The end apses' windows above the eaves, in their outer faces. */
const RISE_WINDOWS: readonly Window[] = [WEST - 8, EAST + 8].map((x) => ({
  x,
  z: 46,
  rotation: 0,
  width: 4,
  frame: 'wide',
  course: 1,
  arch: '15254',
  archCourse: 3,
}));
/** Courses of the tower's dark slate octagon above the ridge, the top one a copper cornice. */
const TOWER_COURSES = 8;
/** Tower windows: one in each straight face of the octagon. */
const TOWER_WINDOWS: readonly Window[] = [
  ...[TOWER[1], TOWER[3]].map((z) => ({ x: 62, z, rotation: 90 as const })),
  ...[TOWER[0], TOWER[2]].map((x) => ({ x, z: 46, rotation: 0 as const })),
].flatMap((opening) =>
  [2].map((course) => ({
    ...opening,
    width: 4 as const,
    frame: 'wide',
    course,
    arch: '15254',
    archCourse: course + 2,
  })),
);

/**
 * The island quay rising from the water, with a promenade along its front edge and the name
 * plaque set in the middle of the front wall. On it a granite terrace raises the museum, with
 * broad steps between cheek walls up to the entrance and a tan path on to the promenade.
 */
const ISLAND = [4, 12, 123, 100] as const;
const PROMENADE = 92;
const TERRACE = [5, 24, 122, 73] as const;
const STEPS = [54, 73] as const;
const STEP_ROWS = 7;
/** Cheek walls two studs wide either side of the steps, by their western stud. */
const CHEEKS = [STEPS[0] - 2, STEPS[1] + 1];
const PATH = [58, 69] as const;
const PLAQUE = [56, 71] as const;
/**
 * Two-stud lampposts along the quay's front edge, by their western stud and mirrored about the
 * middle, with a spindled iron fence centred in each gap between them and down both sides.
 */
const QUAY_LAMPS = [5, 30, 55, 71, 96, 121];
const RAILINGS = [
  ...QUAY_LAMPS.slice(1).flatMap((lamp, index) => {
    const from = QUAY_LAMPS[index] + 2;
    const runs = Math.floor((lamp - from) / 4);
    const start = from + Math.floor((lamp - from - runs * 4) / 2);
    return range(0, runs - 1).map((run) => [start + run * 4, ISLAND[3], 90] as const);
  }),
  ...range(0, 20).flatMap((index) =>
    [ISLAND[0], ISLAND[2]].map((x) => [x, 16 + index * 4, 0] as const),
  ),
];
/**
 * Leafy crowns, each as the green of its shaded underside, its body and its sunlit top: deep,
 * dark greens like the box's lime trees, an elm and a horse chestnut.
 */
const CROWNS = [
  [FOREST, LAWN, LAWN],
  [FOREST, FOREST, LAWN],
  [FOREST, LAWN, FOREST],
] as const;
/**
 * Trees as [x, z, crown, trunk courses], x and z the stud corner the trunk stands round: two
 * rows on the front lawn and one behind, mirrored but each grown differently.
 */
const TREES = [
  ...[11, 23, 35, 47].map((x, index) => [x, 79, index % 3, 4 - (index % 2)]),
  ...[17, 29, 41].map((x, index) => [x, 88, (index + 1) % 3, 3 + (index % 2)]),
  ...[11, 25, 39, 53].map((x, index) => [x, 18, (index + 2) % 3, 3 + (index % 2)]),
].flatMap(([x, z, crown, trunk]) => [
  [x, z, crown, trunk] as const,
  [SIZE - x, z, (crown + 1) % 3, trunk] as const,
]);
/** The portal in front of the door: columns either side and a pier beyond each. */
const COLUMNS = [57, 69];
const PIERS = [52, 72];
const PORTAL = PAVILION_FRONT + 1;
const isPortal = (x: number, z: number) =>
  (z === PORTAL || z === PORTAL + 1) &&
  [...COLUMNS.map((x0) => [x0, x0 + 1]), ...PIERS.map((x0) => [x0, x0 + 3])].some(
    ([x0, x1]) => x >= x0 && x <= x1,
  );
/**
 * A row of 45 degree roof slopes, split into the widest pieces that fit. No piece but a lone
 * one is a single stud wide, so a row may overhang the course below by a stud at either end.
 */
function addSlopeRun(
  add: ExampleBrickAdder,
  from: number,
  to: number,
  y: number,
  line: number,
  rotation: Rotation,
) {
  // Rotations 0 and 180 run along x at z = line; 90 and 270 run along z at x = line.
  for (let at = from; at <= to;) {
    const left = to - at + 1;
    const width = left === 5 ? 3 : Math.min(4, left);
    const partId = { 4: '3037', 3: '3038', 2: '3039', 1: '3040b' }[width]!;
    if (rotation % 180) add(partId, ROOFING, line, y, at, rotation);
    else add(partId, ROOFING, at, y, line, rotation);
    at += width;
  }
}

/**
 * A faceted slate roof over an apse from `base` up, a layer a brick high at a time. Each layer
 * steps a stud in from every outside face: straight faces get two-deep slopes whose back row carries the next
 * layer, the angled faces cheese slopes, and the rest of the layer is solid brick underneath.
 */
function addApseRoof(
  add: ExampleBrickAdder,
  { width, cell, out, minus, plus }: Apse,
  base: number,
) {
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
    const y = base + layer * 3;
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
    // The angled faces step back a stud a row. Two neighbouring steps share an outside corner
    // slope, its low corner hanging out past the lower step and its stud on the cell inside
    // both, which the next layer stands on: a hip rather than a staircase.
    const hipped = new Set<string>();
    for (const side of [-1, 1] as const) {
      const steps = cells
        .filter(([u, d]) => !next.has(key(u, d)) && !has(u, d + 1) && !has(u + side, d))
        .sort(([, first], [, second]) => second - first);
      for (let index = 0; index + 1 < steps.length; index++) {
        const [[u1, d1], [u0, d0]] = [steps[index], steps[index + 1]];
        const inner = key(u1, d0);
        if (u1 !== u0 - side || d1 !== d0 + 1 || !next.has(inner) || covered.has(inner)) continue;
        const block = [cell(u0, d0), cell(u1, d0), cell(u0, d1), cell(u1, d1)];
        const [x, z] = [0, 1].map((axis) => Math.min(...block.map((at) => at[axis])));
        const [studX, studZ] = cell(u1, d0);
        const rotation = ([0, 90, 180, 270] as const).find((turn) =>
          getConnectionSites(
            { id: 'hip', partId: '3045', color: ROOFING, x, y, z, rotation: turn },
            'top',
          ).some((stud) => stud.x === studX + 0.5 && stud.z === studZ + 0.5),
        )!;
        add('3045', ROOFING, x, y, z, rotation);
        covered.add(inner);
        hipped.add(key(u0, d0)).add(key(u1, d1));
        index++;
      }
    }
    // Outer faces first, then the sides; a slope whose back row is taken becomes a cheese slope.
    const rimCells = cells
      .filter(([u, d]) => !next.has(key(u, d)) && !hipped.has(key(u, d)))
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
    // A plate lifts each cheese slope level with the brick-high slopes round it.
    for (const [u, d, rotation] of cheeses) {
      const [x, z] = cell(u, d);
      add('3024', ROOFING, x, y, z);
      add('54200', ROOFING, x, y + 1, z, rotation);
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
        { b: ['brick', ROOFING] },
      );
    region = next;
  }
}

/**
 * A small finial: jumper plate along x, a round brick on its centre stud and a cone, and on a
 * dark cone a gilded knob, like the spirelets on the box.
 */
function addFinial(add: ExampleBrickAdder, x: number, y: number, z: number, tip = COPPER) {
  add('3794b', TRIM, x, y, z, 90);
  add('3062b', TRIM, x + 0.5, y + 1, z);
  add('59900', tip, x + 0.5, y + 4, z);
  if (tip === ROOFING) add('98138', GOLD, x + 0.5, y + 7, z);
}

/**
 * One tier of a hipped roof a brick high on a square base `size` studs across, leaving a field
 * of studs two smaller on top: an outside corner slope at each corner, turned so its stud is on
 * the inside, straight slopes along the sides between them and bricks in the middle.
 */
function addHippedTier(add: ExampleBrickAdder, x: number, y: number, z: number, size: 4 | 6) {
  const far = size - 2;
  for (const [dx, dz, rotation] of [
    [0, 0, 90],
    [far, 0, 0],
    [0, far, 180],
    [far, far, 270],
  ] as const)
    add('3045', ROOFING, x + dx, y, z + dz, rotation);
  if (size === 4) return;
  add('3039', ROOFING, x + 2, y, z, 0);
  add('3039', ROOFING, x + 2, y, z + 4, 180);
  add('3039', ROOFING, x, y, z + 2, 90);
  add('3039', ROOFING, x + 4, y, z + 2, 270);
  add('3003', ROOFING, x + 2, y, z + 2);
}

/**
 * A steeple on a 6 x 6 base, like the corner towers' on the box: a copper band, a dark hipped
 * roof in two tiers, a copper lantern between gold and copper rings, a steep dark pyramid and a
 * gilded needle.
 */
function addSteeple(add: ExampleBrickAdder, x: number, y: number, z: number) {
  add('3958', COPPER, x, y, z);
  addHippedTier(add, x, y + 1, z, 6);
  addHippedTier(add, x + 1, y + 4, z + 1, 4);
  add('3941', COPPER, x + 2, y + 7, z + 2);
  add('4032a', GOLD, x + 2, y + 10, z + 2);
  add('3941', COPPER, x + 2, y + 11, z + 2);
  add('4032a', COPPER, x + 2, y + 14, z + 2);
  add('3688', ROOFING, x + 2, y + 15, z + 2);
  add('3957a', GOLD, x + 2.5, y + 21, z + 2.5);
}

/**
 * A street lamp on a 2 x 2 footing: a fluted black lamppost with a white globe under a black
 * cap on the open stud of its lantern.
 */
function addLampPost(add: ExampleBrickAdder, x: number, z: number, y = LAWN_TOP) {
  add('2039', BLACK, x, y, z);
  add('3062b', WHITE, x + 0.5, y + 21, z + 0.5);
  add('98138', BLACK, x + 0.5, y + 24, z + 0.5);
}

/**
 * A sailing boat moored off the quay, its bow towards +x: a white hull with a pointed bow under
 * a wooden deck, a cabin aft, a stepped mainsail and jib either side of the mast and a pennant at its head.
 */
function addSailboat(add: ExampleBrickAdder, x: number, z: number) {
  add('3029', WHITE, x, GROUND, z, 90);
  for (const row of [z, z + 2]) {
    add('3006', WHITE, x, GROUND + 1, row, 90);
    add('3039', WHITE, x + 10, GROUND + 1, row, 270);
  }
  add('3030', BARK, x, GROUND + 4, z, 90);
  const deck = GROUND + 5;
  add('3001', WHITE, x + 1, deck, z + 1, 90);
  add('87079', WHITE, x + 1, deck + 3, z + 1, 90);
  const mast = x + 6;
  for (const post of [0, 15, 30]) add('2453b', WHITE, mast, deck + post, z + 1);
  // A gilded cone tops the mast, and a navy pennant streams aft off a short pole above it.
  add('59900', GOLD, mast, deck + 45, z + 1);
  add('3957a', GOLD, mast, deck + 48, z + 1);
  add('44676a', NAVY, mast - 2, deck + 52, z + 1, 270);
  // The mainsail clears the cabin on two short rows by the mast; no row is longer than a brick.
  for (const [row, length] of [1, 1, 4, 4, 4, 4, 3, 3, 3, 2, 2, 2, 1, 1].entries())
    addRun(add, 'brick', WHITE, 'x', mast - length, deck + row * 3, z + 1, length);
  for (const [row, length] of [3, 3, 2, 2, 2, 1, 1, 1].entries())
    addRun(add, 'brick', WHITE, 'x', mast + 1, deck + row * 3, z + 1, length);
}

export const nordiskaMuseet: ExampleDefinition = {
  id: 'nordiska-museet',
  name: 'Nordiska Museet',
  tags: [
    'museum',
    'landmark',
    'stockholm',
    'tower',
    'stepped-gables',
    'copper-roofs',
    'park',
    'waterfront',
  ],
  expectedPieceCount: 10285,
  buildArea: SIZE,
  brickIdPrefix: 'museet',
  build(drawnAdd) {
    // Pieces are collected and laid a layer at a time, lowest first, so each one's support is
    // in place before it whatever order the sections below come in.
    const pieces: Parameters<ExampleBrickAdder>[] = [];
    const open = turnAround((...piece) => {
      pieces.push(piece);
    }, SIZE);
    const add = glazeWindows(open, PANES);
    const addWallCourse = (cell: (x: number, z: number) => string, y: number, course: number) =>
      addBondedMap(add, plan(cell), y, WALL_LEGEND, course);

    // The 128 x 128 board is the water round the island, a two-layer plate floor, so the whole
    // board lifts as one.
    for (const plate of layPlateFloor({ x: 0, z: 0, width: SIZE, depth: SIZE }, WATER)!.bricks)
      add(plate.partId, plate.color, plate.x, plate.y, plate.z, plate.rotation);

    // Island quay: a slate plate footing, two courses of dark masonry quay wall round a brick
    // core, and the name plaque in the front wall, black tiles on a row of headlight bricks.
    const island = (x: number, z: number) => within(x, z, ...ISLAND);
    const quay = (x: number, z: number) => rim(x, z, ...ISLAND);
    const isPlaque = (x: number, z: number) => z === ISLAND[3] && x >= PLAQUE[0] && x <= PLAQUE[1];
    addAreaMap(
      add,
      plan((x, z) => (island(x, z) ? 's' : ' ')),
      GROUND,
      { s: ['plate', SLATE] },
    );
    for (const course of [0, 1]) {
      const y = GROUND + 1 + course * 3;
      addBondedMap(
        add,
        plan((x, z) => (quay(x, z) && !(course === 1 && isPlaque(x, z)) ? 'q' : ' ')),
        y,
        WALL_LEGEND,
        course,
      );
      addAreaMap(
        add,
        plan((x, z) => (island(x, z) && !quay(x, z) ? 'c' : ' ')),
        y,
        { c: ['brick', SLATE] },
      );
    }
    for (let x = PLAQUE[0]; x <= PLAQUE[1]; x++) add('4070', SLATE, x, GROUND + 4, ISLAND[3], 180);
    for (const x of [PLAQUE[0], PLAQUE[0] + 8])
      add('4162', BLACK, x, GROUND + 4.5, ISLAND[3] + 0.8, 90, '+z');

    // On the quay: granite coping round the edge, the paved promenade along the front, a tan
    // path from the steps to it, and lawn everywhere else.
    const terrace = (x: number, z: number) => within(x, z, ...TERRACE);
    const stairs = (x: number, z: number) =>
      within(x, z, CHEEKS[0], TERRACE[3] + 1, CHEEKS[1] + 1, TERRACE[3] + STEP_ROWS);
    addAreaMap(
      add,
      plan((x, z) => {
        if (!island(x, z) || terrace(x, z) || stairs(x, z)) return ' ';
        if (quay(x, z)) return 'k';
        if (z >= PROMENADE) return 'p';
        return x >= PATH[0] && x <= PATH[1] && z > TERRACE[3] ? 't' : 'g';
      }),
      QUAY,
      {
        k: ['plate', GRANITE],
        t: ['tile', TRIM],
        p: ['tile', GRANITE],
        g: ['plate', LAWN],
      },
    );

    // Granite terrace under the museum: two courses of masonry round a brick core, a plate
    // course over both, and paving round the walls with a tan carpet from the door to the steps.
    for (const course of [0, 1]) {
      const y = QUAY + course * 3;
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
    addAreaMap(
      add,
      plan((x, z) => (terrace(x, z) ? 's' : ' ')),
      QUAY + 6,
      { s: ['plate', GRANITE] },
    );
    addAreaMap(
      add,
      plan((x, z) =>
        !terrace(x, z) || enclosed(x, z) || isPortal(x, z) || FACET_BOXES.has(key(x, z))
          ? ' '
          : x >= DOOR[0] && x <= DOOR[1] && z > PAVILION_FRONT
            ? 't'
            : 'g',
      ),
      BASE,
      { t: ['tile', TRIM], g: ['tile', GRANITE] },
    );

    // Broad front steps, a plate each, between stepped cheek walls that carry a lamp apiece.
    const stepWidth = STEPS[1] - STEPS[0] + 1;
    for (let row = 0; row < STEP_ROWS; row++) {
      const z = TERRACE[3] + 1 + row;
      const plates = STEP_ROWS - 1 - row;
      for (let layer = 0; layer < plates; layer++)
        addRun(add, 'plate', GRANITE, 'x', STEPS[0], QUAY + layer, z, stepWidth);
      addRun(add, 'tile', GRANITE, 'x', STEPS[0], QUAY + plates, z, stepWidth);
    }
    for (const x of CHEEKS) {
      const z = TERRACE[3] + 1;
      add('3001', GRANITE, x, QUAY, z);
      add('3002', GRANITE, x, QUAY, z + 4);
      add('3021', TRIM, x, QUAY + 3, z + 4);
      add('3001', GRANITE, x, QUAY + 3, z);
      add('3020', TRIM, x, QUAY + 6, z);
      addLampPost(add, x, z + 1, BASE);
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
        (x, z) =>
          standing(x, z) && !ROUND_CELLS.has(key(x, z)) && !FACET_BOXES.has(key(x, z))
            ? material(x, z, course)
            : ' ',
        y,
        course,
      );
      for (const cell of ROUND_CELLS) {
        const [x, z] = cell.split(':').map(Number);
        if (standing(x, z)) add('3062b', WALL_LEGEND[material(x, z, course)][1], x, y, z);
      }
      // The facet takes the colour of the cell beside the corner it chamfers.
      for (const [x, z, rotation] of FACETS) {
        const [cx, cz] = FACET_CELLS[rotation][0];
        const [ox, oz] = [x + 1 - cx, z + cz];
        add('87620', WALL_LEGEND[material(ox, oz, course)][1], x, y, z, rotation);
      }
      if (course === COURSES - 1)
        for (const cell of WALLS) {
          const [x, z] = cell.split(':').map(Number);
          if (!dentil(x, z, course)) continue;
          const [dx, dz] = outward(x, z)!;
          addRun(
            add,
            'brick',
            TRIM,
            dx ? 'x' : 'z',
            Math.min(x, x + dx),
            y,
            Math.min(z, z + dz),
            2,
          );
          // Where no ceiling overhangs a corbel, a tile smooths its top.
          if (!inCeiling(x + dx, z + dz)) add('3070b', TRIM, x + dx, y + 3, z + dz);
        }
      if (course === 1)
        for (const cell of BASEMENT_CELLS) {
          const [x, z] = cell.split(':').map(Number);
          add('4070', SLATE, x, y, z, outward(x, z)![2]);
        }
      // The main door: two four-pane leaves in frames, then a plate across them, an arch and
      // two plates up to the next course, before anything rests on them. Behind, a navy panel
      // on two piers fills the half-moon, like the banner hung over the real entrance.
      if (course < 6)
        for (const x of [DOOR[0] - 1, DOOR[1] + 1])
          add('3005', SANDSTONE, x, y, PAVILION_FRONT - 1);
      if (course === 0)
        for (const x of [DOOR[0], DOOR[0] + 4]) {
          // Hung half a turn round, so the leaf's extra half stud stands inside the hall
          // rather than out on the landing tile.
          add('60596', TRIM, x, y, PAVILION_FRONT, 270);
          add('60623', BARK, x, y, PAVILION_FRONT - 1, 270);
        }
      if (course === 6) {
        add('3460', TRIM, DOOR[0], y, PAVILION_FRONT, 90);
        add('3308', TRIM, DOOR[0], y + 1, PAVILION_FRONT, 90);
        for (const plate of [7, 8]) add('3460', TRIM, DOOR[0], y + plate, PAVILION_FRONT, 90);
      }
      if (course >= 6 && course < 9) add('6111', NAVY, DOOR[0] - 1, y, PAVILION_FRONT - 1, 90);
      // The banner: navy tiles on headlight bricks in the wall, with a gilded emblem.
      if (course >= BANNER_COURSES[0] && course <= BANNER_COURSES[1]) {
        for (let x = BANNER[0]; x <= BANNER[1]; x++)
          add('4070', SANDSTONE, x, y, PAVILION_FRONT, 180);
        const emblem = course === (BANNER_COURSES[0] + BANNER_COURSES[1]) / 2;
        if (emblem)
          for (let x = BANNER[0]; x <= BANNER[1]; x++)
            add(
              '3070b',
              x === BANNER[0] || x === BANNER[1] ? NAVY : GOLD,
              x,
              y + 0.5,
              PAVILION_FRONT + 0.8,
              0,
              '+z',
            );
        else add('2431', NAVY, BANNER[0], y + 0.5, PAVILION_FRONT + 0.8, 90, '+z');
      }
      addWindows(add, open, WINDOWS, course, y);
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
    const addApseCeiling = ({ width, cell, partitions }: Apse, y: number, firstRow: number) => {
      const axis = cell(1, 0)[0] === cell(0, 0)[0] ? 'z' : 'x';
      for (const [d, [from, to]] of apseRows(width).entries()) {
        if (d < firstRow) continue;
        const cuts = [from - 1, ...partitions.filter((u) => u >= from && u < to), to];
        for (const [index, end] of cuts.slice(1).entries()) {
          const start = cuts[index] + 1;
          const [[x0, z0], [x1, z1]] = [cell(start, d), cell(end, d)];
          addRun(add, 'plate', TRIM, axis, Math.min(x0, x1), y, Math.min(z0, z1), end - start + 1);
        }
      }
    };
    for (const apse of APSES) addApseCeiling(apse, CEILING, 2);
    addAreaMap(
      add,
      plan((x, z) => (inCeiling(x, z) && !enclosed(x, z) ? 't' : ' ')),
      ROOF,
      { t: ['tile', TRIM] },
    );

    // The end apses carry on above the eaves, with a window in the outer face under an arch in
    // the tan band on top, so their roofs start high enough to meet the main roof's slopes and
    // ridge. The hidden partitions rise with them and carry a plate ceiling under the roof.
    const inEndApse = (x: number, z: number) => isApse(x, z) && (x < WEST || x > EAST);
    for (let course = 0; course < APSE_RISE; course++) {
      const y = ROOF + course * 3;
      const band = course === APSE_RISE - 1;
      const standing = (x: number, z: number) =>
        inEndApse(x, z) && wall(x, z) && !opens(RISE_WINDOWS, x, z, course);
      addWallCourse(
        (x, z) => {
          if (!standing(x, z) || ROUND_CELLS.has(key(x, z))) return ' ';
          if (PARTITIONS.has(key(x, z))) return 'w';
          return band ? 'b' : stone(x, z, course);
        },
        y,
        course,
      );
      for (const cell of ROUND_CELLS) {
        const [x, z] = cell.split(':').map(Number);
        if (standing(x, z)) add('3062b', band ? TRIM : SANDSTONE, x, y, z);
      }
      addWindows(add, open, RISE_WINDOWS, course, y);
    }
    const apseEaves = ROOF + APSE_RISE * 3;
    for (const apse of END_APSES) addApseCeiling(apse, apseEaves, 0);

    // Steep slate roof: thirteen slope courses front and back up to a light granite ridge, with
    // sandstone gable ends, the lowest four clear of the corner towers. The slopes part round
    // the cross roofs over the back apse and the pavilion, a stud further in with every course
    // as the valleys climb, and from the crossing up they stop against the tower. They part
    // round the bays' dormers the same way.
    const [gableWest, gableEast] = [
      APSES[0].cell(0, 0)[0],
      APSES[0].cell(APSES[0].width - 1, 0)[0],
    ];
    const mirrored = (x: number) => SIZE - 1 - x;
    /**
     * Whether a bay's dormer takes the place of the main slopes at x in this course. The main
     * slopes run on unbroken from the course level with the dormers' ridges, which end against
     * them.
     */
    const inDormer = (x: number, step: number) => {
      const inset = Math.max(0, step - DORMER);
      return inset < 3 && BAYS.some((bay) => x >= bay + inset && x <= bay + 7 - inset);
    };
    for (let step = 0; step < ROOF_STEPS; step++) {
      const y = ROOF + step * 3;
      const [from, to] = step < 4 ? [WEST + 4, EAST - 4] : [WEST, EAST];
      const behind = step < CROSSING ? gableWest + step - 1 : TOWER[0] - 1;
      const before = step < CROSSING ? PAVILION_WEST - 1 + Math.max(0, step - ATTIC) : TOWER[0] - 1;
      for (const [edge, line, rotation] of [
        [behind, BACK + step, 0],
        [before, FRONT - 1 - step, 180],
      ] as const) {
        const sloped = (x: number) =>
          x >= from && x <= to && (x <= edge || x >= mirrored(edge)) && !inDormer(x, step);
        for (let x = from; x <= to; x++) {
          if (!sloped(x)) continue;
          let end = x;
          while (sloped(end + 1)) end++;
          addSlopeRun(add, x, end, y, line, rotation);
          x = end;
        }
      }
      const [z0, z1] = [Math.max(BACK + 2 + step, BACK + 4), Math.min(FRONT - 2 - step, FRONT - 4)];
      if (z1 >= z0)
        for (const x of [WEST, EAST]) addRun(add, 'brick', SANDSTONE, 'z', x, y, z0, z1 - z0 + 1);
    }
    // Between the innermost front dormers and the pavilion the slopes start three courses above
    // the eaves, on a hidden post.
    for (const x of [PAVILION_WEST, PAVILION_EAST])
      for (let course = 0; course < DORMER - 1; course++)
        add('3005', ROOFING, x, ROOF + course * 3, FRONT - DORMER);
    const ridge = BACK + ROOF_STEPS;
    const onChimney = (x: number) => CHIMNEYS.some((chimney) => x === chimney || x === chimney + 1);
    addAreaMap(
      add,
      plan((x, z) =>
        (z === ridge || z === ridge + 1) &&
        x >= WEST &&
        x <= EAST &&
        (x < TOWER[0] || x > TOWER[2]) &&
        !onChimney(x)
          ? 'r'
          : ' ',
      ),
      FLAT,
      { r: ['tile', GRANITE] },
    );
    // Sandstone chimneys with tan bands and copper pots stand astride the ridge.
    for (const x of CHIMNEYS) {
      for (let course = 0; course < 4; course++)
        add('3003', course === 2 ? TRIM : SANDSTONE, x, FLAT + course * 3, ridge);
      add('3022', ROOFING, x, FLAT + 12, ridge);
      for (const [dx, dz] of [
        [0, 0],
        [1, 1],
      ]) {
        add('3062b', COPPER, x + dx, FLAT + 13, ridge + dz);
        add('4589', GOLD, x + dx, FLAT + 16, ridge + dz);
      }
    }

    // The apses get faceted slate roofs; the end ones start above their upper windows and meet
    // the ridge.
    for (const [index, apse] of APSES.entries())
      addApseRoof(add, apse, index ? apseEaves + 1 : ROOF);
    // The back apse's roof carries on over the back slopes as a cross gable up to the tower,
    // its side slopes continuing the apse's under a granite ridge. Each course reaches a stud
    // further back than the one below, to where the main roof's slopes take over, and a row of
    // bricks closes its face above the apse roof.
    const gableBack = TOWER[1] - 1;
    for (let layer = 0; gableWest + layer + 1 < gableEast - layer - 1; layer++) {
      const y = ROOF + layer * 3;
      const [west, east] = [gableWest + layer, gableEast - layer - 1];
      const end = Math.min(BACK + layer + 1, gableBack);
      addSlopeRun(add, BACK, end, y, west, 90);
      addSlopeRun(add, BACK, end, y, east, 270);
      if (east > west + 2) addRun(add, 'brick', ROOFING, 'x', west + 2, y, BACK, east - west - 2);
      if (east === west + 2)
        addAreaMap(
          add,
          plan((x, z) => ((x === west + 1 || x === east) && z >= BACK && z <= end ? 'r' : ' ')),
          y + 3,
          { r: ['tile', GRANITE] },
        );
    }
    // Where the back slopes below the crossing end at the tower, cheese slopes finish the row
    // against its wall, either side of the cross gable.
    for (const x of range(TOWER[0], gableWest + CROSSING - 2))
      for (const at of [x, mirrored(x)])
        add('54200', ROOFING, at, ROOF + CROSSING * 3, gableBack, 0);

    // The pavilion's own roof runs from its gable back to the tower, as high as the main ridge:
    // slopes either side meeting under a granite ridge, each course starting where the main
    // roof's front slopes leave off.
    for (let layer = 0; PAVILION_WEST + layer + 1 < PAVILION_EAST - layer - 1; layer++) {
      const course = layer + ATTIC;
      const y = ROOF + course * 3;
      const [west, east] = [PAVILION_WEST + layer, PAVILION_EAST - layer - 1];
      const start =
        course < CROSSING ? FRONT - 1 - course : TOWER[3] + (course === CROSSING ? 2 : 1);
      addSlopeRun(add, start, PAVILION_FRONT - 1, y, west, 90);
      addSlopeRun(add, start, PAVILION_FRONT - 1, y, east, 270);
      if (east === west + 2)
        addAreaMap(
          add,
          plan((x, z) =>
            (x === west + 1 || x === east) && z >= start && z < PAVILION_FRONT ? 'r' : ' ',
          ),
          y + 3,
          { r: ['tile', GRANITE] },
        );
    }

    // Each bay ends in a dormer: a crow-stepped gable with a window between piers under an
    // arch, four steps with tan caps on their shoulders and a dark finial, in front of side
    // walls and a little roof of its own that runs back into the main roof under a granite
    // ridge. `inward` is the way from the gable into the roof.
    for (const bay of BAYS)
      for (const [face, inward] of [
        [FRONT + 2, -1],
        [BACK - 2, 1],
      ]) {
        const back = face + inward;
        /** A stretch of `length` studs along z from `depth` studs behind the backing wall. */
        const reach = (depth: number, length: number) =>
          inward > 0 ? back + depth : back - depth - length + 1;
        for (let step = 0; step < DORMER; step++) {
          const y = ROOF + step * 3;
          // Behind the window and fanlight the dormer stays open to the roof space.
          for (const x of [bay, bay + 6]) addRun(add, 'brick', SANDSTONE, 'x', x, y, back, 2);
          // The side walls reach a stud further into the roof with every course; a brick two
          // studs long carries the overhang.
          for (const x of [bay, bay + 7]) {
            if (step) addRun(add, 'brick', SANDSTONE, 'z', x, y, reach(1, step), step);
            addRun(add, 'brick', SANDSTONE, 'z', x, y, reach(step + 1, 2), 2);
          }
          if (step === 3) continue;
          // Piers either side of the window, narrowing to the arch's legs at its springing.
          const pier = step === 2 ? 1 : 2;
          addRun(add, 'brick', step === 1 ? TRIM : SANDSTONE, 'x', bay, y, face, pier);
          addRun(add, 'brick', step === 1 ? TRIM : SANDSTONE, 'x', bay + 8 - pier, y, face, pier);
        }
        for (const x of [bay + 2, bay + 4]) add('60592', JOINERY, x, ROOF, face, 90);
        open('20309', JOINERY, bay + 2, ROOF + 6, face, 90);
        add('15254', TRIM, bay + 1, ROOF + 6, face, 90);
        for (const x of [bay, bay + 7]) add('3005', TRIM, x, ROOF + 9, face);
        for (let layer = 0; layer < 3; layer++) {
          const y = ROOF + (DORMER + layer) * 3;
          const z = reach(0, DORMER + layer + 3);
          addSlopeRun(add, z, z + DORMER + layer + 2, y, bay + layer, 90);
          addSlopeRun(add, z, z + DORMER + layer + 2, y, bay + 6 - layer, 270);
        }
        for (const x of [bay + 3, bay + 4])
          addRun(add, 'tile', GRANITE, 'z', x, ROOF + (DORMER + 3) * 3, reach(0, 8), 8);
        for (const [step, from, length] of [
          [0, bay, 8],
          [1, bay + 1, 6],
          [2, bay + 2, 4],
          [3, bay + 3, 2],
        ] as const) {
          const y = ROOF + 12 + step * 3;
          addRun(add, 'brick', step === 3 ? TRIM : SANDSTONE, 'x', from, y, face, length);
          if (step >= 1) for (const x of [from - 1, from + length]) add('3070b', TRIM, x, y, face);
        }
        addFinial(add, bay + 3, ROOF + 24, face, ROOFING);
      }

    // The pavilion's front rises past the eaves into a crow-stepped gable in front of its roof:
    // the great arched window over the portal between two smaller ones, tan caps and dark
    // pinnacles on the steps, and a gilded finial. Short side walls close the attic below the
    // roof, back to the main roof's slopes.
    const gableJambs = new Set(
      GABLE_WINDOWS.flatMap((window) => [
        ...windowCells(window, -1, 1),
        ...windowCells(window, window.width, 1),
      ]),
    );
    const gableStep = (course: number) => Math.max(0, Math.floor((course - GABLE_ATTIC) / 2));
    for (let course = 0; course < GABLE_COURSES; course++) {
      const y = ROOF + course * 3;
      const inset = gableStep(course) * 2;
      const [west, east] = [PAVILION_WEST + inset, PAVILION_EAST - inset];
      const standing = (x: number, z: number) =>
        (z === PAVILION_FRONT && x >= west && x <= east) ||
        (course < ATTIC &&
          (x === PAVILION_WEST || x === PAVILION_EAST) &&
          z >= FRONT - 1 - course &&
          z < PAVILION_FRONT);
      addWallCourse(
        (x, z) => {
          if (!standing(x, z) || opens(GABLE_WINDOWS, x, z, course)) return ' ';
          if (course % 2 === 1 && (x === west || x === east || gableJambs.has(key(x, z))))
            return 'b';
          return stone(x, z, course);
        },
        y,
        course,
      );
      addWindows(add, open, GABLE_WINDOWS, course, y);
      // Each new step leaves a shoulder two studs wide either side: a pinnacle on every other
      // one, a tan cap on the rest.
      if (inset > gableStep(course - 1) * 2)
        for (const [outer, inner] of [
          [west - 2, west - 1],
          [east + 2, east + 1],
        ])
          if (gableStep(course) % 2) {
            add('3062b', TRIM, outer, y, PAVILION_FRONT);
            add('4589', ROOFING, outer, y + 3, PAVILION_FRONT);
            add('98138', GOLD, outer, y + 6, PAVILION_FRONT);
            add('3070b', TRIM, inner, y, PAVILION_FRONT);
          } else add('3069b', TRIM, Math.min(outer, inner), y, PAVILION_FRONT, 90);
    }
    const gableTop = ROOF + GABLE_COURSES * 3;
    addRun(add, 'brick', TRIM, 'x', 62, gableTop, PAVILION_FRONT, 4);
    for (const x of [62, 65]) add('3070b', TRIM, x, gableTop + 3, PAVILION_FRONT);
    addFinial(add, 63, gableTop + 3, PAVILION_FRONT, GOLD);
    add('3957a', GOLD, 63.5, gableTop + 10, PAVILION_FRONT);

    // The tower tapers in tiers like the one on the box: a plain shaft up through the roof to a
    // slab at the ridge, a tall dark slate octagon with an arched window in each face under a
    // copper cornice, a copper gallery with railings and corner pinnacles, an arcaded copper
    // lantern under a steep green bell, a smaller copper lantern under a green cone, and a copper
    // spire in tiers between gold rings up to a gilded point.
    for (let course = 0; course < ROOF_STEPS; course++)
      addWallCourse((x, z) => (rim(x, z, ...TOWER) ? 'd' : ' '), ROOF + course * 3, course);
    addAreaMap(
      add,
      plan((x, z) => (within(x, z, ...TOWER) ? 's' : ' ')),
      FLAT,
      { s: ['plate', SLATE] },
      (x, z) => rim(x, z, ...TOWER),
    );
    for (let course = 0; course < TOWER_COURSES; course++) {
      const y = CAP + course * 3;
      const top = course === TOWER_COURSES - 1;
      const material = top ? 'c' : 'd';
      const standing = (x: number, z: number) =>
        TOWER_RIM.has(key(x, z)) && !opens(TOWER_WINDOWS, x, z, course);
      addWallCourse(
        (x, z) => (standing(x, z) && !TOWER_ROUND.has(key(x, z)) ? material : ' '),
        y,
        course,
      );
      for (const cell of TOWER_ROUND) {
        const [x, z] = cell.split(':').map(Number);
        if (standing(x, z)) add('3062b', top ? COPPER : SLATE, x, y, z);
      }
      addWindows(add, open, TOWER_WINDOWS, course, y);
    }
    const balcony = CAP + TOWER_COURSES * 3;
    addAreaMap(
      add,
      plan((x, z) => (within(x, z, ...TOWER) ? 'g' : ' ')),
      balcony,
      { g: ['plate', COPPER] },
      (x, z) => TOWER_RIM.has(key(x, z)),
    );
    const posts = new Set(
      [0, 5, 6, 11].flatMap((at) => [
        key(TOWER[0] + at, TOWER[1]),
        key(TOWER[0] + at, TOWER[3]),
        key(TOWER[0], TOWER[1] + at),
        key(TOWER[2], TOWER[1] + at),
      ]),
    );
    for (const post of posts) {
      const [x, z] = post.split(':').map(Number);
      add('3062b', COPPER, x, balcony + 1, z);
      const corner = (x === TOWER[0] || x === TOWER[2]) && (z === TOWER[1] || z === TOWER[3]);
      // Corner pinnacles stand taller than the railing posts between them.
      if (corner) {
        add('3062b', COPPER, x, balcony + 4, z);
        add('59900', ROOFING, x, balcony + 7, z);
      } else add('98138', GOLD, x, balcony + 4, z);
    }
    for (const at of [1, 7]) {
      for (const z of [TOWER[1], TOWER[3]]) add('3633', COPPER, TOWER[0] + at, balcony + 1, z, 90);
      for (const x of [TOWER[0], TOWER[2]]) add('3633', COPPER, x, balcony + 1, TOWER[1] + at);
    }
    const lantern = balcony + 1;
    for (const [x, z] of [
      [60, 44],
      [66, 44],
      [60, 50],
      [66, 50],
    ])
      for (const y of [0, 3]) add('3941', COPPER, x, lantern + y, z);
    // Each face: two lights under an arch whose opening a half-round fanlight fills, the arch's
    // legs on the corner piers.
    for (const z of [44, 51]) {
      for (const x of [62, 64]) add('60592', JOINERY, x, lantern, z, 90);
      add('20309', JOINERY, 62, lantern + 6, z, 90);
      add('15254', COPPER, 61, lantern + 6, z, 90);
    }
    for (const x of [60, 67]) {
      for (const z of [46, 48]) add('60592', JOINERY, x, lantern, z, 0);
      add('20309', JOINERY, x, lantern + 6, 46, 0);
      add('15254', COPPER, x, lantern + 6, 45, 0);
    }
    for (const [x, z] of [
      [60, 44],
      [67, 44],
      [60, 51],
      [67, 51],
    ]) {
      add('3005', COPPER, x, lantern + 6, z);
      add('3062b', COPPER, x, lantern + 9, z);
    }
    // The bell: a copper plate over the lantern, then a ring of steep copper slopes round a
    // brick core, narrowing it from eight studs to four, with a corner slope at each corner.
    const dome = lantern + 12;
    const BELL = 9;
    add('41539', COPPER, 60, dome, 44);
    for (const [x, z, rotation] of [
      [60, 44, 90],
      [66, 44, 0],
      [60, 50, 180],
      [66, 50, 270],
    ] as const)
      add('3685', COPPER, x, dome + 1, z, rotation);
    for (let at = 62; at <= 65; at++) {
      add('4460b', COPPER, at, dome + 1, 44, 0);
      add('4460b', COPPER, at, dome + 1, 50, 180);
      add('4460b', COPPER, 60, dome + 1, at - 16, 90);
      add('4460b', COPPER, 66, dome + 1, at - 16, 270);
    }
    for (const y of [1, 4, 7])
      for (const x of [62, 64]) for (const z of [46, 48]) add('3003', COPPER, x, dome + y, z);
    // The upper lantern: copper corner posts and a window in each face on the bell's field of
    // studs, under a copper plate and a copper cone.
    const upper = dome + 1 + BELL;
    for (const [x, z] of [
      [62, 46],
      [65, 46],
      [62, 49],
      [65, 49],
    ])
      for (const y of [0, 3]) add('3062b', COPPER, x, upper + y, z);
    for (const z of [46, 49]) add('60592', JOINERY, 63, upper, z, 90);
    for (const x of [62, 65]) add('60592', JOINERY, x, upper, 47, 0);
    // The onion: two round bricks swelling under a 4 x 4 dome, and a 3 x 3 dome on the one
    // centred stud the larger dome ends in, drawing it up to a point.
    add('3031', COPPER, 62, upper + 6, 46);
    for (const y of [7, 10]) add('87081', COPPER, 62, upper + y, 46);
    add('3960', COPPER, 62, upper + 13, 46);
    add('43898', COPPER, 62.5, upper + 15, 46.5);
    // The needle: a slim copper shaft between gold rings, a grooved cone and a gilded point.
    const spire = upper + 17;
    add('6141', GOLD, 63.5, spire, 47.5);
    for (const y of [1, 4, 7]) add('3062b', COPPER, 63.5, spire + y, 47.5);
    add('6141', GOLD, 63.5, spire + 10, 47.5);
    add('3062b', COPPER, 63.5, spire + 11, 47.5);
    add('59900', COPPER, 63.5, spire + 14, 47.5);
    add('3957a', GOLD, 63.5, spire + 17, 47.5);

    // The towers end in an octagonal tan slab under their steeples.
    const towerTop = BASE + TURRET_COURSES * 3;
    addAreaMap(
      add,
      plan((x, z) => (isTurret(x, z) ? 'c' : ' ')),
      towerTop,
      { c: ['plate', TRIM] },
      (x, z) => TURRET_WALLS.has(key(x, z)),
    );
    for (const [x, z] of TURRETS) addSteeple(add, x + 1, towerTop + 1, z + 1);

    // Grounds: a black railing round the quay with lamps between its runs, leafy trees on the
    // front lawn and behind the museum, and a sailing boat moored off the front.
    for (const [x, z, rotation] of RAILINGS) add('15332', BLACK, x, LAWN_TOP, z, rotation);
    for (const x of QUAY_LAMPS) addLampPost(add, x, ISLAND[3] - 1);
    for (const [index, [x, z, crown, trunk]] of TREES.entries())
      addTree(add, x, z, LAWN_TOP, CROWNS[crown], BARK, trunk, index);
    addSailboat(add, 86, 110);
    for (const piece of pieces.toSorted((first, second) => first[3] - second[3]))
      drawnAdd(...piece);
  },
};
