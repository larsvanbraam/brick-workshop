import { PARTS } from '../core.ts';
import { createShowcase } from './showcase.ts';
import type { ExampleDefinition } from './types.ts';

const showcase = createShowcase(
  PARTS.filter((part) => part.kind === 'tile'),
  64,
);

export const tileFinishes: ExampleDefinition = {
  id: 'tile-finishes',
  name: 'Tile finishes',
  buildArea: 64,
  tags: ['tiles', 'smooth-tops', 'flat-display', 'rotations'],
  expectedPieceCount: showcase.length,
  build(add) {
    for (const placement of showcase) add(...placement);
  },
};
