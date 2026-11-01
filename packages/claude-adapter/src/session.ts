import Ajv from 'ajv';
import type Anthropic from '@anthropic-ai/sdk';
import {
  BUILD_AREA,
  MAX_BUILD_AREA,
  COLORS,
  DEFAULT_PART_COLOR_EVIDENCE,
  MAX_HEIGHT,
  PARTS,
  MAX_PATCH_OPERATIONS,
  BUILDING_TECHNIQUE_IDS,
  getBuildingTechniques,
  createBuildingTechniqueExample,
  applyPatch,
  previewPatch,
  evaluateAssemblyPolicy,
  exportLDraw,
  explainConnection,
  findPlacementCandidates,
  getBillOfMaterials,
  getBuildArea,
  getBuildabilityReport,
  getEngineCapabilities,
  getPartCapabilities,
  getPartColorStatus,
  importPartColorEvidence,
  importPhysicalData,
  validateAssembly,
} from '@lego-builder/brick-engine';
import type {
  Assembly,
  Brick,
  PartColorEvidence,
  PhysicalOptions,
  PlacementQuery,
  AssemblyPatch,
  EditPolicy,
  InventoryEntry,
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

const patchSchema = objectSchema({
  expectedRevision: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER - 1 },
  operations: {
    type: 'array',
    minItems: 1,
    maxItems: MAX_PATCH_OPERATIONS,
    items: {
      oneOf: [
        objectSchema({
          type: { const: 'add' },
          brick: objectSchema({ id: idSchema, ...placementProperties }),
        }),
        objectSchema({ type: { const: 'remove' }, id: idSchema }),
        objectSchema({
          type: { const: 'update' },
          id: idSchema,
          changes: { ...objectSchema(placementProperties, []), minProperties: 1 },
        }),
      ],
    },
  },
});

export const BUILDER_TOOLS: readonly Anthropic.Tool[] = [
  {
    name: 'brick_techniques',
    description:
      'Read up to three versioned advisory guides for grounded foundations, staggered wall joints or seam reinforcement. Filter by id or topic to load relevant guidance only. Examples default on and are separate geometry-validated reference assemblies, NOT placements in the current model; their IDs are illustrative and coordinates must be adapted. Guidance cannot authorize unsupported connections, unobserved colors, unavailable inventory or override host physics policy. Connectivity heuristics are not measured strength, construction-sequence validation or build certification. This tool never mutates the assembly or revision.',
    input_schema: objectSchema(
      {
        id: { type: 'string', enum: BUILDING_TECHNIQUE_IDS },
        topic: { type: 'string', enum: ['foundations', 'walls', 'reinforcement'] },
        limit: { type: 'integer', minimum: 1, maximum: 3 },
        includeExamples: { type: 'boolean' },
      },
      [],
    ),
  },
  {
    name: 'brick_catalog',
    description:
      'Read engine-owned capabilities, supported part designs, reserved footprints, plate-unit heights, local connector cells, and observed color choices. Call this before planning placements; never invent part or color IDs. topStuds and bottomReceivers are zero-based cells before rotation, with half-cell offsets where needed. Baseplates have no bottomReceivers and must remain on the ground; smooth tiles have no topStuds. Only explicitly listed matchingInsertFrameId exceptions permit static inserts inside reserved frame envelopes. By default only inventory-observed colors are listed. includeUnverifiedColors is for inspection, not permission to place unobserved colors.',
    input_schema: objectSchema({ includeUnverifiedColors: { type: 'boolean' } }, []),
  },
  {
    name: 'brick_candidates',
    description:
      'Find bounded, deterministic, geometry-valid upright placements by matching studs and receivers, optionally on one support. Ground-grid placements default on only for empty assemblies. Returned candidates have temporary IDs; use their part, color, coordinates and rotation with brick_place, which assigns a stable ID and rechecks all policies. Each candidate reports host physical-policy permission, not safety or certification. Unknown physics remains unknown. Truncated searches are not exhaustive; static inserts and special connectors are not enumerated. This tool never mutates the assembly.',
    input_schema: objectSchema(
      {
        partId: partIdSchema,
        color: colorSchema,
        supportId: idSchema,
        rotations: {
          type: 'array',
          minItems: 1,
          maxItems: 4,
          uniqueItems: true,
          items: { type: 'integer', enum: [0, 90, 180, 270] },
        },
        includeGround: { type: 'boolean' },
        maxCandidates: { type: 'integer', minimum: 1, maximum: 20 },
        maxChecks: { type: 'integer', minimum: 1, maximum: 2000 },
      },
      ['partId', 'color'],
    ),
  },
  {
    name: 'brick_connection',
    description:
      'Explain an existing piece by stable ID: ground contact, matched world-space stud sites, supporting piece IDs, reviewed insert frames, and geometry issues. Compatible connector sites are not measured clutch strength. This tool is read-only.',
    input_schema: objectSchema({ id: idSchema }),
  },
  {
    name: 'brick_preview_patch',
    description:
      'Preview 1-100 additions, removals or updates atomically against the current expectedRevision. Each piece may be targeted once. Additions require complete bricks including a proposed unique ID and rotation; updates preserve IDs. Only the final arrangement is evaluated, not the operation order or construction sequence. Manufacturing, declared inventory, piece limit and physics policies are host-controlled. This tool never mutates the assembly or revision; an allowed preview is not certification or permission to skip commit-time checks.',
    input_schema: patchSchema,
  },
  {
    name: 'brick_apply_patch',
    description:
      'Apply an atomic patch using the current expectedRevision, preferably after preview. Rechecks all host policies and final geometry before committing all operations together. Success increments revision once and returns the resulting assembly and assessment; rejection changes nothing. Proposed addition IDs become stable only after success. A valid final arrangement is not a validated construction sequence and remains uncertified.',
    input_schema: patchSchema,
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
    inventory?: readonly InventoryEntry[];
    requireInventory?: boolean;
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
  let assembly = structuredClone(initial);
  const physicalOptions = {
    data: importPhysicalData(options.physical?.data ?? { version: 1, parts: {} }),
    estimateMissingMasses: options.physical?.estimateMissingMasses ?? true,
    useCatalogMasses: options.physical?.useCatalogMasses ?? true,
  };
  const rejectInfeasible = options.rejectInfeasible ?? true;
  const editPolicy: EditPolicy = {
    evidence,
    requireObservedColors,
    maxPieces,
    physical: physicalOptions,
    rejectInfeasible,
    inventory: options.inventory === undefined ? undefined : structuredClone(options.inventory),
    requireInventory: options.requireInventory,
  };
  const initialAssessment = evaluateAssemblyPolicy(assembly, editPolicy);
  if (!initialAssessment.allowed) {
    const issue = initialAssessment.issues[0];
    throw new Error(
      issue.code === 'unverified_color'
        ? 'Initial assembly contains unverified part/color combinations.'
        : `Initial assembly rejected by host policy: ${issue.message}`,
    );
  }
  let physicalAssessment = initialAssessment.physical!;
  let policyAssessment = initialAssessment;
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
    inventoryPolicy: {
      requireInventory: editPolicy.requireInventory ?? false,
      entries:
        editPolicy.inventory?.map(({ partId, color, quantity }) => ({ partId, color, quantity })) ??
        null,
    },
    inventoryUsage: structuredClone(policyAssessment.inventory),
    constructionSequence: 'not-validated',
    checks: {
      geometry: 'validated',
      strength: physicalAssessment.connectionStrength,
      stability: physicalAssessment.gravity,
      physicalFeasibility: physicalAssessment.status,
      assemblyAccess: 'idealized-vertical-only',
      stock:
        policyAssessment.inventory.length &&
        policyAssessment.inventory.every((entry) => entry.status === 'within-declared-inventory')
          ? 'within-declared-inventory'
          : 'unknown',
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
    if (name === 'brick_techniques') {
      const result = getBuildingTechniques(args as Parameters<typeof getBuildingTechniques>[0]);
      return {
        ok: true,
        revision,
        data: {
          ...result,
          currentBuildCapabilities: getEngineCapabilities(assembly),
          techniques: result.techniques.map((technique) => ({
            ...technique,
            ...(args.includeExamples === false
              ? {}
              : {
                  example: {
                    assembly: createBuildingTechniqueExample(technique.id),
                    coordinateSpace: 'standalone-reference-not-current-build',
                    ids: 'illustrative-only',
                    geometry: 'validated-reference-only',
                    hostPolicyApproval: 'not-evaluated',
                    parameters: {
                      sections: { minimum: 2, maximum: 4, default: 2 },
                      ...(technique.id === 'staggered-walls'
                        ? { courses: { minimum: 2, maximum: 4, default: 2 } }
                        : {}),
                      color: {
                        default: 4,
                        rule: 'recognized-color-subject-to-host-evidence-policy',
                      },
                      origin: 'nonnegative-half-grid-X/Z-within-a-16-stud-reference-board',
                    },
                  },
                }),
          })),
        },
      };
    }
    if (name === 'brick_preview_patch' || name === 'brick_apply_patch') {
      const result = (name === 'brick_apply_patch' ? applyPatch : previewPatch)(
        assembly,
        args as unknown as AssemblyPatch,
        { revision, policy: editPolicy },
      );
      if (!result.ok) return fail(result.error.code, result.error.message, result.error.issues);
      if (name === 'brick_apply_patch') {
        assembly = result.assembly;
        physicalAssessment = result.assessment.physical!;
        policyAssessment = result.assessment;
        revision = result.revision;
      }
      return {
        ok: true,
        revision,
        data: {
          purpose: name === 'brick_apply_patch' ? 'applied-final-arrangement' : 'preview-only',
          assembly: structuredClone(result.assembly),
          assessment: structuredClone(result.assessment),
        },
      };
    }
    if (name === 'brick_catalog') {
      const observedColors = new Set(evidence.observations.map((entry) => entry.colorId));
      return {
        ok: true,
        revision,
        data: {
          capabilities: getEngineCapabilities(assembly),
          buildArea: getBuildArea(assembly),
          maxHeight: MAX_HEIGHT,
          positionIncrement: 0.5,
          maxPieces,
          requireObservedColors,
          recognizedColorCount: COLORS.length,
          collisionModel: getEngineCapabilities(assembly).collisionModel,
          parts: PARTS.map(({ id }) => ({
            ...getPartCapabilities(id),
            observedColors: COLORS.filter(
              (color) => getPartColorStatus(id, color.id, evidence).manufactured === 'observed',
            ).map((color) => color.id),
          })),
          colors: COLORS.filter(
            (color) =>
              args.includeUnverifiedColors ||
              observedColors.has(evidence.mappings.colors[String(color.id)]),
          ).map(({ id, name, hex, alpha, finish }) => ({ id, name, hex, alpha, finish })),
        },
      };
    }
    if (name === 'brick_connection') {
      const brick = assembly.bricks.find((piece) => piece.id === args.id);
      if (!brick) return fail('piece_not_found', 'Piece not found.');
      return { ok: true, revision, data: explainConnection(assembly, brick) };
    }
    if (name === 'brick_candidates') {
      if (assembly.bricks.length >= maxPieces)
        return fail('piece_limit', `The session allows at most ${maxPieces} pieces.`);
      const colorStatus = getPartColorStatus(args.partId as string, args.color as number, evidence);
      if (requireObservedColors && colorStatus.manufactured !== 'observed')
        return fail(
          'unverified_color',
          'Choose an observed part/color combination from brick_catalog.',
        );
      let result;
      try {
        result = findPlacementCandidates(assembly, {
          ...args,
          maxCandidates: args.maxCandidates ?? 8,
        } as PlacementQuery);
      } catch (error) {
        return fail(
          'search_rejected',
          error instanceof Error ? error.message : 'Placement search failed.',
        );
      }
      return {
        ok: true,
        revision,
        data: {
          ...result,
          manufacturing: colorStatus,
          physics: 'assessed-under-host-policy',
          candidates: result.candidates.map((candidate) => {
            const evaluation = evaluateAssemblyPolicy(
              { ...assembly, bricks: [...assembly.bricks, candidate.brick] },
              editPolicy,
            );
            const assessment = evaluation.physical!;
            return {
              ...candidate,
              placementAllowed: evaluation.allowed,
              policyIssues: evaluation.issues,
              physical: {
                status: assessment.status,
                gravity: assessment.gravity,
                massBasis: assessment.massBasis,
                connectionStrength: assessment.connectionStrength,
                reasons: assessment.reasons,
                certified: false,
              },
            };
          }),
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
      let proposedId = nextId;
      while (assembly.bricks.some((brick) => brick.id === `ai-${proposedId}`)) proposedId += 1;
      const brick = { ...args, rotation: args.rotation ?? 0, id: `ai-${proposedId}` } as Brick;
      const result = applyPatch(
        assembly,
        { expectedRevision: revision, operations: [{ type: 'add', brick }] },
        { revision, policy: editPolicy },
      );
      if (!result.ok) return fail(result.error.code, result.error.message, result.error.issues);
      const assessment = result.assessment.physical!;
      assembly = result.assembly;
      physicalAssessment = assessment;
      policyAssessment = result.assessment;
      revision = result.revision;
      nextId = proposedId + 1;
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
    const result = applyPatch(
      assembly,
      { expectedRevision: revision, operations: [{ type: 'remove', id: args.id as string }] },
      { revision, policy: editPolicy },
    );
    if (!result.ok) return fail(result.error.code, result.error.message, result.error.issues);
    const assessment = result.assessment.physical!;
    assembly = result.assembly;
    physicalAssessment = assessment;
    policyAssessment = result.assessment;
    revision = result.revision;
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
