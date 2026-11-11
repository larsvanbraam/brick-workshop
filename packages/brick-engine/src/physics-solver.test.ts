import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import highsLoader from 'highs';
import {
  EXAMPLES,
  assessPhysicalFeasibility,
  createExampleAssembly,
  createHighsSolver,
  evaluateAssemblyPolicy,
  primePhysicalAssessment,
  setLinearSolver,
} from './index.ts';
import type { Assembly, PhysicalOptions } from './index.ts';

const SMALL_EXAMPLES = EXAMPLES.filter((example) => example.expectedPieceCount < 2500);
const options: PhysicalOptions = { estimateMissingMasses: true };
// Assessments are cached by bricks array, so each solver gets its own copy.
const fresh = (assembly: Assembly): Assembly => structuredClone(assembly);
const overhang = (arms: number): Assembly => ({
  name: 'Overhang',
  bricks: [
    { id: 'plate', partId: '3867', color: 2, x: 0, y: 0, z: 0, rotation: 0 },
    { id: 'post', partId: '3003', color: 15, x: 4, y: 0.5, z: 4, rotation: 0 },
    ...Array.from({ length: arms }, (_, index) => ({
      id: `arm-${index}`,
      partId: '3008',
      color: 4,
      x: 4,
      y: 3.5 + 3 * index,
      z: 4,
      rotation: 90 as const,
    })),
  ],
});

describe('HiGHS static solver', () => {
  let highs: Awaited<ReturnType<typeof highsLoader>>;
  beforeAll(async () => {
    highs = await highsLoader();
  });
  afterAll(() => setLinearSolver(null));

  it.each([
    ...SMALL_EXAMPLES.map(({ id, name }) => ({ name, build: () => createExampleAssembly(id) })),
    { name: 'a holding overhang', build: () => overhang(8) },
    { name: 'an overloaded overhang', build: () => overhang(16) },
  ])('matches the built-in simplex on $name', ({ build }) => {
    const assembly = build();
    setLinearSolver(null);
    const simplex = assessPhysicalFeasibility(fresh(assembly), options);
    setLinearSolver(createHighsSolver(highs));
    const fast = assessPhysicalFeasibility(fresh(assembly), options);
    expect(fast).toMatchObject({
      status: simplex.status,
      gravity: simplex.gravity,
      connectionStrength: simplex.connectionStrength,
    });
    if (simplex.minimumStudTensionNewtons === null)
      expect(fast.minimumStudTensionNewtons).toBe(null);
    else expect(fast.minimumStudTensionNewtons).toBeCloseTo(simplex.minimumStudTensionNewtons, 6);
    expect(fast.overloadedConnections.length > 0).toBe(simplex.overloadedConnections.length > 0);
  });
});

describe('physical checks run elsewhere', () => {
  const tipping: Assembly = {
    name: 'Tipping',
    bricks: [
      { id: 'pedestal', partId: '3005', color: 4, x: 0, y: 0, z: 0, rotation: 0 },
      { id: 'arm', partId: '3010', color: 4, x: 0, y: 3, z: 0, rotation: 0 },
    ],
  };
  it('leaves the physical check out when asked to', () => {
    expect(evaluateAssemblyPolicy(fresh(tipping), { assessPhysics: false })).toMatchObject({
      allowed: true,
      physical: null,
    });
    expect(
      evaluateAssemblyPolicy(fresh(tipping), { assessPhysics: 'no' as never }).issues,
    ).toContainEqual(expect.objectContaining({ code: 'invalid_policy' }));
  });
  it('uses a primed assessment for the same assembly and options', () => {
    const stable: Assembly = { ...fresh(tipping), bricks: fresh(tipping).bricks.slice(0, 1) };
    const physical = { estimateMissingMasses: true };
    // Prime the stable build with the tipping build's report, as a worker's answer would arrive.
    const report = assessPhysicalFeasibility(fresh(tipping), physical);
    primePhysicalAssessment(stable, physical, report);
    expect(evaluateAssemblyPolicy(stable, { physical })).toMatchObject({
      allowed: false,
      issues: [expect.objectContaining({ code: 'physical_rejected' })],
    });
    // Other options are assessed afresh.
    expect(
      evaluateAssemblyPolicy(stable, { physical: { ...physical, useCatalogMasses: false } }),
    ).toMatchObject({ allowed: true });
  });
});
