import { PARTS } from '../core.ts';
import { createShowcase } from './showcase.ts';
import type { ExampleDefinition } from './types.ts';

const showcase = createShowcase(
  PARTS.filter((part) => !part.family || ['tall', 'slope', 'round'].includes(part.family)),
  64,
);

export const catalogSampler: ExampleDefinition = {
  id: 'catalog-sampler',
  name: 'Catalog sampler',
  buildArea: 64,
  tags: ['catalog-coverage', 'rotations', 'flat-display', 'all-basic-families'],
  expectedPieceCount: showcase.length,
  build(add) {
    for (const placement of showcase) add(...placement);
  },
};
