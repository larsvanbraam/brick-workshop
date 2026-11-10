import { addRing, addRowMap, addRun, glazeWindows, turnAround } from './layout.ts';
import type { ExampleDefinition } from './types.ts';

// Top-down island plan: rows run along z (front is high z), characters along x.
// r/R rock edge, s sand, g grass, p stepping-stone path, b building footing, . open water.
const ISLAND = [
  '................',
  '..rRrrrRrrrrr...',
  '.rbbbbbbsbbbbbr.',
  'rsbbbbbbgbbbbbr.',
  'rgbbbbbbgbbbbbRr',
  'Rgbbbbbbgbbbbbgr',
  'rgbbbbbbgbbbbbgr',
  'rsbbbbbbggsssggr',
  '.rsgssspppppggsr',
  '.rsggggggggpgsr.',
  '..rsgggggggpsrr.',
  '...rrsssssspsr..',
  '.....rRrrrppr...',
  '......rrr.......',
];

const WATER = 73;
const ROCK = 72;
const STONE = 71;
const SAND = 19;
const GRASS = 2;
const WHITE = 15;
const RED = 4;
const BLACK = 0;
const TIMBER = 70;
const ROOF = 272;
const GLASS = 47;
const LAMP = 46;
// Doors are 1 x 4 x 6 leaves hung on the pins of a 1 x 4 x 6 frame in the front wall: four panes
// on the lighthouse, smooth on the cottage.
const DOOR_X = 3;
const DOOR_Z = 7;
const COTTAGE_DOOR_X = 9;

export const seasideLighthouse: ExampleDefinition = {
  id: 'seaside-lighthouse',
  name: 'Seaside Lighthouse',
  tags: ['coastal', 'lighthouse', 'cottage', 'jetty', 'rowboat', 'island', 'striped-tower'],
  expectedPieceCount: 415,
  brickIdPrefix: 'lighthouse',
  build(drawnAdd) {
    const add = glazeWindows(turnAround(drawnAdd));
    add('91405', WATER, 0, 0, 0);

    // Two interlocking island layers: rock underneath, sand, grass and footings on top.
    addRowMap(
      add,
      ISLAND.map((row) => row.replace(/[sgbp]/g, 'l')),
      1,
      {
        r: ['plate', ROCK],
        R: ['plate', STONE],
        l: ['plate', STONE],
      },
    );
    addRowMap(
      add,
      ISLAND,
      2,
      { s: ['plate', SAND], g: ['plate', GRASS], b: ['plate', STONE], p: ['plate', SAND] },
      'z',
    );
    ISLAND.forEach((row, z) =>
      [...row].forEach((cell, x) => {
        if (cell === 'p') add('3070b', (x + z) % 3 === 0 ? ROCK : STONE, x, 3, z);
      }),
    );

    // Boulders and pebbles along the shoreline, kept clear of the chimney and the tall grass.
    const clearRock = new Set(['1:2', '11:1', '12:1', '14:3', '14:4']);
    ISLAND.forEach((row, z) =>
      [...row].forEach((cell, x) => {
        if ((cell !== 'r' && cell !== 'R') || clearRock.has(`${x}:${z}`)) return;
        const outward = z <= 2 ? 0 : z >= 10 ? 180 : x < 8 ? 270 : 90;
        switch ((x * 5 + z * 3) % 6) {
          case 0:
            add('3062b', ROCK, x, 2, z);
            break;
          case 1:
            add('54200', ROCK, x, 2, z, outward);
            break;
          case 2:
            add('3024', ROCK, x, 2, z);
            add('54200', STONE, x, 3, z, outward);
            break;
          case 4:
            add('3005', STONE, x, 2, z);
            add('98138', ROCK, x, 5, z);
            break;
          case 5:
            add('35464', ROCK, x, 2, z);
            break;
        }
      }),
    );

    // Lighthouse plinth: six masonry courses with a framed door and a slit window.
    add('60596', WHITE, DOOR_X, 3, DOOR_Z, 90);
    add('60623', RED, DOOR_X, 3, DOOR_Z - 0.5, 90);
    for (let course = 0; course < 6; course++) {
      addRing(
        add,
        'masonry',
        course % 2 ? STONE : ROCK,
        2,
        2,
        6,
        6,
        3 + course * 3,
        course,
        (x, z) =>
          (z === 7 && x >= DOOR_X && x <= DOOR_X + 3) ||
          (course >= 1 && course <= 2 && x === 7 && z >= 4 && z <= 5),
      );
      if (course === 1) add('60592', WHITE, 7, 6, 4);
    }
    add('3958', ROCK, 2, 21, 2);

    // Striped tower: pairs of white and red courses with staggered corners and two windows.
    for (let course = 0; course < 8; course++) {
      const y = 22 + course * 3;
      addRing(
        add,
        'brick',
        course % 4 < 2 ? WHITE : RED,
        3,
        3,
        4,
        4,
        y,
        course,
        (x, z) =>
          (course >= 3 && course <= 4 && z === 6 && x >= 4 && x <= 5) ||
          (course >= 6 && x === 6 && z >= 4 && z <= 5),
      );
      if (course === 3) add('60592', WHITE, 4, y, 6, 90);
      if (course === 6) add('60592', WHITE, 6, y, 4);
    }

    // Gallery with a white lattice railing and black corner posts.
    add('3958', BLACK, 2, 46, 2);
    for (const x of [2, 7])
      for (const z of [2, 7]) {
        add('3062b', BLACK, x, 47, z);
        add('98138', BLACK, x, 50, z);
      }
    for (const z of [2, 7]) add('3633', WHITE, 3, 47, z, 90);
    for (const x of [2, 7]) add('3633', WHITE, x, 47, 3);

    // Lantern room: glazed walls around a glowing lamp, capped by a red cone and lightning rod.
    for (const y of [47, 50]) {
      for (const x of [3, 6]) for (const z of [3, 6]) add('3062b', BLACK, x, y, z);
      for (const z of [3, 6]) add('3004', GLASS, 4, y, z, 90);
      for (const x of [3, 6]) add('3004', GLASS, x, y, 4);
      add('3941', LAMP, 4, y, 4);
    }
    add('3031', RED, 3, 53, 3);
    add('3943b', RED, 3, 54, 3);
    add('3942c', BLACK, 4, 60, 4);
    add('6141', BLACK, 4.5, 66, 4.5);
    add('4589', BLACK, 4.5, 67, 4.5);

    // Keeper's cottage: stone footing course, whitewashed walls, blue door and three windows.
    add('60596', WHITE, COTTAGE_DOOR_X, 3, DOOR_Z - 1, 90);
    add('60616a', 1, COTTAGE_DOOR_X, 3, DOOR_Z - 1.5, 90);
    for (let course = 0; course < 6; course++) {
      addRing(
        add,
        course === 0 ? 'masonry' : 'brick',
        course === 0 ? ROCK : WHITE,
        9,
        2,
        5,
        5,
        3 + course * 3,
        course,
        (x, z) =>
          (z === 6 && x >= COTTAGE_DOOR_X && x <= COTTAGE_DOOR_X + 3) ||
          (course >= 1 && x === 13 && z >= 3 && z <= 4) ||
          (course >= 1 && course <= 2 && z === 2 && x >= 10 && x <= 11),
      );
      if (course === 1) {
        add('60593', WHITE, 13, 6, 3);
        add('60592', WHITE, 10, 6, 2, 90);
      }
    }

    // Pitched slate-blue roof with gable fill and a tiled ridge.
    for (const x of [9, 13]) add('3004', WHITE, x, 21, 4);
    for (const [y, backZ, frontZ] of [
      [21, 2, 6],
      [24, 3, 5],
    ] as const) {
      add('3037', ROOF, 8, y, backZ);
      add('3038', ROOF, 12, y, backZ);
      add('3037', ROOF, 8, y, frontZ, 180);
      add('3038', ROOF, 12, y, frontZ, 180);
    }
    add('3795', ROOF, 8, 27, 4, 90);
    add('3023b', ROOF, 14, 27, 4);
    for (const z of [4, 5]) addRun(add, 'tile', ROCK, 'x', 8, 28, z, 7);

    // Chimney behind the cottage with two clay pots.
    for (let course = 0; course < 9; course++)
      add('98283', course % 2 ? STONE : ROCK, 11, 2 + course * 3, 1, 90);
    add('3023b', ROCK, 11, 29, 1, 90);
    for (const x of [11, 12]) add('3062b', 6, x, 30, 1);

    // Window box under the side window, a rain barrel, woodpile and potted plants by the door.
    for (const y of [2, 5]) add('3004', TIMBER, 14, y, 3);
    add('98138', RED, 14, 8, 3);
    add('98138', 14, 14, 8, 4);
    for (const y of [3, 6]) add('3062b', TIMBER, 14, y, 6);
    add('98138', ROCK, 14, 9, 6);
    add('30136', TIMBER, 8, 3, 3);
    add('30136', TIMBER, 8, 3, 5);
    add('30136', 6, 8, 6, 4);
    for (const [x, bloom] of [
      [8, RED],
      [13, 14],
    ] as const) {
      add('3062b', TIMBER, x, 3, 7);
      add('6141', GRASS, x, 6, 7);
      add('98138', bloom, x, 7, 7);
    }

    // Front garden: bench facing the path, a lamp post, a mailbox, a barrel and wild flowers.
    for (const x of [4, 6]) add('3004', TIMBER, x, 3, 9);
    add('3021', TIMBER, 4, 6, 9, 90);
    add('63864', 6, 4, 7, 9, 90);
    add('3622', TIMBER, 4, 7, 10, 90);
    add('63864', 6, 4, 10, 10, 90);
    add('2453b', BLACK, 8, 3, 9);
    add('3062b', LAMP, 8, 18, 9);
    add('98138', BLACK, 8, 21, 9);
    for (const y of [3, 6]) add('3005', TIMBER, 14, y, 8);
    add('4070', 1, 14, 9, 8);
    add('98138', RED, 14, 12, 8);
    add('3941', TIMBER, 12, 3, 8);
    add('14769', ROCK, 12, 6, 8);
    add('32607', GRASS, 9, 3, 9);
    add('98138', 13, 9, 4, 10);
    for (const [x, z, color] of [
      [1, 7, RED],
      [2, 8, 14],
      [3, 9, WHITE],
      [3, 10, RED],
      [7, 9, 14],
      [7, 10, WHITE],
      [8, 10, RED],
      [12, 10, WHITE],
    ] as const)
      add('98138', color, x, 3, z);
    add('30093', GRASS, 5.5, 3, 11);
    add('30093', GRASS, 1, 3, 2.5, 90);

    // Jetty on round piles with plank decking, a mooring bollard and a lamp at the end.
    for (const x of [10, 11]) for (const z of [13, 15]) add('3062b', TIMBER, x, 1, z);
    for (const x of [10, 11]) add('3710', TIMBER, x, 4, 12);
    for (const z of [12, 13, 14]) add('3069b', z % 2 ? 6 : TIMBER, 10, 5, z, 90);
    add('3062b', 6, 10, 5, 15);
    add('98138', BLACK, 10, 8, 15);
    add('2453b', BLACK, 11, 5, 15);
    add('3062b', LAMP, 11, 20, 15);
    add('4589', BLACK, 11, 23, 15);

    // Rowboat moored beside the jetty: pointed bow, red gunwales, thwart and stern seat.
    add('3020', WHITE, 13, 1, 12);
    for (const x of [13, 14]) {
      add('54200', WHITE, x, 2, 12);
      add('3623', RED, x, 2, 13);
      add('3070b', WHITE, x, 3, 15);
    }
    add('3069b', TIMBER, 13, 3, 14, 90);

    // Striped buoy, foam and ripples on the open water.
    add('3062b', RED, 14, 1, 1);
    add('3062b', WHITE, 14, 4, 1);
    add('4589', RED, 14, 7, 1);
    for (const [x, z, color] of [
      [0, 2, WHITE],
      [15, 3, WHITE],
      [15, 10, WHITE],
      [2, 12, WHITE],
      [5, 13, WHITE],
      [9, 14, GLASS],
      [3, 15, GLASS],
      [7, 0, GLASS],
      [11, 0, GLASS],
      [0, 9, GLASS],
      [15, 13, GLASS],
    ] as const)
      add('98138', color, x, 1, z);
  },
};
