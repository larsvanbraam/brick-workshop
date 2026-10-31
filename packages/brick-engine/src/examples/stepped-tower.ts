import type { ExampleDefinition } from './types.ts';

export const steppedTower: ExampleDefinition = {
  id: 'stepped-tower',
  name: 'Stepped tower',
  tags: ['alternate-supports', 'plate-transitions', 'layered-stack'],
  expectedPieceCount: 24,
  build(add) {
    for (const x of [4, 6, 8]) add('3795', 2, x, 0, 4);
    for (const x of [4, 6, 8]) for (const z of [4, 7]) add('3002', 14, x, 1, z);
    for (const x of [5, 7]) for (const z of [5, 7]) add('3022', 1, x, 4, z);
    for (const x of [5, 7]) for (const z of [5, 7]) add('3003', 15, x, 5, z);
    add('3031', 1, 5, 8, 5);
    add('3003', 4, 6, 9, 6);
    add('3024', 1, 6, 12, 6);
    add('2453b', 14, 6, 13, 6);
    add('3024', 15, 6, 28, 6);
    add('3062b', 14, 6, 29, 6);
    add('98138', 15, 6, 32, 6);
  },
};
