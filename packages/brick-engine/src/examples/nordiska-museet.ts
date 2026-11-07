import { addAreaMap, addBondedMap, addRun, glazeWindows, turnAround } from './layout.ts';
import type { RunKind } from './layout.ts';
import type { ExampleBrickAdder, ExampleDefinition } from './types.ts';

// Plans are drawn top-down on the 64-stud board with the front at high z; x runs left to right.
// The building is symmetric about x = 31.5.
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

/** Heights: baseplate top, terrace top (building base), ceiling slab, roof base, flat roof. */
const GROUND = 0.5;
const BASE = GROUND + 4;
const CEILING = BASE + 27;
const ROOF = CEILING + 1;
const FLAT = ROOF + 15;
const CAP = FLAT + 1;

/** Façade bays: 4-stud projections at z 32 (front) and z 15 (back), each with a stepped gable;
 * recesses sit between. */
const BAYS = [9, 15, 21, 39, 45, 51];
const RECESSES = [13, 19, 43, 49];

const within = (x: number, z: number, x0: number, z0: number, x1: number, z1: number) =>
  x >= x0 && x <= x1 && z >= z0 && z <= z1;
const rim = (x: number, z: number, x0: number, z0: number, x1: number, z1: number) =>
  within(x, z, x0, z0, x1, z1) && (x === x0 || x === x1 || z === z0 || z === z1);
const plan = (cell: (x: number, z: number) => string) =>
  Array.from({ length: SIZE }, (_, z) =>
    Array.from({ length: SIZE }, (_, x) => cell(x, z)).join(''),
  );

const isBay = (x: number, z: number) =>
  (z === 32 || z === 15) && BAYS.some((bay) => x >= bay && x <= bay + 3);
const footprint = (x: number, z: number) =>
  within(x, z, 8, 16, 55, 31) || isBay(x, z) || within(x, z, 26, 31, 37, 34);
/** The entrance pavilion opens into the hall: the main wall doesn't run on behind it. */
const behindEntrance = (x: number, z: number) => z === 31 && x > 26 && x < 37;
/**
 * Inside, an arch on two piers lines up with the front door's arch and leads on into the hall;
 * the bays either side stay open, so the pavilion windows look in.
 */
const innerArch = (x: number, z: number, course: number) =>
  z === 31 && (((x === 29 || x === 34) && course <= 5) || (course === 8 && x >= 29 && x <= 34));
const wall = (x: number, z: number) =>
  ((rim(x, z, 8, 16, 55, 31) || rim(x, z, 26, 31, 37, 34)) && !behindEntrance(x, z)) || isBay(x, z);
const isCentral = (x: number) => x >= 26 && x <= 37;

/** Corner turrets standing just outside the main block. */
const TURRETS = [
  [6, 31],
  [56, 31],
  [6, 15],
  [56, 15],
] as const;

/** Main-floor windows as [x, z, rotation]: 90 for walls along x, 0 for walls along z. */
const WINDOWS: readonly (readonly [number, number, 0 | 90])[] = [
  ...BAYS.map((bay) => [bay + 1, 32, 90] as const),
  ...RECESSES.map((x) => [x, 31, 90] as const),
  ...BAYS.map((bay) => [bay + 1, 15, 90] as const),
  ...[...RECESSES, 28, 31, 34].map((x) => [x, 16, 90] as const),
  ...[19, 23, 27].flatMap((z) => [[8, z, 0] as const, [55, z, 0] as const]),
  [27, 34, 90],
  [35, 34, 90],
  [26, 32, 0],
  [37, 32, 0],
];
/** Cells a window opens: its own two, plus the main wall behind each bay window. */
const WINDOW_CELLS = new Set(
  WINDOWS.flatMap(([x, z, rotation]) =>
    [0, 1].flatMap((offset) => {
      const [cellX, cellZ] = rotation === 90 ? [x + offset, z] : [x, z + offset];
      const behind = { 32: 31, 15: 16 }[cellZ];
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
    const facing = rotation === 90 ? (z >= 31 ? 180 : 0) : x === 8 || x === 26 ? 90 : 270;
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
 * Round-headed windows: a 1 x 4 arch in the tan band over the bay, side and pavilion windows,
 * its legs on the piers either side, as [x, z, rotation]. The recessed windows in the main wall
 * keep square heads, since the band there also bridges the openings behind the bay windows, and
 * so does any window sharing a pier with an arched neighbour.
 */
const WINDOW_ARCHES = (() => {
  const taken = new Set<string>();
  return WINDOWS.filter(([, z]) => z !== 31 && z !== 16).flatMap(([x, z, rotation]) => {
    const [archX, archZ] = rotation === 90 ? [x - 1, z] : [x, z - 1];
    const cells = [0, 1, 2, 3].map((offset) =>
      rotation === 90 ? `${archX + offset}:${archZ}` : `${archX}:${archZ + offset}`,
    );
    if (cells.some((cell) => taken.has(cell))) return [];
    for (const cell of cells) taken.add(cell);
    return [[archX, archZ, rotation] as const];
  });
})();
const ARCH_CELLS = new Set(
  WINDOW_ARCHES.flatMap(([x, z, rotation]) =>
    [0, 1, 2, 3].map((offset) => (rotation === 90 ? `${x + offset}:${z}` : `${x}:${z + offset}`)),
  ),
);

/** Spindled balustrade along the terrace edge as [x, z, rotation], open at the front steps. */
const BALUSTRADES = [
  ...[5, 9, 13, 17, 21, 39, 43, 47, 51, 55].map((x) => [x, 41, 90] as const),
  ...[13, 17, 21, 25, 29, 33, 37].flatMap((z) => [[5, z, 0] as const, [58, z, 0] as const]),
  ...Array.from({ length: 12 }, (_, index) => [8 + index * 4, 12, 90] as const),
];
const BALUSTRADE_CELLS = new Set(
  BALUSTRADES.flatMap(([x, z, rotation]) =>
    [0, 1, 2, 3].map((offset) => (rotation === 90 ? `${x + offset}:${z}` : `${x}:${z + offset}`)),
  ),
);
/** The portal's columns stand on the terrace either side of the door. */
const PORTAL_COLUMNS = [29, 34];

/** Starting x of the 1 x 4 lattice cresting along both edges of each skylight. */
const CRESTING = [9, 13, 17, 21, 39, 43, 47, 51];

const WALL_LEGEND: Readonly<Record<string, readonly [RunKind, number]>> = {
  p: ['masonry', GRANITE],
  w: ['brick', SANDSTONE],
  m: ['masonry', SANDSTONE],
  r: ['brick', SAND_RED],
  b: ['brick', TRIM],
};

/** A row of 45 degree roof slopes along x, split into the widest pieces that fit. */
function addSlopeRun(
  add: ExampleBrickAdder,
  from: number,
  to: number,
  y: number,
  z: number,
  rotation: 0 | 180,
) {
  for (let x = from; x <= to;) {
    const width = Math.min(4, to - x + 1);
    add({ 4: '3037', 3: '3038', 2: '3039', 1: '3040b' }[width]!, SLATE, x, y, z, rotation);
    x += width;
  }
}

/** A copper cupola: open-stud cone, a round spire brick on its centre stud and a point. */
function addCupola(add: ExampleBrickAdder, x: number, y: number, z: number) {
  add('3942c', COPPER, x, y, z);
  add('3062b', COPPER, x + 0.5, y + 6, z + 0.5);
  add('4589', COPPER, x + 0.5, y + 9, z + 0.5);
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
  expectedPieceCount: 1853,
  buildArea: SIZE,
  brickIdPrefix: 'museet',
  build(drawnAdd) {
    const add = glazeWindows(turnAround(drawnAdd, SIZE));

    // Sixteen green baseplates make the 64 x 64 board.
    for (let x = 0; x < SIZE; x += 16)
      for (let z = 0; z < SIZE; z += 16) add('3867', LAWN, x, 0, z);

    // Raised terrace: a slate plate footing, a granite masonry rim around a brick core, and
    // paving with a tan carpet from the entrance to the steps.
    const terrace = (x: number, z: number) => within(x, z, 5, 12, 58, 41);
    const turret = (x: number, z: number) =>
      TURRETS.some(([turretX, turretZ]) =>
        within(x, z, turretX, turretZ, turretX + 1, turretZ + 1),
      );
    addAreaMap(
      add,
      plan((x, z) => (terrace(x, z) ? 's' : ' ')),
      GROUND,
      { s: ['plate', SLATE] },
    );
    addBondedMap(
      add,
      plan((x, z) => (rim(x, z, 5, 12, 58, 41) ? 'p' : ' ')),
      GROUND + 1,
      WALL_LEGEND,
      0,
    );
    addAreaMap(
      add,
      plan((x, z) => (terrace(x, z) && !rim(x, z, 5, 12, 58, 41) ? 'c' : ' ')),
      GROUND + 1,
      { c: ['brick', SLATE] },
    );
    addAreaMap(
      add,
      plan((x, z) =>
        !terrace(x, z) ||
        footprint(x, z) ||
        turret(x, z) ||
        BALUSTRADE_CELLS.has(`${x}:${z}`) ||
        (z === 35 && PORTAL_COLUMNS.includes(x))
          ? ' '
          : within(x, z, 29, 35, 34, 41)
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

    // Main walls: granite plinth, sandstone storeys and tan string courses, with tall windows on
    // both floors, a double entrance door and an arch over it.
    for (let course = 0; course < 9; course++) {
      const y = BASE + course * 3;
      const windowCourse = (course >= 1 && course <= 3) || (course >= 5 && course <= 7);
      const open = (x: number, z: number) =>
        (windowCourse && WINDOW_CELLS.has(`${x}:${z}`)) ||
        (z === 34 && course <= 5 && x >= 30 && x <= 33) ||
        (z === 34 && course >= 6 && course <= 7 && x >= 29 && x <= 34) ||
        (course % 4 === 0 && course > 0 && ARCH_CELLS.has(`${x}:${z}`)) ||
        (course === 0 && BASEMENT_CELLS.has(`${x}:${z}`));
      const material = (x: number, z: number) =>
        course === 0 ? 'p' : course % 4 === 0 ? 'b' : stone(x, z, course, course < 4 ? 6 : 3);
      addBondedMap(
        add,
        plan((x, z) =>
          (wall(x, z) || innerArch(x, z, course)) && !open(x, z) ? material(x, z) : ' ',
        ),
        y,
        WALL_LEGEND,
        course,
      );
      if (course === 1 || course === 5)
        for (const [x, z, rotation] of WINDOWS) add('60593', WHITE, x, y, z, rotation);
      if (course === 0)
        for (const [x, z, rotation] of BASEMENT_LIGHTS) add('4070', SLATE, x, y, z, rotation);
      // Arches over the front door and the inner opening, before the band that rests on them.
      if (course === 6) for (const z of [34, 31]) add('3307', TRIM, 29, y, z, 90);
      if (course === 4 || course === 8)
        for (const [x, z, rotation] of WINDOW_ARCHES) add('3659', TRIM, x, y, z, rotation);
    }
    add('60596', TRIM, 30, BASE, 34, 90);
    add('60623', BARK, 30, BASE, 33.5, 90);

    // Stone portal: a column either side of the door carries an entablature whose frieze is a
    // row of headlight bricks. Their side studs hold the gilded name band, and a stepped
    // pediment rises above with a seated figure at the apex.
    for (const x of PORTAL_COLUMNS)
      for (let course = 0; course < 8; course++) add('3062b', GRANITE, x, BASE + course * 3, 35);
    const frieze = BASE + 24;
    add('3666', GRANITE, 29, frieze, 35, 90);
    for (let x = 29; x <= 34; x++) add('4070', GRANITE, x, frieze + 1, 35, 180);
    add('2431', GOLD, 30, frieze + 1.5, 35.8, 90, '+z');
    for (const x of PORTAL_COLUMNS) add('3070b', TRIM, x, frieze + 1.5, 35.8, 0, '+z');
    const pediment = frieze + 4;
    add('3040b', GRANITE, 29, pediment, 35, 90);
    add('3004', GRANITE, 31, pediment, 35, 90);
    add('3040b', GRANITE, 33, pediment, 35, 270);
    add('3040b', GRANITE, 30, pediment + 3, 35, 90);
    add('3040b', GRANITE, 32, pediment + 3, 35, 270);
    add('3794b', GRANITE, 31, pediment + 6, 35, 90);
    add('3062b', GRANITE, 31.5, pediment + 7, 35);
    add('98138', GRANITE, 31.5, pediment + 10, 35);

    // Corner turrets of round sandstone with tan bands, rising past the eaves to copper cupolas.
    for (const [x, z] of TURRETS) {
      for (let course = 0; course < 9; course++)
        add(
          '3941',
          course === 0 ? GRANITE : course % 4 === 0 ? TRIM : SANDSTONE,
          x,
          BASE + course * 3,
          z,
        );
      add('4032a', TRIM, x, CEILING, z);
      add('3941', SANDSTONE, x, ROOF, z);
      add('3941', SANDSTONE, x, ROOF + 3, z);
      add('4032a', TRIM, x, ROOF + 6, z);
      addCupola(add, x, ROOF + 7, z);
    }

    // Ceiling slab over every wall, carrying the roof, the bay gables and the central block.
    addAreaMap(
      add,
      plan((x, z) => (footprint(x, z) ? 'c' : ' ')),
      CEILING,
      { c: ['plate', TRIM] },
      wall,
    );

    // Steep slate roof: five slope courses front and back, stepped sandstone gable ends, and the
    // front slopes stopping either side of the central block.
    for (let step = 0; step < 5; step++) {
      const y = ROOF + step * 3;
      addSlopeRun(add, 8, 55, y, 16 + step, 0);
      addSlopeRun(add, 8, 25, y, 30 - step, 180);
      addSlopeRun(add, 38, 55, y, 30 - step, 180);
      for (const x of [8, 55]) addRun(add, 'brick', SANDSTONE, 'z', x, y, 18 + step, 12 - 2 * step);
    }

    // Stepped bay gables: a window, a tan band, then a narrow step with corner pinnacles.
    for (const bay of BAYS)
      for (const z of [32, 15]) {
        for (const y of [ROOF, ROOF + 3])
          for (const x of [bay, bay + 3]) add('3005', SANDSTONE, x, y, z);
        add('60592', WHITE, bay + 1, ROOF, z, 90);
        addRun(add, 'brick', TRIM, 'x', bay, ROOF + 6, z, 4);
        add('98283', SANDSTONE, bay + 1, ROOF + 9, z, 90);
        for (const x of [bay, bay + 3]) {
          add('3062b', TRIM, x, ROOF + 9, z);
          add('4589', COPPER, x, ROOF + 12, z);
        }
        addFinial(add, bay + 1, ROOF + 12, z);
      }

    // Central block rising through the roof: four windows above the pediment, either side of a
    // pier the figure stands before, and side windows into the pavilion.
    for (let step = 0; step < 5; step++) {
      const y = ROOF + step * 3;
      const open = (x: number, z: number) =>
        (step >= 2 && step <= 3 && z === 34 && x >= 27 && x <= 36 && x !== 31 && x !== 32) ||
        (step >= 1 && step <= 2 && (x === 26 || x === 37) && (z === 32 || z === 33));
      addBondedMap(
        add,
        plan((x, z) =>
          rim(x, z, 26, 22, 37, 34) && !open(x, z)
            ? step === 4
              ? 'b'
              : stone(x, z, step, 3)
            : ' ',
        ),
        y,
        WALL_LEGEND,
        step,
      );
      if (step === 1) for (const x of [26, 37]) add('60592', WHITE, x, y, 32, 0);
      if (step === 2) for (const x of [27, 29, 33, 35]) add('60592', WHITE, x, y, 34, 90);
    }

    // Flat roof: slate slab over the ridge and the central block, glass skylights either side.
    const central = (x: number, z: number) => within(x, z, 26, 21, 37, 34);
    addAreaMap(
      add,
      plan((x, z) => (within(x, z, 8, 21, 55, 26) || central(x, z) ? 's' : ' ')),
      FLAT,
      { s: ['plate', SLATE] },
      (x, z) =>
        z === 21 ||
        (z === 26 && !isCentral(x)) ||
        rim(x, z, 26, 22, 37, 34) ||
        ((x === 8 || x === 55) && z >= 22 && z <= 25),
    );
    const tower = (x: number, z: number) => within(x, z, 29, 21, 34, 26);
    const chimney = (x: number, z: number) =>
      within(x, z, 27, 23, 28, 24) || within(x, z, 35, 23, 36, 24);
    const pavilionTurret = (x: number, z: number) =>
      within(x, z, 26, 33, 27, 34) || within(x, z, 36, 33, 37, 34);
    addAreaMap(
      add,
      plan((x, z) => {
        if (central(x, z))
          return tower(x, z) ||
            chimney(x, z) ||
            pavilionTurret(x, z) ||
            (z === 34 && x >= 28 && x <= 35)
            ? ' '
            : 's';
        if (!within(x, z, 8, 21, 55, 26)) return ' ';
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

    // Entrance pavilion crown: a crow-stepped gable between two round turrets with cupolas.
    for (const [step, from, to] of [
      [0, 28, 35],
      [1, 28, 35],
      [2, 29, 34],
      [3, 30, 33],
      [4, 31, 32],
    ] as const) {
      const y = CAP + step * 3;
      if (step < 2) {
        addRun(add, 'brick', SANDSTONE, 'x', from, y, 34, 3);
        addRun(add, 'brick', SANDSTONE, 'x', 33, y, 34, 3);
      } else addRun(add, 'brick', step === 4 ? TRIM : SANDSTONE, 'x', from, y, 34, to - from + 1);
      if (step >= 2) for (const x of [from - 1, to + 1]) add('3070b', TRIM, x, y, 34);
    }
    add('60592', WHITE, 31, CAP, 34, 90);
    addFinial(add, 31, CAP + 15, 34);
    for (const x of [26, 36]) {
      for (const y of [0, 3, 6]) add('3941', SANDSTONE, x, CAP + y, 33);
      add('4032a', TRIM, x, CAP + 9, 33);
      addCupola(add, x, CAP + 10, 33);
    }

    // Tall copper chimneys flank the tower on the roof.
    for (const x of [27, 35]) {
      for (let course = 0; course < 6; course++) add('3003', COPPER, x, CAP + course * 3, 23);
      add('18674', SLATE, x, CAP + 18, 23);
      add('4589', GOLD, x + 0.5, CAP + 19, 23.5);
    }

    // Central tower: two storeys of windows, a tan band, then a dark balcony with green railings
    // and gold finials, a dark glazed lantern, a dark dome, and a green spire with a gold tip.
    for (let course = 0; course < 8; course++) {
      const y = CAP + course * 3;
      const windowed = (course >= 1 && course <= 2) || (course >= 5 && course <= 7);
      const open = (x: number, z: number) =>
        windowed &&
        (((z === 21 || z === 26) && (x === 31 || x === 32)) ||
          ((x === 29 || x === 34) && (z === 23 || z === 24)));
      addBondedMap(
        add,
        plan((x, z) =>
          rim(x, z, 29, 21, 34, 26) && !open(x, z)
            ? course === 4
              ? 'b'
              : stone(x, z, course, 3)
            : ' ',
        ),
        y,
        WALL_LEGEND,
        course,
      );
      if (course === 1 || course === 5)
        for (const [x, z, rotation] of [
          [31, 21, 90],
          [31, 26, 90],
          [29, 23, 0],
          [34, 23, 0],
        ] as const)
          add(course === 1 ? '60592' : '60593', WHITE, x, y, z, rotation);
    }
    const balcony = CAP + 24;
    add('41539', SLATE, 28, balcony, 20);
    for (const x of [28, 35])
      for (const z of [20, 27]) {
        add('3062b', SLATE, x, balcony + 1, z);
        add('4589', GOLD, x, balcony + 4, z);
      }
    for (const z of [20, 27]) add('3633', COPPER, 30, balcony + 1, z, 90);
    for (const x of [28, 35]) add('3633', COPPER, x, balcony + 1, 22);
    for (const y of [balcony + 1, balcony + 4]) {
      for (const x of [30, 33]) for (const z of [22, 25]) add('3062b', SLATE, x, y, z);
      for (const z of [22, 25]) add('3004', GLASS, 31, y, z, 90);
      for (const x of [30, 33]) add('3004', GLASS, x, y, 23);
    }
    add('3943b', SLATE, 30, balcony + 7, 22);
    add('3942c', COPPER, 31, balcony + 13, 23);
    add('3062b', SLATE, 31.5, balcony + 19, 23.5);
    add('3062b', GOLD, 31.5, balcony + 22, 23.5);
    add('4589', GOLD, 31.5, balcony + 25, 23.5);

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
    add('3001', GRANITE, 30, GROUND, 54);
    add('3001', GRANITE, 32, GROUND, 54);
    add('3001', GRANITE, 30, GROUND + 3, 54, 90);
    add('3001', GRANITE, 30, GROUND + 3, 56, 90);
    add('3031', TRIM, 30, GROUND + 6, 54);
    add('3941', SLATE, 31, GROUND + 7, 55);
    add('3004', COPPER, 31, GROUND + 10, 55, 90);
    add('3004', COPPER, 31, GROUND + 13, 55, 90);
    addFinial(add, 31, GROUND + 16, 55);

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

    // Trees and shrubs all round: laburnums in bloom out front, oaks and firs along the sides
    // and back, bushes and flowers at the foot of the terrace.
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
      ...[13, 21, 29, 37].flatMap((z, index) => [
        [0, z, index % 2 ? '3471' : '3470'] as const,
        [59, z, index % 2 ? '3471' : '3470'] as const,
      ]),
    ] as const)
      add(partId, LEAVES, x, GROUND, z);
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
