import Ajv from 'ajv';
import type Anthropic from '@anthropic-ai/sdk';
import {
  BUILD_AREA,
  MAX_BUILD_AREA,
  COLORS,
  DEFAULT_PART_COLOR_EVIDENCE,
  MAX_HEIGHT,
  PARTS,
  assessPhysicalFeasibility,
  exportLDraw,
  getBillOfMaterials,
  getBuildArea,
  getBuildabilityReport,
  getPartColorStatus,
  importPartColorEvidence,
  importPhysicalData,
  placeBrick,
  removeBrick,
  validateAssembly,
} from '@lego-builder/brick-engine';
import type {
  Assembly,
  Brick,
  PartColorEvidence,
  PhysicalOptions,
} from '@lego-builder/brick-engine';

const partIdSchema = { type: 'string', enum: PARTS.map((part) => part.id) };
const colorSchema = { type: 'integer', enum: COLORS.map((color) => color.id) };
const idSchema = { type: 'string', minLength: 1, maxLength: 100 };
const placementProperties = {
  partId: partIdSchema,
  color: colorSchema,
  x: { type: 'number', multipleOf: 0.5, minimum: 0, maximum: MAX_BUILD_AREA - 1 },
  y: { type: 'number', multipleOf: 0.5, minimum: 0, maximum: MAX_HEIGHT - 1 },
  z: { type: 'number', multipleOf: 0.5, minimum: 0, maximum: MAX_BUILD_AREA - 1 },
  rotation: { type: 'integer', enum: [0, 90, 180, 270] },
};
function objectSchema(
  properties: Record<string, unknown> = {},
  required = Object.keys(properties),
) {
  return { type: 'object' as const, properties, required, additionalProperties: false };
}

export const BUILDER_TOOLS: readonly Anthropic.Tool[] = [
  {
    name: 'brick_catalog',
    description:
      'Read supported real part designs, their reserved footprints, plate-unit heights, local connector cells, and observed color choices. Call this before planning placements; never invent part or color IDs. topStuds and bottomReceivers are zero-based cells before rotation, with half-cell offsets where needed. Baseplates have no bottomReceivers and must remain on the ground; smooth tiles have no topStuds. Doors are closed integral-hinge designs or empty frames; loose leaves and glazing are unsupported. By default only inventory-observed colors are listed. includeUnverifiedColors is for inspection, not permission to place unobserved colors.',
    input_schema: objectSchema({ includeUnverifiedColors: { type: 'boolean' } }, []),
  },
  {
    name: 'brick_inspect',
    description:
      'Read the current assembly, revision, bill of materials, geometry issues, physical assessment, and manufacturing statuses. Coordinates are minimum reserved-footprint corners in studs for X/Z and plate units for Y, all in increments of 0.5. Physical estimates and supplied limits are not build certification. Use brick_physics for mass provenance, gravity balance, required clutch tension and remaining unknowns.',
    input_schema: objectSchema(),
  },
  {
    name: 'brick_physics',
    description:
      'Read the deterministic static-gravity assessment, mass basis/provenance, center of mass, load paths, minimum stud tension, supplied connection limits, and ideal bottom-up assembly order. Default weights are catalogue-reported nominal values, not independently measured exact-piece masses. Missing masses may use solid-envelope estimates, NOT real part weights. Unknown remains unknown; balanced gravity does not certify bending, shear, compression strength, hand access or resistance to disturbance. Physical data and rejection policy are host-controlled and cannot be changed through tools.',
    input_schema: objectSchema(),
  },
  {
    name: 'brick_place',
    description:
      'Add one supported part after schema, manufacturing-policy, geometry and host physical-policy checks. X/Z are studs, Y is plate units, all in increments of 0.5; rotations are 0, 90, 180, or 270 degrees. Elevated pieces require matching studs on grounded support; smooth tiles cannot supply them. Baseplates must stay on the ground. By default placements infeasible under the selected mass/connection model are rejected. Unknown physical feasibility is reported, not certified. Rejection does not mutate the assembly.',
    input_schema: objectSchema(placementProperties, ['partId', 'color', 'x', 'y', 'z']),
  },
  {
    name: 'brick_remove',
    description:
      'Remove an existing piece by its stable ID. Geometry and host physical-policy checks run before mutation, including whether removing a counterweight makes the remaining assembly tip under the selected model. Remove top-down or retain alternate supports. Rejection leaves assembly and revision unchanged.',
    input_schema: objectSchema({ id: idSchema }),
  },
  {
    name: 'brick_color_status',
    description:
      'Inspect a specific supported part and recognized LDraw color pairing. Rendering recognition, observed historical inventory evidence, and current stock are separate results. Missing mappings or observations mean unknown, not never manufactured. Stock remains unknown because no stock source is connected.',
    input_schema: objectSchema({ partId: partIdSchema, color: colorSchema }),
  },
  {
    name: 'brick_export',
    description:
      'Return an UNVERIFIED DRAFT as LDraw text or JSON with BOM, physical assessment, certification blockers and inventory evidence. Default purpose is draft. Construction-purpose exports are refused: the engine cannot certify all required evidence or guarantee physical buildability. Layer steps are not certified building instructions. This tool cannot write files or execute commands; the host controls saving.',
    input_schema: objectSchema(
      {
        format: { type: 'string', enum: ['ldraw', 'json'] },
        purpose: { type: 'string', enum: ['draft', 'construction'] },
      },
      ['format'],
    ),
  },
];

const ajv = new Ajv({ allErrors: true, coerceTypes: false });
const validators = new Map(
  BUILDER_TOOLS.map((tool) => [tool.name, ajv.compile(tool.input_schema)]),
);
const validateInitial = ajv.compile<Assembly>(
  objectSchema(
    {
      name: { type: 'string', minLength: 1, maxLength: 200 },
      buildArea: { type: 'integer', minimum: BUILD_AREA, maximum: MAX_BUILD_AREA },
      bricks: {
        type: 'array',
        maxItems: 500,
        items: objectSchema({ id: idSchema, ...placementProperties }),
      },
    },
    ['name', 'bricks'],
  ),
);

export type BuilderToolResult =
  | { ok: true; revision: number; data: unknown }
  | { ok: false; revision: number; error: { code: string; message: string; issues?: unknown } };

export function createBuilderSession(
  initial: unknown = { name: 'Claude build', bricks: [] },
  options: {
    evidence?: PartColorEvidence;
    requireObservedColors?: boolean;
    maxPieces?: number;
    physical?: PhysicalOptions;
    rejectInfeasible?: boolean;
  } = {},
) {
  if (!validateInitial(initial))
    throw new Error(`Invalid initial assembly: ${ajv.errorsText(validateInitial.errors)}`);
  const issues = validateAssembly(initial);
  if (issues.length) throw new Error(`Invalid initial geometry: ${issues[0].message}`);
  const evidence = importPartColorEvidence(options.evidence ?? DEFAULT_PART_COLOR_EVIDENCE);
  const requireObservedColors = options.requireObservedColors ?? true;
  const maxPieces = options.maxPieces ?? 500;
  if (
    !Number.isInteger(maxPieces) ||
    maxPieces < 1 ||
    maxPieces > 500 ||
    initial.bricks.length > maxPieces
  )
    throw new Error('Piece limit must be 1-500 and fit the initial assembly.');
  if (
    requireObservedColors &&
    initial.bricks.some(
      (brick) =>
        getPartColorStatus(brick.partId, brick.color, evidence).manufactured !== 'observed',
    )
  )
    throw new Error('Initial assembly contains unverified part/color combinations.');
  let assembly = structuredClone(initial);
  const physicalOptions = {
    data: importPhysicalData(options.physical?.data ?? { version: 1, parts: {} }),
    estimateMissingMasses: options.physical?.estimateMissingMasses ?? true,
    useCatalogMasses: options.physical?.useCatalogMasses ?? true,
  };
  const rejectInfeasible = options.rejectInfeasible ?? true;
  let physicalAssessment = assessPhysicalFeasibility(assembly, physicalOptions);
  if (rejectInfeasible && physicalAssessment.status === 'infeasible')
    throw new Error(
      `Initial assembly is physically infeasible under the selected model: ${physicalAssessment.reasons[0]}`,
    );
  let revision = 0;
  let nextId = 1;
  const snapshot = () => structuredClone(assembly);
  const statuses = () =>
    getBillOfMaterials(assembly).map((entry) => ({
      partId: entry.partId,
      color: entry.color,
      ...getPartColorStatus(entry.partId, entry.color, evidence),
    }));
  const document = () => ({
    version: 1,
    assembly: snapshot(),
    billOfMaterials: getBillOfMaterials(assembly),
    partColorEvidence: structuredClone(evidence),
    partColorStatuses: statuses(),
    physicalAssessment: structuredClone(physicalAssessment),
    buildability: getBuildabilityReport(physicalAssessment),
    exportPurpose: 'unverified-draft',
    physicalData: structuredClone(physicalOptions.data),
    physicalPolicy: {
      rejectInfeasible,
      estimateMissingMasses: physicalOptions.estimateMissingMasses,
      useCatalogMasses: physicalOptions.useCatalogMasses,
    },
    checks: {
      geometry: 'validated',
      strength: physicalAssessment.connectionStrength,
      stability: physicalAssessment.gravity,
      physicalFeasibility: physicalAssessment.status,
      assemblyAccess: 'idealized-vertical-only',
      stock: 'unknown',
    },
  });
  const fail = (code: string, message: string, issues?: unknown): BuilderToolResult => ({
    ok: false,
    revision,
    error: { code, message, ...(issues ? { issues } : {}) },
  });

  function runTool(name: string, input: unknown): BuilderToolResult {
    const validate = validators.get(name);
    if (!validate) return fail('unknown_tool', `Unknown builder tool: ${name}`);
    if (!validate(input)) return fail('invalid_input', ajv.errorsText(validate.errors));
    const args = input as Record<string, unknown>;
    if (name === 'brick_catalog') {
      const observedColors = new Set(evidence.observations.map((entry) => entry.colorId));
      return {
        ok: true,
        revision,
        data: {
          buildArea: getBuildArea(assembly),
          maxHeight: MAX_HEIGHT,
          positionIncrement: 0.5,
          maxPieces,
          requireObservedColors,
          recognizedColorCount: COLORS.length,
          collisionModel:
            'Conservative full body envelopes, including hardware and sills; openings and empty space inside shaped parts are not available for interlocking. Hinges remain closed and static.',
          parts: PARTS.map(
            ({ id, name, width, depth, height, kind, family, shape, connections }) => ({
              id,
              name,
              width,
              depth,
              height,
              kind,
              family: family ?? kind,
              shape: shape ?? 'box',
              contactPhysics: shape ? 'not-assessed' : 'rectangular-model',
              connections: structuredClone(connections),
              observedColors: COLORS.filter(
                (color) => getPartColorStatus(id, color.id, evidence).manufactured === 'observed',
              ).map((color) => color.id),
            }),
          ),
          colors: COLORS.filter(
            (color) =>
              args.includeUnverifiedColors ||
              observedColors.has(evidence.mappings.colors[String(color.id)]),
          ).map(({ id, name, hex, alpha, finish }) => ({ id, name, hex, alpha, finish })),
        },
      };
    }
    if (name === 'brick_inspect')
      return { ok: true, revision, data: { ...document(), issues: validateAssembly(assembly) } };
    if (name === 'brick_physics')
      return {
        ok: true,
        revision,
        data: {
          ...structuredClone(physicalAssessment),
          buildability: getBuildabilityReport(physicalAssessment),
        },
      };
    if (name === 'brick_color_status')
      return {
        ok: true,
        revision,
        data: getPartColorStatus(args.partId as string, args.color as number, evidence),
      };
    if (name === 'brick_export') {
      if (args.purpose === 'construction')
        return fail(
          'buildability_not_certified',
          'Construction approval refused: required checks and independent physical evidence have not all been verified.',
          getBuildabilityReport(physicalAssessment),
        );
      return {
        ok: true,
        revision,
        data: args.format === 'ldraw' ? exportLDraw(assembly) : document(),
      };
    }
    if (name === 'brick_place') {
      if (assembly.bricks.length >= maxPieces)
        return fail('piece_limit', `The session allows at most ${maxPieces} pieces.`);
      if (
        requireObservedColors &&
        getPartColorStatus(args.partId as string, args.color as number, evidence).manufactured !==
          'observed'
      )
        return fail(
          'unverified_color',
          'This part/color combination has no mapped inventory observation. Choose an observed color from brick_catalog.',
        );
      while (assembly.bricks.some((brick) => brick.id === `ai-${nextId}`)) nextId += 1;
      const brick = { ...args, rotation: args.rotation ?? 0, id: `ai-${nextId}` } as Brick;
      const result = placeBrick(assembly, brick);
      if (!result.ok) return fail('geometry_rejected', result.issues[0].message, result.issues);
      const assessment = assessPhysicalFeasibility(result.assembly, physicalOptions);
      if (rejectInfeasible && assessment.status === 'infeasible')
        return fail('physical_rejected', assessment.reasons[0], assessment);
      assembly = result.assembly;
      physicalAssessment = assessment;
      revision += 1;
      nextId += 1;
      return {
        ok: true,
        revision,
        data: {
          brick: { ...brick },
          pieceCount: assembly.bricks.length,
          colorStatus: getPartColorStatus(brick.partId, brick.color, evidence),
          physical: {
            status: assessment.status,
            gravity: assessment.gravity,
            massBasis: assessment.massBasis,
            connectionStrength: assessment.connectionStrength,
          },
        },
      };
    }
    const result = removeBrick(assembly, args.id as string);
    if (!result.ok) return fail('geometry_rejected', result.issues[0].message, result.issues);
    const assessment = assessPhysicalFeasibility(result.assembly, physicalOptions);
    if (rejectInfeasible && assessment.status === 'infeasible')
      return fail('physical_rejected', assessment.reasons[0], assessment);
    assembly = result.assembly;
    physicalAssessment = assessment;
    revision += 1;
    return {
      ok: true,
      revision,
      data: {
        removedId: args.id,
        pieceCount: assembly.bricks.length,
        physical: {
          status: assessment.status,
          gravity: assessment.gravity,
          massBasis: assessment.massBasis,
        },
      },
    };
  }
  return { snapshot, document, runTool };
}

export type BuilderSession = ReturnType<typeof createBuilderSession>;
