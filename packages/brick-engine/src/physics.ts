import solver from 'javascript-lp-solver';
import type { SolverAPI } from 'javascript-lp-solver';
import {
  INSERT_FRAME_PARTS,
  footprint,
  getConnectionSites,
  getPart,
  getSideMountHosts,
  isMatchingInsertFrame,
  isRuntimePart,
  validateAssembly,
} from './core.ts';
import type { Assembly, Brick } from './core.ts';
import { CATALOG_PART_MASSES } from './part-masses.ts';

export interface PartMass {
  massGrams: number;
  kind: 'measured' | 'estimated' | 'catalog';
  source: string;
  catalog?: {
    provider: 'bricklink';
    partId: string;
    url: string;
    retrievedAt: string;
    mappingNote: string;
  };
  centerOfMassStuds?: { x: number; z: number };
}

export interface PhysicalData {
  version: 1;
  parts: Record<string, PartMass>;
  studConnection?: {
    maxTensionPerStudNewtons: number;
    safetyFactor: number;
    source: string;
  };
}

export interface PhysicalOptions {
  data?: PhysicalData;
  estimateMissingMasses?: boolean;
  useCatalogMasses?: boolean;
  /**
   * Check stud tension against DEFAULT_STUD_CONNECTION when the data supplies no limit of its
   * own. On unless set to false.
   */
  useDefaultStudConnection?: boolean;
}

/**
 * A rough per-stud pull-apart strength, used when no measured limit is supplied. Published
 * figures are scarce: about 3-5 N to pull two bricks apart is commonly quoted, roughly 1 N a
 * stud for a 2 x 2, halved again for worn bricks and sustained load.
 */
export const DEFAULT_STUD_CONNECTION: Readonly<NonNullable<PhysicalData['studConnection']>> =
  Object.freeze({
    maxTensionPerStudNewtons: 1,
    safetyFactor: 2,
    source:
      'Unmeasured default: about 1 N a stud from commonly quoted 3-5 N brick pull-apart forces, halved for wear and sustained load.',
  });

export interface PhysicalAssessment {
  status: 'empty' | 'invalid-geometry' | 'infeasible' | 'unknown';
  connectionModel: 'curated' | 'unknown';
  gravity: 'not-assessed' | 'balanced' | 'requires-clutch' | 'unstable';
  connectionStrength: 'unknown' | 'within-supplied-limit' | 'exceeds-supplied-limit';
  /** Where the per-stud limit came from: the physical data, the default, or nowhere. */
  connectionBasis: 'none' | 'supplied' | 'default';
  /** The per-stud tension allowed after the safety factor, when a limit applies. */
  studTensionLimitNewtons: number | null;
  /**
   * Each group of connected pieces standing on the floor: its center of mass (x and z in studs,
   * y in plates), the outline of its floor contact, and whether that center falls outside it.
   * Stud joints can resist any turning with enough tension, so without a stud limit a group
   * tipping over its floor outline is the only way a build fails to balance.
   */
  groundedGroups: {
    pieceCount: number;
    centerOfMass: { x: number; y: number; z: number };
    support: { x: number; z: number }[];
    tips: boolean;
  }[];
  /** With the stud limit exceeded, the joints that pull apart, worst first. */
  overloadedConnections: {
    lowerId: string;
    upperId: string;
    studCount: number;
    tensionNewtons: number;
  }[];
  massBasis: 'missing' | 'measured' | 'estimated' | 'catalog' | 'mixed';
  totalMassGrams: number | null;
  centerOfMassStuds: { x: number; z: number } | null;
  missingMassPartIds: string[];
  masses: { brickId: string; partId: string; mass: PartMass }[];
  minimumStudTensionNewtons: number | null;
  connections: {
    lowerId: string;
    upperId: string;
    studCount: number;
    compressionNewtons: number;
    tensionNewtons: number;
  }[];
  assemblyOrder: string[];
  assumptions: string[];
  reasons: string[];
}

export interface BuildabilityReport {
  status: 'failed' | 'not-certified';
  certified: false;
  label: string;
  checks: {
    id: string;
    label: string;
    status: 'passed' | 'estimated' | 'reported' | 'failed' | 'unknown';
    detail: string;
  }[];
  blockers: string[];
}

export function getBuildabilityReport(assessment: PhysicalAssessment): BuildabilityReport {
  const hasBuild = assessment.status !== 'empty';
  const geometryValid = hasBuild && assessment.status !== 'invalid-geometry';
  const connectionModelKnown = assessment.connectionModel === 'curated';
  const completeMasses =
    geometryValid && assessment.massBasis !== 'missing' && assessment.masses.length > 0;
  const measuredMasses = completeMasses && assessment.massBasis === 'measured';
  const catalogMasses = assessment.masses.some(({ mass }) => mass.kind === 'catalog');
  const estimatedMasses = assessment.masses.some(({ mass }) => mass.kind === 'estimated');
  const suppliedCenters =
    completeMasses && assessment.masses.every(({ mass }) => mass.centerOfMassStuds !== undefined);
  const gravityAssessed =
    assessment.gravity === 'balanced' || assessment.gravity === 'requires-clutch';
  const checks: BuildabilityReport['checks'] = [
    {
      id: 'geometry',
      label: 'Geometry',
      status: !hasBuild
        ? 'unknown'
        : !geometryValid
          ? 'failed'
          : connectionModelKnown
            ? 'passed'
            : 'unknown',
      detail: connectionModelKnown
        ? 'Curated bounds, collisions and grounded stud connections only.'
        : 'Envelope bounds and contacts only; runtime connector geometry is unknown.',
    },
    {
      id: 'mass',
      label: 'Part masses',
      status: !completeMasses
        ? 'unknown'
        : measuredMasses
          ? 'passed'
          : estimatedMasses
            ? 'estimated'
            : catalogMasses
              ? 'reported'
              : 'unknown',
      detail: measuredMasses
        ? 'Declared measured masses supplied; provenance is not independently authenticated.'
        : catalogMasses
          ? 'Includes catalogue-reported nominal weights, not independently measured exact-piece masses.'
          : 'Actual measured masses are required; envelope proxies are not measured part weights.',
    },
    {
      id: 'centers',
      label: 'Centers of mass',
      status: !completeMasses ? 'unknown' : suppliedCenters ? 'passed' : 'estimated',
      detail: suppliedCenters
        ? 'Local centers supplied by the data owner; measurement evidence is not independently verified.'
        : 'Body-center assumptions are not verified centers of mass.',
    },
    {
      id: 'gravity',
      label: 'Gravity equilibrium',
      status:
        assessment.gravity === 'unstable'
          ? 'failed'
          : !gravityAssessed
            ? 'unknown'
            : measuredMasses && suppliedCenters
              ? 'passed'
              : 'estimated',
      detail:
        assessment.gravity === 'requires-clutch'
          ? 'Equilibrium requires stud tension; connection capacity must be checked separately.'
          : 'Static force and moment equilibrium under the declared rigid-body assumptions only.',
    },
    {
      id: 'connections',
      label: 'Stud tensile limits',
      status:
        assessment.connectionStrength === 'exceeds-supplied-limit'
          ? 'failed'
          : assessment.connectionStrength === 'within-supplied-limit'
            ? assessment.connectionBasis === 'default'
              ? 'estimated'
              : 'passed'
            : 'unknown',
      detail:
        assessment.connectionBasis === 'default'
          ? 'Checked against an unmeasured default per-stud pull-apart limit; shear, wear and real clutch behavior are not verified.'
          : 'Only the supplied uniform tensile cap and safety factor are checked; shear, wear and real clutch behavior are not verified.',
    },
    {
      id: 'body-strength',
      label: 'Body strength',
      status: 'unknown',
      detail:
        'Bending, shear, compression strength, deformation and real contact patches have not been verified.',
    },
    {
      id: 'construction',
      label: 'Construction sequence',
      status: 'unknown',
      detail:
        'Intermediate stability, temporary supports, insertion forces and hand/tool clearance have not been verified.',
    },
    {
      id: 'robustness',
      label: 'Disturbance resistance',
      status: 'unknown',
      detail:
        'Tipping margin, tolerances, material variation, impacts and intended handling conditions have not been verified.',
    },
    {
      id: 'evidence',
      label: 'Independent evidence',
      status: 'unknown',
      detail:
        'Mass, center-of-mass and connection measurements have not been independently authenticated.',
    },
    {
      id: 'physical-validation',
      label: 'Physical validation',
      status: 'unknown',
      detail:
        'No assembled-model inspection or physical load-test evidence is available. An absolute guarantee under every real-world condition cannot be established by this engine.',
    },
  ];
  return {
    status: checks.some((check) => check.status === 'failed') ? 'failed' : 'not-certified',
    certified: false,
    label: !hasBuild
      ? 'No build to assess'
      : checks.some((check) => check.status === 'failed')
        ? 'Required checks failed'
        : 'Buildability not certified',
    checks,
    blockers: checks.filter((check) => check.status !== 'passed').map((check) => check.label),
  };
}

const GRAVITY = 9.80665;
export const MAX_PHYSICS_PIECES = 500;
export const MAX_PHYSICS_CONTACT_VARIABLES = 8000;
const TOLERANCE = 1e-7;
const ASSUMPTIONS = [
  'Upright rigid bodies under gravity on a flat, non-adhesive floor; no external loads.',
  'Overlapping flat faces transmit compression; matching studs alone transmit tension.',
  'Shaped parts bear only where they have studs or receivers (a slope on its rear row, an arch on its legs); door and window frames, baseplates and anything on the floor bear on their whole footprint.',
  'Pieces mounted on side studs and panes or doors hung in frames are rigidly clamped to their hosts; sideways stud loads are not strength-checked.',
  'Compression, bending, shear, friction, wear and insertion forces are not strength-verified.',
  'Absent supplied centers of mass, slopes are taken as a rear block plus a wedge and other bodies as even across their footprint; color/material differences are not modeled.',
  'Bottom-up order has ideal vertical insertion clearance only; hand/tool access is not verified.',
  'Assembly order does not verify intermediate construction stability or temporary supports.',
  'Equilibrium may be marginal at a support edge; perturbations and minimum tipping margins are not verified.',
];

export function importPhysicalData(input: unknown): PhysicalData {
  const data = structuredClone(input) as PhysicalData;
  if (
    !data ||
    data.version !== 1 ||
    !data.parts ||
    typeof data.parts !== 'object' ||
    Array.isArray(data.parts)
  )
    throw new Error('Physical data requires version 1 and a parts object.');
  const positive = (value: number) =>
    Number.isFinite(value) && value >= 0.000001 && value <= 1_000_000;
  const source = (value: string) => typeof value === 'string' && value.trim().length > 0;
  for (const [partId, mass] of Object.entries(data.parts)) {
    const part = getPart(partId);
    if (
      !mass ||
      !positive(mass.massGrams) ||
      !['measured', 'estimated', 'catalog'].includes(mass.kind) ||
      !source(mass.source)
    )
      throw new Error(`Invalid mass or provenance for ${partId}.`);
    if (mass.kind === 'catalog' || mass.catalog !== undefined) {
      const catalog = mass.catalog;
      if (
        !catalog ||
        catalog.provider !== 'bricklink' ||
        catalog.partId !== CATALOG_PART_MASSES[partId]?.catalog?.partId ||
        !source(catalog.mappingNote) ||
        typeof catalog.retrievedAt !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(catalog.retrievedAt) ||
        !Number.isFinite(Date.parse(catalog.retrievedAt)) ||
        new Date(catalog.retrievedAt).toISOString().slice(0, 10) !== catalog.retrievedAt
      )
        throw new Error(`Catalogue mass requires valid provenance for ${partId}.`);
      const url = new URL(catalog.url);
      if (
        url.origin !== 'https://www.bricklink.com' ||
        url.pathname !== '/v2/catalog/catalogitem.page' ||
        url.username ||
        url.password ||
        url.hash ||
        [...url.searchParams.keys()].join() !== 'P' ||
        url.searchParams.get('P') !== catalog.partId
      )
        throw new Error(`Invalid catalogue source URL for ${partId}.`);
    }
    const center = mass.centerOfMassStuds;
    if (
      center &&
      (!Number.isFinite(center.x) ||
        !Number.isFinite(center.z) ||
        center.x < 0 ||
        center.x > part.width ||
        center.z < 0 ||
        center.z > part.depth)
    )
      throw new Error(`Invalid center of mass for ${partId}.`);
  }
  const connection = data.studConnection;
  if (
    connection &&
    (!positive(connection.maxTensionPerStudNewtons) ||
      !Number.isFinite(connection.safetyFactor) ||
      connection.safetyFactor < 1 ||
      !source(connection.source))
  )
    throw new Error('Connection limits require positive force, safety factor >= 1 and provenance.');
  return data;
}

function estimatedMass(brick: Brick): PartMass {
  const size = footprint(brick);
  return {
    massGrams: (size.width * 8 * size.depth * 8 * size.height * 3.2 * 1.05) / 1000,
    kind: 'estimated',
    source:
      'Solid rectangular ABS envelope proxy: 8 mm stud pitch, 3.2 mm plate height, assumed density 1.05 g/cm3. Ignores cavities and studs; NOT an actual part weight.',
  };
}

/**
 * Where a part's weight acts in its own studs. Slopes, upright or inverted, are a one-stud
 * block at the high rear end (z = depth) with a wedge tapering away to the front, so their
 * mass sits toward the rear. Everything else is assumed even across its body.
 */
function localCenter(partId: string) {
  const part = getPart(partId);
  const run = part.depth - 1;
  if ((part.shape === 'slope' || part.shape === 'inverted-slope') && run > 0) {
    const fromRear = (0.5 + (run / 2) * (1 + run / 3)) / (1 + run / 2);
    return { x: part.width / 2, z: part.depth - fromRear };
  }
  return { x: part.width / 2, z: part.depth / 2 };
}

function worldCenter(brick: Brick, mass: PartMass) {
  const part = getPart(brick.partId);
  const center = mass.centerOfMassStuds ?? localCenter(brick.partId);
  let { x, z } = center;
  if (brick.rotation === 90) [x, z] = [center.z, part.width - center.x];
  if (brick.rotation === 180) [x, z] = [part.width - center.x, part.depth - center.z];
  if (brick.rotation === 270) [x, z] = [part.depth - center.z, center.x];
  return { x: brick.x + x, z: brick.z + z };
}

interface Rectangle {
  left: number;
  right: number;
  near: number;
  far: number;
}

const EPSILON = 1e-9;

function floorRectangle(brick: Brick): Rectangle {
  const size = footprint(brick);
  return { left: brick.x, right: brick.x + size.width, near: brick.z, far: brick.z + size.depth };
}

/** Shapes whose top is only flat where its studs are: a slope's rear row, a cone's tip. */
const STUDDED_TOPS = new Set(['slope', 'round', 'cone', 'detail', 'foliage']);
/** Shapes whose underside is cut away except at its receivers: an arch's legs. */
const OPEN_UNDERSIDES = new Set(['inverted-slope', 'arch', 'detail', 'foliage']);

/**
 * Where a piece can bear load on its top or underside. Plain bricks, plates and tiles are flat
 * across their whole body, as are door and window frames below and baseplates. Other shaped
 * parts are only flat where they have studs or receivers, and those one-stud cells are merged
 * into as few rectangles as a row-then-column sweep gives. An underside with no receivers at
 * all bears on its whole body.
 */
function bearingRectangles(brick: Brick, surface: 'top' | 'bottom'): Rectangle[] {
  const shape = getPart(brick.partId).shape;
  if (!shape || !(surface === 'top' ? STUDDED_TOPS : OPEN_UNDERSIDES).has(shape))
    return [floorRectangle(brick)];
  const rows = new Map<number, number[]>();
  for (const site of getConnectionSites(brick, surface))
    rows.set(site.z, [...(rows.get(site.z) ?? []), site.x]);
  const runs: Rectangle[] = [];
  for (const [z, xs] of [...rows].sort(([first], [second]) => first - second)) {
    xs.sort((first, second) => first - second);
    let start = xs[0];
    for (const [index, x] of xs.entries()) {
      const next = xs[index + 1];
      if (next !== undefined && Math.abs(next - x - 1) < EPSILON) continue;
      runs.push({ left: start - 0.5, right: x + 0.5, near: z - 0.5, far: z + 0.5 });
      start = next;
    }
  }
  if (!runs.length) return surface === 'bottom' ? [floorRectangle(brick)] : [];
  const merged: Rectangle[] = [];
  for (const run of runs) {
    const above = merged.find(
      (rectangle) =>
        Math.abs(rectangle.left - run.left) < EPSILON &&
        Math.abs(rectangle.right - run.right) < EPSILON &&
        Math.abs(rectangle.far - run.near) < EPSILON,
    );
    if (above) above.far = run.far;
    else merged.push({ ...run });
  }
  return merged;
}

type Point = { x: number; z: number };

/**
 * Whether a point lies within a convex hull from convexHull, edges included. A hull of one or
 * two points is a single spot or edge, which only points on it are within.
 */
function inside(hull: readonly Point[], point: Point) {
  const cross = (origin: Point, first: Point, second: Point) =>
    (first.x - origin.x) * (second.z - origin.z) - (first.z - origin.z) * (second.x - origin.x);
  if (hull.length === 1) return Math.hypot(hull[0].x - point.x, hull[0].z - point.z) < 1e-6;
  if (hull.length === 2) {
    const [start, end] = hull;
    const length = Math.hypot(end.x - start.x, end.z - start.z);
    const along =
      ((point.x - start.x) * (end.x - start.x) + (point.z - start.z) * (end.z - start.z)) /
      length ** 2;
    return (
      Math.abs(cross(start, end, point)) / length < 1e-6 && along >= -1e-6 && along <= 1 + 1e-6
    );
  }
  return hull.every(
    (corner, index) => cross(corner, hull[(index + 1) % hull.length], point) >= -1e-6,
  );
}

/** The corners of the convex hull of some points, without points along its edges. */
function convexHull(points: readonly { x: number; z: number }[]) {
  const sorted = [
    ...new Map(points.map((point) => [`${point.x}:${point.z}`, point])).values(),
  ].sort((first, second) => first.x - second.x || first.z - second.z);
  if (sorted.length < 3) return sorted;
  const turn = (
    origin: { x: number; z: number },
    first: { x: number; z: number },
    second: { x: number; z: number },
  ) => (first.x - origin.x) * (second.z - origin.z) - (first.z - origin.z) * (second.x - origin.x);
  const chain = (ordered: { x: number; z: number }[]) => {
    const hull: { x: number; z: number }[] = [];
    for (const point of ordered) {
      while (hull.length >= 2 && turn(hull.at(-2)!, hull.at(-1)!, point) <= EPSILON) hull.pop();
      hull.push(point);
    }
    return hull.slice(0, -1);
  };
  const hull = [...chain(sorted), ...chain([...sorted].reverse())];
  // Points all on one line leave just its two ends.
  return hull.length ? hull : [sorted[0], sorted.at(-1)!];
}

/**
 * The latest assessment of each bricks array, for the options it ran with. Like validations,
 * assemblies and physical data are treated as immutable.
 */
const assessments = new WeakMap<
  readonly Brick[],
  {
    buildArea: number | undefined;
    data: PhysicalData | undefined;
    estimateMissingMasses: boolean | undefined;
    useCatalogMasses: boolean | undefined;
    useDefaultStudConnection: boolean | undefined;
    report: PhysicalAssessment;
  }
>();

export function assessPhysicalFeasibility(
  assembly: Assembly,
  options: PhysicalOptions = {},
): PhysicalAssessment {
  return structuredClone(sharedPhysicalAssessment(assembly, options));
}

/**
 * assessPhysicalFeasibility without the copy: the report is shared by everyone who asks for
 * the same assembly and options, so it must not be changed.
 */
export function sharedPhysicalAssessment(
  assembly: Assembly,
  options: PhysicalOptions = {},
): PhysicalAssessment {
  const cached = assessments.get(assembly.bricks);
  if (
    cached &&
    cached.buildArea === assembly.buildArea &&
    cached.data === options.data &&
    cached.estimateMissingMasses === options.estimateMissingMasses &&
    cached.useCatalogMasses === options.useCatalogMasses &&
    cached.useDefaultStudConnection === options.useDefaultStudConnection
  )
    return cached.report;
  const report = computePhysicalAssessment(assembly, options);
  // Registering a part can make invalid geometry valid, so only valid builds are kept.
  if (report.status !== 'invalid-geometry')
    assessments.set(assembly.bricks, {
      buildArea: assembly.buildArea,
      data: options.data,
      estimateMissingMasses: options.estimateMissingMasses,
      useCatalogMasses: options.useCatalogMasses,
      useDefaultStudConnection: options.useDefaultStudConnection,
      report,
    });
  return report;
}

function computePhysicalAssessment(
  assembly: Assembly,
  options: PhysicalOptions,
): PhysicalAssessment {
  const data = importPhysicalData(options.data ?? { version: 1, parts: {} });
  const hasRuntimeParts = assembly.bricks.some((brick) => isRuntimePart(brick.partId));
  const report: PhysicalAssessment = {
    status: assembly.bricks.length ? 'unknown' : 'empty',
    connectionModel: hasRuntimeParts ? 'unknown' : 'curated',
    gravity: 'not-assessed',
    connectionStrength: 'unknown',
    connectionBasis: 'none',
    studTensionLimitNewtons: null,
    groundedGroups: [],
    overloadedConnections: [],
    massBasis: 'missing',
    totalMassGrams: null,
    centerOfMassStuds: null,
    missingMassPartIds: [],
    masses: [],
    minimumStudTensionNewtons: null,
    connections: [],
    assemblyOrder: [],
    assumptions: [...ASSUMPTIONS],
    reasons: hasRuntimeParts
      ? ['Runtime part contacts use bounding envelopes; connector fit is unknown.']
      : [],
  };
  const geometry = validateAssembly(assembly);
  if (geometry.length) {
    report.status = 'invalid-geometry';
    report.reasons.push('Resolve geometry issues before physical assessment.');
    return report;
  }
  if (!assembly.bricks.length) return report;
  for (const brick of assembly.bricks) {
    const mass =
      data.parts[brick.partId] ??
      (options.useCatalogMasses !== false ? CATALOG_PART_MASSES[brick.partId] : undefined) ??
      (options.estimateMissingMasses ? estimatedMass(brick) : null);
    if (mass) report.masses.push({ brickId: brick.id, partId: brick.partId, mass });
    else report.missingMassPartIds.push(brick.partId);
  }
  report.missingMassPartIds = [...new Set(report.missingMassPartIds)];
  if (report.missingMassPartIds.length) {
    report.reasons.push('Part masses are missing; gravity and total weight are unknown.');
    return report;
  }
  const kinds = new Set(report.masses.map(({ mass }) => mass.kind));
  report.massBasis = kinds.size > 1 ? 'mixed' : report.masses[0].mass.kind;
  const bodies = assembly.bricks.map((brick, index) => {
    const mass = report.masses[index].mass;
    return {
      brick,
      mass,
      center: worldCenter(brick, mass),
      weight: (mass.massGrams * GRAVITY) / 1000,
    };
  });
  report.totalMassGrams = bodies.reduce((sum, body) => sum + body.mass.massGrams, 0);
  report.centerOfMassStuds = {
    x:
      bodies.reduce((sum, body) => sum + body.center.x * body.mass.massGrams, 0) /
      report.totalMassGrams,
    z:
      bodies.reduce((sum, body) => sum + body.center.z * body.mass.massGrams, 0) /
      report.totalMassGrams,
  };
  report.assemblyOrder = [...bodies]
    .sort((first, second) => first.brick.y - second.brick.y)
    .map(({ brick }) => brick.id);
  if (bodies.length > MAX_PHYSICS_PIECES) {
    report.reasons.push(
      `Static analysis is limited to ${MAX_PHYSICS_PIECES} pieces; this build was not assessed.`,
    );
    return report;
  }
  // Upright pieces standing on studs are the solver's rigid bodies. A piece mounted on side
  // studs is clamped to its hosts, and a pane or door hangs inside its frame, so their weight
  // and leverage are carried by those hosts, shared equally between several.
  const carriers = getSideMountHosts(assembly.bricks);
  const framesByPart = new Map<string, Brick[]>();
  for (const brick of assembly.bricks)
    framesByPart.set(brick.partId, [...(framesByPart.get(brick.partId) ?? []), brick]);
  for (const brick of assembly.bricks) {
    const framePartId = INSERT_FRAME_PARTS[brick.partId];
    if (!framePartId || brick.facing) continue;
    const frames = (framesByPart.get(framePartId) ?? []).filter((frame) =>
      isMatchingInsertFrame(brick, frame),
    );
    if (frames.length)
      carriers.set(
        brick.id,
        frames.map((frame) => frame.id),
      );
  }
  const solids = bodies.filter(({ brick }) => !carriers.has(brick.id));
  const solidIndex = new Map(solids.map((body, index) => [body.brick.id, index]));
  const loads = solids.map((body) => ({
    weight: body.weight,
    momentX: body.weight * body.center.x,
    momentZ: body.weight * body.center.z,
  }));
  const carryingSolids = (id: string, seen = new Set<string>()): Map<number, number> => {
    const shares = new Map<number, number>();
    if (seen.has(id)) return shares;
    seen.add(id);
    const direct = carriers.get(id) ?? [];
    for (const host of direct) {
      const share = 1 / direct.length;
      const index = solidIndex.get(host);
      if (index !== undefined) shares.set(index, (shares.get(index) ?? 0) + share);
      else
        for (const [nested, part] of carryingSolids(host, seen))
          shares.set(nested, (shares.get(nested) ?? 0) + share * part);
    }
    return shares;
  };
  for (const body of bodies) {
    if (solidIndex.has(body.brick.id)) continue;
    const shares = carryingSolids(body.brick.id);
    if (!shares.size) {
      report.reasons.push(
        `Piece ${body.brick.id} has no upright host to carry it; gravity remains unknown.`,
      );
      return report;
    }
    for (const [index, share] of shares) {
      loads[index].weight += body.weight * share;
      loads[index].momentX += body.weight * share * body.center.x;
      loads[index].momentZ += body.weight * share * body.center.z;
    }
  }
  const contacts: {
    lower: number | null;
    upper: number;
    corners: { x: number; z: number }[];
    studs: { x: number; z: number }[];
  }[] = [];
  const bearings = solids.map(({ brick }) => ({
    top: bearingRectangles(brick, 'top'),
    bottom: bearingRectangles(brick, 'bottom'),
  }));
  const byTop = new Map<number, number[]>();
  for (const [index, { brick }] of solids.entries()) {
    const top = brick.y + footprint(brick).height;
    byTop.set(top, [...(byTop.get(top) ?? []), index]);
  }
  for (const [upper, { brick }] of solids.entries()) {
    const receivers = new Set(
      getConnectionSites(brick, 'bottom').map((site) => `${site.x}:${site.z}`),
    );
    const supports = brick.y === 0 ? [null] : (byTop.get(brick.y) ?? []);
    for (const lower of supports) {
      // Whatever a piece on the floor leans on, the floor catches, so it bears on its body.
      const below = lower === null ? [floorRectangle(brick)] : bearings[lower].top;
      const above = lower === null ? [floorRectangle(brick)] : bearings[upper].bottom;
      const corners = below.flatMap((first) =>
        above.flatMap((second) => {
          const left = Math.max(first.left, second.left);
          const right = Math.min(first.right, second.right);
          const near = Math.max(first.near, second.near);
          const far = Math.min(first.far, second.far);
          if (left >= right - EPSILON || near >= far - EPSILON) return [];
          return [
            { x: left, z: near },
            { x: right, z: near },
            { x: right, z: far },
            { x: left, z: far },
          ];
        }),
      );
      const studs =
        lower === null
          ? []
          : getConnectionSites(solids[lower].brick, 'top').filter((site) =>
              receivers.has(`${site.x}:${site.z}`),
            );
      if (!corners.length && !studs.length) continue;
      contacts.push({ lower, upper, corners, studs });
    }
  }
  // Pieces joined through studs, or carried by a host, stand or fall together.
  const parent = solids.map((_, index) => index);
  const find = (index: number): number =>
    parent[index] === index ? index : (parent[index] = find(parent[index]));
  for (const contact of contacts)
    if (contact.lower !== null) parent[find(contact.upper)] = find(contact.lower);
  const groups = new Map<
    number,
    { pieces: number; weight: number; x: number; y: number; z: number; floor: Point[] }
  >();
  const group = (root: number) => {
    let entry = groups.get(root);
    if (!entry) groups.set(root, (entry = { pieces: 0, weight: 0, x: 0, y: 0, z: 0, floor: [] }));
    return entry;
  };
  for (const body of bodies) {
    const index = solidIndex.get(body.brick.id) ?? [...carryingSolids(body.brick.id).keys()][0];
    const entry = group(find(index));
    const height = body.brick.y + footprint(body.brick).height / 2;
    entry.pieces += 1;
    entry.weight += body.weight;
    entry.x += body.weight * body.center.x;
    entry.y += body.weight * height;
    entry.z += body.weight * body.center.z;
  }
  for (const contact of contacts)
    if (contact.lower === null) group(find(contact.upper)).floor.push(...contact.corners);
  report.groundedGroups = [...groups.values()]
    .filter((entry) => entry.floor.length)
    .map((entry) => {
      const center = {
        x: entry.x / entry.weight,
        y: entry.y / entry.weight,
        z: entry.z / entry.weight,
      };
      const support = convexHull(entry.floor);
      return {
        pieceCount: entry.pieces,
        centerOfMass: center,
        support,
        tips: !inside(support, center),
      };
    });
  const studConnection =
    data.studConnection ??
    (options.useDefaultStudConnection !== false ? DEFAULT_STUD_CONNECTION : undefined);
  report.connectionBasis = data.studConnection ? 'supplied' : studConnection ? 'default' : 'none';
  report.studTensionLimitNewtons = studConnection
    ? studConnection.maxTensionPerStudNewtons / studConnection.safetyFactor
    : null;
  // The floor can only push, so a group whose center of mass falls outside everything it
  // stands on cannot balance, whatever holds it together; no solve is needed to say so.
  if (report.groundedGroups.some((group) => group.tips)) {
    report.gravity = 'unstable';
    report.status = 'infeasible';
    report.reasons.push(
      'No static gravity equilibrium, even with unlimited internal stud tension. The build or a disconnected component tips under this mass model.',
    );
    return report;
  }
  // Unlimited forces anywhere in a contact add up to the same totals and moments as forces at
  // the corners of its convex hull, so only those corners need a variable. A per-stud limit
  // caps each stud separately, so that check gives every stud its own.
  const pushes = contacts.map((contact) => convexHull(contact.corners));
  const count = (pulls: (typeof contacts)[number]['studs'][]) =>
    pulls.reduce((sum, pull, index) => sum + pushes[index].length + pull.length, 0);
  const hullPulls = contacts.map((contact) => convexHull(contact.studs));
  if (
    count(studConnection ? contacts.map((contact) => contact.studs) : hullPulls) >
    MAX_PHYSICS_CONTACT_VARIABLES
  ) {
    report.reasons.push(
      'Contact complexity exceeds the static analysis limit; no result is assumed.',
    );
    return report;
  }
  type Model = ReturnType<typeof buildModel>;
  const buildModel = (pulls: (typeof contacts)[number]['studs'][], limit?: number) => {
    const model = {
      optimize: 'tension',
      opType: 'min' as const,
      constraints: {} as Record<string, { equal?: number; max?: number }>,
      variables: {} as Record<string, Record<string, number>>,
      forces: [] as { name: string; contact: number; tension: boolean }[],
    };
    for (const [index, load] of loads.entries()) {
      model.constraints[`force${index}`] = { equal: load.weight };
      model.constraints[`momentX${index}`] = { equal: load.momentX };
      model.constraints[`momentZ${index}`] = { equal: load.momentZ };
    }
    for (const [contactIndex, contact] of contacts.entries()) {
      for (const [tension, points] of [
        [false, pushes[contactIndex]],
        [true, pulls[contactIndex]],
      ] as const) {
        for (const [siteIndex, site] of points.entries()) {
          const name = `${tension ? 'pull' : 'push'}${contactIndex}_${siteIndex}`;
          const sign = tension ? -1 : 1;
          const coefficients: Record<string, number> = {
            tension: tension ? 1 : 0,
            [`force${contact.upper}`]: sign,
            [`momentX${contact.upper}`]: sign * site.x,
            [`momentZ${contact.upper}`]: sign * site.z,
          };
          if (contact.lower !== null) {
            coefficients[`force${contact.lower}`] = -sign;
            coefficients[`momentX${contact.lower}`] = -sign * site.x;
            coefficients[`momentZ${contact.lower}`] = -sign * site.z;
          }
          if (tension && limit !== undefined) {
            model.constraints[name] = { max: limit };
            coefficients[name] = 1;
          }
          model.variables[name] = coefficients;
          model.forces.push({ name, contact: contactIndex, tension });
        }
      }
    }
    return model;
  };
  const solve = (model: Model) => {
    try {
      const result = (solver as unknown as SolverAPI).Solve(
        {
          optimize: model.optimize,
          opType: model.opType,
          constraints: model.constraints,
          variables: model.variables,
        },
        1e-10,
      ) as {
        feasible: boolean;
        bounded: boolean;
        [name: string]: number | boolean;
      };
      if (typeof result.feasible !== 'boolean') return null;
      if (!result.feasible) return result;
      if (!result.bounded || !Number.isFinite(result.result)) return null;
      const totals = new Map<string, number>();
      for (const [variable, coefficients] of Object.entries(model.variables)) {
        const value = Number(result[variable] ?? 0);
        if (!value) continue;
        for (const [name, coefficient] of Object.entries(coefficients))
          totals.set(name, (totals.get(name) ?? 0) + value * coefficient);
      }
      for (const [name, bounds] of Object.entries(model.constraints)) {
        const total = totals.get(name) ?? 0;
        const expected = bounds.equal ?? bounds.max!;
        const tolerance = 1e-7 * Math.max(Math.abs(expected), 0.001);
        if (
          !Number.isFinite(total) ||
          (bounds.equal !== undefined
            ? Math.abs(total - expected) > tolerance
            : total > expected + tolerance)
        )
          return null;
      }
      if (
        Object.keys(model.variables).some((variable) => Number(result[variable] ?? 0) < -TOLERANCE)
      )
        return null;
      return result;
    } catch {
      return null;
    }
  };
  const unlimited = buildModel(hullPulls);
  const solution = solve(unlimited);
  if (!solution) {
    report.reasons.push(
      'The static solver did not return a numerically verified result. Physical feasibility remains unknown.',
    );
    return report;
  }
  if (!solution.feasible) {
    report.gravity = 'unstable';
    report.status = 'infeasible';
    report.reasons.push(
      'No static gravity equilibrium, even with unlimited internal stud tension. The build or a disconnected component tips under this mass model.',
    );
    return report;
  }
  let selected = { model: unlimited, solution };
  report.minimumStudTensionNewtons = Math.max(0, Number(solution.result));
  report.gravity = report.minimumStudTensionNewtons > TOLERANCE ? 'requires-clutch' : 'balanced';
  if (studConnection) {
    // Hull corners are real studs, so when the unlimited solution already keeps every one of
    // them within the limit it is a capped solution too; only otherwise is each stud solved.
    const limit = report.studTensionLimitNewtons!;
    const withinLimit = unlimited.forces.every(
      (force) => !force.tension || Number(solution[force.name] ?? 0) <= limit * (1 + 1e-9),
    );
    if (withinLimit) report.connectionStrength = 'within-supplied-limit';
    else {
      const capped = buildModel(
        contacts.map((contact) => contact.studs),
        limit,
      );
      const limited = solve(capped);
      if (!limited) {
        report.reasons.push('The connection limits could not be assessed reliably.');
        return report;
      }
      report.connectionStrength = limited.feasible
        ? 'within-supplied-limit'
        : 'exceeds-supplied-limit';
      if (limited.feasible) selected = { model: capped, solution: limited };
      else {
        // The joints whose share of the least-tension balance is more than their studs can
        // hold, or failing that, those pulling hardest on any one stud.
        const pulls = contacts.map((contact, index) => {
          const forces = unlimited.forces.filter(
            (force) => force.tension && force.contact === index,
          );
          const values = forces.map((force) => Math.max(0, Number(solution[force.name] ?? 0)));
          return {
            contact,
            total: values.reduce((sum, value) => sum + value, 0),
            peak: Math.max(0, ...values),
          };
        });
        const tolerance = limit * 1e-9;
        const beyond = pulls.filter(
          ({ contact, total }) => total > limit * contact.studs.length + tolerance,
        );
        report.overloadedConnections = (
          beyond.length ? beyond : pulls.filter(({ peak }) => peak > limit + tolerance)
        )
          .filter(({ contact }) => contact.lower !== null)
          .sort((first, second) => second.total - first.total)
          .map(({ contact, total }) => ({
            lowerId: solids[contact.lower!].brick.id,
            upperId: solids[contact.upper].brick.id,
            studCount: contact.studs.length,
            tensionNewtons: total,
          }));
        report.status = 'infeasible';
        report.reasons.push(
          report.connectionBasis === 'default'
            ? 'No equilibrium within the default per-stud tension limit: an overhang or hanging load would pull its studs apart.'
            : 'No equilibrium within the supplied per-stud tension limit and safety factor.',
        );
      }
    }
  }
  report.connections = contacts.flatMap((contact, index) => {
    if (contact.lower === null) return [];
    const load = {
      lowerId: solids[contact.lower].brick.id,
      upperId: solids[contact.upper].brick.id,
      studCount: contact.studs.length,
      compressionNewtons: 0,
      tensionNewtons: 0,
    };
    for (const force of selected.model.forces.filter((force) => force.contact === index)) {
      const value = Math.max(0, Number(selected.solution[force.name] ?? 0));
      if (force.tension) load.tensionNewtons += value;
      else load.compressionNewtons += value;
    }
    return [load];
  });
  if (report.massBasis !== 'measured')
    report.reasons.push(
      'Masses include estimates; stability conclusions depend on those estimates.',
    );
  if (report.connectionBasis === 'default')
    report.reasons.push(
      'Stud tensile strength uses an unmeasured default limit; supply measured connection data to replace it.',
    );
  if (report.connectionBasis === 'none')
    report.reasons.push(
      'Stud tensile strength is unknown; no measured connection limit was supplied.',
    );
  report.reasons.push(
    'Static equilibrium is not physical build certification; bending, compression strength and real assembly access remain unverified.',
  );
  return report;
}
