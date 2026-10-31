import type { ExampleDefinition } from './types.ts';

export const staggeredWall: ExampleDefinition = {
  id: 'staggered-wall',
  name: 'Staggered wall',
  tags: ['staggered-seams', 'multiple-supports', 'rotations'],
  expectedPieceCount: 15,
  build(add) {
    for (const x of [2, 8]) add('3795', 2, x, 0, 6, 90);
    for (const x of [2, 5, 8, 11]) add('3002', 15, x, 1, 6, 90);
    for (const x of [2, 6, 10]) add('3010', 14, x, 4, 6, 90);
    for (const x of [2, 8]) add('3009', 4, x, 7, 6, 90);
    add('60479', 1, 2, 10, 6, 90);
    add('6112', 15, 2, 11, 6, 90);
    for (const x of [2, 8]) add('69729', 1, x, 14, 6, 90);
  },
};
