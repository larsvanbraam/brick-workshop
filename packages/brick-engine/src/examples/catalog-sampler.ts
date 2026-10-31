import { PARTS } from '../core.ts';
import { createShowcase } from './showcase.ts';
import type { ExampleDefinition } from './types.ts';

const showcase = createShowcase(PARTS, 64, 0.5);

export const catalogSampler: ExampleDefinition = {
  id: 'catalog-sampler',
  name: 'Catalog sampler',
  buildArea: 64,
  tags: ['catalog-coverage', 'rotations', 'flat-display', 'all-supported-parts', 'foliage'],
  expectedPieceCount: showcase.length,
  build(add) {
    for (const placement of showcase) add(...placement);
  },
};
