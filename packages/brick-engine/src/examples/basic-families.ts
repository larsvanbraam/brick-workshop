import { getPart } from '../core.ts';
import { createShowcase } from './showcase.ts';
import type { ExampleDefinition } from './types.ts';

const showcase = createShowcase(
  [
    '91405',
    '2453b',
    '3245c',
    '6111',
    '3007',
    '3040b',
    '3039',
    '3038',
    '3037',
    '3941',
    '14769',
    '3062b',
    '6141',
    '98138',
    '3031',
    '1751',
    '6636',
    '4162',
  ].map(getPart),
  64,
);

export const basicFamilies: ExampleDefinition = {
  id: 'basic-families',
  name: 'Basic families',
  tags: ['tall-bricks', 'slopes', 'round-parts', 'large-plates', 'tiles', 'flat-display'],
  buildArea: 64,
  expectedPieceCount: 18,
  build(add) {
    for (const placement of showcase) add(...placement);
  },
};
