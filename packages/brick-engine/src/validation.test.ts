import { describe, expect, it } from 'vite-plus/test';
import {
  DEFAULT_PART_COLOR_EVIDENCE,
  assessPhysicalFeasibility,
  EXAMPLES,
  FACINGS,
  INSERT_FRAME_PARTS,
  PARTS,
  createExampleAssembly,
  evaluateAssemblyPolicy,
  footprint,
  getBuildArea,
  previewPatch,
  validateAddition,
  validateAssembly,
} from './index.ts';
import type { Assembly, Brick, EditPolicy, Rotation } from './index.ts';

const policy: EditPolicy = {
  evidence: DEFAULT_PART_COLOR_EVIDENCE,
  requireObservedColors: false,
  rejectInfeasible: true,
  physical: { estimateMissingMasses: true, useCatalogMasses: true },
};

/** Validates from scratch: a fresh bricks array has no cached result. */
function fullValidation(assembly: Assembly, brick: Brick) {
  return validateAssembly({ ...assembly, bricks: [...assembly.bricks, brick] });
}

function random(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

/** Additions near existing pieces: on top, inside, floating, past the edge, or not valid at all. */
function candidates(assembly: Assembly, count: number, seed: number): Brick[] {
  const next = random(seed);
  const pick = <T>(values: readonly T[]) => values[Math.floor(next() * values.length)];
  const area = getBuildArea(assembly);
  const bricks: Brick[] = [];
  for (let index = 0; index < count; index += 1) {
    const base = pick(assembly.bricks);
    const part = pick(PARTS);
    const brick: Brick = {
      id: `candidate-${index}`,
      partId: part.id,
      color: base.color,
      x: Math.max(0, base.x + pick([-1, -0.5, 0, 0.5, 1])),
      y: base.y + footprint(base).height,
      z: Math.max(0, base.z + pick([-1, -0.5, 0, 0.5, 1])),
      rotation: pick([0, 90, 180, 270] as const),
    };
    const kind = index % 8;
    if (kind === 1) Object.assign(brick, { x: base.x, y: base.y, z: base.z });
    if (kind === 2) brick.y += 1;
    if (kind === 3) brick.x = area - 0.5;
    if (kind === 4) brick.color = -1;
    if (kind === 5) brick.y = 0;
    if (kind === 6) brick.facing = pick(FACINGS);
    if (kind === 7) brick.id = base.id;
    bricks.push(brick);
  }
  return bricks;
}

/** Pieces that nothing rests on or hangs from, taken out so they can be put back. */
function leaves(assembly: Assembly, count: number, seed: number) {
  const next = random(seed);
  const special = assembly.bricks.filter(
    (brick) => brick.facing || brick.partId in INSERT_FRAME_PARTS,
  );
  const pool = [...special.slice(0, count), ...assembly.bricks];
  const found: { base: Assembly; brick: Brick }[] = [];
  for (let attempt = 0; attempt < count * 4 && found.length < count; attempt += 1) {
    const brick =
      attempt < special.length && attempt < count
        ? pool[attempt]
        : assembly.bricks[Math.floor(next() * assembly.bricks.length)];
    const base = { ...assembly, bricks: assembly.bricks.filter((other) => other !== brick) };
    if (!validateAssembly(base).length) found.push({ base, brick });
  }
  return found;
}

function variations(brick: Brick): Brick[] {
  const turned = ((brick.rotation + 90) % 360) as Rotation;
  return [
    brick,
    { ...brick, x: brick.x + 0.5 },
    { ...brick, z: brick.z + 0.5 },
    { ...brick, y: brick.y + 1 },
    { ...brick, rotation: turned },
    ...(brick.facing
      ? [{ ...brick, facing: FACINGS[(FACINGS.indexOf(brick.facing) + 1) % 4] }]
      : []),
  ];
}

function expectSameAsFull(base: Assembly, brick: Brick) {
  const fast = validateAddition(base, brick);
  const full = fullValidation(base, brick);
  if (fast) expect(fast.issues).toEqual(full);
  return fast;
}

describe('validating one added piece', () => {
  for (const example of EXAMPLES) {
    it(`matches full validation for ${example.id}`, () => {
      const assembly = createExampleAssembly(example.id);
      const large = assembly.bricks.length > 5000;
      const codes = new Set<string>();
      let checked = 0;
      const check = (base: Assembly, brick: Brick) => {
        const added = expectSameAsFull(base, brick);
        if (!added) return;
        checked += 1;
        codes.add(added.issues[0]?.code ?? 'ok');
      };
      for (const brick of candidates(assembly, large ? 16 : 80, 7)) check(assembly, brick);
      for (const { base, brick } of leaves(assembly, large ? 2 : 12, 11))
        for (const variation of variations(brick)) check(base, variation);
      expect(checked).toBeGreaterThan(0);
      expect([...codes].sort()).toEqual(['collision', 'invalid', 'ok', 'unsupported']);
    }, 60_000);
  }

  it('matches full validation across a run of additions', () => {
    // The upper courses go back one by one, each checked against the index derived from the last.
    const example = createExampleAssembly('nordiska-museet');
    const upper = example.bricks
      .filter((brick) => brick.y >= 12)
      .toSorted(
        (first, second) => Number(!!first.facing) - Number(!!second.facing) || first.y - second.y,
      );
    let assembly: Assembly = { ...example, bricks: example.bricks.filter((brick) => brick.y < 12) };
    expect(validateAssembly(assembly)).toEqual([]);
    const strays = candidates(example, upper.length, 3);
    let placed = 0;
    for (const [index, brick] of upper.entries()) {
      if (index % 25 === 0) expectSameAsFull(assembly, strays[index]);
      const added = expectSameAsFull(assembly, brick);
      if (added && !added.issues.length) {
        assembly = added.assembly;
        placed += 1;
      }
    }
    expect(placed).toBeGreaterThan(upper.length * 0.9);
    // The index derived from all those additions agrees with one built from scratch.
    expect(validateAssembly(assembly)).toEqual([]);
    expect(validateAssembly({ ...assembly, bricks: [...assembly.bricks] })).toEqual([]);
  }, 60_000);

  it('keeps patch previews identical', () => {
    for (const id of ['courtyard-house', 'nordiska-museet']) {
      const assembly = createExampleAssembly(id);
      for (const brick of candidates(assembly, 24, 5)) {
        const result = previewPatch(
          assembly,
          { operations: [{ type: 'add', brick }] },
          { policy, revision: 3 },
        );
        if (assembly.bricks.some((other) => other.id === brick.id)) {
          expect(result).toMatchObject({ ok: false, error: { code: 'duplicate_id' } });
          continue;
        }
        const next = {
          ...assembly,
          bricks: [...assembly.bricks.map((other) => ({ ...other })), { ...brick }],
        };
        const assessment = evaluateAssemblyPolicy(next, policy);
        if (assessment.allowed)
          expect(result).toEqual({ ok: true, revision: 3, assembly: next, assessment });
        else
          expect(result).toEqual({
            ok: false,
            revision: 3,
            error: {
              code: assessment.issues[0].code,
              message: assessment.issues[0].message,
              issues: assessment.issues[0].details,
            },
            assessment,
          });
      }
    }
  });

  it('matches full validation for arch infills and upside-down casements', () => {
    const at = (id: string, partId: string, x: number, y: number, rotation: Rotation = 90) =>
      ({ id, partId, color: 70, x, y, z: 0, rotation }) as Brick;
    const window: Assembly = {
      name: 'Window heads',
      bricks: [
        at('jamb-0', '3005', 0, 0),
        at('jamb-5', '3005', 5, 0),
        at('frame-1', '60592', 1, 0),
        at('frame-3', '60592', 3, 0),
        at('post-0', '3005', 0, 3),
        at('post-5', '3005', 5, 3),
        at('fanlight', '20309', 1, 6),
      ],
    };
    for (const arch of [at('arch', '15254', 0, 6), at('arch', '3307', 0, 6)])
      expect(validateAddition(window, arch)?.issues).toEqual(fullValidation(window, arch));
    const frame: Assembly = {
      name: 'Casements',
      bricks: [
        at('sill', '3010', 0, 0),
        at('frame', '60594', 0, 3),
        at('left', '60608', 2, 3),
      ],
    };
    for (const pane of [
      { ...at('right', '60608', 0, 3), upsideDown: true as const },
      at('right', '60608', 0, 3),
    ])
      expect(validateAddition(frame, pane)?.issues).toEqual(fullValidation(frame, pane));
    expect(fullValidation(frame, { ...at('right', '60608', 0, 3), upsideDown: true })).toEqual([]);
  });
  it('falls back when the assembly is invalid', () => {
    const assembly = createExampleAssembly('courtyard-house');
    const [first] = assembly.bricks;
    const invalid = { ...assembly, bricks: [...assembly.bricks, { ...first, id: 'clash' }] };
    expect(validateAddition(invalid, { ...first, id: 'other', y: 300 })).toBeNull();
  });
});

describe('physical assessment cache', () => {
  it('hands out copies that match a fresh assessment', () => {
    const assembly = createExampleAssembly('courtyard-house');
    const options = { data: { version: 1 as const, parts: {} }, estimateMissingMasses: true };
    const first = assessPhysicalFeasibility(assembly, options);
    first.reasons.push('changed by the caller');
    const second = assessPhysicalFeasibility(assembly, options);
    expect(second).not.toBe(first);
    expect(second).toEqual(
      assessPhysicalFeasibility({ ...assembly, bricks: [...assembly.bricks] }, options),
    );
    expect(
      assessPhysicalFeasibility(assembly, { ...options, estimateMissingMasses: false }),
    ).toEqual(
      assessPhysicalFeasibility(
        { ...assembly, bricks: [...assembly.bricks] },
        {
          ...options,
          estimateMissingMasses: false,
        },
      ),
    );
  });
});
