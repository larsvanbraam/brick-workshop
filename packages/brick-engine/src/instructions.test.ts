import { describe, expect, it } from 'vite-plus/test';
import {
  EXAMPLES,
  createExampleAssembly,
  footprint,
  planInstructionSteps,
  validateAssembly,
} from './index.ts';
import type { Assembly, Brick } from './index.ts';

const brick = (id: string, partId: string, x: number, y: number, z: number): Brick => ({
  id,
  partId,
  color: 4,
  x,
  y,
  z,
  rotation: 0,
});

/** The large museum takes too long to check piece by piece, so these tests use the smaller builds. */
const SMALL_EXAMPLES = EXAMPLES.filter((example) => example.expectedPieceCount < 2500);

describe('planInstructionSteps', () => {
  it.each(SMALL_EXAMPLES.map((example) => example.id))(
    'orders every piece of %s once, with each stage valid and buildable',
    (id) => {
      const assembly = createExampleAssembly(id);
      const steps = planInstructionSteps(assembly);
      const byId = new Map(assembly.bricks.map((entry) => [entry.id, entry]));
      const order = steps.flatMap((step) => step.brickIds);
      expect(order.toSorted()).toEqual(assembly.bricks.map((entry) => entry.id).toSorted());
      const placed: Brick[] = [];
      for (const [index, step] of steps.entries()) {
        expect(step.number).toBe(index + 1);
        expect(step.brickIds.length).toBeLessThanOrEqual(6);
        expect(step.parts.length).toBeLessThanOrEqual(4);
        expect(step.parts.reduce((sum, part) => sum + part.quantity, 0)).toBe(step.brickIds.length);
        const added = step.brickIds.map((brickId) => byId.get(brickId)!);
        // A step's pieces share one height, so none of them covers another.
        expect(new Set(added.map((entry) => entry.y)).size).toBe(1);
        placed.push(...added);
        expect(validateAssembly({ ...assembly, bricks: placed })).toEqual([]);
      }
    },
    20_000,
  );

  it('places a piece only after everything it rests on', () => {
    const assembly = createExampleAssembly(EXAMPLES[0].id);
    const stepOf = new Map(
      planInstructionSteps(assembly).flatMap((step) =>
        step.brickIds.map((brickId) => [brickId, step.number] as const),
      ),
    );
    for (const upper of assembly.bricks)
      for (const lower of assembly.bricks) {
        const upperSize = footprint(upper);
        const lowerSize = footprint(lower);
        if (
          lower.y + lowerSize.height === upper.y &&
          upper.x < lower.x + lowerSize.width &&
          lower.x < upper.x + upperSize.width &&
          upper.z < lower.z + lowerSize.depth &&
          lower.z < upper.z + upperSize.depth
        )
          expect(stepOf.get(lower.id)!).toBeLessThan(stepOf.get(upper.id)!);
      }
  });

  it('keeps steps small, nearby and grouped by part', () => {
    const assembly: Assembly = {
      name: 'Rows',
      bricks: [
        ...[0, 2, 4, 6, 8, 10].map((x) => brick(`near-${x}`, '3003', x, 0, 0)),
        brick('far', '3003', 14, 0, 14),
      ],
    };
    const steps = planInstructionSteps(assembly, { maxPiecesPerStep: 4, maxStepSpread: 2 });
    expect(steps.map((step) => step.brickIds)).toEqual([
      ['near-0', 'near-2', 'near-4', 'near-6'],
      ['near-8', 'near-10'],
      ['far'],
    ]);
    expect(steps[0].parts).toEqual([{ partId: '3003', color: 4, quantity: 4 }]);
  });

  it('finishes a freestanding stack before moving away', () => {
    const assembly: Assembly = {
      name: 'Stack',
      bricks: [
        brick('base', '3003', 0, 0, 0),
        brick('middle', '3003', 0, 3, 0),
        brick('top', '3003', 0, 6, 0),
        brick('away', '3003', 12, 0, 12),
      ],
    };
    expect(planInstructionSteps(assembly).map((step) => step.brickIds)).toEqual([
      ['base'],
      ['middle'],
      ['top'],
      ['away'],
    ]);
  });

  it('refuses invalid assemblies and limits', () => {
    expect(() =>
      planInstructionSteps({ name: 'Floating', bricks: [brick('a', '3003', 0, 3, 0)] }),
    ).toThrow('valid assembly');
    expect(() =>
      planInstructionSteps({ name: 'Empty', bricks: [] }, { maxPiecesPerStep: 0 }),
    ).toThrow('positive whole numbers');
  });
});
