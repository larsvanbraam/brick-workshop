import { addAreaMap, addBondedMap, addRun, glazeWindows, turnAround } from './layout.ts';
import type { RunKind } from './layout.ts';
import type { ExampleBrickAdder, ExampleDefinition } from './types.ts';
import type { Facing, Rotation } from '../core.ts';
import { layPlateFloor } from '../board.ts';

// Plans are drawn top-down on the 64-stud board with the front at high z; x runs left to right.
// The building is symmetric about x = 31.5. Proportions follow a massing model of the museum at
// 0.375 studs to the metre: a long main block with gabled bays, corner turrets, half-octagon
// apses at both ends and behind the crossing, the entrance pavilion in front and the tower over
// the crossing.
const SIZE = 64;

const SANDSTONE = 28;
const TRIM = 19;
const GRANITE = 71;
const SLATE = 72;
/** The steep roofs, spires and dome read as dark slate, as on the real museum. */
const ROOFING = 0;
const COPPER = 378;
const LAWN = 2;
const FOREST = 288;
const BARK = 70;
const WATER = 1;
const NAVY = 272;
const WHITE = 15;
const GLASS = 47;
/** Trans-black glass, so the white window frames stand out against dark panes. */
const PANES = 40;
const BLACK = 0;
const GOLD = 297;

/**
 * Heights: water level, the quay top, the lawn on it, the terrace top (building base), the main
 * ceiling at the eaves, the roof base, the flat top of the central block and the tiles on it.
 * The walls are eight courses: a plinth, ground-floor windows, a band, upper windows and a band.
 * The roof rises six slope courses to a ridge.
 */
const GROUND = 2;
const QUAY = GROUND + 4;
const LAWN_TOP = QUAY + 1;
const BASE = QUAY + 4;
const CEILING = BASE + 24;
const ROOF = CEILING + 1;
const ROOF_STEPS = 6;
const FLAT = ROOF + ROOF_STEPS * 3;
const CAP = FLAT + 1;

/** Main block outline, its front and back walls, and the entrance pavilion in front. */
const [WEST, EAST, BACK, FRONT] = [8, 55, 17, 30];
const PAVILION_FRONT = 33;

/** Façade bays: 4-stud projections in front of both long walls, each with a gable over it. */
const BAYS = [10, 16, 22, 38, 44, 50];
const RECESSES = [14, 20, 42, 48];

const within = (x: number, z: number, x0: number, z0: number, x1: number, z1: number) =>
  x >= x0 && x <= x1 && z >= z0 && z <= z1;
const rim = (x: number, z: number, x0: number, z0: number, x1: number, z1: number) =>
  within(x, z, x0, z0, x1, z1) && (x === x0 || x === x1 || z === z0 || z === z1);
const plan = (cell: (x: number, z: number) => string) =>
  Array.from({ length: SIZE }, (_, z) =>
    Array.from({ length: SIZE }, (_, x) => cell(x, z)).join(''),
  );

const isBay = (x: number, z: number) =>
  (z === FRONT + 1 || z === BACK - 1) && BAYS.some((bay) => x >= bay && x <= bay + 3);
/** Square corner turrets, 3 x 3, overlapping each corner of the main block by two studs. */
const TURRETS = [
  [WEST - 1, FRONT - 1],
  [EAST - 1, FRONT - 1],
  [WEST - 1, BACK - 1],
  [EAST - 1, BACK - 1],
] as const;
const TURRET_COURSES = 14;
const isTurret = (x: number, z: number) =>
  TURRETS.some(([turretX, turretZ]) => within(x, z, turretX, turretZ, turretX + 2, turretZ + 2));
/**
 * Half-octagon apses, one behind the crossing and one on each end wall. `cell` maps a stud u
 * along the wall and d out from it to the plan; `out`, `minus` and `plus` are the slope
 * rotations facing away from the wall and towards lower and higher u.
 */
interface Apse {
  width: number;
  cell: (u: number, d: number) => readonly [number, number];
  out: Rotation;
  minus: Rotation;
  plus: Rotation;
}
const APSES: readonly Apse[] = [
  { width: 10, cell: (u, d) => [27 + u, BACK - 1 - d], out: 0, minus: 90, plus: 270 },
  { width: 8, cell: (u, d) => [WEST - 1 - d, 20 + u], out: 90, minus: 0, plus: 180 },
  { width: 8, cell: (u, d) => [EAST + 1 + d, 20 + u], out: 270, minus: 0, plus: 180 },
];
/** An apse's rows from the wall out, as [from, to] in u: two full rows, then the angled faces. */
const apseRows = (width: number): (readonly [number, number])[] => [
  [0, width - 1],
  [0, width - 1],
  [1, width - 2],
  [2, width - 3],
];
const APSE_CELLS = new Set(
  APSES.flatMap(({ width, cell }) =>
    apseRows(width).flatMap(([from, to], d) =>
      Array.from({ length: to - from + 1 }, (_, index) => cell(from + index, d).join(':')),
    ),
  ),
);
const isApse = (x: number, z: number) => APSE_CELLS.has(`${x}:${z}`);
/**
 * The end apses rise this many courses past the eaves, so their roofs climb to the ridge and
 * close the ends of the main roof instead of stopping halfway up its gables.
 */
const APSE_RISE = 3;
const isEndApse = (x: number, z: number) => isApse(x, z) && (x < WEST || x > EAST);
/** Apses are hollow: their walls are the cells that touch the outside, corners included. */
const apseWall = (x: number, z: number) =>
  isApse(x, z) && [-1, 0, 1].some((dx) => [-1, 0, 1].some((dz) => !enclosed(x + dx, z + dz)));

/** Everything the main ceiling covers. */
const footprint = (x: number, z: number) =>
  (within(x, z, WEST, BACK, EAST, FRONT) ||
    isBay(x, z) ||
    within(x, z, 26, FRONT, 37, PAVILION_FRONT) ||
    isApse(x, z)) &&
  !isTurret(x, z);
/** Cells inside the building's outline at wall height. */
const enclosed = (x: number, z: number) => footprint(x, z) || isTurret(x, z);
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

/**
 * The ceiling's plate areas: the main span from back overhang to front overhang between the
 * turrets, and the ends between the turrets with their overhang, as [x0, z0, x1, z1].
 */
const MAIN_CEILING = [WEST + 3, BACK - 1, EAST - 3, FRONT + 1] as const;
const END_CEILINGS = [
  [WEST - 1, BACK + 2, WEST + 2, FRONT - 2],
  [EAST - 2, BACK + 2, EAST + 1, FRONT - 2],
] as const;
/**
 * Dentils under the cornice: headlight bricks in the top band where a long wall meets the
 * overhang, each with a flat tile on its side stud.
 */
const dentil = (x: number, z: number, course: number) =>
  course === 7 &&
  (z === FRONT || z === BACK) &&
  x >= MAIN_CEILING[0] &&
  x <= MAIN_CEILING[2] &&
  wall(x, z) &&
  !enclosed(x, z === FRONT ? z + 1 : z - 1);

/** The pavilion opens into the hall: the front wall doesn't run on behind it. */
const behindEntrance = (x: number, z: number) => z === FRONT && x > 26 && x < 37;
/**
 * Inside, an arch on two piers lines up with the front door's arch and leads on into the hall;
 * the bays either side stay open, so the pavilion windows look in.
 */
const innerArch = (x: number, z: number, course: number) =>
  z === FRONT && (x === 29 || x === 34) && course <= 5;
const wall = (x: number, z: number) =>
  (((rim(x, z, WEST, BACK, EAST, FRONT) || rim(x, z, 26, FRONT, 37, PAVILION_FRONT)) &&
    !behindEntrance(x, z)) ||
    isBay(x, z) ||
    apseWall(x, z)) &&
  !isTurret(x, z);
const isCentral = (x: number) => x >= 26 && x <= 37;

/**
 * Windows as [x, z, rotation]: 90 for walls along x, 0 for walls along z. Each has a tall
 * ground-floor window and a shorter one above.
 */
const WINDOWS: readonly (readonly [number, number, 0 | 90])[] = [
  ...BAYS.map((bay) => [bay + 1, FRONT + 1, 90] as const),
  ...RECESSES.map((x) => [x, FRONT, 90] as const),
  ...BAYS.map((bay) => [bay + 1, BACK - 1, 90] as const),
  ...RECESSES.map((x) => [x, BACK, 90] as const),
  [26, FRONT + 1, 0],
  [37, FRONT + 1, 0],
  [31, BACK - 4, 90],
  [WEST - 4, 23, 0],
  [EAST + 4, 23, 0],
];
/** The first cell inside the building behind a window in a wall at `at` along z (or x). */
const inside = (at: number, axis: 'x' | 'z' = 'z') => {
  if (axis === 'x') return at < 32 ? at + 1 : at - 1;
  if (at >= FRONT) return FRONT - 1;
  if (at === BACK - 4) return at + 1;
  return BACK + 1;
};
/** Cells a window opens: its own two, plus the long wall behind each bay window. */
const WINDOW_CELLS = new Set(
  WINDOWS.flatMap(([x, z, rotation]) =>
    [0, 1].flatMap((offset) => {
      const [cellX, cellZ] = rotation === 90 ? [x + offset, z] : [x, z + offset];
      const behind = { [FRONT + 1]: FRONT, [BACK - 1]: BACK }[cellZ];
      return [`${cellX}:${cellZ}`, ...(behind ? [`${cellX}:${behind}`] : [])];
    }),
  ),
);
/**
 * Headlight bricks under each window read as basement lights in the plinth. Their side stud
 * points to LDraw -z, so 180 faces the front, 0 the back, 90 the left and 270 the right.
 */
const BASEMENT_LIGHTS = WINDOWS.flatMap(([x, z, rotation]) =>
  [0, 1].map((offset) => {
    const [cellX, cellZ] = rotation === 90 ? [x + offset, z] : [x, z + offset];
    const facing = rotation === 90 ? (z >= FRONT ? 180 : 0) : x < 32 ? 90 : 270;
    return [cellX, cellZ, facing] as const;
  }),
);
const BASEMENT_CELLS = new Set(BASEMENT_LIGHTS.map(([x, z]) => `${x}:${z}`));

/**
 * Sandstone walls mix plain bricks with patches of masonry profile bricks: most of the ground
 * floor is rusticated, the upper storeys only here and there.
 */
const stone = (x: number, z: number, course: number, density: number) => {
  const patch = Math.floor((x + z + (course % 2) * 2) / 3);
  return (patch * 7 + course * 3) % 10 < density ? 'm' : 'w';
};
/**
 * Dressed stone: the outside corners of every block, where two outside faces meet, and the
 * jambs either side of each window.
 */
const isCorner = (x: number, z: number) =>
  OUTWARD.filter(([dx, dz]) => !enclosed(x + dx, z + dz)).length >= 2;
/** The outside corners of turrets and apses are round bricks, to soften their outlines. */
const ROUND_CORNERS = Array.from({ length: SIZE * SIZE }, (_, index) => [
  index % SIZE,
  Math.floor(index / SIZE),
]).filter(([x, z]) => (isTurret(x, z) || isApse(x, z)) && isCorner(x, z));
const ROUND_CELLS = new Set(ROUND_CORNERS.map(([x, z]) => `${x}:${z}`));
const JAMBS = new Set(
  WINDOWS.flatMap(([x, z, rotation]) =>
    rotation === 90 ? [`${x - 1}:${z}`, `${x + 2}:${z}`] : [`${x}:${z - 1}`, `${x}:${z + 2}`],
  ),
);
/**
 * Wall courses: a granite plinth, tan bands over each storey and sandstone between, with tan
 * quoins at the corners and window jambs on every other course, like the real dressed stone.
 */
const material = (x: number, z: number, course: number) => {
  if (course === 0) return 'p';
  if (course === 4 || (course >= 7 && course % 3 === 1)) return 'b';
  if (course % 2 === 1 && (isCorner(x, z) || JAMBS.has(`${x}:${z}`))) return 'b';
  return stone(x, z, course, course < 4 ? 6 : 3);
};

/**
 * Round-headed windows: a 1 x 4 arch in the tan band over the bay, pavilion side and apse
 * windows, its legs on the piers either side, as [x, z, rotation]. The recessed windows in the
 * long walls keep square heads, since the band there also bridges the openings behind the bay
 * windows, and so do the pavilion's front windows beside the portal.
 */
const WINDOW_ARCHES = WINDOWS.filter(
  ([, z]) => z !== FRONT && z !== BACK && z !== PAVILION_FRONT,
).map(([x, z, rotation]): readonly [number, number, 0 | 90] =>
  rotation === 90 ? [x - 1, z, 90] : [x, z - 1, 0],
);
const ARCH_CELLS = new Set(
  WINDOW_ARCHES.flatMap(([x, z, rotation]) =>
    [0, 1, 2, 3].map((offset) => (rotation === 90 ? `${x + offset}:${z}` : `${x}:${z + offset}`)),
  ),
);

/**
 * The island quay rising from the water, with a promenade along its front edge and the name
 * plaque set in the middle of the front wall. On it a granite terrace raises the museum, with
 * broad steps between low cheek walls up to the entrance.
 */
const ISLAND = [2, 6, 61, 50] as const;
const PROMENADE = 46;
const TERRACE = [3, 12, 60, 36] as const;
const STEPS = [26, 37] as const;
const CHEEKS = [STEPS[0] - 1, STEPS[1] + 1];
const isPlaque = (x: number, z: number) => z === ISLAND[3] && x >= 26 && x <= 37;
/** Railing along the front and sides of the quay, as [x, z, rotation], and the lamps between. */
const RAILINGS = [
  ...[4, 8, 12, 17, 21, 25, 30, 35, 39, 43, 48, 52, 56].map((x) => [x, ISLAND[3], 90] as const),
  ...Array.from({ length: 11 }, (_, index) =>
    [ISLAND[0], ISLAND[2]].map((x) => [x, 7 + index * 4, 0] as const),
  ).flat(),
];
const QUAY_LAMPS = [3, 16, 29, 34, 47, 60];
/** Round trees as [x, z, colour, trunk courses]: a row along the front lawn and one behind. */
const TREES = [
  ...[3, 9, 15, 20].flatMap((x, index) => [
    [x, 40, index % 2 ? FOREST : LAWN, 2 - (index % 2)] as const,
    [59 - x, 40, index % 2 ? FOREST : LAWN, 2 - (index % 2)] as const,
  ]),
  ...[3, 10, 17].flatMap((x, index) => [
    [x, 7, index % 2 ? LAWN : FOREST, 1] as const,
    [59 - x, 7, index % 2 ? LAWN : FOREST, 1] as const,
  ]),
];
/** The portal's columns stand on the terrace either side of the door, piers beyond them. */
const PORTAL_COLUMNS = [29, 34];
const PIERS = [26, 35];
const isPortal = (x: number, z: number) =>
  z === PAVILION_FRONT + 1 && x >= 26 && x <= 37 && !(x >= 30 && x <= 33);

const WALL_LEGEND: Readonly<Record<string, readonly [RunKind, number]>> = {
  p: ['masonry', GRANITE],
  q: ['masonry', SLATE],
  w: ['brick', SANDSTONE],
  m: ['masonry', SANDSTONE],
  b: ['brick', TRIM],
};

/** A row of 45 degree roof slopes, split into the widest pieces that fit. */
function addSlopeRun(
  add: ExampleBrickAdder,
  from: number,
  to: number,
  y: number,
  line: number,
  rotation: 0 | 90 | 180 | 270,
) {
  // Rotations 0 and 180 run along x at z = line; 90 and 270 run along z at x = line.
  for (let at = from; at <= to;) {
    const width = Math.min(4, to - at + 1);
    const partId = { 4: '3037', 3: '3038', 2: '3039', 1: '3040b' }[width]!;
    if (rotation % 180) add(partId, ROOFING, line, y, at, rotation);
    else add(partId, ROOFING, at, y, line, rotation);
    at += width;
  }
}

/**
 * A faceted roof over an apse: each layer steps a stud in from the walls below, with slopes on
 * its outer face and sides and cheese slopes where the angled faces meet the outer one.
 */
function addApseRoof(add: ExampleBrickAdder, { width, cell, out, minus, plus }: Apse, y: number) {
  const slope = (u0: number, u1: number, d0: number, d1: number, rotation: Rotation, y: number) => {
    // Rotations 90 and 270 run along z, 0 and 180 along x; the line is the other axis.
    const [[x0, z0], [x1, z1]] = [cell(u0, d0), cell(u1, d1)];
    const [along0, along1, across] =
      rotation % 180 ? [z0, z1, Math.min(x0, x1)] : [x0, x1, Math.min(z0, z1)];
    addSlopeRun(add, Math.min(along0, along1), Math.max(along0, along1), y, across, rotation);
  };
  const cheese = (u: number, d: number, y: number) => {
    const [x, z] = cell(u, d);
    add('54200', ROOFING, x, y, z, out);
  };
  let rows = apseRows(width);
  for (let layer = 0; rows.length; layer++) {
    const at = y + layer * 3;
    const [from, to] = rows.at(-1)!;
    if (rows.length === 1) for (let u = from; u <= to; u++) cheese(u, 0, at);
    else {
      slope(from, to, rows.length - 2, rows.length - 1, out, at);
      const [innerFrom, innerTo] = rows.at(-2)!;
      for (let u = innerFrom; u <= innerTo; u++)
        if (u < from || u > to) cheese(u, rows.length - 2, at);
      if (rows.length > 2) {
        const [first, last] = rows[0];
        slope(first, first + 1, 0, rows.length - 3, minus, at);
        slope(last - 1, last, 0, rows.length - 3, plus, at);
      }
    }
    // The next layer keeps the cells whose neighbours along the wall and further out are roofed.
    rows = rows
      .slice(0, -1)
      .map(([first, last], d): readonly [number, number] => [
        Math.max(first + 1, rows[d + 1][0]),
        Math.min(last - 1, rows[d + 1][1]),
      ]);
  }
}

/** A small finial: jumper plate along x, a round brick on its centre stud and a cone. */
function addFinial(add: ExampleBrickAdder, x: number, y: number, z: number, tip = COPPER) {
  add('3794b', TRIM, x, y, z, 90);
  add('3062b', TRIM, x + 0.5, y + 1, z);
  add('4589', tip, x + 0.5, y + 4, z);
}

/** A round tree: a brown trunk of round bricks under an oval crown. */
function addTree(add: ExampleBrickAdder, x: number, z: number, color: number, trunk: number) {
  for (let course = 0; course < trunk; course++)
    add('3062b', BARK, x + 2, LAWN_TOP + course * 3, z + 2);
  add('3470', color, x, LAWN_TOP + trunk * 3, z);
}

/**
 * A candelabra lamp: a black post with a crossbar carrying three white globes, each under a
 * black cap, the middle one raised on a short stem.
 */
function addLampPost(add: ExampleBrickAdder, x: number, z: number, y = LAWN_TOP) {
  add('2453b', BLACK, x, y, z);
  add('3623', BLACK, x - 1, y + 15, z, 90);
  for (const [dx, stem] of [
    [-1, 0],
    [0, 3],
    [1, 0],
  ]) {
    if (stem) add('3062b', BLACK, x + dx, y + 16, z);
    add('3062b', WHITE, x + dx, y + 16 + stem, z);
    add('98138', BLACK, x + dx, y + 19 + stem, z);
  }
}

/**
 * A sailing boat moored off the quay, its bow towards +x: a white hull with a pointed bow under
 * a wooden deck, a small cabin, and a stepped mainsail and jib either side of the mast.
 */
function addSailboat(add: ExampleBrickAdder, x: number, z: number) {
  add('3832', WHITE, x, GROUND, z, 90);
  add('3007', WHITE, x, GROUND + 1, z, 90);
  add('3039', WHITE, x + 8, GROUND + 1, z, 270);
  add('3034', BARK, x, GROUND + 4, z, 90);
  add('3004', WHITE, x + 1, GROUND + 5, z + 1, 90);
  add('3069b', WHITE, x + 1, GROUND + 8, z + 1, 90);
  for (const y of [GROUND + 5, GROUND + 20]) add('2453b', WHITE, x + 5, y, z);
  add('4589', GOLD, x + 5, GROUND + 35, z);
  for (const [row, length] of [4, 4, 4, 3, 3, 2, 2, 1, 1].entries())
    addRun(add, 'brick', WHITE, 'x', x + 5 - length, GROUND + 5 + row * 3, z, length);
  for (const [row, length] of [2, 2, 1, 1, 1].entries())
    addRun(add, 'brick', WHITE, 'x', x + 6, GROUND + 5 + row * 3, z, length);
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
  expectedPieceCount: 2606,
  buildArea: SIZE,
  brickIdPrefix: 'museet',
  build(drawnAdd) {
    const add = glazeWindows(turnAround(drawnAdd, SIZE), PANES);
    /** A bonded wall course from a plan of wall letters. */
    const addWallCourse = (cell: (x: number, z: number) => string, y: number, course: number) =>
      addBondedMap(add, plan(cell), y, WALL_LEGEND, course);
    /** Round corner bricks for one course, in the course's material where `cells` holds. */
    const addRoundCorners = (
      cells: (x: number, z: number) => boolean,
      y: number,
      course: number,
    ) => {
      for (const [x, z] of ROUND_CORNERS)
        if (cells(x, z)) add('3062b', WALL_LEGEND[material(x, z, course)][1], x, y, z);
    };

    // The 64 x 64 board is the water round the island, a two-layer plate floor, so the whole
    // board lifts as one.
    for (const plate of layPlateFloor({ x: 0, z: 0, width: SIZE, depth: SIZE }, WATER)!.bricks)
      add(plate.partId, plate.color, plate.x, plate.y, plate.z, plate.rotation);

    // Island quay: a slate plate footing, dark masonry quay walls round a brick core, and the
    // name plaque in the front wall, a black tile on a row of headlight bricks.
    const island = (x: number, z: number) => within(x, z, ...ISLAND);
    const quay = (x: number, z: number) => rim(x, z, ...ISLAND);
    addAreaMap(
      add,
      plan((x, z) => (island(x, z) ? 's' : ' ')),
      GROUND,
      { s: ['plate', SLATE] },
    );
    addBondedMap(
      add,
      plan((x, z) => (quay(x, z) && !isPlaque(x, z) ? 'q' : ' ')),
      GROUND + 1,
      WALL_LEGEND,
      0,
    );
    addAreaMap(
      add,
      plan((x, z) => (island(x, z) && !quay(x, z) ? 'c' : ' ')),
      GROUND + 1,
      { c: ['brick', SLATE] },
    );
    for (let x = 26; x <= 37; x++) add('4070', SLATE, x, GROUND + 1, ISLAND[3], 180);
    for (const x of [26, 32]) add('6636', BLACK, x, GROUND + 1.5, ISLAND[3] + 0.8, 90, '+z');

    // On the quay: granite coping round the edge, the paved promenade along the front, a tan
    // path from the steps, and lawn everywhere else.
    const terrace = (x: number, z: number) => within(x, z, ...TERRACE);
    const stairs = (x: number, z: number) =>
      within(x, z, CHEEKS[0], TERRACE[3] + 1, CHEEKS[1], TERRACE[3] + 4);
    addAreaMap(
      add,
      plan((x, z) => {
        if (!island(x, z) || terrace(x, z) || stairs(x, z)) return ' ';
        if (quay(x, z)) return 'k';
        if (within(x, z, 29, TERRACE[3] + 5, 34, PROMENADE - 1)) return 't';
        return z >= PROMENADE ? 'p' : 'g';
      }),
      QUAY,
      {
        k: ['plate', GRANITE],
        t: ['tile', TRIM],
        p: ['tile', GRANITE],
        g: ['plate', LAWN],
      },
    );

    // Granite terrace under the museum: a masonry rim round a brick core, a plate course over
    // both, and paving round the walls with a tan carpet from the door to the steps.
    addBondedMap(
      add,
      plan((x, z) => (rim(x, z, ...TERRACE) ? 'p' : ' ')),
      QUAY,
      WALL_LEGEND,
      0,
    );
    addAreaMap(
      add,
      plan((x, z) => (terrace(x, z) && !rim(x, z, ...TERRACE) ? 'c' : ' ')),
      QUAY,
      { c: ['brick', SLATE] },
    );
    addAreaMap(
      add,
      plan((x, z) => (terrace(x, z) ? 's' : ' ')),
      QUAY + 3,
      { s: ['plate', GRANITE] },
    );
    addAreaMap(
      add,
      plan((x, z) =>
        !terrace(x, z) || footprint(x, z) || isTurret(x, z) || isPortal(x, z)
          ? ' '
          : within(x, z, 29, PAVILION_FRONT + 1, 34, TERRACE[3])
            ? 't'
            : 'g',
      ),
      BASE,
      { t: ['tile', TRIM], g: ['tile', GRANITE] },
    );

    // Broad front steps, one plate each, between low cheek walls that carry a lamp apiece.
    for (const [index, plates] of [3, 2, 1, 0].entries()) {
      const z = TERRACE[3] + 1 + index;
      for (let layer = 0; layer < plates; layer++)
        addRun(add, 'plate', GRANITE, 'x', STEPS[0], QUAY + layer, z, STEPS[1] - STEPS[0] + 1);
      addRun(add, 'tile', GRANITE, 'x', STEPS[0], QUAY + plates, z, STEPS[1] - STEPS[0] + 1);
    }
    for (const x of CHEEKS) {
      add('3010', GRANITE, x, QUAY, TERRACE[3] + 1);
      add('3710', TRIM, x, QUAY + 3, TERRACE[3] + 1);
      addLampPost(add, x, TERRACE[3] + 1, BASE);
    }

    // Main walls: granite plinth, sandstone storeys and tan string courses, with tall windows
    // below and shorter ones above, a double entrance door and an arch over it.
    for (let course = 0; course < 8; course++) {
      const y = BASE + course * 3;
      const windowCourse = (course >= 1 && course <= 3) || (course >= 5 && course <= 6);
      const open = (x: number, z: number) =>
        (windowCourse && WINDOW_CELLS.has(`${x}:${z}`)) ||
        (z === PAVILION_FRONT && course <= 5 && x >= 30 && x <= 33) ||
        (z === PAVILION_FRONT && course >= 6 && x >= 29 && x <= 34) ||
        (z === FRONT && course >= 6 && x >= 29 && x <= 34) ||
        ((course === 4 || course === 7) && ARCH_CELLS.has(`${x}:${z}`)) ||
        (course === 0 && BASEMENT_CELLS.has(`${x}:${z}`));
      addWallCourse(
        (x, z) =>
          (wall(x, z) || innerArch(x, z, course)) &&
          !open(x, z) &&
          !dentil(x, z, course) &&
          !ROUND_CELLS.has(`${x}:${z}`)
            ? material(x, z, course)
            : ' ',
        y,
        course,
      );
      addRoundCorners((x, z) => wall(x, z) && !open(x, z), y, course);
      for (let x = MAIN_CEILING[0]; x <= MAIN_CEILING[2]; x++)
        for (const z of [FRONT, BACK])
          if (dentil(x, z, course)) {
            const [, , rotation, facing, dx, dz] = OUTWARD[z === FRONT ? 0 : 1];
            add('4070', TRIM, x, y, z, rotation);
            add('3070b', TRIM, x + dx, y + 0.5, z + dz, 0, facing);
          }
      if (course === 1)
        for (const [x, z, rotation] of WINDOWS) add('60593', WHITE, x, y, z, rotation);
      if (course === 5)
        for (const [x, z, rotation] of WINDOWS) add('60592', WHITE, x, y, z, rotation);
      if (course === 0)
        for (const [x, z, rotation] of BASEMENT_LIGHTS) add('4070', SLATE, x, y, z, rotation);
      // Arches over the front door and the inner opening, and over the windows, before
      // anything rests on them.
      if (course === 6) for (const z of [PAVILION_FRONT, FRONT]) add('3307', TRIM, 29, y, z, 90);
      if (course === 4 || course === 7)
        for (const [x, z, rotation] of WINDOW_ARCHES) add('3659', TRIM, x, y, z, rotation);
    }
    // Dark backing inside every window, a column of tall 1 x 2 bricks from the floor to the
    // ceiling, so the panes read dark against the white frames.
    for (const [x, z, rotation] of WINDOWS) {
      const [insideX, insideZ] = rotation === 90 ? [x, inside(z)] : [inside(x, 'x'), z];
      for (const [partId, y] of [
        ['2454b', BASE],
        ['3245c', BASE + 15],
        ['3004', BASE + 21],
      ] as const)
        add(partId, BLACK, insideX, y, insideZ, rotation);
    }
    add('60596', TRIM, 30, BASE, PAVILION_FRONT, 90);
    add('60623', BARK, 30, BASE, PAVILION_FRONT - 0.5, 90);
    // Behind the arch over the door, a navy panel fills the half-moon like the banner hung over
    // the real entrance. It rests on two piers hidden behind the wall either side.
    for (const x of [29, 34])
      for (let course = 0; course < 6; course++)
        add('3005', SANDSTONE, x, BASE + course * 3, PAVILION_FRONT - 1);
    for (const y of [BASE + 18, BASE + 21]) add('3009', NAVY, 29, y, PAVILION_FRONT - 1, 90);

    // Stone portal, after the real entrance: a column either side of the door carries an
    // entablature, its frieze a row of headlight bricks holding the gilded name band, under a
    // projecting cornice and a shallow pediment with a seated figure on the apex. Piers frame
    // it, each with a name plaque, a statue in an arched niche and a lantern spire on top.
    const portal = PAVILION_FRONT + 1;
    for (const x of PORTAL_COLUMNS) {
      add('3024', GRANITE, x, BASE, portal);
      for (let course = 0; course < 7; course++)
        add('3062b', GRANITE, x, BASE + 1 + course * 3, portal);
      add('6141', TRIM, x, BASE + 22, portal);
      add('3024', GRANITE, x, BASE + 23, portal);
    }
    const frieze = BASE + 24;
    add('3666', GRANITE, 29, frieze, portal, 90);
    for (let x = 29; x <= 34; x++) add('4070', GRANITE, x, frieze + 1, portal, 180);
    add('2431', GOLD, 30, frieze + 1.5, portal + 0.8, 90, '+z');
    for (const x of PORTAL_COLUMNS) add('3070b', TRIM, x, frieze + 1.5, portal + 0.8, 0, '+z');
    add('3795', GRANITE, 29, frieze + 4, portal, 90);
    // Pediment: plates stepping in a stud each side per layer, white tiles along the raking
    // edges, and the seated figure on a jumper at the top.
    const pediment = frieze + 5;
    for (const [layer, partId] of [
      [0, '3034'],
      [1, '3795'],
      [2, '3020'],
      [3, '3022'],
    ] as const) {
      add(partId, GRANITE, 28 + layer, pediment + layer, portal, 90);
      if (layer > 0)
        for (const x of [27 + layer, 36 - layer]) add('3069b', WHITE, x, pediment + layer, portal);
    }
    add('3069b', WHITE, 31, pediment + 4, portal + 1, 90);
    add('3794b', GRANITE, 31, pediment + 4, portal, 90);
    add('3062b', GRANITE, 31.5, pediment + 5, portal);
    add('6141', WHITE, 31.5, pediment + 8, portal);
    add('98138', WHITE, 31.5, pediment + 9, portal);
    for (const [x0, niche] of [
      [PIERS[0], PIERS[0] + 1],
      [PIERS[1], PIERS[1] + 1],
    ] as const) {
      // Three courses of solid pier, then the plaque: headlight bricks with a white 1 x 3 tile.
      for (let course = 0; course < 3; course++)
        add('3622', course === 1 ? TRIM : GRANITE, x0, BASE + course * 3, portal, 90);
      for (let x = x0; x <= x0 + 2; x++) add('4070', GRANITE, x, BASE + 9, portal, 180);
      add('63864', WHITE, x0, BASE + 9.5, portal + 0.8, 90, '+z');
      // The niche: two courses of jambs either side of a standing white figure, under an arch.
      for (const y of [BASE + 12, BASE + 15])
        for (const x of [x0, x0 + 2]) add('3005', GRANITE, x, y, portal);
      add('3024', GRANITE, niche, BASE + 12, portal);
      add('3062b', WHITE, niche, BASE + 13, portal);
      add('6141', WHITE, niche, BASE + 16, portal);
      add('98138', WHITE, niche, BASE + 17, portal);
      add('4490', GRANITE, x0, BASE + 18, portal, 90);
      add('3622', TRIM, x0, BASE + 21, portal, 90);
      // Above the entablature the pier narrows to two studs on its outer side, then a lantern
      // spire: a jumper, two round bricks and a point.
      const outer = x0 < 32 ? x0 : x0 + 1;
      for (const y of [BASE + 24, BASE + 27]) add('3004', GRANITE, outer, y, portal, 90);
      add('3023b', TRIM, outer, BASE + 30, portal, 90);
      add('3794b', GRANITE, outer, BASE + 31, portal, 90);
      add('3062b', GRANITE, outer + 0.5, BASE + 32, portal);
      add('3062b', WHITE, outer + 0.5, BASE + 35, portal);
      add('4589', GRANITE, outer + 0.5, BASE + 38, portal);
    }

    // Corner turrets with rounded corners, rising past the eaves to slate spires with copper
    // lanterns and gold points.
    // They stand clear of the roof, with tan bands above the eaves.
    for (let course = 0; course < TURRET_COURSES; course++) {
      addWallCourse(
        (x, z) => (isTurret(x, z) && !ROUND_CELLS.has(`${x}:${z}`) ? material(x, z, course) : ' '),
        BASE + course * 3,
        course,
      );
      addRoundCorners(isTurret, BASE + course * 3, course);
    }
    const spire = BASE + TURRET_COURSES * 3;
    for (const [x, z] of TURRETS) {
      add('6233', ROOFING, x, spire, z);
      add('3942c', ROOFING, x + 0.5, spire + 6, z + 0.5);
      add('3062b', COPPER, x + 1, spire + 12, z + 1);
      add('4589', GOLD, x + 1, spire + 15, z + 1);
    }

    // Ceiling slab over every wall and the two entrance arches, carrying the roof, the bay
    // gables and the central block. It overhangs the long walls and the ends by a stud as a
    // cornice, which also lets its plates span the full 16 studs from one overhang to the other
    // and rest on both long walls. The ends beside the turrets, the pavilion front and the
    // projection behind get plates of their own.
    const cornice = (x: number, z: number) =>
      (within(x, z, ...MAIN_CEILING) ||
        within(x, z, ...END_CEILINGS[0]) ||
        within(x, z, ...END_CEILINGS[1])) &&
      !enclosed(x, z);
    addAreaMap(
      add,
      plan((x, z) => {
        if (within(x, z, ...MAIN_CEILING)) return 'm';
        if (END_CEILINGS.some((area) => within(x, z, ...area))) return 'e';
        if (!footprint(x, z) || isApse(x, z)) return ' ';
        if (x === WEST + 2 || x === EAST - 2) return 'n';
        return 'p';
      }),
      CEILING,
      {
        m: ['plate', TRIM],
        e: ['plate', TRIM],
        n: ['plate', TRIM],
        p: ['plate', TRIM],
      },
      (x, z) => wall(x, z) || ((z === FRONT || z === PAVILION_FRONT) && x >= 29 && x <= 34),
    );
    // Apses are roofed a row at a time along the wall, so each run ends on the walls either
    // side; the row against the main block lies under the main ceiling.
    for (const { width, cell } of APSES) {
      const axis = cell(1, 0)[0] === cell(0, 0)[0] ? 'z' : 'x';
      for (const [d, [from, to]] of apseRows(width).entries()) {
        if (d === 0) continue;
        const [[x0, z0], [x1, z1]] = [cell(from, d), cell(to, d)];
        addRun(
          add,
          'plate',
          TRIM,
          axis,
          Math.min(x0, x1),
          CEILING,
          Math.min(z0, z1),
          to - from + 1,
        );
      }
    }
    addAreaMap(
      add,
      plan((x, z) => (cornice(x, z) ? 't' : ' ')),
      ROOF,
      { t: ['tile', TRIM] },
    );

    // The end apses carry on above the eaves, with a window in each outer face and a tan band
    // on top, so their roofs start high enough to meet the main roof's slopes and ridge.
    for (let course = 0; course < APSE_RISE; course++) {
      const y = ROOF + course * 3;
      const window = (x: number, z: number) =>
        course < 2 && (x === WEST - 4 || x === EAST + 4) && (z === 23 || z === 24);
      const cells = (x: number, z: number) => isEndApse(x, z) && apseWall(x, z) && !window(x, z);
      addWallCourse(
        (x, z) => (cells(x, z) && !ROUND_CELLS.has(`${x}:${z}`) ? material(x, z, 8 + course) : ' '),
        y,
        8 + course,
      );
      addRoundCorners(cells, y, 8 + course);
      if (course === 0) for (const x of [WEST - 4, EAST + 4]) add('60592', WHITE, x, y, 23, 0);
    }

    // Steep slate roof: six slope courses front and back up to a light granite ridge, stepped
    // sandstone gable ends, the slopes stopping either side of the central block and every slope
    // clear of the turrets.
    for (let step = 0; step < ROOF_STEPS; step++) {
      const y = ROOF + step * 3;
      const [from, to] = step < 2 ? [WEST + 2, EAST - 2] : [WEST, EAST];
      // The central block reaches back to z = 21, which the back slopes meet from the fourth;
      // below that they stop either side of the back apse's cross gable.
      const spans: readonly (readonly [number, number])[] =
        step < 3
          ? [
              [from, 26],
              [37, to],
            ]
          : [
              [from, 25],
              [38, to],
            ];
      for (const [first, last] of spans) addSlopeRun(add, first, last, y, BACK + step, 0);
      addSlopeRun(add, from, 25, y, FRONT - 1 - step, 180);
      addSlopeRun(add, 38, to, y, FRONT - 1 - step, 180);
      if (step < ROOF_STEPS - 1)
        for (const x of [WEST, EAST])
          addRun(add, 'brick', SANDSTONE, 'z', x, y, BACK + 2 + step, 10 - 2 * step);
    }
    const ridge = BACK + ROOF_STEPS;
    addAreaMap(
      add,
      plan((x, z) =>
        (z === ridge || z === ridge + 1) && x >= WEST && x <= EAST && !isCentral(x) ? 'r' : ' ',
      ),
      FLAT,
      { r: ['tile', GRANITE] },
    );
    // Where the turrets cut the lowest slopes short, a brick closes the roof beside them.
    for (const x of [WEST, EAST - 1])
      for (const z of [BACK + 2, FRONT - 2]) add('3004', SANDSTONE, x, ROOF + 3, z, 90);

    // The apses get faceted slate roofs rising to the main block; the end ones meet the ridge.
    for (const apse of APSES) {
      const [x, z] = apse.cell(0, 0);
      addApseRoof(add, apse, isEndApse(x, z) ? ROOF + APSE_RISE * 3 : ROOF);
    }
    // The back apse's roof carries on over the back slopes as a short cross gable up to the
    // central block, its side slopes continuing the apse's, under a granite ridge.
    for (let layer = 0; layer < 3; layer++) {
      const y = ROOF + layer * 3;
      const [west, east] = [27 + layer, 35 - layer];
      addSlopeRun(add, BACK, BACK + 3, y, west, 90);
      addSlopeRun(add, BACK, BACK + 3, y, east, 270);
      addAreaMap(
        add,
        plan((x, z) => (x >= west + 2 && x < east && z >= BACK && z <= BACK + 3 ? 'f' : ' ')),
        y,
        { f: ['brick', ROOFING] },
      );
    }
    addAreaMap(
      add,
      plan((x, z) => (x >= 31 && x <= 32 && z >= BACK && z <= BACK + 3 ? 'r' : ' ')),
      ROOF + 9,
      { r: ['tile', GRANITE] },
    );

    // Stepped gables over the bays, rising as dormers in front of the roof: a window between
    // sandstone piers, a tan band, a step with tan caps either side, and a dark finial.
    for (const bay of BAYS)
      for (const z of [FRONT + 1, BACK - 1]) {
        for (const y of [ROOF, ROOF + 3])
          for (const x of [bay, bay + 3]) add('3005', SANDSTONE, x, y, z);
        add('60592', WHITE, bay + 1, ROOF, z, 90);
        addRun(add, 'brick', TRIM, 'x', bay, ROOF + 6, z, 4);
        add('3004', SANDSTONE, bay + 1, ROOF + 9, z, 90);
        for (const x of [bay, bay + 3]) add('3070b', TRIM, x, ROOF + 9, z);
        addFinial(add, bay + 1, ROOF + 12, z, ROOFING);
      }

    // Central block over the crossing, rising through the roof from the pavilion front to the
    // tower: two windows above the pediment either side of the seated figure and a pair over
    // it under the crown, windows into the pavilion's sides, and tan bands between.
    const centralWindow = (x: number, z: number, step: number) =>
      (step >= 2 && step <= 3 && z === PAVILION_FRONT && [28, 29, 34, 35].includes(x)) ||
      (step >= 4 && z === PAVILION_FRONT && x >= 30 && x <= 33) ||
      (step >= 1 && step <= 2 && (x === 26 || x === 37) && (z === FRONT + 1 || z === FRONT + 2));
    for (let step = 0; step < ROOF_STEPS; step++) {
      const y = ROOF + step * 3;
      addBondedMap(
        add,
        plan((x, z) =>
          rim(x, z, 26, 21, 37, PAVILION_FRONT) && !centralWindow(x, z, step)
            ? step === 3 || step === 5
              ? 'b'
              : stone(x, z, step, 3)
            : ' ',
        ),
        y,
        WALL_LEGEND,
        step,
      );
      if (step === 1) for (const x of [26, 37]) add('60592', WHITE, x, y, FRONT + 1, 0);
      if (step === 2) for (const x of [28, 34]) add('60592', WHITE, x, y, PAVILION_FRONT, 90);
      if (step === 4) for (const x of [30, 32]) add('60592', WHITE, x, y, PAVILION_FRONT, 90);
    }

    // Flat top of the central block, slate tiles round the tower, chimneys and crown.
    const central = (x: number, z: number) => within(x, z, 26, 21, 37, PAVILION_FRONT);
    addAreaMap(
      add,
      plan((x, z) => (central(x, z) ? 's' : ' ')),
      FLAT,
      { s: ['plate', SLATE] },
      (x, z) => rim(x, z, 26, 21, 37, PAVILION_FRONT),
    );
    const tower = (x: number, z: number) => within(x, z, 29, 21, 34, 26);
    const chimney = (x: number, z: number) =>
      within(x, z, 26, 23, 27, 24) || within(x, z, 36, 23, 37, 24);
    const pavilionTurret = (x: number, z: number) =>
      within(x, z, 26, PAVILION_FRONT - 1, 27, PAVILION_FRONT) ||
      within(x, z, 36, PAVILION_FRONT - 1, 37, PAVILION_FRONT);
    addAreaMap(
      add,
      plan((x, z) =>
        !central(x, z) ||
        tower(x, z) ||
        chimney(x, z) ||
        pavilionTurret(x, z) ||
        (z === PAVILION_FRONT && x >= 28 && x <= 35)
          ? ' '
          : 's',
      ),
      CAP,
      { s: ['tile', SLATE] },
    );

    // Entrance pavilion crown: a low crow-stepped gable between two small round turrets.
    for (const [step, from, to] of [
      [0, 29, 34],
      [1, 30, 33],
      [2, 31, 32],
    ] as const) {
      const y = CAP + step * 3;
      addRun(
        add,
        'brick',
        step === 2 ? TRIM : SANDSTONE,
        'x',
        from,
        y,
        PAVILION_FRONT,
        to - from + 1,
      );
      for (const x of [from - 1, to + 1]) add('3070b', TRIM, x, y, PAVILION_FRONT);
    }
    addFinial(add, 31, CAP + 9, PAVILION_FRONT);
    for (const x of [26, 36]) {
      add('4032a', TRIM, x, CAP, PAVILION_FRONT - 1);
      add('3942c', ROOFING, x, CAP + 1, PAVILION_FRONT - 1);
      add('4589', GOLD, x + 0.5, CAP + 7, PAVILION_FRONT - 0.5);
    }

    // Tall sandstone chimneys with tan caps flank the tower on the roof.
    for (const x of [26, 36]) {
      for (let course = 0; course < 4; course++)
        add('3003', course === 3 ? TRIM : SANDSTONE, x, CAP + course * 3, 23);
      add('18674', ROOFING, x, CAP + 12, 23);
      add('4589', GOLD, x + 0.5, CAP + 13, 23.5);
    }

    // Central tower: a square stone base rising clear of the roof with a window in each face, a
    // dark balcony with green railings and gold finials, an arched copper lantern, a dark dome,
    // and a tiered copper spire with gold rings and a gold tip.
    const towerWindow = (x: number, z: number) =>
      ((z === 21 || z === 26) && (x === 31 || x === 32)) ||
      ((x === 29 || x === 34) && (z === 23 || z === 24));
    for (let course = 0; course < 3; course++) {
      addBondedMap(
        add,
        plan((x, z) => {
          if (!rim(x, z, 29, 21, 34, 26) || (course > 0 && towerWindow(x, z))) return ' ';
          return course === 1 && (x === 29 || x === 34) && (z === 21 || z === 26)
            ? 'b'
            : stone(x, z, course, 3);
        }),
        CAP + course * 3,
        WALL_LEGEND,
        course,
      );
      if (course === 1) {
        for (const z of [21, 26]) add('60592', WHITE, 31, CAP + 3, z, 90);
        for (const x of [29, 34]) add('60592', WHITE, x, CAP + 3, 23, 0);
      }
    }
    const balcony = CAP + 9;
    add('41539', SLATE, 28, balcony, 20);
    for (const x of [28, 35])
      for (const z of [20, 27]) {
        add('3062b', SLATE, x, balcony + 1, z);
        add('4589', ROOFING, x, balcony + 4, z);
      }
    for (const z of [20, 27]) add('3633', COPPER, 30, balcony + 1, z, 90);
    for (const x of [28, 35]) add('3633', COPPER, x, balcony + 1, 22);
    for (const x of [30, 33]) for (const z of [22, 25]) add('3062b', COPPER, x, balcony + 1, z);
    for (const z of [22, 25]) add('3004', GLASS, 31, balcony + 1, z, 90);
    for (const y of [balcony + 1, balcony + 4])
      for (const x of [30, 33]) add('3004', GLASS, x, y, 23);
    for (const z of [22, 25]) add('3659', COPPER, 30, balcony + 4, z, 90);
    add('3031', COPPER, 30, balcony + 7, 22);
    add('3943b', ROOFING, 30, balcony + 8, 22);
    add('3941', COPPER, 31, balcony + 14, 23);
    add('4032a', GOLD, 31, balcony + 17, 23);
    add('3941', COPPER, 31, balcony + 18, 23);
    add('3942c', COPPER, 31, balcony + 21, 23);
    add('3062b', GOLD, 31.5, balcony + 27, 23.5);
    add('3062b', COPPER, 31.5, balcony + 30, 23.5);
    add('4589', GOLD, 31.5, balcony + 33, 23.5);

    // Grounds: a black railing round the quay with lamps between its runs, round trees along
    // the front lawn and behind the museum, and a sailing boat moored off the front.
    for (const [x, z, rotation] of RAILINGS) add('3633', BLACK, x, LAWN_TOP, z, rotation);
    for (const x of QUAY_LAMPS) addLampPost(add, x, ISLAND[3]);
    for (const [x, z, color, trunk] of TREES) addTree(add, x, z, color, trunk);
    addSailboat(add, 46, 56);
  },
};
