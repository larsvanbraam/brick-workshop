import solver from 'javascript-lp-solver';
import type { SolverAPI } from 'javascript-lp-solver';
import { footprint, getConnectionSites, getPart, isRuntimePart, validateAssembly } from './core.ts';
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
}

export interface PhysicalAssessment {
  status: 'empty' | 'invalid-geometry' | 'infeasible' | 'unknown';
  connectionModel: 'curated' | 'unknown';
  gravity: 'not-assessed' | 'balanced' | 'requires-clutch' | 'unstable';
  connectionStrength: 'unknown' | 'within-supplied-limit' | 'exceeds-supplied-limit';
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
            ? 'passed'
            : 'unknown',
      detail:
        'Only the supplied uniform tensile cap and safety factor are checked; shear, wear and real clutch behavior are not verified.',
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
export const MAX_PHYSICS_PIECES = 200;
export const MAX_PHYSICS_CONTACT_VARIABLES = 4000;
const TOLERANCE = 1e-7;
const ASSUMPTIONS = [
  'Upright rigid rectangular bodies under gravity on a flat, non-adhesive floor; no external loads.',
  'Full overlapping body rectangles transmit compression; matching studs alone transmit tension.',
  'Compression, bending, shear, friction, wear and insertion forces are not strength-verified.',
  'Absent supplied centers of mass, body footprint centers are assumed; color/material differences are not modeled.',
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

function worldCenter(brick: Brick, mass: PartMass) {
  const part = getPart(brick.partId);
  const center = mass.centerOfMassStuds ?? { x: part.width / 2, z: part.depth / 2 };
  let { x, z } = center;
  if (brick.rotation === 90) [x, z] = [center.z, part.width - center.x];
  if (brick.rotation === 180) [x, z] = [part.width - center.x, part.depth - center.z];
  if (brick.rotation === 270) [x, z] = [part.depth - center.z, center.x];
  return { x: brick.x + x, z: brick.z + z };
}

export function assessPhysicalFeasibility(
  assembly: Assembly,
  options: PhysicalOptions = {},
): PhysicalAssessment {
  const data = importPhysicalData(options.data ?? { version: 1, parts: {} });
  const hasRuntimeParts = assembly.bricks.some((brick) => isRuntimePart(brick.partId));
  const report: PhysicalAssessment = {
    status: assembly.bricks.length ? 'unknown' : 'empty',
    connectionModel: hasRuntimeParts ? 'unknown' : 'curated',
    gravity: 'not-assessed',
    connectionStrength: 'unknown',
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
  if (bodies.some(({ brick }) => getPart(brick.partId).shape)) {
    report.reasons.push(
      'Unsupported contact surfaces of shaped parts and thin baseplates are outside the rectangular static solver; gravity, hinge behaviour, flexure and connection strength remain unknown.',
    );
    return report;
  }
  if (bodies.length > MAX_PHYSICS_PIECES) {
    report.reasons.push(
      `Static analysis is limited to ${MAX_PHYSICS_PIECES} pieces; this build was not assessed.`,
    );
    return report;
  }
  const contacts: {
    lower: number | null;
    upper: number;
    corners: { x: number; z: number }[];
    studs: { x: number; z: number }[];
  }[] = [];
  for (const [upper, { brick }] of bodies.entries()) {
    const size = footprint(brick);
    const supports = brick.y === 0 ? [null] : bodies.map((_, index) => index);
    for (const lower of supports) {
      const support = lower === null ? null : bodies[lower].brick;
      const supportSize = support ? footprint(support) : null;
      if (support && support.y + supportSize!.height !== brick.y) continue;
      const left = Math.max(brick.x, support?.x ?? brick.x);
      const right = Math.min(
        brick.x + size.width,
        support ? support.x + supportSize!.width : brick.x + size.width,
      );
      const near = Math.max(brick.z, support?.z ?? brick.z);
      const far = Math.min(
        brick.z + size.depth,
        support ? support.z + supportSize!.depth : brick.z + size.depth,
      );
      if (left >= right || near >= far) continue;
      const studs = support ? getConnectionSites(support, 'top') : [];
      const receivers = new Set(
        getConnectionSites(brick, 'bottom').map((site) => `${site.x}:${site.z}`),
      );
      contacts.push({
        lower,
        upper,
        corners: [
          { x: left, z: near },
          { x: right, z: near },
          { x: right, z: far },
          { x: left, z: far },
        ],
        studs: studs.filter((site) => receivers.has(`${site.x}:${site.z}`)),
      });
    }
  }
  if (
    contacts.reduce((sum, contact) => sum + 4 + contact.studs.length, 0) >
    MAX_PHYSICS_CONTACT_VARIABLES
  ) {
    report.reasons.push(
      'Contact complexity exceeds the static analysis limit; no result is assumed.',
    );
    return report;
  }
  const model = {
    optimize: 'tension',
    opType: 'min' as const,
    constraints: {} as Record<string, { equal?: number; max?: number }>,
    variables: {} as Record<string, Record<string, number>>,
  };
  for (const [index, body] of bodies.entries()) {
    model.constraints[`force${index}`] = { equal: body.weight };
    model.constraints[`momentX${index}`] = { equal: body.weight * body.center.x };
    model.constraints[`momentZ${index}`] = { equal: body.weight * body.center.z };
  }
  const variables: { name: string; contact: number; tension: boolean }[] = [];
  for (const [contactIndex, contact] of contacts.entries()) {
    for (const [tension, sites] of [
      [false, contact.corners],
      [true, contact.studs],
    ] as const) {
      for (const [siteIndex, site] of sites.entries()) {
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
        model.variables[name] = coefficients;
        variables.push({ name, contact: contactIndex, tension });
      }
    }
  }
  const solve = () => {
    try {
      const result = (solver as unknown as SolverAPI).Solve(model, 1e-10) as {
        feasible: boolean;
        bounded: boolean;
        [name: string]: number | boolean;
      };
      if (typeof result.feasible !== 'boolean') return null;
      if (!result.feasible) return result;
      if (!result.bounded || !Number.isFinite(result.result)) return null;
      for (const [name, bounds] of Object.entries(model.constraints)) {
        const total = Object.entries(model.variables).reduce(
          (sum, [variable, coefficients]) =>
            sum + Number(result[variable] ?? 0) * (coefficients[name] ?? 0),
          0,
        );
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
  const solution = solve();
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
  let selectedSolution = solution;
  report.minimumStudTensionNewtons = Math.max(0, Number(solution.result));
  report.gravity = report.minimumStudTensionNewtons > TOLERANCE ? 'requires-clutch' : 'balanced';
  if (data.studConnection) {
    const limit = data.studConnection.maxTensionPerStudNewtons / data.studConnection.safetyFactor;
    for (const variable of variables.filter((variable) => variable.tension)) {
      model.constraints[variable.name] = { max: limit };
      model.variables[variable.name][variable.name] = 1;
    }
    const limited = solve();
    if (!limited) {
      report.reasons.push('The supplied connection limits could not be assessed reliably.');
      return report;
    }
    report.connectionStrength = limited.feasible
      ? 'within-supplied-limit'
      : 'exceeds-supplied-limit';
    if (limited.feasible) selectedSolution = limited;
    else {
      report.status = 'infeasible';
      report.reasons.push(
        'No equilibrium within the supplied per-stud tension limit and safety factor.',
      );
    }
  }
  report.connections = contacts.flatMap((contact, index) => {
    if (contact.lower === null) return [];
    const load = {
      lowerId: bodies[contact.lower].brick.id,
      upperId: bodies[contact.upper].brick.id,
      studCount: contact.studs.length,
      compressionNewtons: 0,
      tensionNewtons: 0,
    };
    for (const variable of variables.filter((variable) => variable.contact === index)) {
      const force = Math.max(0, Number(selectedSolution[variable.name] ?? 0));
      if (variable.tension) load.tensionNewtons += force;
      else load.compressionNewtons += force;
    }
    return [load];
  });
  if (report.massBasis !== 'measured')
    report.reasons.push(
      'Masses include estimates; stability conclusions depend on those estimates.',
    );
  if (!data.studConnection)
    report.reasons.push(
      'Stud tensile strength is unknown; no measured connection limit was supplied.',
    );
  report.reasons.push(
    'Static equilibrium is not physical build certification; bending, compression strength and real assembly access remain unverified.',
  );
  return report;
}
