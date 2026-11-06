import { describe, expect, it } from 'vite-plus/test';
import {
  PARTS,
  BUILDING_TECHNIQUE_IDS,
  createBuildingTechniqueExample,
  getBuildingTechniques,
  applyPatch,
  previewPatch,
  evaluateAssemblyPolicy,
  importAssembly,
  CATALOG_PART_MASSES,
  assessPhysicalFeasibility,
  getBuildabilityReport,
  getEngineCapabilities,
  getPartCapabilities,
  importPhysicalData,
  EXAMPLES,
  createDemoAssembly,
  createExampleAssembly,
  createExampleRegistry,
  exportLDraw,
  footprint,
  getBillOfMaterials,
  getConnectionSites,
  getLDrawTransform,
  getPart,
  hasStudConnection,
  explainConnection,
  findPlacementCandidates,
  placeBrick,
  registerPart,
  removeBrick,
  resizeBuildArea,
  validateAssembly,
  MAX_BUILD_AREA,
  MAX_HEIGHT,
  MAX_PIECES,
} from './index';
import type { Assembly, Brick, ExampleDefinition } from './index';
import { parseLDrawColors } from './colors.ts';
import { getPartColorStatus, importPartColorEvidence } from './part-colors.ts';
import { COLORS, DEFAULT_PART_COLOR_EVIDENCE } from './index.ts';

const empty: Assembly = { name: 'Test', bricks: [] };
const base: Brick = { id: 'base', partId: '3001', color: 4, x: 0, y: 0, z: 0, rotation: 0 };
const architecturalExpansionIds = [
  '3193a',
  '3192a',
  '60616a',
  '60623',
  '98283',
  '15533',
  '2877',
  '4216',
  '30136',
  '30137',
  '4070',
  '2357',
  '87087',
  '11211',
  '30414',
  '22885',
  '2412b',
  '3794b',
  '87580',
  '25269',
  '24246',
  '60581',
  '59349',
  '3185',
  '3633',
  '33303',
  '30055',
  '4286',
  '3298',
  '4161',
  '3297',
  '30363',
  '4460b',
  '3678b',
  '3660a',
  '3665a',
  '3747b',
  '54200',
  '85984',
  '35464',
  '11477',
  '15068',
  '50950',
  '6091',
  '60474',
  '4150',
  '18674',
  '3470',
  '3471',
  '6064',
  '30093',
  '2417',
  '32607',
  '24866',
  '4727',
  '30176',
  '6255',
  '3308',
  '92950',
  '4035',
  '60601',
  '60602',
  '86210',
  '2494',
];

describe('connection-aware placement planning', () => {
  it('reports engine-owned insert rules and honest physics coverage', () => {
    expect(getPartCapabilities('60602')).toMatchObject({
      matchingInsertFrameId: '60593',
      contactPhysics: 'not-assessed',
    });
    const capabilities = getEngineCapabilities({
      ...empty,
      bricks: [{ ...base, partId: '3942c' }],
    });
    expect(capabilities.staticGravity).toEqual({
      maxPieces: 200,
      maxContactVariables: 4000,
      withinPieceLimit: true,
      unsupportedPartIds: ['3942c'],
      unknownConnectorPartIds: [],
      certification: 'not-certified',
    });
    expect(capabilities.placementSearch.inserts).toBe('not-enumerated');
    const part = getPartCapabilities('3001');
    part.connections.topStuds = [];
    expect(getPart('3001').connections.topStuds).toHaveLength(8);
  });

  it('returns only valid stud-aligned placements without changing the assembly', () => {
    const assembly = { ...empty, bricks: [base] };
    const before = structuredClone(assembly);
    const result = findPlacementCandidates(assembly, { partId: '3005', color: 4 });
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const { brick, connection } of result.candidates) {
      expect(placeBrick(assembly, brick).ok).toBe(true);
      expect(brick.y).toBe(3);
      expect(connection.studSupports).toEqual([
        { brickId: 'base', sites: getConnectionSites(brick, 'bottom') },
      ]);
      expect(connection.strength).toBe('unknown');
    }
    expect(assembly).toEqual(before);
    expect(findPlacementCandidates(assembly, { partId: '3005', color: 4 })).toEqual(result);
  });

  it('does not invent support on tiles and preserves half-stud cone mounts', () => {
    const tile = { ...base, partId: '87079' };
    expect(
      findPlacementCandidates({ ...empty, bricks: [tile] }, { partId: '3005', color: 4 })
        .candidates,
    ).toEqual([]);
    const cone = { ...base, partId: '3942c' };
    const result = findPlacementCandidates(
      { ...empty, bricks: [cone] },
      {
        partId: '6141',
        color: 4,
        rotations: [0],
        supportId: base.id,
      },
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].brick).toMatchObject({ x: 0.5, y: 6, z: 0.5 });
  });

  it('bounds searches and distinguishes truncation from an exhausted search', () => {
    expect(
      findPlacementCandidates(empty, { partId: '3005', color: 4, maxCandidates: 1 }),
    ).toMatchObject({
      checked: 1,
      truncated: true,
      candidates: [expect.anything()],
    });
    expect(
      findPlacementCandidates(empty, { partId: '3005', color: 4, maxChecks: 1 }),
    ).toMatchObject({ checked: 1, truncated: true });
    expect(() =>
      findPlacementCandidates(empty, { partId: '3005', color: 4, supportId: 'missing' }),
    ).toThrow('Support piece not found');
    expect(() =>
      findPlacementCandidates(empty, { partId: '3005', color: 4, maxChecks: 0 }),
    ).toThrow('Invalid placement search');
    expect(() =>
      findPlacementCandidates(
        { ...empty, bricks: [{ ...base, y: 3 }] },
        { partId: '3005', color: 4 },
      ),
    ).toThrow('Resolve assembly geometry');
  });

  it('finds collision-free candidates for rotated supports without reusing existing IDs', () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      const support = { ...base, id: 'candidate', rotation, x: 2, z: 2 };
      const cap = { ...base, id: 'cap', partId: '3005', x: 2, z: 2, y: 3 };
      const assembly = { ...empty, bricks: [support, cap] };
      const result = findPlacementCandidates(assembly, {
        partId: '3023b',
        color: 4,
        supportId: support.id,
      });
      expect(result.candidates.length).toBeGreaterThan(0);
      const positions = result.candidates.map(
        ({ brick }) => `${brick.x}:${brick.y}:${brick.z}:${brick.rotation}`,
      );
      expect(new Set(positions).size).toBe(positions.length);
      for (const { brick } of result.candidates) {
        expect(brick.id).not.toBe(support.id);
        expect(placeBrick(assembly, brick).ok).toBe(true);
      }
    }
  });

  it('explains reviewed insert connections using the validator mapping', () => {
    const support = { ...base, partId: '3001' };
    const frame: Brick = { ...base, id: 'frame', partId: '3579', y: 3, z: 1, rotation: 90 };
    const door: Brick = { ...base, id: 'door', partId: '3193a', y: 3, z: 0.5, rotation: 90 };
    expect(explainConnection({ ...empty, bricks: [support, frame] }, door)).toMatchObject({
      insertFrames: ['frame'],
      issues: [],
    });
  });

  it('explains missing and existing support without treating fit as strength', () => {
    expect(explainConnection(empty, { ...base, y: 3 })).toMatchObject({
      grounded: false,
      studSupports: [],
      issues: [expect.objectContaining({ code: 'unsupported' })],
      strength: 'unknown',
    });
    expect(explainConnection({ ...empty, bricks: [base] }, base)).toMatchObject({
      grounded: true,
      issues: [],
    });
  });
});

describe('catalogue-reported weights', () => {
  it('covers reviewed catalogue entries with validated immutable source records', () => {
    expect(Object.keys(CATALOG_PART_MASSES)).toHaveLength(105);
    expect(
      new Set(PARTS.filter((part) => !CATALOG_PART_MASSES[part.id]).map((part) => part.id)),
    ).toEqual(new Set(['39266', ...architecturalExpansionIds]));
    expect(
      Object.keys(CATALOG_PART_MASSES).every((id) => PARTS.some((part) => part.id === id)),
    ).toBe(true);
    expect(importPhysicalData({ version: 1, parts: CATALOG_PART_MASSES }).parts).toEqual(
      CATALOG_PART_MASSES,
    );
    expect(Object.isFrozen(CATALOG_PART_MASSES)).toBe(true);
    for (const mass of Object.values(CATALOG_PART_MASSES)) {
      expect(mass.massGrams).toBeGreaterThan(0);
      expect(mass.kind).toBe('catalog');
      expect(mass.catalog?.retrievedAt).toBe('2026-10-31');
      expect(Object.isFrozen(mass)).toBe(true);
      expect(Object.isFrozen(mass.catalog)).toBe(true);
    }
    for (const [partId, catalogPartId] of [
      ['3023b', '3023'],
      ['3070b', '3070'],
      ['3069b', '3069'],
      ['3068b', '3068'],
    ])
      expect(CATALOG_PART_MASSES[partId].catalog?.partId).toBe(catalogPartId);
    const massSample: Assembly = {
      name: 'Catalog mass sample',
      bricks: [
        base,
        { ...base, id: 'plate', partId: '3023b', x: 3 },
        { ...base, id: 'tile', partId: '87079', x: 5 },
      ],
    };
    const report = assessPhysicalFeasibility(massSample);
    expect(report.massBasis).toBe('catalog');
    expect(report.missingMassPartIds).toEqual([]);
    expect(report.totalMassGrams).toBeCloseTo(
      massSample.bricks.reduce(
        (total, brick) => total + CATALOG_PART_MASSES[brick.partId].massGrams,
        0,
      ),
      8,
    );
  });
  it('uses published masses by default without treating them as independently measured', () => {
    const assessment = assessPhysicalFeasibility({ ...empty, bricks: [base] });
    expect(assessment).toMatchObject({
      massBasis: 'catalog',
      totalMassGrams: 2.32,
      gravity: 'balanced',
      status: 'unknown',
    });
    const report = getBuildabilityReport(assessment);
    expect(report.certified).toBe(false);
    expect(report.checks.find((check) => check.id === 'mass')?.status).toBe('reported');
    expect(CATALOG_PART_MASSES['3005'].massGrams).toBe(0.44);
    expect(CATALOG_PART_MASSES['87079'].massGrams).toBe(0.9);
  });
  it('lets host-supplied measurements override the catalogue and supports explicit opt-out', () => {
    const build = { ...empty, bricks: [base] };
    expect(
      assessPhysicalFeasibility(build, {
        data: {
          version: 1,
          parts: {
            '3001': { massGrams: 2.4, kind: 'measured', source: 'Synthetic measurement fixture.' },
          },
        },
      }),
    ).toMatchObject({ totalMassGrams: 2.4, massBasis: 'measured' });
    expect(assessPhysicalFeasibility(build, { useCatalogMasses: false })).toMatchObject({
      massBasis: 'missing',
      totalMassGrams: null,
    });
    expect(
      assessPhysicalFeasibility(build, { useCatalogMasses: false, estimateMissingMasses: true })
        .massBasis,
    ).toBe('estimated');
    const mixed = assessPhysicalFeasibility(
      { ...empty, bricks: [base, { ...base, id: 'upper', partId: '3005', y: 3 }] },
      {
        data: {
          version: 1,
          parts: {
            '3001': { massGrams: 2.4, kind: 'measured', source: 'Synthetic measurement fixture.' },
          },
        },
      },
    );
    expect(mixed).toMatchObject({ massBasis: 'mixed', totalMassGrams: 2.84 });
    expect(getBuildabilityReport(mixed).checks.find((check) => check.id === 'mass')?.status).toBe(
      'reported',
    );
  });
  it('validates catalogue provenance without allowing credentials or mismatched identifiers', () => {
    const mass = CATALOG_PART_MASSES['3001'];
    expect(importPhysicalData({ version: 1, parts: { '3001': mass } }).parts['3001']).toEqual(mass);
    for (const catalog of [
      undefined,
      { ...mass.catalog, retrievedAt: '2026-02-30' },
      { ...mass.catalog, partId: '3005' },
      { ...mass.catalog, partId: '3005', url: CATALOG_PART_MASSES['3005'].catalog!.url },
      { ...mass.catalog, url: `${mass.catalog!.url}&token=secret` },
      {
        ...mass.catalog,
        url: 'https://user:password@www.bricklink.com/v2/catalog/catalogitem.page?P=3001',
      },
    ]) {
      expect(() =>
        importPhysicalData({ version: 1, parts: { '3001': { ...mass, catalog } } }),
      ).toThrow();
    }
    expect(() =>
      importPhysicalData({
        version: 1,
        parts: {
          '3001': {
            ...mass,
            kind: 'measured',
            catalog: { ...mass.catalog, url: 'javascript:alert(1)' },
          },
        },
      }),
    ).toThrow();
  });
});

describe('physical feasibility', () => {
  const measured = (massGrams: number) => ({
    massGrams,
    kind: 'measured' as const,
    source: 'Synthetic test fixture, not real part data.',
  });
  const pedestal: Brick = { ...base, id: 'pedestal', partId: '3005', y: 3 };
  const arm: Brick = { ...base, id: 'arm', partId: '3010', y: 6 };
  const cantilever: Assembly = { name: 'Cantilever', bricks: [base, pedestal, arm] };
  const data = {
    version: 1 as const,
    parts: { '3001': measured(10), '3005': measured(1), '3010': measured(1) },
  };

  it('never promotes estimated balance to certified buildability', () => {
    const report = getBuildabilityReport(
      assessPhysicalFeasibility(
        { ...empty, bricks: [base] },
        { estimateMissingMasses: true, useCatalogMasses: false },
      ),
    );
    expect(report).toMatchObject({
      status: 'not-certified',
      certified: false,
      label: 'Buildability not certified',
    });
    expect(report.checks.find((check) => check.id === 'geometry')?.status).toBe('passed');
    expect(report.checks.find((check) => check.id === 'mass')?.status).toBe('estimated');
    expect(report.checks.find((check) => check.id === 'gravity')?.status).toBe('estimated');
    expect(report.blockers).toContain('Physical validation');
  });
  it('requires measured centers and independent evidence even when masses and tensile limits are supplied', () => {
    const options = {
      data: {
        version: 1 as const,
        parts: { '3001': { ...measured(10), centerOfMassStuds: { x: 1, z: 2 } } },
        studConnection: {
          maxTensionPerStudNewtons: 1,
          safetyFactor: 2,
          source: 'Synthetic fixture.',
        },
      },
    };
    const assessment = assessPhysicalFeasibility({ ...empty, bricks: [base] }, options);
    const report = getBuildabilityReport(assessment);
    expect(report.certified).toBe(false);
    expect(
      report.checks
        .filter((check) => ['mass', 'centers', 'gravity', 'connections'].includes(check.id))
        .every((check) => check.status === 'passed'),
    ).toBe(true);
    expect(report.blockers).toEqual(
      expect.arrayContaining([
        'Body strength',
        'Construction sequence',
        'Disturbance resistance',
        'Independent evidence',
        'Physical validation',
      ]),
    );
    delete (options.data.parts['3001'] as { centerOfMassStuds?: unknown }).centerOfMassStuds;
    expect(
      getBuildabilityReport(
        assessPhysicalFeasibility({ ...empty, bricks: [base] }, options),
      ).checks.find((check) => check.id === 'gravity')?.status,
    ).toBe('estimated');
  });
  it('distinguishes failed geometry, failed physics and missing masses without claiming certainty', () => {
    const invalid = getBuildabilityReport(
      assessPhysicalFeasibility({ ...empty, bricks: [{ ...base, y: 3 }] }),
    );
    expect(invalid).toMatchObject({ status: 'failed', certified: false });
    expect(invalid.checks.find((check) => check.id === 'geometry')?.status).toBe('failed');
    const unstable = getBuildabilityReport(
      assessPhysicalFeasibility(
        {
          ...empty,
          bricks: [
            { ...pedestal, y: 0 },
            { ...arm, y: 3 },
          ],
        },
        { data },
      ),
    );
    expect(unstable.status).toBe('failed');
    expect(unstable.checks.find((check) => check.id === 'gravity')?.status).toBe('failed');
    const missing = getBuildabilityReport(
      assessPhysicalFeasibility({ ...empty, bricks: [base] }, { useCatalogMasses: false }),
    );
    expect(missing.checks.find((check) => check.id === 'mass')?.status).toBe('unknown');
    expect(missing.checks.find((check) => check.id === 'gravity')?.status).toBe('unknown');
    expect(getBuildabilityReport(assessPhysicalFeasibility(empty))).toMatchObject({
      certified: false,
      label: 'No build to assess',
    });
  });

  it('does not silently invent real part masses or certify empty/invalid builds', () => {
    expect(assessPhysicalFeasibility(empty).status).toBe('empty');
    expect(
      assessPhysicalFeasibility({ ...empty, bricks: [base] }, { useCatalogMasses: false }),
    ).toMatchObject({
      status: 'unknown',
      gravity: 'not-assessed',
      totalMassGrams: null,
      missingMassPartIds: ['3001'],
    });
    expect(assessPhysicalFeasibility({ ...empty, bricks: [{ ...base, y: 3 }] }).status).toBe(
      'invalid-geometry',
    );
  });
  it('balances a centered stack, accumulates weight and returns bottom-up insertion order', () => {
    const report = assessPhysicalFeasibility(
      { ...empty, bricks: [{ ...base, id: 'top', y: 3 }, base] },
      { data },
    );
    expect(report).toMatchObject({
      status: 'unknown',
      gravity: 'balanced',
      massBasis: 'measured',
      totalMassGrams: 20,
      centerOfMassStuds: { x: 1, z: 2 },
      assemblyOrder: ['base', 'top'],
      connectionStrength: 'unknown',
      minimumStudTensionNewtons: 0,
    });
    expect(report.connections[0].compressionNewtons).toBeCloseTo(0.0980665, 6);
  });
  it('detects local overhangs needing clutch even when the entire base prevents tipping', () => {
    expect(validateAssembly(cantilever)).toEqual([]);
    const report = assessPhysicalFeasibility(cantilever, { data });
    expect(report).toMatchObject({
      status: 'unknown',
      gravity: 'requires-clutch',
      connectionStrength: 'unknown',
    });
    expect(report.minimumStudTensionNewtons).toBeCloseTo(0.02941995, 6);
    expect(
      report.connections.find((contact) => contact.upperId === 'arm')!.tensionNewtons,
    ).toBeCloseTo(0.0196133, 6);
  });
  it('detects global tipping despite legal geometry and unlimited internal clutch', () => {
    const build = {
      ...empty,
      bricks: [
        { ...pedestal, y: 0 },
        { ...arm, y: 3 },
      ],
    };
    expect(validateAssembly(build)).toEqual([]);
    expect(assessPhysicalFeasibility(build, { data })).toMatchObject({
      status: 'infeasible',
      gravity: 'unstable',
      massBasis: 'measured',
    });
  });
  it('uses actual mass ratios rather than unweighted part centers', () => {
    const build = {
      ...empty,
      bricks: [
        { ...base, partId: '3003' },
        { ...arm, y: 3 },
      ],
    };
    const light = { ...data, parts: { ...data.parts, '3003': measured(10) } };
    const heavy = { ...light, parts: { ...light.parts, '3010': measured(30) } };
    expect(assessPhysicalFeasibility(build, { data: light }).gravity).toBe('balanced');
    expect(assessPhysicalFeasibility(build, { data: heavy }).gravity).toBe('balanced');
    const longer = { ...build, bricks: [build.bricks[0], { ...arm, partId: '3009', y: 3 }] };
    expect(
      assessPhysicalFeasibility(longer, {
        data: { ...light, parts: { ...light.parts, '3009': measured(1) } },
      }).gravity,
    ).toBe('requires-clutch');
    expect(
      assessPhysicalFeasibility(longer, {
        data: { ...light, parts: { ...light.parts, '3009': measured(30) } },
      }).gravity,
    ).toBe('unstable');
  });
  it('checks individual disconnected components instead of a misleading whole-build center', () => {
    const bad = [
      { ...pedestal, y: 0 },
      { ...arm, y: 3 },
    ];
    const build = { ...empty, bricks: [...bad, { ...base, id: 'distant', z: 10 }] };
    expect(assessPhysicalFeasibility(build, { data }).gravity).toBe('unstable');
  });
  it('checks supplied tension limits with safety factors without treating them as certification', () => {
    const connection = {
      maxTensionPerStudNewtons: 0.03,
      safetyFactor: 1,
      source: 'Synthetic test limit.',
    };
    expect(
      assessPhysicalFeasibility(cantilever, { data: { ...data, studConnection: connection } }),
    ).toMatchObject({ status: 'unknown', connectionStrength: 'within-supplied-limit' });
    expect(
      assessPhysicalFeasibility(cantilever, {
        data: { ...data, studConnection: { ...connection, safetyFactor: 2 } },
      }),
    ).toMatchObject({ status: 'infeasible', connectionStrength: 'exceeds-supplied-limit' });
  });
  it.each([0, 90, 180, 270] as const)(
    'handles rotated parts and preserves the input at %s degrees',
    (rotation) => {
      const build = {
        ...empty,
        bricks: [
          { ...base, rotation },
          { ...base, id: 'top', y: 3, rotation },
        ],
      };
      const before = structuredClone(build);
      expect(assessPhysicalFeasibility(build, { data }).gravity).toBe('balanced');
      expect(build).toEqual(before);
    },
  );
  it('labels optional solid-envelope estimates and never upgrades them to measured weights', () => {
    const report = assessPhysicalFeasibility(cantilever, {
      estimateMissingMasses: true,
      useCatalogMasses: false,
    });
    expect(report).toMatchObject({
      status: 'unknown',
      massBasis: 'estimated',
      gravity: 'requires-clutch',
    });
    expect(
      report.masses.every(({ mass }) => mass.source.includes('NOT an actual part weight')),
    ).toBe(true);
    expect(
      assessPhysicalFeasibility(cantilever, {
        estimateMissingMasses: true,
        useCatalogMasses: false,
        data: { version: 1, parts: { '3001': measured(10) } },
      }).massBasis,
    ).toBe('mixed');
  });
  it('validates physical inputs and retains independent copies', () => {
    const imported = importPhysicalData(data);
    imported.parts['3001'].massGrams = 1;
    expect(data.parts['3001'].massGrams).toBe(10);
    for (const massGrams of [0, -1, NaN, Infinity])
      expect(() =>
        importPhysicalData({ ...data, parts: { '3001': measured(massGrams) } }),
      ).toThrow();
    expect(() => importPhysicalData({ ...data, parts: { unknown: measured(1) } })).toThrow();
    expect(() =>
      importPhysicalData({ ...data, parts: { '3001': { ...measured(1), source: '' } } }),
    ).toThrow();
    expect(() =>
      importPhysicalData({
        ...data,
        parts: { '3001': { ...measured(1), centerOfMassStuds: { x: 3, z: 0 } } },
      }),
    ).toThrow();
    expect(() =>
      importPhysicalData({
        ...data,
        studConnection: { maxTensionPerStudNewtons: 1, safetyFactor: 0, source: 'Test' },
      }),
    ).toThrow();
    expect(() => importPhysicalData({ version: 1, parts: 1 })).toThrow();
    expect(() => importPhysicalData({ ...data, parts: { '3001': measured(1e300) } })).toThrow();
  });
  it('rotates a supplied asymmetric center of mass with the part', () => {
    const report = assessPhysicalFeasibility(
      { ...empty, bricks: [{ ...base, rotation: 90 }] },
      {
        data: {
          version: 1,
          parts: { '3001': { ...measured(10), centerOfMassStuds: { x: 0.25, z: 3 } } },
        },
      },
    );
    expect(report.centerOfMassStuds).toEqual({ x: 3, z: 1.75 });
  });
  it('keeps global tipping invariant under scale and reports conservative model limits', () => {
    const build = {
      ...empty,
      bricks: [
        { ...pedestal, y: 0 },
        { ...arm, y: 3 },
      ],
    };
    for (const scale of [0.01, 1, 100])
      expect(
        assessPhysicalFeasibility(build, {
          data: { version: 1, parts: { '3005': measured(scale), '3010': measured(scale) } },
        }).gravity,
      ).toBe('unstable');
    const large = {
      ...empty,
      bricks: Array.from({ length: 201 }, (_, index) => ({
        ...base,
        id: `ground-${index}`,
        partId: '3005',
        x: index % 16,
        z: Math.floor(index / 16),
      })),
    };
    expect(assessPhysicalFeasibility(large, { estimateMissingMasses: true })).toMatchObject({
      status: 'unknown',
      gravity: 'not-assessed',
    });
  });
});

describe('part/color inventory evidence', () => {
  const input = {
    version: 1,
    source: {
      provider: 'rebrickable',
      url: 'https://cdn.rebrickable.com/media/downloads/inventory_parts.csv.gz',
      retrievedAt: '2026-07-31T00:00:00Z',
      mappingNote: 'Synthetic test mappings, not production catalog data.',
    },
    mappings: { parts: { '3023b': '3023' }, colors: { '4': 999 } },
    observations: [{ partId: '3023', colorId: 999, inventoryId: 123 }],
  };
  it('requires explicit part and color mappings rather than assuming matching IDs', () => {
    const evidence = importPartColorEvidence(input);
    expect(getPartColorStatus('3023b', 4, evidence)).toMatchObject({
      rendering: 'recognized',
      manufactured: 'observed',
      stock: 'unknown',
      rebrickablePartId: '3023',
      rebrickableColorId: 999,
      inventoryId: 123,
    });
    expect(getPartColorStatus('3023b', 36, evidence)).toMatchObject({
      manufactured: 'unknown',
      reason: 'unmapped-color',
    });
    expect(getPartColorStatus('3001', 4, evidence)).toMatchObject({
      manufactured: 'unknown',
      reason: 'unmapped-part',
    });
  });
  it('does not treat recognized colors or absence of observations as manufacturing or stock proof', () => {
    expect(getPartColorStatus('3001', 36)).toMatchObject({
      rendering: 'recognized',
      manufactured: 'unknown',
      stock: 'unknown',
      reason: 'no-data',
    });
    expect(
      getPartColorStatus('3023b', 4, importPartColorEvidence({ ...input, observations: [] })),
    ).toMatchObject({ manufactured: 'unknown', reason: 'not-observed' });
    expect(getPartColorStatus('3001', 999999)).toMatchObject({
      rendering: 'unknown',
      manufactured: 'unknown',
    });
  });
  it('validates provenance, reserved color IDs, observations, and ambiguous mappings', () => {
    expect(() => importPartColorEvidence({ ...input, version: 2 })).toThrow('version');
    expect(() =>
      importPartColorEvidence({
        ...input,
        source: { ...input.source, url: 'https://example.com/data' },
      }),
    ).toThrow('Rebrickable');
    expect(() =>
      importPartColorEvidence({
        ...input,
        source: { ...input.source, url: 'https://rebrickable.com/api/?key=secret' },
      }),
    ).toThrow('credentials');
    expect(() =>
      importPartColorEvidence({ ...input, mappings: { ...input.mappings, colors: { '16': 999 } } }),
    ).toThrow('color mapping');
    expect(() =>
      importPartColorEvidence({
        ...input,
        mappings: { ...input.mappings, colors: { '4': 999, '36': 999 } },
      }),
    ).toThrow('ambiguous');
    expect(() =>
      importPartColorEvidence({
        ...input,
        observations: [{ partId: '3023', colorId: 999, inventoryId: 0 }],
      }),
    ).toThrow('inventory ID');
  });
  it('deduplicates observations and freezes copied input data', () => {
    const evidence = importPartColorEvidence({
      ...input,
      observations: [...input.observations, ...input.observations],
    });
    expect(evidence.observations).toHaveLength(1);
    expect(Object.isFrozen(evidence.mappings.colors)).toBe(true);
    expect(Object.isFrozen(evidence.observations[0])).toBe(true);
    expect(evidence.mappings.colors).not.toBe(input.mappings.colors);
  });
});

describe('LDraw color definitions', () => {
  it('accepts all official colors in placement, BOM, and LDraw export but rejects contextual IDs', () => {
    for (const color of COLORS) {
      const brick = { ...base, color: color.id };
      const assembly = { name: 'Color check', bricks: [brick] };
      expect(placeBrick({ name: 'Color check', bricks: [] }, brick).ok).toBe(true);
      expect(validateAssembly(assembly)).toEqual([]);
      expect(getBillOfMaterials(assembly)[0].color).toBe(color.id);
      expect(exportLDraw(assembly)).toContain(`1 ${color.id} `);
    }
    for (const color of [16, 24, 999999])
      expect(placeBrick({ name: 'Contextual color', bricks: [] }, { ...base, color }).ok).toBe(
        false,
      );
    expect(DEFAULT_PART_COLOR_EVIDENCE.observations).toHaveLength(562);
    expect(Object.keys(DEFAULT_PART_COLOR_EVIDENCE.mappings.parts)).toHaveLength(106);
    for (const part of PARTS)
      for (const color of [0, 1, 2, 4, 14, 15])
        expect(getPartColorStatus(part.id, color, DEFAULT_PART_COLOR_EVIDENCE).manufactured).toBe(
          DEFAULT_PART_COLOR_EVIDENCE.observations.some(
            (observation) =>
              observation.partId === DEFAULT_PART_COLOR_EVIDENCE.mappings.parts[part.id] &&
              observation.colorId === DEFAULT_PART_COLOR_EVIDENCE.mappings.colors[String(color)],
          )
            ? 'observed'
            : 'unknown',
        );
  });
  it('preserves color IDs, transparency, edges, finishes, and luminance', () => {
    const colors = parseLDrawColors(
      '0 !COLOUR Red CODE 4 VALUE #B40000 EDGE #333333\n0 !COLOUR Trans_Red CODE 36 VALUE #C91A09 EDGE #660D05 ALPHA 128\n0 !COLOUR Chrome_Blue CODE 61 VALUE #123456 EDGE 4 CHROME LUMINANCE 12',
    );
    expect(colors[0]).toEqual({
      id: 4,
      name: 'Red',
      hex: '#b40000',
      edge: '#333333',
      alpha: 255,
      luminance: 0,
      finish: 'solid',
    });
    expect(colors[1]).toMatchObject({ id: 36, name: 'Trans Red', alpha: 128 });
    expect(colors[2]).toMatchObject({ id: 61, edge: 4, finish: 'chrome', luminance: 12 });
  });
  it('excludes contextual codes and preserves detailed material definitions', () => {
    const colors = parseLDrawColors(
      '0 !COLOUR Main CODE 16 VALUE #FFFFFF EDGE #333333\n0 !COLOUR Edge CODE 24 VALUE #333333 EDGE #333333\n0 !COLOUR Glitter CODE 114 VALUE #123456 EDGE #333333 ALPHA 128 MATERIAL GLITTER VALUE #FFFFFF FRACTION 0.17 VFRACTION 0.2 SIZE 1',
    );
    expect(colors).toHaveLength(1);
    expect(colors[0]).toMatchObject({
      id: 114,
      finish: 'glitter',
      material: 'GLITTER VALUE #FFFFFF FRACTION 0.17 VFRACTION 0.2 SIZE 1',
    });
    expect(
      parseLDrawColors(
        '0 !COLOUR Cloth CODE 20000 VALUE #123456 EDGE #333333 MATERIAL FABRIC CANVAS',
      )[0],
    ).toMatchObject({ finish: 'fabric', material: 'FABRIC CANVAS' });
  });
  it('rejects malformed definitions and duplicate IDs', () => {
    expect(() =>
      parseLDrawColors('0 !COLOUR Broken CODE 4 VALUE #B40000 EDGE #333333 ALPHA 300'),
    ).toThrow('Invalid color');
    expect(() =>
      parseLDrawColors(
        '0 !COLOUR Red CODE 4 VALUE #B40000 EDGE #333333\n0 !COLOUR Other CODE 4 VALUE #000000 EDGE #333333',
      ),
    ).toThrow('Duplicate color');
  });
});

describe('architectural part families', () => {
  it('includes every architectural design in the complete catalogue sampler', () => {
    const assembly = createExampleAssembly('catalog-sampler');
    const architecturalParts = PARTS.filter(
      (part) =>
        part.clearance === 'reserved' ||
        ['arch', 'baseplate', 'cone', 'door', 'window', 'detail', 'foliage'].includes(
          part.family ?? '',
        ),
    );
    const included = assembly.bricks.filter((brick) =>
      architecturalParts.some((part) => part.id === brick.partId),
    );
    expect(included).toHaveLength(81);
    expect(new Set(included.map((brick) => brick.partId))).toEqual(
      new Set(architecturalParts.map((part) => part.id)),
    );
    expect(validateAssembly(assembly)).toEqual([]);
    expect(assembly.bricks.every((brick) => brick.y === 0)).toBe(true);
    expect(getPartColorStatus('3193a', 4).manufactured).toBe('unknown');
    expect(getPartColorStatus('3192a', 4).manufactured).toBe('unknown');
    expect(assessPhysicalFeasibility(assembly)).toMatchObject({
      gravity: 'not-assessed',
      status: 'unknown',
    });
  });
  it('mounts foliage on real underside sites without inventing canopy connections', () => {
    for (const part of PARTS.filter((part) => part.family === 'foliage')) {
      expect(getPartColorStatus(part.id, 2).manufactured).toBe('unknown');
      for (const rotation of [0, 90, 180, 270] as const) {
        const plant = { ...base, partId: part.id, id: 'plant', y: 3, rotation };
        const receiver = getConnectionSites(plant, 'bottom')[0];
        const support = { ...base, partId: '3005', x: receiver.x - 0.5, z: receiver.z - 0.5 };
        expect(placeBrick({ ...empty, bricks: [support] }, plant).ok, part.id).toBe(true);
        expect(
          placeBrick({ ...empty, bricks: [{ ...support, x: support.x + 0.5 }] }, plant).ok,
          part.id,
        ).toBe(false);
        expect(getLDrawTransform(plant).y).toBe(-24 - (part.ldrawBaseY ?? part.height * 8));
        expect(assessPhysicalFeasibility({ ...empty, bricks: [support, plant] }).status).toBe(
          'unknown',
        );
      }
    }
    const tree = { ...base, partId: '3470' };
    expect(getConnectionSites(tree, 'top')).toEqual([]);
    expect(
      placeBrick(
        { ...empty, bricks: [tree] },
        { ...base, id: 'inside-canopy', partId: '3005', x: 4, y: 6, z: 4 },
      ).ok,
    ).toBe(false);
  });
  it('supports half-stud detail mounting while excluding non-building figure designs', () => {
    for (const id of architecturalExpansionIds) expect(getPart(id).id).toBe(id);
    for (const id of ['970', '973', '3626b']) expect(() => getPart(id)).toThrow('Unknown part');
    expect(getPart('3794b').connections.topStuds).toEqual([{ x: 0, z: 0.5 }]);
    expect(getPart('87580').connections.topStuds).toEqual([{ x: 0.5, z: 0.5 }]);
    const jumper = { ...base, partId: '87580' };
    expect(
      placeBrick(
        { ...empty, bricks: [jumper] },
        { ...base, id: 'cap', partId: '3005', x: 0.5, y: 1, z: 0.5 },
      ).ok,
    ).toBe(true);
    expect(getPart('60474').connections.topStuds).toHaveLength(12);
  });
  it('uses real half-plate baseplates with no underside stud receivers', () => {
    const foundation = { ...base, partId: '3867' };
    expect(getPart('3867')).toMatchObject({ height: 0.5, family: 'baseplate' });
    expect(getConnectionSites(foundation, 'bottom')).toEqual([]);
    expect(
      placeBrick({ ...empty, bricks: [foundation] }, { ...base, id: 'upper', y: 0.5 }).ok,
    ).toBe(true);
    expect(placeBrick({ ...empty, bricks: [foundation] }, { ...base, id: 'upper', y: 1 }).ok).toBe(
      false,
    );
    expect(placeBrick({ ...empty, bricks: [base] }, { ...foundation, id: 'upper', y: 3 }).ok).toBe(
      false,
    );
    expect(placeBrick(empty, { ...base, x: 0.25 }).ok).toBe(false);
  });
  it('connects centred cone studs with half-stud offsets without inventing corner studs', () => {
    const cone = { ...base, partId: '3942c' };
    expect(getConnectionSites(cone, 'top')).toEqual([{ x: 1, y: 6, z: 1 }]);
    expect(
      placeBrick(
        { ...empty, bricks: [cone] },
        { ...base, id: 'cap', partId: '6141', x: 0.5, y: 6, z: 0.5 },
      ).ok,
    ).toBe(true);
    expect(
      placeBrick({ ...empty, bricks: [cone] }, { ...base, id: 'cap', partId: '6141', y: 6 }).ok,
    ).toBe(false);
    expect(getConnectionSites({ ...base, partId: '3943b' }, 'top')).toHaveLength(4);
    expect(getConnectionSites({ ...base, partId: '6233' }, 'top')).toHaveLength(4);
  });
  it('supports arch legs but never treats the opening as an underside receiver', () => {
    const support = { ...base, partId: '3005' };
    expect(
      placeBrick({ ...empty, bricks: [support] }, { ...base, id: 'arch', partId: '3659', y: 3 }).ok,
    ).toBe(true);
    expect(
      placeBrick(
        { ...empty, bricks: [{ ...support, z: 1 }] },
        { ...base, id: 'arch', partId: '3659', y: 3 },
      ).ok,
    ).toBe(false);
  });
  it('retains integral hinge studs and the two centre studs of modern frames', () => {
    expect(getConnectionSites({ ...base, partId: '3193a' }, 'top')).toEqual([
      { x: 0.5, y: 12, z: 0.5 },
    ]);
    expect(getConnectionSites({ ...base, partId: '60596' }, 'top')).toHaveLength(2);
    expect(getConnectionSites({ ...base, partId: '60594' }, 'top')).toHaveLength(2);
  });
  it('supports a window insert only when a matching frame holds it in place', () => {
    const support = { ...base, partId: '3004', rotation: 90 as const };
    const frame = { ...base, id: 'frame', partId: '60593', y: 3, rotation: 90 as const };
    const pane = { ...base, id: 'pane', partId: '60602', y: 3, rotation: 90 as const };
    expect(placeBrick({ ...empty, bricks: [support, frame] }, pane).ok).toBe(true);
    expect(placeBrick(empty, pane).ok).toBe(false);
    expect(placeBrick({ ...empty, bricks: [support, frame] }, { ...pane, z: 0.5 }).ok).toBe(false);
    expect(placeBrick({ ...empty, bricks: [support, frame] }, { ...pane, rotation: 270 }).ok).toBe(
      false,
    );
    // An old build's whole window sitting inside the frame comes back as the frame's glass.
    const legacy = { ...pane, partId: '4035', z: 0.5 };
    expect(
      importAssembly({ name: 'Legacy pane', bricks: [support, frame, legacy] }).bricks[2],
    ).toMatchObject({ partId: '60602', x: 0, z: 0 });
  });
  it('fits a door leaf into its matching door frame', () => {
    const support = { ...base, partId: '3001' };
    const frame = { ...base, id: 'door-frame', partId: '3579', y: 3, z: 1, rotation: 90 as const };
    const door = { ...base, id: 'door', partId: '3193a', y: 3, z: 0.5, rotation: 90 as const };
    expect(placeBrick({ ...empty, bricks: [support, frame] }, door).ok).toBe(true);
    expect(getLDrawTransform(door)).toMatchObject({ x: 10, y: -120, z: 30, rotation: 90 });
    const right = { ...door, partId: '3192a', z: 1 };
    expect(placeBrick({ ...empty, bricks: [support, frame] }, right).ok).toBe(true);
    expect(placeBrick({ ...empty, bricks: [support, frame] }, { ...right, z: 0.5 }).ok).toBe(false);
  });
  it('hangs 1 x 4 x 6 doors on the hinge pins at either end of their frame', () => {
    const support = { ...base, partId: '3001', rotation: 90 as const, x: 0, z: 0 };
    const frame = { ...base, id: 'door-frame', partId: '60596', y: 3, z: 1, rotation: 90 as const };
    const placed = { ...empty, bricks: [support, frame] };
    for (const partId of ['60616a', '60623']) {
      const door = { ...base, id: 'door', partId, y: 3, z: 0.5, rotation: 90 as const };
      expect(placeBrick(placed, door).ok, partId).toBe(true);
      expect(placeBrick(placed, { ...door, rotation: 270 }).ok, partId).toBe(true);
      expect(placeBrick(placed, { ...door, z: 1 }).ok, partId).toBe(false);
      expect(placeBrick({ ...empty, bricks: [support] }, door).ok, partId).toBe(false);
    }
  });
  it('swaps legacy 1 x 3 x 3 doors for the doors that fit 1 x 3 x 4 frames on import', () => {
    const support = { ...base, partId: '3001' };
    const frame = { ...base, id: 'frame', partId: '3579', y: 3, z: 1, rotation: 90 as const };
    const legacy = (partId: string) => ({
      name: 'Legacy doors',
      bricks: [support, frame, { ...base, id: 'door', partId, y: 3, z: 0.5, rotation: 90 }],
    });
    expect(importAssembly(legacy('801a')).bricks[2]).toMatchObject({ partId: '3193a', z: 0.5 });
    expect(importAssembly(legacy('802a')).bricks[2]).toMatchObject({ partId: '3192a', z: 1 });
  });
});

describe('basic part families', () => {
  it('connects tall bricks at their actual plate height, not at ordinary brick height', () => {
    const tall = { ...base, partId: '2453b' };
    expect(getPart(tall.partId)).toMatchObject({ height: 15, family: 'tall' });
    expect(
      placeBrick({ ...empty, bricks: [tall] }, { ...base, id: 'upper', partId: '3005', y: 15 }).ok,
    ).toBe(true);
    expect(
      placeBrick({ ...empty, bricks: [tall] }, { ...base, id: 'upper', partId: '3005', y: 3 }).ok,
    ).toBe(false);
  });
  it.each([0, 90, 180, 270] as const)(
    'limits slope studs to the high rear row at %s degrees',
    (rotation) => {
      const slope = { ...base, partId: '3039', rotation };
      const studs = getConnectionSites(slope, 'top');
      expect(studs).toHaveLength(2);
      for (const x of [0, 1])
        for (const z of [0, 1]) {
          const upper = { ...base, id: 'upper', partId: '3005', x, z, y: 3 };
          const rear =
            rotation === 0
              ? z === 1
              : rotation === 90
                ? x === 1
                : rotation === 180
                  ? z === 0
                  : x === 0;
          expect(placeBrick({ ...empty, bricks: [slope] }, upper).ok).toBe(rear);
        }
      const transform = getLDrawTransform(slope);
      const cosine = Math.round(Math.cos((rotation * Math.PI) / 180));
      const sine = Math.round(Math.sin((rotation * Math.PI) / 180));
      const corners = [-20, 20].flatMap((nativeX) =>
        [-30, 10].map((nativeZ) => ({
          x: transform.x + cosine * nativeX + sine * nativeZ,
          z: transform.z - sine * nativeX + cosine * nativeZ,
        })),
      );
      expect(Math.min(...corners.map((corner) => corner.x))).toBe(0);
      expect(Math.min(...corners.map((corner) => corner.z))).toBe(0);
      expect(Math.max(...corners.map((corner) => corner.x))).toBe(40);
      expect(Math.max(...corners.map((corner) => corner.z))).toBe(40);
    },
  );
  it.each(PARTS.filter((part) => part.shape))(
    'withholds rectangular contact physics for $id',
    (part) => {
      const assessment = assessPhysicalFeasibility(
        { ...empty, bricks: [{ ...base, partId: part.id }] },
        { estimateMissingMasses: true },
      );
      expect(assessment).toMatchObject({
        status: 'unknown',
        gravity: 'not-assessed',
        connectionStrength: 'unknown',
        minimumStudTensionNewtons: null,
      });
      expect(assessment.totalMassGrams).toBeGreaterThan(0);
      expect(assessment.reasons.join(' ')).toContain('contact surfaces');
      expect(
        getBuildabilityReport(assessment).checks.find((check) => check.id === 'gravity')?.status,
      ).toBe('unknown');
      const measured = assessPhysicalFeasibility(
        { ...empty, bricks: [{ ...base, partId: part.id }] },
        {
          data: {
            version: 1,
            parts: {
              [part.id]: {
                massGrams: 1,
                kind: 'measured',
                source: 'Synthetic regression fixture.',
              },
            },
          },
        },
      );
      expect(measured).toMatchObject({
        massBasis: 'measured',
        gravity: 'not-assessed',
        status: 'unknown',
        connectionStrength: 'unknown',
      });
    },
  );
});

describe('tile connections', () => {
  it.each(PARTS.filter((part) => part.kind === 'tile'))(
    'attaches $id underneath but provides no studs in any rotation',
    (part) => {
      for (const rotation of [0, 90, 180, 270] as const) {
        const tile = { ...base, id: 'tile', partId: part.id, y: 3, rotation };
        const size = footprint(tile);
        const support = {
          ...base,
          partId: '4204',
          rotation,
        };
        const assembly = { ...empty, bricks: [support, tile] };
        expect(validateAssembly(assembly)).toEqual([]);
        expect(getConnectionSites(tile, 'top')).toEqual([]);
        expect(getConnectionSites(tile, 'bottom')).toHaveLength(size.width * size.depth);
        expect(hasStudConnection(support, tile)).toBe(true);
        const upper = { ...base, id: 'upper', partId: '3024', y: 4 };
        expect(hasStudConnection(tile, upper)).toBe(false);
        expect(placeBrick(assembly, upper)).toMatchObject({
          ok: false,
          issues: [expect.objectContaining({ code: 'unsupported' })],
        });
        expect(removeBrick(assembly, support.id).ok).toBe(false);
        expect(removeBrick(assembly, tile.id).ok).toBe(true);
        expect(exportLDraw(assembly)).toContain(`${part.id}.dat`);
      }
    },
  );
  it('does not count a smooth tile as an alternate stud support', () => {
    const tile = { ...base, id: 'tile', partId: '3070b' };
    const plate = { ...base, id: 'plate', partId: '3024', x: 1 };
    const upper = { ...base, id: 'upper', partId: '3069b', y: 1, rotation: 90 as const };
    const assembly = { ...empty, bricks: [tile, plate, upper] };
    expect(validateAssembly(assembly)).toEqual([]);
    expect(hasStudConnection(tile, upper)).toBe(false);
    expect(hasStudConnection(plate, upper)).toBe(true);
    expect(removeBrick(assembly, tile.id).ok).toBe(true);
    expect(removeBrick(assembly, plate.id).ok).toBe(false);
  });
});

describe('upright brick engine', () => {
  it('matches brute-force support and collision results across half-unit grid bucket boundaries', () => {
    let seed = 104729;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let sample = 0; sample < 150; sample++) {
      const bricks = Array.from({ length: 25 }, (_, index) => {
        const part = PARTS[Math.floor(random() * PARTS.length)];
        const rotation = ([0, 90, 180, 270] as const)[Math.floor(random() * 4)];
        const size = footprint({ ...base, partId: part.id, rotation });
        return {
          ...base,
          id: `sample-${index}`,
          partId: part.id,
          rotation,
          x: Math.floor(random() * (16 - size.width) * 2) / 2,
          z: Math.floor(random() * (16 - size.depth) * 2) / 2,
          y: [0, 0.5, 1, 3, 6, 9, 15, 18][Math.floor(random() * 8)],
        };
      });
      const expected: [string, string][] = [];
      const grounded = new Set<string>();
      for (const brick of bricks.toSorted((first, second) => first.y - second.y)) {
        if (
          brick.y === 0 ||
          bricks.some((support) => grounded.has(support.id) && hasStudConnection(support, brick))
        )
          grounded.add(brick.id);
        else expected.push(['unsupported', brick.id]);
      }
      for (const [index, brick] of bricks.entries())
        for (const other of bricks.slice(index + 1)) {
          const first = footprint(brick);
          const second = footprint(other);
          if (
            brick.x < other.x + second.width &&
            brick.x + first.width > other.x &&
            brick.z < other.z + second.depth &&
            brick.z + first.depth > other.z &&
            brick.y < other.y + second.height &&
            brick.y + first.height > other.y
          )
            expected.push(['collision', brick.id], ['collision', other.id]);
        }
      expect(
        validateAssembly({ ...empty, bricks }).map((issue) => [issue.code, issue.brickId]),
      ).toEqual(expected);
    }
  });
  it('contains 170 unique building and foliage parts with explicit connection sites', () => {
    expect(PARTS).toHaveLength(170);
    expect(new Set(PARTS.map((part) => part.id)).size).toBe(170);
    expect(PARTS.filter((part) => part.family === 'tall')).toHaveLength(10);
    expect(PARTS.filter((part) => part.family === 'slope')).toHaveLength(21);
    expect(PARTS.filter((part) => part.family === 'round')).toHaveLength(8);
    for (const [family, count] of [
      ['arch', 6],
      ['baseplate', 2],
      ['cone', 4],
      ['door', 7],
      ['window', 10],
      ['detail', 24],
      ['foliage', 10],
    ] as const)
      expect(PARTS.filter((part) => part.family === family)).toHaveLength(count);
    for (const part of PARTS) {
      expect(part.height).toBeGreaterThan(0);
      expect(Number.isInteger(part.height * 2)).toBe(true);
      for (const [surface, sites] of Object.entries(part.connections)) {
        if (
          part.clearance !== 'reserved' &&
          (!part.family || ['tall', 'slope', 'round'].includes(part.family))
        )
          expect(sites).toHaveLength(
            surface === 'topStuds'
              ? part.kind === 'tile'
                ? 0
                : part.shape === 'slope'
                  ? part.width
                  : part.width * part.depth
              : part.width * part.depth,
          );
        expect(new Set(sites.map((site) => `${site.x}:${site.z}`)).size).toBe(sites.length);
        expect(
          sites.every(
            (site) =>
              Number.isInteger(site.x * 2) &&
              Number.isInteger(site.z * 2) &&
              site.x >= 0 &&
              site.x < part.width &&
              site.z >= 0 &&
              site.z < part.depth,
          ),
        ).toBe(true);
      }
    }
  });
  it.each(PARTS)(
    'validates $id placement, collisions, support, removal, and export in all rotations',
    (part) => {
      for (const rotation of [0, 90, 180, 270] as const) {
        const brick = { ...base, partId: part.id, rotation };
        const size = footprint(brick);
        expect(placeBrick(empty, brick).ok).toBe(true);
        expect(
          validateAssembly({ ...empty, bricks: [{ ...brick, y: MAX_HEIGHT + 1 - part.height }] }),
        ).toContainEqual(expect.objectContaining({ code: 'invalid' }));
        expect(placeBrick(empty, { ...brick, x: 16 - size.width, z: 16 - size.depth }).ok).toBe(
          true,
        );
        expect(placeBrick(empty, { ...brick, x: 17 - size.width }).ok).toBe(false);
        expect(placeBrick(empty, { ...brick, z: 17 - size.depth }).ok).toBe(false);
        expect(
          placeBrick(
            { ...empty, bricks: [brick] },
            { ...brick, id: 'collision', x: size.width - 1 },
          ).ok,
        ).toBe(false);
        expect(
          placeBrick({ ...empty, bricks: [brick] }, { ...brick, id: 'adjacent', x: size.width }).ok,
        ).toBe(size.width * 2 <= 16);
        let upper = { ...brick, id: 'upper', y: part.height };
        const connection = getConnectionSites(brick, 'top')
          .flatMap((stud) =>
            getConnectionSites(upper, 'bottom').map((receiver) => ({ stud, receiver })),
          )
          .find(
            ({ stud, receiver }) =>
              stud.x >= receiver.x &&
              stud.z >= receiver.z &&
              stud.x - receiver.x + size.width <= 16 &&
              stud.z - receiver.z + size.depth <= 16,
          );
        if (!connection) {
          expect(placeBrick({ ...empty, bricks: [brick] }, upper)).toMatchObject({
            ok: false,
            issues: [expect.objectContaining({ code: 'unsupported' })],
          });
          expect(removeBrick({ ...empty, bricks: [brick] }, brick.id).ok).toBe(true);
          expect(getBillOfMaterials({ ...empty, bricks: [brick] })).toEqual([
            { partId: part.id, color: 4, quantity: 1 },
          ]);
          expect(exportLDraw({ ...empty, bricks: [brick] })).toContain(`${part.id}.dat`);
          continue;
        }
        const { stud, receiver } = connection;
        upper = { ...upper, x: stud.x - receiver.x, z: stud.z - receiver.z };
        const stack = { ...empty, bricks: [upper, brick] };
        expect(validateAssembly(stack)).toEqual([]);
        expect(removeBrick(stack, brick.id).ok).toBe(false);
        expect(removeBrick(stack, upper.id).ok).toBe(true);
        expect(hasStudConnection(brick, upper)).toBe(true);
        expect(getBillOfMaterials(stack)).toEqual([{ partId: part.id, color: 4, quantity: 2 }]);
        expect(
          exportLDraw(stack)
            .split('\n')
            .filter((line) => line.startsWith('1 ')),
        ).toHaveLength(2);
        expect(exportLDraw(stack)).toContain(`${part.id}.dat`);
        expect(exportLDraw(stack)).toContain('0 STEP');
      }
    },
  );
  it('connects supported part pairs only when the lower part provides an aligned stud', () => {
    for (const lowerPart of PARTS)
      for (const upperPart of PARTS) {
        for (const lowerRotation of [0, 90, 180, 270] as const)
          for (const upperRotation of [0, 90, 180, 270] as const) {
            const lower = { ...base, partId: lowerPart.id, rotation: lowerRotation };
            const size = footprint(lower);
            const upperSize = footprint({ ...base, partId: upperPart.id, rotation: upperRotation });
            const upper = {
              ...base,
              id: 'upper',
              partId: upperPart.id,
              rotation: upperRotation,
              x: Math.min(size.width - 1, 16 - upperSize.width),
              z: Math.min(size.depth - 1, 16 - upperSize.depth),
              y: lowerPart.height,
            };
            const issues = validateAssembly({ ...empty, bricks: [lower, upper] });
            const receivers = getConnectionSites(upper, 'bottom');
            const connects = getConnectionSites(lower, 'top').some((stud) =>
              receivers.some((receiver) => stud.x === receiver.x && stud.z === receiver.z),
            );
            if (connects) expect(issues).toEqual([]);
            else
              expect(issues).toEqual([
                expect.objectContaining({ brickId: 'upper', code: 'unsupported' }),
              ]);
          }
      }
  }, 30_000);
  it('accepts a grounded brick without mutating its input', () => {
    const result = placeBrick(empty, base);
    expect(result.ok).toBe(true);
    expect(empty.bricks).toHaveLength(0);
  });
  it('registers envelope-only runtime parts without inventing connections', () => {
    const part = {
      id: 'runtime-envelope-test',
      name: 'Runtime envelope test',
      width: 1,
      depth: 1,
      height: 3,
      kind: 'brick' as const,
      family: 'detail' as const,
      shape: 'detail' as const,
      ldrawRotation: 0 as const,
      connections: { topStuds: [], bottomReceivers: [] },
    };
    registerPart(part);
    expect(getPart(part.id)).toEqual(part);
    expect(getConnectionSites({ ...base, partId: part.id }, 'top')).toEqual([]);
    expect(placeBrick(empty, { ...base, partId: part.id }).ok).toBe(true);
    expect(
      placeBrick(
        { ...empty, bricks: [base] },
        { ...base, id: 'runtime-upper', partId: part.id, y: 3 },
      ).ok,
    ).toBe(true);
    expect(
      validateAssembly({
        ...empty,
        bricks: [
          base,
          { ...base, id: 'runtime-middle', partId: part.id, y: 3 },
          { ...base, id: 'curated-upper', partId: '3005', y: 6 },
        ],
      }),
    ).toEqual([]);
    const envelopeAssembly = {
      ...empty,
      bricks: [
        base,
        { ...base, id: 'runtime-middle', partId: part.id, y: 3 },
        { ...base, id: 'curated-upper', partId: '3005', y: 6 },
      ],
    };
    const assessment = assessPhysicalFeasibility(envelopeAssembly);
    expect(assessment.connectionModel).toBe('unknown');
    expect(
      getBuildabilityReport(assessment).checks.find((check) => check.id === 'geometry'),
    ).toMatchObject({
      status: 'unknown',
      detail: expect.stringContaining('connector geometry is unknown'),
    });
    expect(placeBrick(empty, { ...base, id: 'floating-runtime', partId: part.id, y: 3 }).ok).toBe(
      false,
    );
    expect(() => registerPart({ ...part, id: 'runtime-invalid-test', width: 0 })).toThrow(
      'Invalid runtime part definition',
    );
  });
  it('rejects overlapping bricks but allows edge contact', () => {
    const assembly = { ...empty, bricks: [base] };
    expect(placeBrick(assembly, { ...base, id: 'overlap', x: 1 }).ok).toBe(false);
    expect(placeBrick(assembly, { ...base, id: 'neighbor', x: 2 }).ok).toBe(true);
  });
  it('connects an upper brick at the exact top surface', () => {
    const assembly = { ...empty, bricks: [base] };
    expect(placeBrick(assembly, { ...base, id: 'top', y: 3 }).ok).toBe(true);
    expect(placeBrick(assembly, { ...base, id: 'floating', y: 4 }).ok).toBe(false);
  });
  it('rotates explicit connection sites around the minimum footprint corner', () => {
    const part = {
      ...getPart('3001'),
      connections: { topStuds: [{ x: 0, z: 1 }], bottomReceivers: [] },
    };
    const expected = [
      { x: 3.5, y: 6, z: 6.5 },
      { x: 4.5, y: 6, z: 6.5 },
      { x: 4.5, y: 6, z: 7.5 },
      { x: 5.5, y: 6, z: 5.5 },
    ];
    for (const [index, rotation] of ([0, 90, 180, 270] as const).entries()) {
      const brick = { ...base, x: 3, y: 3, z: 5, rotation };
      expect(getConnectionSites(brick, 'top', part)).toEqual([expected[index]]);
      expect(getConnectionSites(brick, 'bottom', part)).toEqual([]);
    }
  });
  it('requires stud and underside contact on the exact height plane', () => {
    expect(hasStudConnection(base, { ...base, id: 'upper', x: 1, z: 3, y: 3 })).toBe(true);
    expect(hasStudConnection(base, { ...base, id: 'upper', x: 2, y: 3 })).toBe(false);
    expect(hasStudConnection(base, { ...base, id: 'upper', y: 4 })).toBe(false);
    expect(
      hasStudConnection({ ...base, rotation: 90 }, { ...base, id: 'upper', x: 3, z: 1, y: 3 }),
    ).toBe(true);
  });
  it('rejects overlapping bodies with absent or misaligned connection sites', () => {
    const original = getPart('3001');
    const lowerPart = {
      ...original,
      connections: { ...original.connections, topStuds: [{ x: 0, z: 1 }] },
    };
    const upperPart = {
      ...original,
      connections: { ...original.connections, bottomReceivers: [{ x: 0, z: 0 }] },
    };
    const upper = { ...base, id: 'upper', y: 3 };
    expect(hasStudConnection(base, upper, lowerPart, upperPart)).toBe(false);
    expect(hasStudConnection(base, { ...upper, rotation: 90 }, lowerPart, upperPart)).toBe(true);
    expect(
      hasStudConnection(
        base,
        upper,
        { ...original, connections: { ...original.connections, topStuds: [] } },
        original,
      ),
    ).toBe(false);
    expect(
      hasStudConnection(base, upper, original, {
        ...original,
        connections: { ...original.connections, bottomReceivers: [] },
      }),
    ).toBe(false);
    expect(original.connections.topStuds).toHaveLength(8);
    expect(original.connections.bottomReceivers).toHaveLength(8);
  });
  it.each(['3008', '3460'])(
    'accepts $0 at the maximum supported height and rejects overflow',
    (partId) => {
      const part = getPart(partId);
      const tower = Array.from({ length: MAX_HEIGHT / part.height }, (_, index) => ({
        ...base,
        id: `level-${index}`,
        partId,
        y: index * part.height,
      }));
      expect(validateAssembly({ ...empty, bricks: tower })).toEqual([]);
      expect(
        placeBrick({ ...empty, bricks: tower }, { ...base, id: 'overflow', partId, y: MAX_HEIGHT })
          .ok,
      ).toBe(false);
    },
  );
  it('rejects floating support chains', () => {
    const issues = validateAssembly({
      ...empty,
      bricks: [
        { ...base, y: 3 },
        { ...base, id: 'upper', y: 6 },
      ],
    });
    expect(issues.filter((issue) => issue.code === 'unsupported')).toHaveLength(2);
  });
  it('swaps the footprint on a quarter turn', () => {
    expect(footprint({ ...base, rotation: 90 })).toEqual({ width: 4, depth: 2, height: 3 });
  });
  it('rejects unsupported parts, colors, coordinates, rotations, and duplicate IDs', () => {
    for (const change of [
      { partId: 'unknown' },
      { color: 999 },
      { x: -1 },
      { y: 0.5 },
      { x: NaN },
      { x: 15 },
      { y: MAX_HEIGHT },
      { rotation: 45 },
    ]) {
      expect(placeBrick(empty, { ...base, ...change } as Brick).ok).toBe(false);
    }
    expect(placeBrick({ ...empty, bricks: [base] }, base).ok).toBe(false);
  });
  it('prevents removing a support and allows removing the top brick', () => {
    const assembly = { ...empty, bricks: [base, { ...base, id: 'top', y: 3 }] };
    expect(removeBrick(assembly, 'base').ok).toBe(false);
    expect(removeBrick(assembly, 'top').ok).toBe(true);
    expect(removeBrick(assembly, 'missing').ok).toBe(false);
  });
  it('ships a valid demo with a complete bill of materials', () => {
    const demo = createDemoAssembly();
    expect(validateAssembly(demo)).toEqual([]);
    expect(getBillOfMaterials(demo).reduce((total, entry) => total + entry.quantity, 0)).toBe(
      demo.bricks.length,
    );
  });
  it('exports LDraw coordinates and layer steps', () => {
    const assembly = {
      ...empty,
      bricks: [base, { ...base, id: 'top', y: 3, rotation: 90 as const }],
    };
    expect(exportLDraw(assembly)).toContain('1 4 20 -24 40 0 0 1 0 1 0 -1 0 0 3001.dat');
    expect(exportLDraw(assembly)).toContain('0 STEP');
    expect(exportLDraw(assembly)).toContain('1 4 40 -48 20 -1 0 0 0 1 0 0 0 -1 3001.dat');
    expect(() => exportLDraw({ ...empty, bricks: [{ ...base, y: 4 }] })).toThrow();
  });
  it.each([
    { id: '3001', halfWidth: 40, halfDepth: 20, bodyHeight: 24 },
    { id: '3003', halfWidth: 20, halfDepth: 20, bodyHeight: 24 },
    { id: '3004', halfWidth: 20, halfDepth: 10, bodyHeight: 24 },
    { id: '3005', halfWidth: 10, halfDepth: 10, bodyHeight: 24 },
    { id: '3622', halfWidth: 30, halfDepth: 10, bodyHeight: 24 },
    { id: '3010', halfWidth: 40, halfDepth: 10, bodyHeight: 24 },
    { id: '3009', halfWidth: 60, halfDepth: 10, bodyHeight: 24 },
    { id: '3008', halfWidth: 80, halfDepth: 10, bodyHeight: 24 },
    { id: '3002', halfWidth: 30, halfDepth: 20, bodyHeight: 24 },
    { id: '2456', halfWidth: 60, halfDepth: 20, bodyHeight: 24 },
    { id: '6111', halfWidth: 100, halfDepth: 10, bodyHeight: 24 },
    { id: '3020', halfWidth: 40, halfDepth: 20, bodyHeight: 8 },
    { id: '3022', halfWidth: 20, halfDepth: 20, bodyHeight: 8 },
    { id: '3024', halfWidth: 10, halfDepth: 10, bodyHeight: 8 },
    { id: '3023b', halfWidth: 20, halfDepth: 10, bodyHeight: 8 },
    { id: '3623', halfWidth: 30, halfDepth: 10, bodyHeight: 8 },
    { id: '3710', halfWidth: 40, halfDepth: 10, bodyHeight: 8 },
    { id: '3666', halfWidth: 60, halfDepth: 10, bodyHeight: 8 },
    { id: '3460', halfWidth: 80, halfDepth: 10, bodyHeight: 8 },
    { id: '3021', halfWidth: 30, halfDepth: 20, bodyHeight: 8 },
    { id: '3795', halfWidth: 60, halfDepth: 20, bodyHeight: 8 },
    { id: '3070b', halfWidth: 10, halfDepth: 10, bodyHeight: 8 },
    { id: '3069b', halfWidth: 20, halfDepth: 10, bodyHeight: 8 },
    { id: '63864', halfWidth: 30, halfDepth: 10, bodyHeight: 8 },
    { id: '2431', halfWidth: 40, halfDepth: 10, bodyHeight: 8 },
    { id: '3068b', halfWidth: 20, halfDepth: 20, bodyHeight: 8 },
    { id: '87079', halfWidth: 40, halfDepth: 20, bodyHeight: 8 },
  ])(
    'maps measured native $id bounds and exports to the footprint in every orientation',
    ({ id, halfWidth, halfDepth, bodyHeight }) => {
      for (const rotation of [0, 90, 180, 270] as const) {
        const brick = { ...base, partId: id, x: 3, y: 3, z: 5, rotation };
        const transform = getLDrawTransform(brick);
        const cosine = Math.round(Math.cos((transform.rotation * Math.PI) / 180));
        const sine = Math.round(Math.sin((transform.rotation * Math.PI) / 180));
        const corners = [-halfWidth, halfWidth].flatMap((nativeX) =>
          [-halfDepth, halfDepth].map((nativeZ) => ({
            x: transform.x + cosine * nativeX + sine * nativeZ,
            z: transform.z - sine * nativeX + cosine * nativeZ,
          })),
        );
        const size = footprint(brick);
        expect(Math.min(...corners.map((corner) => corner.x))).toBe(brick.x * 20);
        expect(Math.max(...corners.map((corner) => corner.x))).toBe((brick.x + size.width) * 20);
        expect(Math.min(...corners.map((corner) => corner.z))).toBe(brick.z * 20);
        expect(Math.max(...corners.map((corner) => corner.z))).toBe((brick.z + size.depth) * 20);
        expect(transform.y + bodyHeight).toBe(-brick.y * 8);
        const support = { ...base, id: 'support', partId: '3005', x: 3, z: 5 };
        const record = exportLDraw({ ...empty, bricks: [support, brick] })
          .split('\n')
          .filter((line) => line.startsWith('1 '))[1]
          .split(' ');
        expect(record[14]).toBe(`${id}.dat`);
        expect(record.slice(2, 5).map(Number)).toEqual([transform.x, transform.y, transform.z]);
        expect(record.slice(5, 14).map(Number)).toEqual(
          [cosine, 0, sine, 0, 1, 0, -sine, 0, cosine].map((value) => value || 0),
        );
      }
    },
  );
});

describe('mixed-part engine builds', () => {
  it('lays complete catalogue and tile displays on one larger board without stacking', () => {
    for (const [id, count] of [['catalog-sampler', 170]] as const) {
      const assembly = createExampleAssembly(id);
      expect(assembly.buildArea).toBe(64);
      expect(assembly.bricks).toHaveLength(count);
      expect(new Set(assembly.bricks.map((brick) => brick.y))).toEqual(new Set([0]));
      expect(validateAssembly(assembly)).toEqual([]);
      expect(assembly.bricks.some((brick) => brick.x > 15 || brick.z > 15)).toBe(true);
      expect(
        validateAssembly({ ...assembly, buildArea: 16 }).some((issue) => issue.code === 'invalid'),
      ).toBe(true);
    }
    for (const buildArea of [0, 15, 16.5, MAX_BUILD_AREA + 1, Infinity, NaN])
      expect(validateAssembly({ name: 'invalid board', bricks: [], buildArea })).toContainEqual(
        expect.objectContaining({ code: 'invalid' }),
      );
    expect(createExampleAssembly('courtyard-house').buildArea).toBeUndefined();
  });

  it('resizes the board around the build and refuses sizes the pieces do not fit', () => {
    const house = createExampleAssembly('courtyard-house');
    const grown = resizeBuildArea(house, 32);
    expect(grown?.buildArea).toBe(32);
    expect(grown?.bricks.map((brick) => [brick.id, brick.x - 8, brick.y, brick.z - 8])).toEqual(
      house.bricks.map((brick) => [brick.id, brick.x, brick.y, brick.z]),
    );
    expect(validateAssembly(grown!)).toEqual([]);
    expect(resizeBuildArea(grown!, 16)).toEqual(house);

    const sampler = catalogSampler();
    expect(resizeBuildArea(sampler, 16)).toBeNull();
    const cone = { id: 'cone', partId: '6141', color: 4, x: 40.5, y: 0, z: 2, rotation: 0 } as const;
    const shrunk = resizeBuildArea({ name: 'corner', buildArea: 64, bricks: [cone] }, 16);
    expect(shrunk).toEqual({ name: 'corner', bricks: [{ ...cone, x: 14.5, z: 0 }] });
    expect(validateAssembly(shrunk!)).toEqual([]);
    for (const size of [15, 16.5, MAX_BUILD_AREA + 1])
      expect(resizeBuildArea(house, size)).toBeNull();
  });
  const catalogSampler = () => createExampleAssembly('catalog-sampler');

  it('builds a medieval courtyard with a jettied hall, watchtower, well and walled garden', () => {
    const assembly = createExampleAssembly('courtyard-house');
    expect(assembly.bricks).toHaveLength(383);
    expect(new Set(assembly.bricks.map((brick) => brick.partId)).size).toBe(46);
    expect(assembly.bricks[0]).toMatchObject({ partId: '91405', x: 0, y: 0, z: 0 });
    expect(Math.max(...assembly.bricks.map((brick) => brick.y + footprint(brick).height))).toBe(48);
    expect(validateAssembly(assembly)).toEqual([]);
    // Corbels under the jettied upper floor and the tower's fighting platform.
    expect(assembly.bricks.filter((brick) => brick.partId === '3665a')).toHaveLength(11);
    const doors = assembly.bricks.filter((brick) => brick.partId === '3193a');
    expect(doors).toHaveLength(2);
    for (const door of doors)
      expect(
        assembly.bricks.some(
          (frame) => frame.partId === '3579' && frame.x === door.x && frame.z === door.z + 0.5,
        ),
      ).toBe(true);
    for (const partId of ['3307', '3470', '33303', '3068b', '14716', '30137', '2453b'])
      expect(assembly.bricks.some((brick) => brick.partId === partId)).toBe(true);
  });

  it("builds a striped lighthouse, keeper's cottage, jetty and rowboat on a rocky island", () => {
    const assembly = createExampleAssembly('seaside-lighthouse');
    expect(assembly.name).toBe('Seaside Lighthouse');
    expect(assembly.buildArea).toBeUndefined();
    expect(validateAssembly(assembly)).toEqual([]);
    const tower = assembly.bricks.filter(
      (brick) =>
        brick.y >= 16 &&
        brick.y < 40 &&
        brick.x >= 9 &&
        brick.x <= 12 &&
        brick.z >= 9 &&
        brick.z <= 12,
    );
    for (let course = 0; course < 8; course++)
      expect(
        new Set(
          tower
            .filter(
              (brick) => brick.y === 16 + course * 3 && !['60592', '60601'].includes(brick.partId),
            )
            .map((brick) => brick.color),
        ),
      ).toEqual(new Set([course % 4 < 2 ? 15 : 4]));
    expect(assembly.bricks.filter((brick) => brick.partId === '60592')).toHaveLength(4);
    const doors = assembly.bricks.filter((brick) => brick.partId === '3193a');
    expect(doors.map(({ x, y, z }) => ({ x, y, z }))).toEqual([
      { x: 9, y: 3, z: 7.5 },
      { x: 3, y: 3, z: 8.5 },
    ]);
    expect(
      assembly.bricks.filter((brick) => brick.partId === '3941' && brick.color === 46),
    ).toHaveLength(2);
    expect(assembly.bricks.filter((brick) => brick.partId === '3633')).toHaveLength(4);
    const summit = assembly.bricks.reduce((top, brick) => (brick.y > top.y ? brick : top));
    expect(summit).toMatchObject({ partId: '4589', y: 61 });
    expect(
      assembly.bricks.filter((brick) => brick.partId === '3069b' && brick.y === 5),
    ).toHaveLength(3);
    expect(
      assembly.bricks.filter(
        (brick) => brick.y === 1 && brick.x >= 1 && brick.x <= 2 && brick.z <= 3,
      ),
    ).toEqual([expect.objectContaining({ partId: '3020', color: 15 })]);
  });

  it('builds a flower stall with a striped awning, flower buckets and street furniture', () => {
    const assembly = createExampleAssembly('flower-stall');
    expect(assembly.name).toBe('Flower Market Stall');
    expect(validateAssembly(assembly)).toEqual([]);
    const awning = assembly.bricks.filter((brick) => brick.partId === '4286');
    expect(awning).toHaveLength(28);
    for (const brick of awning) {
      expect(brick.rotation).toBe(0);
      expect(brick.color).toBe(brick.x % 2 ? 4 : 15);
    }
    // The shelf plate is bonded into the booth wall: courses sit both under and on top of it.
    const shelf = assembly.bricks.find((brick) => brick.partId === '2445' && brick.y === 10);
    expect(shelf).toMatchObject({ x: 2, z: 12, rotation: 270 });
    for (const y of [7, 11])
      expect(assembly.bricks.some((brick) => brick.z === 13 && brick.y === y)).toBe(true);
    const blooms = assembly.bricks.filter((brick) => brick.partId === '24866');
    expect(blooms).toHaveLength(6);
    for (const bloom of blooms)
      expect(
        assembly.bricks.some(
          (brick) =>
            brick.partId === '4727' &&
            brick.x === bloom.x &&
            brick.z === bloom.z &&
            brick.y === bloom.y - 3,
        ),
      ).toBe(true);
    for (const partId of ['3470', '3678b', '2412b', '60581', '2453b', '3456'])
      expect(assembly.bricks.some((brick) => brick.partId === partId)).toBe(true);
    expect(assembly.bricks.filter((brick) => brick.y === 1 && brick.z === 0)).toHaveLength(2);
  });

  it('gives the courtyard house a stepped slate roof with overhanging eaves', () => {
    const assembly = createExampleAssembly('courtyard-house');
    const roofHeights = Array.from({ length: 8 }, (_, index) => {
      const z = index + 7;
      return Math.max(
        ...assembly.bricks
          .filter((brick) => {
            const size = footprint(brick);
            return (
              brick.color === 72 &&
              brick.y >= 24 &&
              brick.x <= 10 &&
              10 < brick.x + size.width &&
              brick.z <= z &&
              z < brick.z + size.depth
            );
          })
          .map((brick) => brick.y + footprint(brick).height),
      );
    });
    expect(roofHeights).toEqual([27, 30, 33, 34, 34, 33, 30, 27]);
  });

  it('provides named, valid examples with independent assembly instances', () => {
    expect(EXAMPLES.map((example) => example.id)).toEqual([
      'courtyard-house',
      'catalog-sampler',
      'seaside-lighthouse',
      'flower-stall',
    ]);
    expect(new Set(EXAMPLES.map((example) => example.id)).size).toBe(EXAMPLES.length);
    for (const example of EXAMPLES) {
      const first = createExampleAssembly(example.id);
      const second = createExampleAssembly(example.id);
      expect(first.name).toBe(example.name);
      expect(first.bricks).toHaveLength(example.expectedPieceCount);
      expect(validateAssembly(first)).toEqual([]);
      expect(first).toEqual(second);
      expect(first.bricks).not.toBe(second.bricks);
      for (const [index, brick] of first.bricks.entries())
        expect(brick).not.toBe(second.bricks[index]);
    }
    expect(createExampleAssembly('courtyard-house')).toEqual(createDemoAssembly());
    expect(() => createExampleAssembly('unknown')).toThrow('Unknown example');
  }, 15_000);

  it.each(EXAMPLES)(
    'validates, exports, rejects invalid moves, and disassembles the $name',
    ({ id, expectedPieceCount: count }) => {
      const assembly = createExampleAssembly(id);
      expect(assembly.bricks).toHaveLength(count);
      expect(validateAssembly(assembly)).toEqual([]);
      expect(validateAssembly({ ...assembly, bricks: assembly.bricks.toReversed() })).toEqual([]);
      expect(getBillOfMaterials(assembly).reduce((total, entry) => total + entry.quantity, 0)).toBe(
        count,
      );
      const lines = exportLDraw(assembly).split('\n');
      expect(lines.filter((line) => line.startsWith('1 '))).toHaveLength(count);
      expect(lines.filter((line) => line === '0 STEP')).toHaveLength(
        Math.max(0, new Set(assembly.bricks.map((brick) => brick.y)).size - 1),
      );
      const snapshot = structuredClone(assembly);
      const top = assembly.bricks.at(-1);
      if (top) {
        const collision = placeBrick(assembly, { ...top, id: 'collision' });
        expect(collision.ok).toBe(false);
        if (!collision.ok)
          expect(collision.issues.some((issue) => issue.code === 'collision')).toBe(true);
        const height = Math.max(
          ...assembly.bricks.map((brick) => brick.y + footprint(brick).height),
        );
        const floating = placeBrick(assembly, { ...top, id: 'floating', y: height + 1 });
        expect(floating.ok).toBe(false);
        if (!floating.ok)
          expect(
            floating.issues.some(
              (issue) =>
                issue.code ===
                (height + 1 + footprint(top).height > MAX_HEIGHT ? 'invalid' : 'unsupported'),
            ),
          ).toBe(true);
      }
      expect(assembly).toEqual(snapshot);
      let remaining = assembly;
      for (const brick of assembly.bricks.toReversed()) {
        const result = removeBrick(remaining, brick.id);
        if (!result.ok) throw new Error(`Disassembly: ${JSON.stringify(result.issues)}`);
        remaining = result.assembly;
      }
      expect(remaining.bricks).toHaveLength(0);
    },
  );

  it('samples every supported design exactly once and demonstrates every supported tile size', () => {
    const sampler = catalogSampler();
    expect(sampler.bricks).toHaveLength(PARTS.length);
    expect(new Set(sampler.bricks.map((brick) => brick.partId))).toEqual(
      new Set(PARTS.map((part) => part.id)),
    );
    expect(
      sampler.bricks.filter((brick) => getPart(brick.partId).family === 'foliage'),
    ).toHaveLength(10);
    for (const [index, first] of sampler.bricks.entries()) {
      const firstSize = footprint(first);
      for (const second of sampler.bricks.slice(index + 1)) {
        const secondSize = footprint(second);
        expect(
          Math.max(
            second.x - first.x - firstSize.width,
            first.x - second.x - secondSize.width,
            second.z - first.z - firstSize.depth,
            first.z - second.z - secondSize.depth,
          ),
        ).toBeGreaterThanOrEqual(0.5);
      }
    }
    expect(
      new Set(
        catalogSampler()
          .bricks.filter((brick) => getPart(brick.partId).kind === 'tile')
          .map((brick) => brick.partId),
      ),
    ).toEqual(new Set(PARTS.filter((part) => part.kind === 'tile').map((part) => part.id)));
    expect(new Set(assessPhysicalFeasibility(catalogSampler()).missingMassPartIds)).toEqual(
      new Set(PARTS.filter((part) => !CATALOG_PART_MASSES[part.id]).map((part) => part.id)),
    );
  });

  it('preserves a tower with alternate supports but protects its last grounded connection', () => {
    const center: Brick = { ...base, id: 'center', partId: '3031', y: 3 };
    let tower: Assembly = {
      name: 'Four-way support test',
      bricks: [
        ...[0, 2].flatMap((x) =>
          [0, 2].map((z) => ({
            ...base,
            id: `support-${x}-${z}`,
            partId: '3003',
            x,
            z,
          })),
        ),
        center,
      ],
    };
    expect(validateAssembly(tower)).toEqual([]);
    const supports = tower.bricks.filter((brick) => hasStudConnection(brick, center));
    expect(supports).toHaveLength(4);
    for (const support of supports.slice(0, 3)) {
      const result = removeBrick(tower, support.id);
      if (!result.ok) throw new Error(JSON.stringify(result.issues));
      tower = result.assembly;
    }
    expect(validateAssembly(tower)).toEqual([]);
    const result = removeBrick(tower, supports[3].id);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.issues).toContainEqual(
        expect.objectContaining({ brickId: center.id, code: 'unsupported' }),
      );
  });
});

describe('building technique guidance', () => {
  it('returns bounded versioned advisory guides without sharing mutable records', () => {
    const result = getBuildingTechniques({ topic: 'walls', limit: 1 });
    expect(result).toMatchObject({
      version: 1,
      totalMatches: 2,
      truncated: true,
      certified: false,
      constructionSequence: 'not-validated',
    });
    expect(result.techniques).toHaveLength(1);
    Reflect.set(result.techniques[0], 'title', 'Changed');
    expect(getBuildingTechniques({ id: 'staggered-walls' }).techniques[0].title).toBe(
      'Staggered wall joints',
    );
    expect(() => getBuildingTechniques({ limit: 4 })).toThrow('1-3');
    expect(() => getBuildingTechniques({ id: 'invented' } as never)).toThrow('Unknown');
    expect(getBuildingTechniques({ id: 'reinforcement', topic: 'foundations' }).techniques).toEqual(
      [],
    );
  });

  it.each(BUILDING_TECHNIQUE_IDS)(
    'constructs valid parameterized %s references without certifying physics',
    (id) => {
      for (const sections of [2, 3, 4]) {
        const assembly = createBuildingTechniqueExample(id, { sections });
        expect(validateAssembly(assembly)).toEqual([]);
        expect(new Set(assembly.bricks.map((brick) => brick.partId))).toEqual(
          new Set(getBuildingTechniques({ id }).techniques[0].requiredPartIds),
        );
        expect(
          evaluateAssemblyPolicy(assembly, {
            requireObservedColors: true,
            evidence: DEFAULT_PART_COLOR_EVIDENCE,
          }),
        ).toMatchObject({
          allowed: true,
          physical: { gravity: 'balanced' },
          buildability: { certified: false },
        });
        for (const brick of assembly.bricks.filter(
          (piece) =>
            piece.partId === '3020' ||
            (id === 'staggered-walls' && piece.y === 3 && piece.partId === '3001'),
        ))
          expect(explainConnection(assembly, brick).studSupports).toHaveLength(2);
      }
    },
  );

  it('alternates multiple wall courses and rejects invalid example parameters or occupied bounds', () => {
    const assembly = createBuildingTechniqueExample('staggered-walls', {
      sections: 2,
      courses: 4,
      x: 0.5,
      z: 0.5,
      color: 14,
    });
    expect(validateAssembly(assembly)).toEqual([]);
    expect(assembly.bricks.filter((brick) => brick.y === 9).map((brick) => brick.partId)).toEqual([
      '3003',
      '3001',
      '3003',
    ]);
    expect(() => createBuildingTechniqueExample('foundations', { sections: 1 })).toThrow('Invalid');
    expect(() => createBuildingTechniqueExample('reinforcement', { courses: 2 })).toThrow(
      'Invalid',
    );
    expect(() => createBuildingTechniqueExample('foundations', { color: 16 })).toThrow('Invalid');
    expect(() => createBuildingTechniqueExample('foundations', { z: 14 })).toThrow('rejected');
  });
});

describe('atomic assembly edits', () => {
  it('imports raw or exported assemblies without trusting exported host policies', () => {
    const source = {
      version: 1,
      assembly: { ...empty, bricks: [base] },
      physicalPolicy: { rejectInfeasible: false },
      buildability: { certified: true },
    };
    const assembly = importAssembly(source);
    expect(assembly).toEqual({ ...empty, bricks: [base] });
    assembly.bricks[0].x = 4;
    expect(source.assembly.bricks[0].x).toBe(0);
    expect(importAssembly(empty)).toEqual(empty);
    for (const value of [
      null,
      { ...empty, bricks: [base, base] },
      { ...empty, bricks: [{ ...base, x: 0.25 }] },
      { ...empty, bricks: [{ ...base, partId: 'unknown' }] },
      { ...empty, buildArea: MAX_BUILD_AREA + 1 },
      { version: 2, assembly: empty },
      { ...empty, physicalPolicy: {} },
      { ...empty, bricks: Array(MAX_PIECES + 1).fill(base) },
    ])
      expect(() => importAssembly(value)).toThrow();
  });

  it('moves and recolors multiple pieces against final geometry, not temporary overlaps', () => {
    const second = { ...base, id: 'second', x: 4 };
    const assembly = { ...empty, bricks: [base, second] };
    const result = applyPatch(assembly, {
      operations: [
        { type: 'update', id: base.id, changes: { x: 4, color: 14 } },
        { type: 'update', id: second.id, changes: { x: 0 } },
      ],
    });
    expect(result).toMatchObject({ ok: true, revision: 1 });
    if (!result.ok) throw new Error('Patch rejected');
    expect(result.assembly.bricks).toMatchObject([
      { id: base.id, x: 4, color: 14 },
      { id: second.id, x: 0 },
    ]);
    expect(assembly.bricks).toMatchObject([{ x: 0, color: 4 }, { x: 4 }]);
    expect(result.assessment.constructionSequence).toBe('not-validated');
  });

  it('counts final inventory usage and does not infer zero stock from missing entries', () => {
    const assembly = { ...empty, bricks: [base] };
    const policy = {
      requireInventory: true,
      inventory: [{ partId: base.partId, color: 4, quantity: 1 }],
    };
    const result = applyPatch(
      assembly,
      {
        operations: [
          { type: 'remove', id: base.id },
          { type: 'add', brick: { ...base, id: 'replacement', x: 4 } },
        ],
      },
      { policy },
    );
    expect(result).toMatchObject({
      ok: true,
      assessment: {
        inventory: [{ required: 1, available: 1, status: 'within-declared-inventory' }],
      },
    });
    expect(evaluateAssemblyPolicy(assembly, { inventory: [] })).toMatchObject({
      allowed: true,
      inventory: [{ available: null, status: 'unknown' }],
    });
  });

  it('bounds patch operations and rejects nonfinite or unsupported coordinates', () => {
    expect(
      previewPatch(empty, {
        operations: Array.from({ length: 101 }, (_, index) => ({
          type: 'add' as const,
          brick: { ...base, id: `piece-${index}` },
        })),
      }),
    ).toMatchObject({ ok: false, error: { code: 'invalid_patch' } });
    expect(
      previewPatch(empty, { operations: [{ type: 'add', brick: { ...base, x: NaN } }] }),
    ).toMatchObject({ ok: false, error: { code: 'invalid_patch' } });
    expect(
      previewPatch(empty, { operations: [{ type: 'add', brick: { ...base, x: 0.25 } }] }),
    ).toMatchObject({ ok: false, error: { code: 'geometry_rejected' } });
    expect(
      previewPatch(
        empty,
        { operations: [{ type: 'add', brick: base }] },
        { revision: Number.MAX_SAFE_INTEGER },
      ),
    ).toMatchObject({ ok: false, error: { code: 'invalid_revision' } });
    expect(evaluateAssemblyPolicy(empty, null as never).allowed).toBe(false);
  });

  it('replaces a support atomically without claiming a valid construction sequence', () => {
    const upper = { ...base, id: 'upper', partId: '3005', y: 3 };
    const assembly = { ...empty, bricks: [base, upper] };
    expect(removeBrick(assembly, base.id).ok).toBe(false);
    const patch = {
      expectedRevision: 4,
      operations: [
        { type: 'remove' as const, id: base.id },
        { type: 'add' as const, brick: { ...base, id: 'replacement' } },
      ],
    };
    const before = structuredClone(assembly);
    const preview = previewPatch(assembly, patch, { revision: 4 });
    expect(preview).toMatchObject({
      ok: true,
      revision: 4,
      assessment: { constructionSequence: 'not-validated', buildability: { certified: false } },
    });
    const applied = applyPatch(assembly, patch, { revision: 4 });
    expect(applied).toMatchObject({ ok: true, revision: 5 });
    expect(assembly).toEqual(before);
    if (!applied.ok) throw new Error('Patch rejected');
    applied.assembly.bricks[0].color = 14;
    expect(upper.color).toBe(4);
    expect(patch.operations[1]).toMatchObject({ brick: { color: 4 } });
    expect(previewPatch(assembly, patch, { revision: 5 })).toMatchObject({
      ok: false,
      revision: 5,
      error: { code: 'revision_conflict' },
    });
  });

  it('rejects collisions, duplicate targets, malformed updates and partial edits without mutation', () => {
    const assembly = { ...empty, bricks: [base] };
    const before = structuredClone(assembly);
    expect(
      applyPatch(assembly, {
        operations: [
          { type: 'update', id: base.id, changes: { color: 14 } },
          { type: 'add', brick: { ...base, id: 'overlap' } },
        ],
      }),
    ).toMatchObject({ ok: false, revision: 0, error: { code: 'geometry_rejected' } });
    expect(
      applyPatch(assembly, {
        operations: [
          { type: 'remove', id: base.id },
          { type: 'update', id: base.id, changes: { color: 14 } },
        ],
      }),
    ).toMatchObject({ ok: false, error: { code: 'duplicate_target' } });
    expect(
      previewPatch(assembly, {
        operations: [{ type: 'update', id: base.id, changes: { id: 'changed' } }],
      } as never),
    ).toMatchObject({ ok: false, error: { code: 'invalid_patch' } });
    expect(previewPatch(assembly, { operations: [] })).toMatchObject({
      ok: false,
      error: { code: 'invalid_patch' },
    });
    expect(
      previewPatch(assembly, { operations: [{ type: 'remove', id: 'missing' }] }),
    ).toMatchObject({ ok: false, error: { code: 'piece_not_found' } });
    expect(assembly).toEqual(before);
  });

  it('shares manufacturing, declared inventory and physical rejection policies', () => {
    const assembly = { ...empty, bricks: [base] };
    expect(evaluateAssemblyPolicy(assembly, { requireObservedColors: true })).toMatchObject({
      allowed: false,
      issues: [expect.objectContaining({ code: 'unverified_color' })],
    });
    expect(
      evaluateAssemblyPolicy(assembly, {
        requireObservedColors: true,
        evidence: DEFAULT_PART_COLOR_EVIDENCE,
      }),
    ).toMatchObject({ allowed: true });
    expect(evaluateAssemblyPolicy(assembly, { requireInventory: true })).toMatchObject({
      allowed: false,
      issues: [expect.objectContaining({ code: 'inventory_unknown' })],
    });
    expect(
      evaluateAssemblyPolicy(assembly, {
        inventory: [{ partId: base.partId, color: base.color, quantity: 0 }],
      }),
    ).toMatchObject({
      allowed: false,
      inventory: [expect.objectContaining({ status: 'exceeds-declared-inventory' })],
    });
    expect(
      evaluateAssemblyPolicy(assembly, {
        requireInventory: true,
        inventory: [{ partId: base.partId, color: base.color, quantity: 1 }],
      }),
    ).toMatchObject({ allowed: true });
    const tipping = {
      ...empty,
      bricks: [
        { ...base, partId: '3003' },
        { ...base, id: 'arm', partId: '3009', y: 3 },
      ],
    };
    expect(evaluateAssemblyPolicy(tipping)).toMatchObject({
      allowed: false,
      physical: { status: 'infeasible' },
    });
    expect(evaluateAssemblyPolicy(tipping, { rejectInfeasible: false })).toMatchObject({
      allowed: true,
      physical: { status: 'infeasible' },
      buildability: { certified: false },
    });
  });

  it('rechecks current policy on apply and fails closed on invalid host data', () => {
    const patch = { operations: [{ type: 'add' as const, brick: base }] };
    expect(previewPatch(empty, patch).ok).toBe(true);
    expect(applyPatch(empty, patch, { policy: { requireInventory: true } })).toMatchObject({
      ok: false,
      error: { code: 'inventory_unknown' },
    });
    expect(
      evaluateAssemblyPolicy(empty, { physical: { data: { version: 2 } } } as never),
    ).toMatchObject({
      allowed: false,
      physical: null,
      issues: [expect.objectContaining({ code: 'invalid_policy' })],
    });
    expect(
      evaluateAssemblyPolicy(empty, { physical: { estimateMissingMasses: 'yes' } } as never),
    ).toMatchObject({ allowed: false });
    expect(evaluateAssemblyPolicy(empty, { evidence: {} } as never)).toMatchObject({
      allowed: false,
    });
    expect(
      evaluateAssemblyPolicy(empty, {
        inventory: [
          { partId: '3001', color: 4, quantity: 1 },
          { partId: '3001', color: 4, quantity: 2 },
        ],
      }),
    ).toMatchObject({ allowed: false });
    expect(
      previewPatch(
        { ...empty, bricks: [base, base] },
        { operations: [{ type: 'remove', id: base.id }] },
      ),
    ).toMatchObject({ ok: false, error: { code: 'geometry_rejected' } });
  });
});

describe('example registry', () => {
  const definition: ExampleDefinition = {
    id: 'registry-fixture',
    name: 'Registry fixture',
    tags: ['registry'],
    expectedPieceCount: 1,
    build: (add) => add('3005', 4, 0, 0, 0),
  };

  it('reuses validated templates while isolating every returned assembly', () => {
    let builds = 0;
    const registry = createExampleRegistry([
      {
        ...definition,
        build(add) {
          builds += 1;
          add('3005', 4, 0, 0, 0);
        },
      },
    ]);
    const first = registry.createAssembly(definition.id);
    first.name = 'Changed';
    first.bricks[0].x = 10;
    const second = registry.createAssembly(definition.id);
    expect(builds).toBe(1);
    expect(second.name).toBe(definition.name);
    expect(second.bricks[0].x).toBe(0);
    expect(validateAssembly(second)).toEqual([]);
  });

  it('rejects duplicate IDs and malformed metadata', () => {
    expect(() => createExampleRegistry([definition, definition])).toThrow('Duplicate example ID');
    for (const change of [
      { id: 'Bad ID' },
      { name: '  ' },
      { expectedPieceCount: -1 },
      { expectedPieceCount: 0.5 },
    ]) {
      expect(() => createExampleRegistry([{ ...definition, ...change }])).toThrow(
        'Invalid example metadata',
      );
    }
  });

  it('rejects invalid placements and incorrect expected counts', () => {
    const floating = createExampleRegistry([
      { ...definition, build: (add) => add('3005', 4, 0, 1, 0) },
    ]);
    expect(() => floating.createAssembly(definition.id)).toThrow('unsupported');
    const miscounted = createExampleRegistry([{ ...definition, expectedPieceCount: 2 }]);
    expect(() => miscounted.createAssembly(definition.id)).toThrow('expected 2 pieces, got 1');
  });

  it('exposes immutable metadata without builders and creates fresh assemblies', () => {
    const tags = ['registry'];
    const registry = createExampleRegistry([{ ...definition, tags }]);
    tags.push('changed');
    expect(registry.examples[0].tags).toEqual(['registry']);
    expect(registry.examples[0]).not.toHaveProperty('build');
    expect(Object.isFrozen(registry.examples)).toBe(true);
    expect(Object.isFrozen(registry.examples[0])).toBe(true);
    const first = registry.createAssembly(definition.id);
    const second = registry.createAssembly(definition.id);
    expect(first).toEqual(second);
    expect(first.bricks[0]).not.toBe(second.bricks[0]);
    expect(() => registry.createAssembly('unknown')).toThrow('Unknown example');
    expect(createDemoAssembly().bricks.map((brick) => brick.id)).toEqual(
      Array.from({ length: 383 }, (_, index) => `demo-${index + 1}`),
    );
  });
});
