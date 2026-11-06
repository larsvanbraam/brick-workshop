import { addRing, addRowMap, addRun, glazeWindows, turnAround } from './layout.ts';
import type { ExampleBrickAdder, ExampleDefinition } from './types.ts';

// Top-down plan of the square: rows run along z (front is high z), characters along x.
// c cobbles, # occupied by a structure, u puddle, * fallen petal, k kerb.
const SQUARE = [
  'cccccccccccccccc',
  'cccccccccccccccc',
  'cc############cc',
  'cc##############',
  'cc##############',
  'cc##############',
  'cc##############',
  'cccccccccccccccc',
  'ccc######c##cccc',
  'c#c######c##cccc',
  'cc*cccc*cccccccc',
  'ccccccc##cu####c',
  'cccuccccccu####c',
  'ccc###c##c*####c',
  'ccc###c###c####c',
  'kkkkkkkkkkkkkkkk',
];

const PAVING = 72;
const COBBLE = 71;
const TAN = 19;
const TIMBER = 70;
const BROWN = 6;
const GREEN = 2;
const RED = 4;
const WHITE = 15;
const YELLOW = 14;
const PINK = 13;
const ORANGE = 25;
const BLACK = 0;
const LAMP = 46;

/** A round bucket holding a leafy bunch with one large bloom on top. */
function addBucket(
  add: ExampleBrickAdder,
  x: number,
  y: number,
  z: number,
  pail: number,
  bloom: number,
) {
  add('3941', pail, x, y, z);
  add('18674', pail, x, y + 3, z);
  add('4727', GREEN, x, y + 4, z);
  add('24866', bloom, x, y + 7, z);
}

/** A small round pot with a leaf plate and a single flower head. */
function addPot(
  add: ExampleBrickAdder,
  x: number,
  y: number,
  z: number,
  pot: number,
  bloom: number,
) {
  add('3062b', pot, x, y, z);
  add('6141', GREEN, x, y + 3, z);
  add('98138', bloom, x, y + 4, z);
}

/** A 2 x 2 produce crate filled with round fruit. */
function addCrate(add: ExampleBrickAdder, x: number, z: number, fruit: readonly number[]) {
  add('3022', TIMBER, x, 1, z);
  for (const [index, [dx, dz]] of (
    [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ] as const
  ).entries()) {
    add('3005', index % 3 ? TIMBER : BROWN, x + dx, 2, z + dz);
    add('98138', fruit[index % fruit.length], x + dx, 5, z + dz);
  }
}

export const flowerStall: ExampleDefinition = {
  id: 'flower-stall',
  name: 'Flower Market Stall',
  tags: ['market', 'flower-stall', 'striped-awning', 'street-furniture', 'cobblestones', 'tree'],
  expectedPieceCount: 351,
  brickIdPrefix: 'stall',
  build(drawnAdd) {
    const add = glazeWindows(turnAround(drawnAdd));
    add('91405', PAVING, 0, 0, 0);

    // Cobbled square with mixed stones, puddles, fallen petals and a kerb along the front.
    SQUARE.forEach((row, z) => {
      for (let x = 0; x < row.length; x++) {
        const cell = row[x];
        if (cell === 'u') add('3070b', 43, x, 1, z);
        if (cell === '*') add('98138', (x + z) % 2 ? PINK : RED, x, 1, z);
        if (cell !== 'c') continue;
        const color = (x * 3 + z * 5) % 4 === 0 ? PAVING : (x + z * 2) % 7 === 0 ? TAN : COBBLE;
        if (row[x + 1] === 'c' && (x * 7 + z * 3) % 4 === 0) add('3069b', color, x++, 1, z, 90);
        else add('3070b', color, x, 1, z);
      }
    });
    addRowMap(add, SQUARE, 1, { k: ['tile', PAVING] });

    // Booth: timber lower walls, a shelf plate bonded into the wall, and tan upper walls with
    // side windows. Even courses give the back wall the corners, odd courses the side walls.
    const addBoothCourse = (y: number, course: number, color: number, windows: boolean) => {
      const even = course % 2 === 0;
      addRun(add, 'brick', color, 'x', even ? 2 : 3, y, 2, even ? 12 : 10);
      for (const x of [2, 13]) {
        if (windows) {
          if (!even) add('3005', color, x, y, 2);
        } else addRun(add, 'brick', color, 'z', x, y, even ? 3 : 2, even ? 2 : 3);
      }
    };
    for (let course = 0; course < 3; course++)
      addBoothCourse(1 + course * 3, course, TIMBER, false);
    add('2445', TIMBER, 2, 10, 2, 90);
    for (const x of [2, 13]) add('3024', TIMBER, x, 10, 4);
    for (let course = 0; course < 4; course++) {
      const y = 11 + course * 3;
      addBoothCourse(y, course, TAN, course === 1 || course === 2);
      if (course === 1) for (const x of [2, 13]) add('60592', WHITE, x, y, 3);
    }
    for (const z of [3, 4]) addRun(add, 'tile', TIMBER, 'x', 3, 1, z, 10);

    // Counter: an inner timber row and a grooved tan front, bonded by a long top plate.
    addRun(add, 'brick', TIMBER, 'x', 2, 1, 5, 4);
    addRun(add, 'brick', TIMBER, 'x', 6, 1, 5, 8);
    addRun(add, 'brick', TIMBER, 'x', 2, 4, 5, 8);
    addRun(add, 'brick', TIMBER, 'x', 10, 4, 5, 4);
    for (let x = 2; x < 14; x += 2) add('4216', TAN, x, 1, 6, 90);
    add('3005', TAN, 2, 4, 6);
    for (let x = 3; x < 13; x += 2) add('4216', TAN, x, 4, 6, 90);
    add('3005', TAN, 13, 4, 6);
    add('2445', TIMBER, 2, 7, 5, 90);

    // Counter display: three flower buckets, potted seedlings and a little cash register.
    addBucket(add, 3, 8, 5, PAVING, RED);
    addBucket(add, 5, 8, 5, WHITE, YELLOW);
    for (const [x, z, bloom] of [
      [7, 5, PINK],
      [8, 5, WHITE],
      [7, 6, YELLOW],
      [8, 6, RED],
    ] as const)
      addPot(add, x, 8, z, TIMBER, bloom);
    addBucket(add, 9, 8, 5, RED, PINK);
    add('3022', PAVING, 11, 8, 5);
    add('3039', PAVING, 11, 9, 5, 180);
    add('3070b', BLACK, 11, 12, 5);
    add('98138', YELLOW, 12, 12, 5);

    // Shelf of terracotta, white and timber pots along the back wall.
    for (let x = 3; x < 13; x++)
      addPot(
        add,
        x,
        11,
        3,
        [ORANGE, WHITE, TIMBER][x % 3],
        [RED, YELLOW, PINK, WHITE, ORANGE][x % 5],
      );

    // Corner posts on the counter carry the roof plate and a striped, stepped awning.
    for (const x of [2, 13]) add('2453b', TIMBER, x, 8, 6);
    add('3456', TIMBER, 1, 23, 2, 90);
    for (let x = 1; x < 15; x++) {
      const stripe = x % 2 ? WHITE : RED;
      add('3622', stripe, x, 24, 2);
      add('4286', stripe, x, 24, 5, 180);
      add('3005', stripe, x, 27, 2);
      add('4286', stripe, x, 27, 3, 180);
      if (x >= 6 && x <= 9) add('3070b', stripe, x, 30, 3);
      else add('3069b', stripe, x, 30, 2);
    }

    // Shop sign standing on the awning ridge.
    add('60581', WHITE, 6, 30, 2, 90);
    add('3710', GREEN, 6, 39, 2, 90);
    add('3069b', GREEN, 7, 40, 2, 90);
    for (const x of [6, 9]) add('98138', PINK, x, 40, 2);

    // Fruit crates beside the booth.
    addCrate(add, 14, 3, [RED, GREEN]);
    addCrate(add, 14, 5, [ORANGE, YELLOW]);

    // Buckets of cut flowers on the cobbles and a chalkboard A-frame sign.
    addBucket(add, 3, 1, 8, TIMBER, ORANGE);
    addBucket(add, 5, 1, 8, PAVING, WHITE);
    addBucket(add, 7, 1, 8, WHITE, RED);
    add('3678b', BLACK, 10, 1, 8, 180);

    // Street lamp, drain grate, bench, litter bin and fire hydrant.
    for (const y of [1, 16]) add('2453b', BLACK, 1, y, 9);
    add('3062b', LAMP, 1, 31, 9);
    add('4589', BLACK, 1, 34, 9);
    add('2412b', PAVING, 7, 1, 11, 90);
    for (const x of [3, 5]) add('3004', TIMBER, x, 1, 13);
    add('3021', TIMBER, 3, 4, 13, 90);
    add('63864', BROWN, 3, 5, 13, 90);
    add('3622', TIMBER, 3, 5, 14, 90);
    add('63864', BROWN, 3, 8, 14, 90);
    add('3941', 288, 7, 1, 13);
    add('14769', 288, 7, 4, 13);
    for (const y of [1, 4]) add('3062b', RED, 9, y, 14);
    add('98138', RED, 9, 7, 14);

    // Raised planter with a leafy shade tree.
    addRing(add, 'brick', TAN, 11, 11, 4, 4, 1, 0);
    add('3003', BROWN, 12, 1, 12);
    add('3470', GREEN, 10, 4, 10);
  },
};
