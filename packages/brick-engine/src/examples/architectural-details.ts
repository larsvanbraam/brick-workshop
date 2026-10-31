import { PARTS } from '../core.ts';
import { createShowcase } from './showcase.ts';
import type { ExampleDefinition } from './types.ts';

const showcase = createShowcase(
  PARTS.filter(
    (part) => part.family && ['arch', 'baseplate', 'cone', 'door', 'window'].includes(part.family),
  ),
  64,
);

export const architecturalDetails: ExampleDefinition = {
  id: 'architectural-details',
  name: 'Architectural details',
  tags: ['arches', 'baseplates', 'cones', 'doors', 'windows', 'flat-display'],
  buildArea: 64,
  expectedPieceCount: 20,
  build(add) {
    for (const placement of showcase) add(...placement);
  },
};
