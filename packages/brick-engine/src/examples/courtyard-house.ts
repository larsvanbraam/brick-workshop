import type { ExampleDefinition } from './types.ts';

export const courtyardHouse: ExampleDefinition = {
  id: 'courtyard-house',
  name: 'Courtyard House',
  tags: ['demo', 'medieval', 'half-timbered', 'watchtower', 'courtyard', 'sloped-roof'],
  expectedPieceCount: 306,
  brickIdPrefix: 'demo',
  build(add) {
    const stone = 71;
    const slate = 72;
    const timber = 70;
    const plaster = 19;
    add('91405', stone, 0, 0, 0);
    for (const y of [1, 4]) {
      add('6112', y === 1 ? slate : stone, 0, y, 1);
      add('3622', stone, 0, y, 13);
      add('6112', stone, 1, y, 14, 90);
      add('3004', stone, 13, y, 14, 90);
      for (const x of [1, 14]) {
        if (y === 1) add('3009', stone, x, y, 8);
        else for (const z of [8, 12]) add('3004', stone, x, y, z);
      }
      if (y === 1) {
        for (const x of [1, 9]) add('3009', stone, x, y, 7, 90);
      } else {
        for (const x of [1, 2, 5, 6, 9, 10, 13, 14]) add('3005', stone, x, y, 7);
      }
      add('3004', timber, 7, y, 7, 90);
      for (const z of [1, 4]) {
        if (z === 1) {
          for (const x of [1, 4]) add('3005', stone, x, y, z);
          add('3004', timber, 2, y, z, 90);
        } else add('3010', stone, 1, y, z, 90);
      }
      for (const x of [1, 4]) add('3004', stone, x, y, 2);
    }
    add('6320', slate, 3, 1, 8, 90);
    add('6934', timber, 11, 1, 8);
    add('92438', timber, 0, 7, 7, 90);
    add('3031', stone, 1, 7, 1);

    for (const x of [1, 5, 10, 14]) for (const z of [7, 14]) add('2453b', timber, x, 8, z);
    for (const x of [1, 14]) for (const z of [10, 12]) add('2453b', timber, x, 8, z);
    for (const y of [8, 11, 14, 17, 20]) {
      if (y === 8 || y === 20) {
        for (const z of [7, 14]) {
          for (const x of [2, 11]) add('3622', plaster, x, y, z, 90);
          add('3010', plaster, 6, y, z, 90);
        }
        for (const x of [1, 14]) {
          add('3004', plaster, x, y, 8);
          for (const z of [11, 13]) add('3005', plaster, x, y, z);
        }
      } else {
        for (const z of [7, 14])
          for (const x of [2, 4, 6, 9, 11, 13]) add('3005', plaster, x, y, z);
        for (const x of [1, 14]) for (const z of [8, 11, 13]) add('3005', plaster, x, y, z);
      }
    }
    for (const z of [7, 14]) {
      add('6112', timber, 1, 23, z, 90);
      add('3004', timber, 13, 23, z, 90);
    }
    for (const x of [1, 14]) add('3009', timber, x, 23, 8);

    for (const x of [1, 4]) for (const z of [1, 4]) add('14716', stone, x, 8, z);
    for (const z of [1, 4]) add('3004', stone, 2, 8, z, 90);
    for (const x of [1, 4]) add('3004', stone, x, 8, 2);
    for (const y of [11, 14]) for (const x of [1, 4]) add('3005', stone, x, y, 3);
    for (const y of [17, 20]) {
      for (const z of [1, 4]) add('3010', y === 17 ? slate : stone, 1, y, z, 90);
      for (const x of [1, 4]) add('3004', stone, x, y, 2);
    }
    add('3031', slate, 1, 23, 1);
    for (const x of [1, 4])
      for (const z of [1, 4]) {
        add('3005', stone, x, 24, z);
        add('3070b', slate, x, 27, z);
      }
    add('3941', stone, 2, 24, 2);
    add('14769', slate, 2, 27, 2);

    for (let step = 0; step < 4; step++) {
      for (const x of [0, 4, 8, 12]) {
        add('3037', slate, x, 26 + step * 3, 6 + step);
        if (step === 2 && x === 12) add('3039', slate, x, 32, 12, 180);
        else add('3037', slate, x, 26 + step * 3, 14 - step, 180);
      }
    }
    for (const x of [0, 8]) add('3034', slate, x, 38, 10, 90);
    for (const x of [0, 4, 8, 12]) add('87079', slate, x, 39, 10, 90);
    for (const y of [32, 35, 38, 41]) add('3003', stone, 14, y, 13);
    add('3020', slate, 14, 44, 11);
    for (const x of [14, 15]) {
      for (const z of [11, 14]) add('3070b', stone, x, 45, z);
      add('3062b', timber, x, 45, 12);
      add('98138', slate, x, 48, 12);
    }

    for (const x of [3, 12]) {
      add('14716', stone, x, 1, 6);
      add('3024', stone, x, 10, 6);
      add('3023b', timber, x, 11, 6);
      add('3005', timber, x, 12, 6);
      add('6141', 2, x, 15, 6);
      add('98138', 4, x, 16, 6);
    }
    add('3941', stone, 5, 1, 3);
    for (const [x, z] of [
      [5, 3],
      [6, 4],
    ])
      add('3062b', timber, x, 4, z);
    add('3022', timber, 5, 7, 3);
    add('3039', timber, 5, 8, 3);
    add('3941', stone, 10, 1, 3);
    add('4032a', stone, 10, 4, 3);
    add('14769', 1, 10, 5, 3);
    add('3941', timber, 13, 1, 2);
    add('4032a', 0, 13, 4, 2);
    add('3941', timber, 13, 5, 2);
    add('14769', timber, 13, 8, 2);
    for (const x of [12, 14]) add('3062b', timber, x, 1, 5);
    add('3710', timber, 11, 4, 5, 90);
    add('2431', timber, 11, 5, 5, 90);
    add('3062b', timber, 15, 1, 1);
    add('6141', 2, 15, 4, 1);
    add('98138', 2, 15, 5, 1);
    for (const x of [1, 4, 10, 14]) add('3062b', timber, x, 1, 0);
    add('3666', timber, 1, 4, 0, 90);
    add('6636', timber, 1, 5, 0, 90);
    add('78329', timber, 10, 4, 0, 90);
    add('2431', timber, 10, 5, 0, 90);
    add('3070b', timber, 14, 5, 0);
    for (const z of [1, 4]) add('26603', slate, 7, 1, z);

    const reserved = [
      [1, 1, 4, 4],
      [5, 3, 2, 2],
      [10, 3, 2, 2],
      [13, 2, 2, 2],
      [11, 5, 4, 1],
      [15, 1, 1, 1],
      [3, 6, 1, 1],
      [12, 6, 1, 1],
      [7, 1, 2, 6],
    ];
    for (let x = 1; x < 16; x++)
      for (let z = 1; z < 7; z++) {
        if (
          !reserved.some(
            ([startX, startZ, width, depth]) =>
              x >= startX && x < startX + width && z >= startZ && z < startZ + depth,
          )
        )
          add('3070b', (x + z) % 3 === 0 ? slate : stone, x, 1, z);
      }
  },
};
