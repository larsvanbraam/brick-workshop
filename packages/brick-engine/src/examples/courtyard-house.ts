import { addRing, addRowMap, addRun, glazeWindows, turnAround } from './layout.ts';
import type { ExampleDefinition } from './types.ts';

// Top-down plan of the yard: rows run along z (front is high z), characters along x.
// c cobbles, p flagstones, d garden soil, g bare grass, - kept clear for a door, # structure.
const YARD = [
  'ggggggg##ggggggg',
  'ggggggggggg####g',
  '###############g',
  '###############g',
  '###############g',
  '###########---g#',
  'g##########cccc#',
  '#####---#cc#####',
  '####cpppc#c#####',
  '#dddcpp####ccccg',
  '#dddcpp####ggggg',
  '#dddcpp####ggggg',
  '#dddcpp####ggggg',
  '#dddcppccccggggg',
  '#ccccpppppcggggg',
  '######pppp######',
];

const STONE = 71;
const SLATE = 72;
const TIMBER = 70;
const PLASTER = 19;
const BROWN = 6;
const GREEN = 2;
const RED = 4;
const ORANGE = 25;
const FLAME = 57;
const EMBER = 46;

export const courtyardHouse: ExampleDefinition = {
  id: 'courtyard-house',
  name: 'Courtyard House',
  tags: [
    'demo',
    'medieval',
    'half-timbered',
    'jettied',
    'watchtower',
    'courtyard',
    'well',
    'sloped-roof',
  ],
  expectedPieceCount: 383,
  brickIdPrefix: 'demo',
  build(drawnAdd) {
    const add = glazeWindows(turnAround(drawnAdd));
    add('91405', GREEN, 0, 0, 0);

    // Cobbled yard with a flagstone path from the gate to the hall door.
    YARD.forEach((row, z) =>
      [...row].forEach((cell, x) => {
        if (cell === 'c') add('3070b', (x * 3 + z * 5) % 4 === 0 ? SLATE : STONE, x, 1, z);
        if (cell === 'p') add('3070b', (x + z) % 2 ? PLASTER : 28, x, 1, z);
      }),
    );
    addRowMap(add, YARD, 1, { d: ['plate', BROWN] }, 'z');

    // Hall ground floor: four masonry courses with a door, two tall windows and a side window.
    // The top course carries inverted-slope corbels that hold the jettied upper floor.
    const frontWindows = (x: number) => (x >= 2 && x <= 3) || (x >= 8 && x <= 9);
    const corbels = [1, 4, 10];
    add('3579', TIMBER, 5, 1, 6, 90);
    add('3193a', BROWN, 5, 1, 5.5, 90);
    for (let course = 0; course < 4; course++) {
      const y = 1 + course * 3;
      addRing(add, 'masonry', course % 2 ? STONE : SLATE, 1, 2, 10, 5, y, course, (x, z) =>
        z === 6
          ? (x >= 5 && x <= 7) ||
            (course >= 1 && frontWindows(x)) ||
            (course === 3 && corbels.includes(x))
          : x === 1 && course >= 1 && course <= 2 && z >= 3 && z <= 4,
      );
      if (course === 1) {
        for (const x of [2, 8]) add('60593', TIMBER, x, y, 6, 90);
        add('60592', TIMBER, 1, y, 3);
      }
    }
    for (const x of corbels) add('3665a', TIMBER, x, 10, 6, 180);
    add('3033', TIMBER, 1, 13, 2, 90);

    // Jettied upper storey: plaster infill between timber posts, a timber rail course and windows.
    const posts = new Set(['1:2', '10:2', '1:7', '10:7', '4:7', '7:7', '4:2', '7:2', '10:5']);
    for (let course = 0; course < 3; course++) {
      const y = 14 + course * 3;
      addRing(
        add,
        'brick',
        course === 2 ? TIMBER : PLASTER,
        1,
        2,
        10,
        6,
        y,
        course,
        (x, z) =>
          posts.has(`${x}:${z}`) ||
          (z === 7 && frontWindows(x)) ||
          (x === 1 && course <= 1 && z >= 4 && z <= 5),
      );
      for (const post of posts) {
        const [x, z] = post.split(':').map(Number);
        add('3005', TIMBER, x, y, z);
      }
      if (course === 0) {
        for (const x of [2, 8]) add('60593', TIMBER, x, y, 7, 90);
        add('60592', TIMBER, 1, y, 4);
      }
    }
    add('3033', TIMBER, 1, 23, 2, 90);

    // Stepped slate roof with timber gables and a tiled ridge.
    for (const x of [1, 10]) {
      add('3010', TIMBER, x, 24, 3);
      add('3004', PLASTER, x, 27, 4);
    }
    for (const [y, backZ, frontZ] of [
      [24, 1, 7],
      [27, 2, 6],
      [30, 3, 5],
    ] as const)
      for (const [x, partId] of [
        [0, '3037'],
        [4, '3037'],
        [8, '3038'],
      ] as const) {
        add(partId, SLATE, x, y, backZ);
        add(partId, SLATE, x, y, frontZ, 180);
      }
    add('3795', SLATE, 0, 33, 4, 90);
    add('3022', SLATE, 6, 33, 4);
    add('3021', SLATE, 8, 33, 4, 90);
    for (const z of [4, 5]) addRun(add, 'tile', TIMBER, 'x', 0, 34, z, 11);

    // Chimney stack behind the hall with two clay pots.
    for (let course = 0; course < 12; course++)
      add('98283', course % 2 ? STONE : SLATE, 7, 1 + course * 3, 0, 90);
    add('3023b', SLATE, 7, 37, 0, 90);
    for (const x of [7, 8]) add('3062b', RED, x, 38, 0);

    // Watchtower: masonry shaft with a door, arrow slits and a window; the top course swaps
    // its middle stones for corbels under an overhanging, crenellated fighting platform.
    const slits = new Set(['14:2:4', '14:2:5', '12:4:6', '12:4:7', '12:1:6', '12:1:7']);
    const corbelCells = new Set(['12:4', '13:4', '12:1', '13:1', '11:2', '11:3', '14:2', '14:3']);
    add('3579', TIMBER, 11, 1, 4, 90);
    add('3193a', BROWN, 11, 1, 3.5, 90);
    for (let course = 0; course < 12; course++) {
      const y = 1 + course * 3;
      addRing(
        add,
        'masonry',
        course % 3 ? STONE : SLATE,
        11,
        1,
        4,
        4,
        y,
        course,
        (x, z) =>
          (z === 4 && x <= 13 && course <= 3) ||
          slits.has(`${x}:${z}:${course}`) ||
          (x === 14 && z >= 2 && z <= 3 && course >= 8 && course <= 9) ||
          (course === 11 && corbelCells.has(`${x}:${z}`)),
      );
      if (course === 8) add('60592', TIMBER, 14, y, 2);
    }
    for (const x of [12, 13]) {
      add('3665a', SLATE, x, 34, 4, 180);
      add('3665a', SLATE, x, 34, 0);
    }
    for (const z of [2, 3]) {
      add('3665a', SLATE, 10, 34, z, 90);
      add('3665a', SLATE, 14, 34, z, 270);
    }
    add('3958', SLATE, 10, 37, 0);
    for (let x = 10; x < 16; x++)
      for (let z = 0; z < 6; z++) {
        const edge = x === 10 || x === 15 || z === 0 || z === 5;
        if (!edge || (x + z) % 2) continue;
        add('3005', (x * z) % 3 ? STONE : SLATE, x, 38, z);
        add('3070b', SLATE, x, 41, z);
      }
    add('3941', 0, 12, 38, 2);
    add('18674', 0, 12, 41, 2);
    add('4589', FLAME, 12.5, 42, 2.5);
    add('4589', EMBER, 12.5, 45, 2.5);

    // Courtyard wall with an arched gate, flanking torches and capping tiles.
    for (let course = 0; course < 2; course++) {
      const y = 1 + course * 3;
      addRun(add, 'masonry', course ? STONE : SLATE, 'x', course ? 1 : 0, y, 15, course ? 5 : 6);
      addRun(add, 'masonry', course ? SLATE : STONE, 'x', 10, y, 15, 6);
      addRun(add, 'masonry', course ? SLATE : STONE, 'z', 0, y, course ? 7 : 8, course ? 9 : 7);
    }
    add('3307', STONE, 5, 7, 15, 90);
    add('3666', SLATE, 5, 13, 15, 90);
    for (const x of [5, 10]) {
      add('3005', STONE, x, 14, 15);
      add('3070b', SLATE, x, 17, 15);
    }
    add('2431', SLATE, 6, 14, 15, 90);
    addRun(add, 'tile', SLATE, 'x', 0, 7, 15, 4);
    addRun(add, 'tile', SLATE, 'x', 12, 7, 15, 4);
    addRun(add, 'tile', SLATE, 'z', 0, 7, 7, 8);
    for (const x of [4, 11]) {
      add('3062b', TIMBER, x, 7, 15);
      add('4589', FLAME, x, 10, 15);
    }

    // Roofed well with a stone rim, water, timber posts and a bucket on the rim.
    for (let course = 0; course < 2; course++)
      addRing(add, 'masonry', course ? STONE : SLATE, 7, 9, 4, 4, 1 + course * 3, course);
    add('3068b', 33, 8, 1, 10);
    for (const x of [7, 10]) add('14716', TIMBER, x, 7, 10);
    add('3020', TIMBER, 7, 16, 10, 90);
    add('3037', BROWN, 7, 17, 9);
    add('3037', BROWN, 7, 17, 11, 180);
    for (const z of [10, 11]) add('2431', TIMBER, 7, 20, z, 90);
    add('3062b', TIMBER, 9, 7, 12);
    add('98138', 33, 9, 10, 12);

    // Vegetable garden: lettuces, pumpkins and carrots with a scarecrow keeping watch.
    for (const x of [1, 2, 3]) {
      add('6141', 10, x, 2, 9);
      add('98138', GREEN, x, 3, 9);
      add('6141', ORANGE, x, 2, 11);
      add('98138', GREEN, x, 3, 11);
      add('98138', ORANGE, x, 2, 13);
    }
    add('2453b', TIMBER, 2, 2, 12);
    add('3623', 1, 1, 17, 12, 90);
    add('3062b', PLASTER, 2, 18, 12);
    add('4589', BROWN, 2, 21, 12);

    // Woodpile, a bench and potted plants by the door, a barrel, crates and a chopping block.
    add('30137', BROWN, 0, 1, 2);
    add('30137', TIMBER, 0, 4, 2);
    add('30136', BROWN, 0, 7, 3);
    for (const x of [1, 3]) add('3004', TIMBER, x, 1, 7);
    add('3021', TIMBER, 1, 4, 7, 90);
    add('3622', TIMBER, 1, 5, 7, 90);
    add('63864', BROWN, 1, 5, 8, 90);
    add('63864', BROWN, 1, 8, 7, 90);
    for (const [x, bloom] of [
      [4, RED],
      [8, 14],
    ] as const) {
      add('3062b', TIMBER, x, 1, 7);
      add('6141', GREEN, x, 4, 7);
      add('98138', bloom, x, 5, 7);
    }
    add('3941', TIMBER, 11, 1, 7);
    add('3941', TIMBER, 11, 4, 7);
    add('14769', BROWN, 11, 7, 7);
    add('3022', TIMBER, 13, 1, 7);
    for (const [dx, dz] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ] as const) {
      add('3005', dx === dz ? BROWN : TIMBER, 13 + dx, 2, 7 + dz);
      add('98138', (dx + dz) % 2 ? RED : GREEN, 13 + dx, 5, 7 + dz);
    }
    add('3062b', BROWN, 9, 1, 8);
    add('98138', PLASTER, 9, 4, 8);

    // Picket fence along the open side and a shade tree in the garden corner.
    add('33303', TIMBER, 15, 1, 5);
    add('3470', GREEN, 11, 1, 10);
  },
};
