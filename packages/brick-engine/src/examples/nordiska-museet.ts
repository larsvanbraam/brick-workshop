import { addAreaMap, addBondedMap, addRun, glazeWindows, turnAround } from './layout.ts';
import type { RunKind } from './layout.ts';
import type { ExampleBrickAdder, ExampleDefinition } from './types.ts';
import type { Facing, Rotation } from '../core.ts';

// Plans are drawn top-down on the 64-stud board with the front at high z; x runs left to right.
// The building is symmetric about x = 31.5. Proportions follow a massing model of the museum at
// 0.375 studs to the metre: a long main block with gabled bays, square corner turrets, low wings
// at both ends, the entrance pavilion in front, a polygonal projection behind and the tower over
// the crossing.
const SIZE = 64;

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

/**
 * Heights: baseplate top, terrace top (building base), the main ceiling at the eaves, the roof
 * base, the flat ridge and the tiles on it. The walls are eight courses: a plinth, ground-floor
 * windows, a band, upper windows and a band.
 */
const GROUND = 0.5;
const BASE = GROUND + 4;
const CEILING = BASE + 24;
const ROOF = CEILING + 1;
const FLAT = ROOF + 12;
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
const isTurret = (x: number, z: number) =>
  TURRETS.some(([turretX, turretZ]) => within(x, z, turretX, turretZ, turretX + 2, turretZ + 2));
/** The polygonal projection behind the crossing, narrowing in two steps. */
const isApse = (x: number, z: number) =>
  (z === BACK - 1 && x >= 27 && x <= 36) ||
  (z === BACK - 2 && x >= 28 && x <= 35) ||
  (z === BACK - 3 && x >= 29 && x <= 34);
const apseWall = (x: number, z: number) =>
  (z === BACK - 3 && x >= 29 && x <= 34) ||
  (z === BACK - 2 && (x === 28 || x === 35)) ||
  (z === BACK - 1 && (x === 27 || x === 36));
/** Low wings at both ends of the main block. */
const WINGS = [
  [4, 7],
  [56, 59],
] as const;
const [WING_BACK, WING_FRONT] = [20, 27];
const isWing = (x: number, z: number) =>
  WINGS.some(([x0, x1]) => within(x, z, x0, WING_BACK, x1, WING_FRONT));

/** Everything the main ceiling covers. */
const footprint = (x: number, z: number) =>
  (within(x, z, WEST, BACK, EAST, FRONT) ||
    isBay(x, z) ||
    within(x, z, 26, FRONT, 37, PAVILION_FRONT) ||
    isApse(x, z)) &&
  !isTurret(x, z);
/** Cells inside the building's outline at wall height. */
const enclosed = (x: number, z: number) => footprint(x, z) || isTurret(x, z) || isWing(x, z);
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
  [31, BACK - 3, 90],
];
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
 * floor is rusticated, the upper storeys only here and there. Scattered sand red bricks give the
 * mottled pink-and-buff look of the real stonework.
 */
const stone = (x: number, z: number, course: number, density: number) => {
  const patch = Math.floor((x + z + (course % 2) * 2) / 3);
  if ((patch * 5 + course * 7 + x * 3 + z) % 9 === 0) return 'r';
  return (patch * 7 + course * 3) % 10 < density ? 'm' : 'w';
};
/**
 * Dressed stone: the outside corners of every block, where two outside faces meet, and the
 * jambs either side of each window.
 */
const isCorner = (x: number, z: number) =>
  OUTWARD.filter(([dx, dz]) => !enclosed(x + dx, z + dz)).length >= 2;
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
  if (course === 4 || course === 7) return 'b';
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

/** The terrace the museum stands on, and its spindled balustrade, open at the front steps. */
const TERRACE = [4, 12, 59, 41] as const;
const BALUSTRADES = [
  ...[5, 9, 13, 17, 21, 39, 43, 47, 51, 55].map((x) => [x, 41, 90] as const),
  ...[13, 28, 32, 36].flatMap((z) => [[4, z, 0] as const, [59, z, 0] as const]),
  ...Array.from({ length: 12 }, (_, index) => [8 + index * 4, 12, 90] as const),
];
const BALUSTRADE_CELLS = new Set(
  BALUSTRADES.flatMap(([x, z, rotation]) =>
    [0, 1, 2, 3].map((offset) => (rotation === 90 ? `${x + offset}:${z}` : `${x}:${z + offset}`)),
  ),
);
/** The portal's columns stand on the terrace either side of the door, piers beyond them. */
const PORTAL_COLUMNS = [29, 34];
const PIERS = [26, 35];
const isPortal = (x: number, z: number) =>
  z === PAVILION_FRONT + 1 && x >= 26 && x <= 37 && !(x >= 30 && x <= 33);

/** Starting x of the 1 x 4 lattice cresting along both edges of each skylight. */
const CRESTING = [9, 13, 17, 21, 39, 43, 47, 51];

const WALL_LEGEND: Readonly<Record<string, readonly [RunKind, number]>> = {
  p: ['masonry', GRANITE],
  w: ['brick', SANDSTONE],
  m: ['masonry', SANDSTONE],
  r: ['brick', SAND_RED],
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
    if (rotation % 180) add(partId, SLATE, line, y, at, rotation);
    else add(partId, SLATE, at, y, line, rotation);
    at += width;
  }
}

/** A small finial: jumper plate along x, a round brick on its centre stud and a copper cone. */
function addFinial(add: ExampleBrickAdder, x: number, y: number, z: number) {
  add('3794b', TRIM, x, y, z, 90);
  add('3062b', TRIM, x + 0.5, y + 1, z);
  add('4589', COPPER, x + 0.5, y + 4, z);
}

/** A laburnum: brown trunk through three leaf layers, the upper two in yellow bloom. */
function addLaburnum(add: ExampleBrickAdder, x: number, z: number) {
  for (const y of [0, 3, 6]) add('3062b', BARK, x + 2, GROUND + y, z + 3);
  add('2417', LEAVES, x, GROUND + 9, z);
  add('3062b', BARK, x + 2, GROUND + 10, z + 3);
  add('2417', BLOSSOM, x, GROUND + 13, z + 1, 180);
  add('3062b', BARK, x + 2, GROUND + 14, z + 3);
  add('2417', BLOSSOM, x, GROUND + 17, z);
  for (const [dx, dz] of [
    [1, 1],
    [3, 1],
    [2, 0],
  ])
    add('98138', BLOSSOM, x + dx, GROUND + 18, z + dz);
}

/** A bush on a jumper, so its centre peg finds a stud on the baseplate. */
function addBush(add: ExampleBrickAdder, x: number, z: number) {
  add('87580', LAWN, x + 1, GROUND, z + 1);
  add('6064', LEAVES, x, GROUND + 1, z);
}

function addLampPost(add: ExampleBrickAdder, x: number, z: number) {
  add('2453b', BLACK, x, GROUND, z);
  add('3062b', LAMP, x, GROUND + 15, z);
  add('98138', BLACK, x, GROUND + 18, z);
}

export const nordiskaMuseet: ExampleDefinition = {
  id: 'nordiska-museet',
  name: 'Nordiska Museet',
  tags: ['museum', 'landmark', 'stockholm', 'tower', 'stepped-gables', 'copper-roofs', 'park'],
  expectedPieceCount: 1973,
  buildArea: SIZE,
  brickIdPrefix: 'museet',
  build(drawnAdd) {
    const add = glazeWindows(turnAround(drawnAdd, SIZE));
    /** A bonded wall course from a plan of wall letters. */
    const addWallCourse = (cell: (x: number, z: number) => string, y: number, course: number) =>
      addBondedMap(add, plan(cell), y, WALL_LEGEND, course);

    // Sixteen green baseplates make the 64 x 64 board.
    for (let x = 0; x < SIZE; x += 16)
      for (let z = 0; z < SIZE; z += 16) add('3867', LAWN, x, 0, z);

    // Raised terrace: a slate plate footing, a granite masonry rim around a brick core, and
    // paving with a tan carpet from the entrance to the steps.
    const terrace = (x: number, z: number) => within(x, z, ...TERRACE);
    addAreaMap(
      add,
      plan((x, z) => (terrace(x, z) ? 's' : ' ')),
      GROUND,
      { s: ['plate', SLATE] },
    );
    addBondedMap(
      add,
      plan((x, z) => (rim(x, z, ...TERRACE) ? 'p' : ' ')),
      GROUND + 1,
      WALL_LEGEND,
      0,
    );
    addAreaMap(
      add,
      plan((x, z) => (terrace(x, z) && !rim(x, z, ...TERRACE) ? 'c' : ' ')),
      GROUND + 1,
      { c: ['brick', SLATE] },
    );
    addAreaMap(
      add,
      plan((x, z) =>
        !terrace(x, z) ||
        footprint(x, z) ||
        isTurret(x, z) ||
        isWing(x, z) ||
        BALUSTRADE_CELLS.has(`${x}:${z}`) ||
        isPortal(x, z)
          ? ' '
          : within(x, z, 29, PAVILION_FRONT + 1, 34, 41)
            ? 't'
            : 'g',
      ),
      BASE,
      { t: ['tile', TRIM], g: ['tile', GRANITE] },
    );

    // Front steps down from the terrace, one plate per step.
    for (const [z, plates] of [
      [42, 3],
      [43, 2],
      [44, 1],
      [45, 0],
    ] as const) {
      for (let layer = 0; layer < plates; layer++)
        addRun(add, 'plate', GRANITE, 'x', 27, GROUND + layer, z, 10);
      addRun(add, 'tile', GRANITE, 'x', 27, GROUND + plates, z, 10);
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
          (wall(x, z) || innerArch(x, z, course)) && !open(x, z) && !dentil(x, z, course)
            ? material(x, z, course)
            : ' ',
        y,
        course,
      );
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
    add('60596', TRIM, 30, BASE, PAVILION_FRONT, 90);
    add('60623', BARK, 30, BASE, PAVILION_FRONT - 0.5, 90);
    // Behind the arch over the door, a panel in the door's colour fills the half-moon, so the
    // doors read as round-headed. It rests on two piers hidden behind the wall either side.
    for (const x of [29, 34])
      for (let course = 0; course < 6; course++)
        add('3005', SANDSTONE, x, BASE + course * 3, PAVILION_FRONT - 1);
    for (const y of [BASE + 18, BASE + 21]) add('3009', BARK, 29, y, PAVILION_FRONT - 1, 90);

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

    // Square corner turrets rising past the eaves to slate pyramid roofs with gold points.
    for (let course = 0; course < 10; course++)
      addWallCourse(
        (x, z) => (isTurret(x, z) ? material(x, z, course) : ' '),
        BASE + course * 3,
        course,
      );
    for (const [x, z] of TURRETS) {
      add('6233', SLATE, x, BASE + 30, z);
      add('4589', GOLD, x + 0.5, BASE + 36, z + 0.5);
    }

    // Low wings at both ends: a storey of walls with tall windows in the end faces, a ceiling,
    // and a roof sloping up in three steps to the main block's end wall.
    for (const [x0, x1] of WINGS) {
      const end = x0 < 32 ? x0 : x1;
      const wingWall = (x: number, z: number) =>
        within(x, z, x0, WING_BACK, x1, WING_FRONT) &&
        (x === end || z === WING_BACK || z === WING_FRONT);
      const wingWindow = (x: number, z: number) => x === end && [21, 22, 25, 26].includes(z);
      for (let course = 0; course < 4; course++)
        addBondedMap(
          add,
          plan((x, z) =>
            wingWall(x, z) && !(course > 0 && wingWindow(x, z)) ? material(x, z, course) : ' ',
          ),
          BASE + course * 3,
          WALL_LEGEND,
          course,
        );
      for (const z of [21, 25]) add('60593', WHITE, end, BASE + 3, z, 0);
      addAreaMap(
        add,
        plan((x, z) => (within(x, z, x0, WING_BACK, x1, WING_FRONT) ? 'c' : ' ')),
        BASE + 12,
        { c: ['plate', TRIM] },
        wingWall,
      );
      for (let step = 0; step < 3; step++)
        addSlopeRun(
          add,
          WING_BACK,
          WING_FRONT,
          BASE + 13 + step * 3,
          end === x0 ? x0 + step : x1 - 1 - step,
          end === x0 ? 90 : 270,
        );
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
        if (!footprint(x, z)) return ' ';
        if (x === WEST + 2 || x === EAST - 2) return 'n';
        return isApse(x, z) ? 'a' : 'p';
      }),
      CEILING,
      {
        m: ['plate', TRIM],
        e: ['plate', TRIM],
        n: ['plate', TRIM],
        a: ['plate', TRIM],
        p: ['plate', TRIM],
      },
      (x, z) => wall(x, z) || ((z === FRONT || z === PAVILION_FRONT) && x >= 29 && x <= 34),
    );
    addAreaMap(
      add,
      plan((x, z) => (cornice(x, z) ? 't' : ' ')),
      ROOF,
      { t: ['tile', TRIM] },
    );

    // Slate roof: four slope courses front and back, stepped sandstone gable ends, the front
    // slopes stopping either side of the central block and every slope clear of the turrets.
    for (let step = 0; step < 4; step++) {
      const y = ROOF + step * 3;
      const [from, to] = step < 2 ? [WEST + 2, EAST - 2] : [WEST, EAST];
      addSlopeRun(add, from, to, y, BACK + step, 0);
      addSlopeRun(add, from, 25, y, FRONT - 1 - step, 180);
      addSlopeRun(add, 38, to, y, FRONT - 1 - step, 180);
      for (const x of [WEST, EAST])
        addRun(add, 'brick', SANDSTONE, 'z', x, y, BACK + 2 + step, 10 - 2 * step);
    }
    // Where the turrets cut the lowest slopes short, a brick closes the roof beside them.
    for (const x of [WEST, EAST - 1])
      for (const z of [BACK + 2, FRONT - 2]) add('3004', SANDSTONE, x, ROOF + 3, z, 90);

    // The polygonal projection behind gets a slate roof: a slope course along its back face
    // and slate tiles over the rest.
    addSlopeRun(add, 29, 34, ROOF, BACK - 3, 0);
    addAreaMap(
      add,
      plan((x, z) => (isApse(x, z) && !(z <= BACK - 2 && x >= 29 && x <= 34) ? 't' : ' ')),
      ROOF,
      { t: ['tile', SLATE] },
    );

    // Gables over the bays: a window between sandstone piers, a tan band, copper points at the
    // corners and a finial in the middle.
    for (const bay of BAYS)
      for (const z of [FRONT + 1, BACK - 1]) {
        for (const y of [ROOF, ROOF + 3])
          for (const x of [bay, bay + 3]) add('3005', SANDSTONE, x, y, z);
        add('60592', WHITE, bay + 1, ROOF, z, 90);
        addRun(add, 'brick', TRIM, 'x', bay, ROOF + 6, z, 4);
        for (const x of [bay, bay + 3]) {
          add('3062b', TRIM, x, ROOF + 9, z);
          add('4589', COPPER, x, ROOF + 12, z);
        }
        addFinial(add, bay + 1, ROOF + 9, z);
      }

    // Central block over the crossing, rising through the roof from the pavilion front to the
    // tower: two windows above the pediment either side of the seated figure, and windows into
    // the pavilion's sides.
    for (let step = 0; step < 4; step++) {
      const y = ROOF + step * 3;
      const open = (x: number, z: number) =>
        (step >= 2 && z === PAVILION_FRONT && [28, 29, 34, 35].includes(x)) ||
        (step >= 1 && step <= 2 && (x === 26 || x === 37) && (z === FRONT + 1 || z === FRONT + 2));
      addBondedMap(
        add,
        plan((x, z) =>
          rim(x, z, 26, 22, 37, PAVILION_FRONT) && !open(x, z)
            ? step === 3
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
    }

    // Flat roof: slate slab over the ridge and the central block, glass skylights either side.
    const central = (x: number, z: number) => within(x, z, 26, 21, 37, PAVILION_FRONT);
    addAreaMap(
      add,
      plan((x, z) => (within(x, z, WEST, 21, EAST, 26) || central(x, z) ? 's' : ' ')),
      FLAT,
      { s: ['plate', SLATE] },
      (x, z) =>
        z === 21 ||
        (z === 26 && !isCentral(x)) ||
        rim(x, z, 26, 22, 37, PAVILION_FRONT) ||
        ((x === WEST || x === EAST) && z >= 22 && z <= 25),
    );
    const tower = (x: number, z: number) => within(x, z, 29, 21, 34, 26);
    const chimney = (x: number, z: number) =>
      within(x, z, 26, 23, 27, 24) || within(x, z, 36, 23, 37, 24);
    const pavilionTurret = (x: number, z: number) =>
      within(x, z, 26, PAVILION_FRONT - 1, 27, PAVILION_FRONT) ||
      within(x, z, 36, PAVILION_FRONT - 1, 37, PAVILION_FRONT);
    addAreaMap(
      add,
      plan((x, z) => {
        if (central(x, z))
          return tower(x, z) ||
            chimney(x, z) ||
            pavilionTurret(x, z) ||
            (z === PAVILION_FRONT && x >= 28 && x <= 35)
            ? ' '
            : 's';
        if (!within(x, z, WEST, 21, EAST, 26)) return ' ';
        return (x >= 9 && x <= 24) || (x >= 39 && x <= 54)
          ? z === 21 || z === 26
            ? ' '
            : 'g'
          : 's';
      }),
      CAP,
      { s: ['tile', SLATE], g: ['tile', GLASS] },
    );
    for (const x of CRESTING) for (const z of [21, 26]) add('3633', BLACK, x, CAP, z, 90);

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
      add('3942c', COPPER, x, CAP + 1, PAVILION_FRONT - 1);
      add('4589', GOLD, x + 0.5, CAP + 7, PAVILION_FRONT - 0.5);
    }

    // Tall copper chimneys flank the tower on the roof.
    for (const x of [26, 36]) {
      for (let course = 0; course < 4; course++) add('3003', COPPER, x, CAP + course * 3, 23);
      add('18674', SLATE, x, CAP + 12, 23);
      add('4589', GOLD, x + 0.5, CAP + 13, 23.5);
    }

    // Central tower: a short square base just clearing the roof, a dark balcony with green
    // railings and gold finials, an arched lantern, a dark dome, and a green spire with a gold
    // tip.
    addBondedMap(
      add,
      plan((x, z) => (rim(x, z, 29, 21, 34, 26) ? stone(x, z, 0, 3) : ' ')),
      CAP,
      WALL_LEGEND,
      0,
    );
    const balcony = CAP + 3;
    add('41539', SLATE, 28, balcony, 20);
    for (const x of [28, 35])
      for (const z of [20, 27]) {
        add('3062b', SLATE, x, balcony + 1, z);
        add('4589', GOLD, x, balcony + 4, z);
      }
    for (const z of [20, 27]) add('3633', COPPER, 30, balcony + 1, z, 90);
    for (const x of [28, 35]) add('3633', COPPER, x, balcony + 1, 22);
    for (const x of [30, 33]) for (const z of [22, 25]) add('3062b', SLATE, x, balcony + 1, z);
    for (const z of [22, 25]) add('3004', GLASS, 31, balcony + 1, z, 90);
    for (const y of [balcony + 1, balcony + 4])
      for (const x of [30, 33]) add('3004', GLASS, x, y, 23);
    for (const z of [22, 25]) add('3659', SLATE, 30, balcony + 4, z, 90);
    add('3031', SLATE, 30, balcony + 7, 22);
    add('3943b', SLATE, 30, balcony + 8, 22);
    add('3942c', COPPER, 31, balcony + 14, 23);
    add('3062b', GOLD, 31.5, balcony + 20, 23.5);
    add('3062b', SLATE, 31.5, balcony + 23, 23.5);
    add('4589', GOLD, 31.5, balcony + 26, 23.5);

    // Grounds: a path from the steps, the drive across the front, a round plaza with a statue,
    // and a garden path behind the museum.
    const plaza = (x: number, z: number) =>
      z >= 52 && Math.hypot(x + 0.5 - 32, z + 0.5 - 56) <= 4.8;
    const plinth = (x: number, z: number) => within(x, z, 30, 54, 33, 57);
    addAreaMap(
      add,
      plan((x, z) => {
        if (z >= 49 && z <= 51) return 'd';
        if (within(x, z, 29, 46, 34, 48) || (plaza(x, z) && !plinth(x, z)) || z === 9 || z === 10)
          return 'g';
        return ' ';
      }),
      GROUND,
      { d: ['tile', SLATE], g: ['tile', GRANITE] },
    );
    // Equestrian statue: a tall granite pedestal under a tan cornice, and a bronze rider on a
    // horse facing away from the museum, towards the street.
    for (const [y, rotation, z] of [
      [GROUND, 0, 54],
      [GROUND + 3, 90, 54],
      [GROUND + 3, 90, 56],
      [GROUND + 6, 0, 54],
    ] as const)
      for (const offset of rotation ? [0] : [0, 2])
        add('3001', GRANITE, 30 + offset, y, z, rotation);
    add('3031', TRIM, 30, GROUND + 9, 54);
    const hooves = GROUND + 10;
    for (const x of [31, 32]) for (const z of [55, 57]) add('3062b', COPPER, x, hooves, z);
    add('3020', COPPER, 31, hooves + 3, 54);
    for (const x of [31, 32]) add('3010', COPPER, x, hooves + 4, 54);
    add('54200', COPPER, 31, hooves + 7, 54);
    add('3004', COPPER, 31, hooves + 7, 57, 90);
    add('3039', COPPER, 31, hooves + 10, 57, 180);
    for (const x of [31, 32]) add('54200', COPPER, x, hooves + 13, 57, 180);
    add('3794b', COPPER, 31, hooves + 7, 55, 90);
    add('3062b', COPPER, 31.5, hooves + 8, 55);
    add('6141', COPPER, 31.5, hooves + 11, 55);
    add('4589', COPPER, 31.5, hooves + 12, 55);

    // Terrace balustrade with tan coping tiles.
    for (const [x, z, rotation] of BALUSTRADES) {
      add('30055', WHITE, x, BASE, z, rotation);
      add('2431', TRIM, x, BASE + 6, z, rotation);
    }

    // Benches either side of the statue plaza, and a ring of flowers round its edge.
    for (const x of [26, 37]) {
      for (const z of [54, 56]) add('3005', BARK, x, GROUND, z);
      add('3623', BARK, x, GROUND + 3, 54);
      add('63864', 6, x, GROUND + 4, 54);
    }
    for (let z = 52; z < SIZE; z++)
      for (let x = 25; x <= 38; x++) {
        const distance = Math.hypot(x + 0.5 - 32, z + 0.5 - 56);
        if (distance <= 4.8 || distance > 5.8 || x === 26 || x === 37) continue;
        add('98138', [4, WHITE, BLOSSOM, 13][(x + z) % 4], x, GROUND, z);
      }

    // Trees and shrubs all round: laburnums in bloom out front, oaks and firs behind, bushes
    // along the sides and flowers at the foot of the terrace.
    for (const x of [20, 39]) addLaburnum(add, x, 54);
    for (const [x, z, partId] of [
      [1, 53, '3470'],
      [8, 58, '3471'],
      [14, 53, '3470'],
      [45, 53, '3470'],
      [51, 58, '3471'],
      [58, 53, '3470'],
      ...[0, 7, 14, 21, 29, 37, 44, 51, 59].map(
        (x, index) => [x, 2, index % 2 ? '3471' : '3470'] as const,
      ),
    ] as const)
      add(partId, LEAVES, x, GROUND, z);
    for (const z of [13, 21, 29, 37]) for (const x of [0, 60]) addBush(add, x, z);
    for (const x of [8, 15, 22, 38, 45, 52]) addBush(add, x, 42);
    for (const x of [0, 59]) addBush(add, x, 43);
    for (const [x, color] of [
      [5, 4],
      [6, WHITE],
      [12, BLOSSOM],
      [13, 4],
      [14, WHITE],
      [19, 13],
      [20, WHITE],
      [21, 4],
    ] as const)
      for (const z of [43, 44]) {
        add('98138', color, x, GROUND, z);
        add('98138', color, 63 - x, GROUND, z);
      }
    for (const x of [26, 37]) addLampPost(add, x, 43);
    for (const x of [5, 18, 45, 58]) addLampPost(add, x, 48);
  },
};
