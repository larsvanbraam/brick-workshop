import Ajv from 'ajv';
import type Anthropic from '@anthropic-ai/sdk';
import {
  MAX_BUILD_AREA,
  MAX_PIECES,
  COLORS,
  FACINGS,
  TILT_ANGLES,
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
  resizeBuildArea,
  BUILD_AREA,
  getBuildabilityReport,
  getEngineCapabilities,
  getPartCapabilities,
  getPartColorStatus,
  importPartColorEvidence,
  importPhysicalData,
  importAssembly,
  validateAssembly,
  getBaseplateJoins,
  describeVoxelLayer,
  findVoxelGaps,
  fillVoxelModel,
  VOXEL_FILL_PART_IDS,
  VOXEL_PLATE_PART_IDS,
  voxelizeShapes,
  smoothAssembly,
  PLATE_STUDS,
  MAX_PHYSICS_PIECES,
} from '@brick-workshop/engine';
import { RENDER_VIEWS, renderAssembly } from './render.ts';
import type { RenderOptions, RenderView } from './render.ts';
import type {
  Assembly,
  Brick,
  PartColorEvidence,
  PhysicalOptions,
  PlacementQuery,
  AssemblyPatch,
  EditPolicy,
  InventoryEntry,
  VoxelModel,
  SculptShape,
} from '@brick-workshop/engine';

const partIdSchema = { type: 'string', enum: PARTS.map((part) => part.id) };
const colorSchema = { type: 'integer', enum: COLORS.map((color) => color.id) };
const idSchema = { type: 'string', minLength: 1, maxLength: 100 };
const placementProperties = {
  partId: partIdSchema,
  color: colorSchema,
  x: { type: 'number', multipleOf: 0.1, minimum: 0, maximum: MAX_BUILD_AREA - 1 },
  y: { type: 'number', multipleOf: 0.5, minimum: 0, maximum: MAX_HEIGHT - 1 },
  z: { type: 'number', multipleOf: 0.1, minimum: 0, maximum: MAX_BUILD_AREA - 1 },
  rotation: { type: 'integer', enum: [0, 90, 180, 270] },
  facing: {
    type: 'string',
    enum: FACINGS,
    description:
      'Omit for upright pieces. Mounts the piece on its side (SNOT): its top points this way and its underside must sit on side studs pointing the same way (headlight brick 4070, side-stud bricks 87087/11211/30414, or another mounted piece). Its depth stands up at 2.5 plates a stud and its height becomes 0.4 studs of thickness; x/z stay the min corner, on 0.1 stud steps along the facing and 0.5 across it.',
  },
  upsideDown: {
    type: 'boolean',
    enum: [true],
    description:
      'Omit unless needed. Only for flippable parts: latticed casement 60607 hangs in a 60594 frame turned like the frame, upright in the frame half its own hinge end shows, and upside down in the other half, both at the frame y. It keeps its cells.',
  },
  tilt: {
    type: 'object',
    description:
      "Omit for upright pieces. Tips the piece about a hinge line, for angled roofs and panels: place it as if upright (x, y, z, rotation), then it turns `angle` degrees about the level line at height `y` (plates) crossing `toward`'s axis at `at` (studs), its top leaning toward `toward` (the low side faces that way). A hinge brick base 3937 holds a hinge top 3938 one plate up at the same x/z and rotation; the top takes the tilt of the base's pivot line, which runs along the pair's 2-stud length 1.75 plates above the base's bottom and through the middle of its width (for a base at rotation 0 and z: toward +z or -z, y = base y + 1.75, at = base z + 0.5). Pieces stacked on the top with the very same tilt stand in its frame and connect by studs as if upright, so a plate on the top can carry tiles, cheese slopes or more plates at that angle. Pieces in other frames, upright ones included, must not intersect the turned bodies.",
    properties: {
      toward: { type: 'string', enum: FACINGS },
      angle: { type: 'number', enum: TILT_ANGLES },
      y: { type: 'number', multipleOf: 0.25, minimum: 0 },
      at: { type: 'number', multipleOf: 0.5, minimum: 0 },
    },
    required: ['toward', 'angle', 'y', 'at'],
    additionalProperties: false,
  },
};
function objectSchema(
  properties: Record<string, unknown> = {},
  required = Object.keys(properties),
) {
  return { type: 'object' as const, properties, required, additionalProperties: false };
}

const BRICK_COLUMNS = [
  'id',
  'partId',
  'color',
  'x',
  'y',
  'z',
  'rotation',
  'facing',
  'upsideDown',
  'tilt',
] as const;
/**
 * Catalogue overview columns; one row per part instead of repeated keys. connectorFit is left
 * out because every shipped part is curated; per-part detail still reports it.
 */
const PART_COLUMNS = [
  'id',
  'name',
  'width',
  'depth',
  'height',
  'kind',
  'family',
  'shape',
  'contactPhysics',
] as const;

/**
 * Bricks as rows of BRICK_COLUMNS: about a third of the JSON size, which matters because every
 * turn resends the conversation and converted models run to thousands of pieces.
 */
export function compactBricks(bricks: readonly Brick[]) {
  return {
    columns: BRICK_COLUMNS,
    rows: bricks.map((brick) => BRICK_COLUMNS.map((column) => brick[column])),
  };
}

/** A compact assembly for Claude: name, board and brick rows. */
/** Bricks added, updated (by ID) and removed between two assemblies, as compact rows. */
function changedBricks(before: Assembly, after: Assembly) {
  const previous = new Map(before.bricks.map((brick) => [brick.id, brick]));
  const current = new Set(after.bricks.map((brick) => brick.id));
  const added = after.bricks.filter((brick) => !previous.has(brick.id));
  const updated = after.bricks.filter((brick) => {
    const old = previous.get(brick.id);
    return (
      old &&
      BRICK_COLUMNS.some((column) =>
        column === 'tilt'
          ? JSON.stringify(old.tilt) !== JSON.stringify(brick.tilt)
          : old[column] !== brick[column],
      )
    );
  });
  return {
    pieceCount: after.bricks.length,
    added: compactBricks(added).rows,
    updated: compactBricks(updated).rows,
    removed: before.bricks.filter((brick) => !current.has(brick.id)).map((brick) => brick.id),
    columns: BRICK_COLUMNS,
  };
}

export function compactAssembly(assembly: Assembly) {
  return {
    name: assembly.name,
    buildArea: getBuildArea(assembly),
    bricks: compactBricks(assembly.bricks),
  };
}

const VEC3 = {
  type: 'array',
  items: { type: 'number', minimum: -MAX_BUILD_AREA, maximum: MAX_HEIGHT },
  minItems: 3,
  maxItems: 3,
};

const regionSchema = {
  type: 'object',
  description:
    'Only list bricks whose minimum corner lies in this box (studs for x/z, plates for y).',
  properties: Object.fromEntries(
    ['minX', 'maxX', 'minY', 'maxY', 'minZ', 'maxZ'].map((key) => [key, { type: 'number' }]),
  ),
  additionalProperties: false,
};

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
          brick: objectSchema({ id: idSchema, ...placementProperties }, [
            'id',
            'partId',
            'color',
            'x',
            'y',
            'z',
            'rotation',
          ]),
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
      'Read engine-owned capabilities, supported part designs, reserved footprints, plate-unit heights and color choices. Without partIds it lists every part briefly; pass partIds (up to 20) for their local connector cells and observed colors. Call the overview once and reuse it; never invent part or color IDs. topStuds and bottomReceivers are zero-based [x, z] cells before rotation, with half-cell offsets where needed; "full" means every whole cell of the width x depth footprint. Parts use the top-level collisionModel unless they list their own. Baseplates have no bottomReceivers and must remain on the ground; smooth tiles have no topStuds. Only explicitly listed matchingInsertFrameId exceptions permit static inserts inside reserved frame envelopes. Parts with bars or clips list them as {from, to} or {at, axis} in [x studs, y plates up, z studs] from the min corner before rotation: a clip holds a piece whose bar runs through it along its axis, anywhere along the bar (a flag 2335 on an antenna 3957a, or a loose bar 30374 mounted level between clip plates 4081b), and the two may share space. By default only inventory-observed colors are listed. includeUnverifiedColors is for inspection, not permission to place unobserved colors.',
    input_schema: objectSchema(
      {
        includeUnverifiedColors: { type: 'boolean' },
        partIds: {
          type: 'array',
          items: partIdSchema,
          minItems: 1,
          maxItems: 20,
          uniqueItems: true,
        },
      },
      [],
    ),
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
      'Apply an atomic patch using the current expectedRevision, preferably after preview. Rechecks all host policies and final geometry before committing all operations together. Success increments revision once and returns the changed bricks (added, updated, removed) and a summarized assessment (brick_physics has per-piece detail); rejection changes nothing. Proposed addition IDs become stable only after success. A valid final arrangement is not a validated construction sequence and remains uncertified.',
    input_schema: patchSchema,
  },
  {
    name: 'brick_sculpt',
    description:
      'Add a whole shape at once from pixel-art layers: the engine fills each layer with the largest plain bricks (3 plates tall) or, for layers marked plates, plates (1 plate tall, three times the vertical detail for faces, eyes, mustaches and trim) that fit in each color, staggered over the layer below, widens or corbels overhangs where it can and skips cells it cannot support. One character per stud: a palette letter, or "." for empty; a letter may be followed by a repeat count ("r4.2b3" is rrrr..bbb). rows[0] is z, the front that the default and Front cameras see, and each row runs from x upward. Layers go bottom-up from y (plates), and repeat stacks the same layer several times. Layer 0 must rest on studs (ground, a baseplate or built pieces), so later calls can continue on top of earlier ones. All pieces are added atomically under the host policies or nothing changes; the result lists what was added by part and region, not every brick.',
    input_schema: objectSchema(
      {
        palette: {
          type: 'object',
          description: 'Single letters mapped to color IDs from brick_catalog.',
          minProperties: 1,
          maxProperties: 52,
          propertyNames: { pattern: '^[A-Za-z]$' },
          additionalProperties: colorSchema,
        },
        x: { type: 'integer', minimum: 0, maximum: MAX_BUILD_AREA - 1 },
        z: { type: 'integer', minimum: 0, maximum: MAX_BUILD_AREA - 1 },
        y: { type: 'number', multipleOf: 0.5, minimum: 0, maximum: MAX_HEIGHT - 3 },
        layers: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_HEIGHT,
          items: objectSchema(
            {
              rows: {
                type: 'array',
                minItems: 1,
                maxItems: MAX_BUILD_AREA,
                items: {
                  type: 'string',
                  maxLength: 4 * MAX_BUILD_AREA,
                  pattern: '^([A-Za-z.][0-9]{0,3})*$',
                },
              },
              repeat: { type: 'integer', minimum: 1, maximum: MAX_HEIGHT },
              plates: { type: 'boolean', description: 'One plate tall instead of one brick.' },
            },
            ['rows'],
          ),
        },
      },
      ['palette', 'x', 'z', 'y', 'layers'],
    ),
  },
  {
    name: 'brick_shape',
    description:
      'Sculpt a rounded 3D subject from solid shapes; the engine samples them one stud across and one plate (or brick) tall and fills the result with staggered plates or bricks, so curved surfaces come out round in every direction. Coordinates are studs: x and z on the board, y up from the base (a plate is 0.4 studs, a brick 1.2). The front faces -z: the default and Front cameras look at the smallest z. Shapes apply in order: "add" fills with its color, "paint" recolors only cells earlier shapes filled (eyes, pupils, brows, emblems, buttons, overall straps on the surface), "cut" empties (an open mouth, a gap between legs). Paint and cut shapes must reach the surface to show. Hidden interiors deeper than shell studs stay hollow. Every shape needs support from below or within two studs sideways of something below it; floating parts are corbelled where possible and otherwise skipped. All pieces are added atomically under the host policies or nothing changes.',
    input_schema: objectSchema(
      {
        y: {
          type: 'number',
          multipleOf: 0.5,
          minimum: 0,
          maximum: MAX_HEIGHT - 1,
          description: 'Plate height the base (y 0) stands on.',
        },
        resolution: {
          type: 'string',
          enum: ['plate', 'brick'],
          description:
            'Layer height; plate (default) is smoother and uses about three times the pieces.',
        },
        preview: {
          type: 'boolean',
          description:
            'Check the result (pieces, skipped cells, unseenShapes) without adding anything.',
        },
        shell: {
          type: 'integer',
          minimum: 0,
          maximum: 6,
          description:
            'Wall thickness in studs before the inside is left hollow; default 2, 0 for solid.',
        },
        shapes: {
          type: 'array',
          minItems: 1,
          maxItems: 300,
          items: objectSchema(
            {
              type: { type: 'string', enum: ['ellipsoid', 'box', 'capsule', 'cylinder'] },
              mode: { type: 'string', enum: ['add', 'paint', 'cut'] },
              color: colorSchema,
              center: { ...VEC3, description: 'ellipsoid' },
              radii: { ...VEC3, description: 'ellipsoid half-sizes along x, y, z' },
              min: { ...VEC3, description: 'box corner' },
              max: { ...VEC3, description: 'box corner' },
              from: { ...VEC3, description: 'capsule or cylinder axis start' },
              to: { ...VEC3, description: 'capsule or cylinder axis end' },
              radius: { type: 'number', exclusiveMinimum: 0, maximum: MAX_BUILD_AREA },
              toRadius: {
                type: 'number',
                exclusiveMinimum: 0,
                maximum: MAX_BUILD_AREA,
                description: 'radius at "to", for tapered limbs',
              },
              clipMin: { ...VEC3, description: 'keep only the part above these coordinates' },
              clipMax: { ...VEC3, description: 'keep only the part below these coordinates' },
              note: {
                type: 'string',
                maxLength: 60,
                description: 'what this shape is, for your own bookkeeping',
              },
            },
            ['type'],
          ),
        },
      },
      ['shapes'],
    ),
  },
  {
    name: 'brick_smooth',
    description:
      'Finish surfaces the way sets dress a sculpted shape: plain 1 x 1 and 2 x 2 pieces on outside corners become round and quarter-circle pieces, studs against a step two plates or taller get a cheese slope or a curved slope leaning on the step, studs against a one-plate step get a flush tile, open edges get tiles and corners quarter-round tiles, and with accents green tops get a scatter of flowers. Only exposed studs of plain bricks and plates are built on, so call it once a region is finished (nothing more will stand on it), usually after brick_shape or brick_sculpt and before brick_physics. Doors, windows, floors and detail parts are left alone; every change is engine-checked and dropped if it does not fit. Region limits it to pieces whose minimum corner lies in the box; pass the region a brick_shape result reports to smooth just that shape.',
    input_schema: objectSchema(
      {
        region: {
          ...regionSchema,
          description:
            'Only smooth pieces whose minimum corner lies in this box (studs for x/z, plates for y).',
        },
        corners: { type: 'boolean', description: 'Round outside corners; default true.' },
        slopes: { type: 'boolean', description: 'Slopes against steps; default true.' },
        tiles: { type: 'boolean', description: 'Tiles on edges and plate steps; default true.' },
        accents: {
          type: 'boolean',
          description: 'Flowers on green tops (grass, gardens); default false.',
        },
        preview: { type: 'boolean', description: 'Report what would change without changing it.' },
      },
      [],
    ),
  },
  {
    name: 'brick_inspect',
    description:
      'Read the current assembly as compact brick rows (optionally only a region, which keeps large builds small), revision, bill of materials, geometry issues, a physical summary, and manufacturing statuses. Coordinates are minimum reserved-footprint corners in studs for X/Z and plate units for Y, all in increments of 0.5. Physical estimates and supplied limits are not build certification. Use brick_physics for mass provenance, gravity balance, required clutch tension and remaining unknowns.',
    input_schema: objectSchema({ region: regionSchema }, []),
  },
  {
    name: 'brick_render',
    description:
      'Look at the current build: returns a PNG of it from one side, every piece as a flat-shaded solid with outlines and studs, the board in light grey, orthographic so sizes compare. front looks from +z (high z) toward -z with x running left to right, back from -z, left from -x, right from +x, top straight down with the front at the bottom, iso from front-right above and iso-back from back-left above. Slopes show as wedges and round parts as octagons, so judge silhouette, proportions, colours and layering, not part shapes. Use it after the bulk and before finishing to compare the build with any reference images and the standard: flat walls, bare stud fields, a plain roofline, square ground, one flat colour per mass. Region limits it to pieces whose minimum corner lies in the box, to look closer at one part.',
    input_schema: objectSchema(
      {
        view: { type: 'string', enum: [...RENDER_VIEWS], description: 'Default iso.' },
        region: {
          ...regionSchema,
          description:
            'Only show pieces whose minimum corner lies in this box (studs for x/z, plates for y).',
        },
      },
      [],
    ),
  },
  {
    name: 'brick_board',
    description:
      'Resize the square build board (studs per side). Existing pieces move with whole-stud shifts to stay centred where they fit; the result reports the shift. Resize before placing anything when the requested subject plus its surroundings does not fit the current board. Shrinking is rejected when the pieces would not fit. Not available with a reference 3D model.',
    input_schema: objectSchema({
      size: { type: 'integer', minimum: BUILD_AREA, maximum: MAX_BUILD_AREA },
    }),
  },
  {
    name: 'brick_physics',
    description:
      'Read the deterministic static-gravity assessment, mass basis/provenance, center of mass, load paths, minimum stud tension, the per-stud connection limit (host-supplied, or an unmeasured default of 0.5 N a stud that a long overhang or hanging load can exceed), and ideal bottom-up assembly order. Default weights are catalogue-reported nominal values, not independently measured exact-piece masses. Missing masses may use solid-envelope estimates, NOT real part weights. Unknown remains unknown; balanced gravity does not certify bending, shear, compression strength, hand access or resistance to disturbance. Physical data and rejection policy are host-controlled and cannot be changed through tools.',
    input_schema: objectSchema(),
  },
  {
    name: 'brick_place',
    description:
      'Add one supported part after schema, manufacturing-policy, geometry and host physical-policy checks. X/Z are studs, Y is plate units, all in increments of 0.5; rotations are 0, 90, 180, or 270 degrees. Elevated pieces require matching studs on grounded support, side studs for mounted pieces, or a clip gripping a bar (either way round) on a held piece; smooth tiles cannot supply studs. Baseplates must stay on the ground. By default placements infeasible under the selected mass/connection model are rejected. Unknown physical feasibility is reported, not certified. Rejection does not mutate the assembly.',
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
  {
    name: 'model_gaps',
    description:
      'Only with a reference 3D model: regions of the model the current build does not cover yet, closable ones first, as board bounding boxes (studs for x/z, plates for y) with their main color and support: "supported" (a built piece directly under it), "bridgeable" (one within two studs, reachable with a longer brick) or "unsupported" (over empty space; no brick can be placed there). Closable gaps come first. Recomputed on every call; use it after patches to see what is left.',
    input_schema: objectSchema(),
  },
  {
    name: 'model_layer',
    description:
      'Only with a reference 3D model: one brick layer of the model next to the same layer of the current build, one character per stud. Read only the layers you are working on.',
    input_schema: objectSchema({
      layer: { type: 'integer', minimum: 0, maximum: MAX_HEIGHT / 3 - 1 },
    }),
  },
];

const HOST_ONLY_TOOLS = new Set(['brick_preview_patch', 'brick_export']);

/**
 * Tool definitions sent to Claude. The part and color enums repeat ~1.5k characters in every
 * placement schema on every turn, so Claude gets catalogue references instead; runTool still
 * validates inputs against the strict BUILDER_TOOLS schemas.
 */
export const MODEL_TOOLS: readonly Anthropic.Tool[] = BUILDER_TOOLS.filter(
  // Exports are the host's job, and brick_apply_patch already rejects atomically with the same
  // issues a preview reports; both definitions would be resent on every turn for nothing.
  (tool) => !HOST_ONLY_TOOLS.has(tool.name),
).map((tool) => ({
  ...tool,
  input_schema: compactSchema(tool.input_schema) as Anthropic.Tool['input_schema'],
}));

function compactSchema(schema: unknown): unknown {
  if (schema === partIdSchema)
    return { type: 'string', description: 'Part ID from brick_catalog.' };
  if (schema === colorSchema)
    return { type: 'integer', description: 'Color ID from brick_catalog.' };
  if (Array.isArray(schema)) return schema.map(compactSchema);
  if (!schema || typeof schema !== 'object') return schema;
  return Object.fromEntries(
    Object.entries(schema).map(([key, value]) => [key, compactSchema(value)]),
  );
}

/** 'full' when the cells are exactly every whole cell of the footprint, else [x, z] pairs. */
function compactCells(cells: readonly { x: number; z: number }[], width: number, depth: number) {
  const unique = new Set(cells.map(({ x, z }) => `${x},${z}`));
  const full =
    cells.length === width * depth &&
    unique.size === cells.length &&
    cells.every(
      ({ x, z }) =>
        Number.isInteger(x) && Number.isInteger(z) && x >= 0 && z >= 0 && x < width && z < depth,
    );
  return full ? 'full' : cells.map(({ x, z }) => [x, z]);
}

const ajv = new Ajv({ allErrors: true, coerceTypes: false });
const validators = new Map(
  BUILDER_TOOLS.map((tool) => [tool.name, ajv.compile(tool.input_schema)]),
);

/** A tool result's image, if it has one, split from the rest so it can travel as an image. */
export function splitToolImage(response: BuilderToolResult): {
  response: BuilderToolResult;
  image?: { mediaType: 'image/png'; data: string };
} {
  if (!response.ok || !response.data || typeof response.data !== 'object') return { response };
  const { image, ...data } = response.data as {
    image?: { mediaType: 'image/png'; data: string };
  };
  return image ? { response: { ...response, data }, image } : { response };
}

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
    /** The 3D model the initial assembly was converted from, and where it sits on the board. */
    reference?: { model: VoxelModel; origin: { x: number; z: number } };
  } = {},
) {
  let imported: Assembly;
  try {
    imported = importAssembly(initial);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Invalid assembly geometry:'))
      throw new Error(error.message.replace('assembly geometry', 'initial geometry'));
    throw new Error(
      `Invalid initial assembly: ${error instanceof Error ? error.message : 'Invalid input.'}`,
    );
  }
  const evidence = importPartColorEvidence(options.evidence ?? DEFAULT_PART_COLOR_EVIDENCE);
  const requireObservedColors = options.requireObservedColors ?? true;
  const maxPieces = options.maxPieces ?? 500;
  if (
    !Number.isInteger(maxPieces) ||
    maxPieces < 1 ||
    maxPieces > MAX_PIECES ||
    imported.bricks.length > maxPieces
  )
    throw new Error(`Piece limit must be 1-${MAX_PIECES} and fit the initial assembly.`);
  let assembly = imported;
  const physicalOptions = {
    data: importPhysicalData(options.physical?.data ?? { version: 1, parts: {} }),
    estimateMissingMasses: options.physical?.estimateMissingMasses ?? true,
    useCatalogMasses: options.physical?.useCatalogMasses ?? true,
    useDefaultStudConnection: options.physical?.useDefaultStudConnection ?? true,
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
      useDefaultStudConnection: physicalOptions.useDefaultStudConnection,
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

  /**
   * Fills voxel groups stacked bottom-up from `base` (plates) at board x/z `left`/`front` and
   * adds every piece in one policy-checked commit, or nothing.
   */
  function placeVoxels(
    left: number,
    front: number,
    base: number,
    width: number,
    depth: number,
    groups: readonly { plates: boolean; layers: number; cells: readonly (number | null)[] }[],
    preview = false,
  ): BuilderToolResult {
    const board = getBuildArea(assembly);
    const height = groups.reduce(
      (total, group) => total + group.layers * (group.plates ? 1 : 3),
      0,
    );
    if (base + height > MAX_HEIGHT)
      return fail('out_of_bounds', `The layers reach above the ${MAX_HEIGHT}-plate height limit.`);
    if (!width || left + width > board || front + depth > board)
      return fail(
        'out_of_bounds',
        `A ${width} x ${depth} sculpt at x ${left}, z ${front} does not fit the ${board}-stud board; resize it with brick_board first.`,
      );
    const colorAllowed = (partId: string, color: number) =>
      !requireObservedColors ||
      getPartColorStatus(partId, color, evidence).manufactured === 'observed';
    for (const plates of [false, true]) {
      const partIds = plates ? VOXEL_PLATE_PART_IDS : VOXEL_FILL_PART_IDS;
      const used = new Set(
        groups.filter((group) => group.plates === plates).flatMap((group) => group.cells),
      );
      const unbuildable = [...used].filter(
        (color): color is number =>
          color !== null && !partIds.some((partId) => colorAllowed(partId, color)),
      );
      if (unbuildable.length)
        return fail(
          'unverified_color',
          `No plain ${plates ? 'plate' : 'brick'} is allowed in color ${unbuildable.join(', ')}; choose the nearest color brick_catalog lists for ${plates ? '3023b' : '3001'}.`,
        );
    }
    const added: Brick[] = [];
    const firstId = nextId;
    let [y, filledCells, skippedCells, supportCells] = [base, 0, 0, 0];
    for (const { plates, layers, cells } of groups) {
      const remaining = maxPieces - assembly.bricks.length - added.length;
      if (remaining < 1)
        return fail('piece_limit', `The session allows at most ${maxPieces} pieces.`);
      const fill = fillVoxelModel(
        { name: assembly.name, width, depth, layers, cells },
        {
          buildArea: board,
          maxPieces: remaining,
          supportGaps: true,
          details: false,
          plates,
          colorAllowed,
        },
      );
      if (fill.truncated)
        return fail(
          'piece_limit',
          `The sculpt needs more than the ${maxPieces - assembly.bricks.length} pieces left of the ${maxPieces}-piece budget. Hollow out hidden interiors or simplify.`,
        );
      for (const brick of fill.assembly.bricks) {
        while (assembly.bricks.some((piece) => piece.id === `ai-${nextId}`)) nextId += 1;
        added.push({
          ...brick,
          id: `ai-${nextId++}`,
          x: brick.x - fill.origin.x + left,
          y: brick.y + y,
          z: brick.z - fill.origin.z + front,
        });
      }
      y += layers * (plates ? 1 : 3);
      filledCells += fill.filledCells;
      skippedCells += fill.skippedCells;
      supportCells += fill.addedCells;
    }
    if (!added.length)
      return fail(
        'unsupported',
        'No cell could be filled: layer 0 needs studs or ground beneath it.',
      );
    const next = { ...assembly, bricks: [...assembly.bricks, ...added] };
    const evaluation = evaluateAssemblyPolicy(next, editPolicy);
    if (!evaluation.allowed) {
      const issue = evaluation.issues[0];
      // Geometry issues list every clash; the first few are enough to fix the drawing.
      return fail(
        issue.code,
        issue.message,
        Array.isArray(issue.details) ? issue.details.slice(0, 20) : issue.details,
      );
    }
    if (!preview) {
      assembly = next;
      physicalAssessment = evaluation.physical!;
      policyAssessment = evaluation;
      revision += 1;
    } else nextId = firstId;
    return {
      ok: true,
      revision,
      data: {
        ...(preview && { purpose: 'preview-only' }),
        pieceCount: next.bricks.length,
        added: {
          pieces: added.length,
          ids: [added[0].id, added.at(-1)!.id],
          billOfMaterials: getBillOfMaterials({ ...assembly, bricks: added }),
        },
        region: {
          minX: left,
          maxX: left + width - 1,
          minZ: front,
          maxZ: front + depth - 1,
          minY: base,
          maxY: base + height,
        },
        filledCells,
        skippedCells,
        supportCells,
        detail: 'Read pieces with brick_inspect and this region before replacing any of them.',
        physical: {
          status: evaluation.physical!.status,
          gravity: evaluation.physical!.gravity,
          massBasis: evaluation.physical!.massBasis,
          reasons: evaluation.physical!.reasons,
        },
      },
    };
  }

  /** Smooths the assembly (or only `ids`), as brick_smooth and the host's finishing pass do. */
  function smooth(args: Record<string, unknown>, ids?: ReadonlySet<string>): BuilderToolResult {
    const colorAllowed = (partId: string, color: number) =>
      !requireObservedColors ||
      getPartColorStatus(partId, color, evidence).manufactured === 'observed';
    const firstId = nextId;
    const smoothed = smoothAssembly(assembly, {
      ids,
      region: args.region as Record<string, number> | undefined,
      corners: args.corners as boolean | undefined,
      slopes: args.slopes as boolean | undefined,
      tiles: args.tiles as boolean | undefined,
      accents: args.accents as boolean | undefined,
      maxPieces,
      colorAllowed,
      nextId: () => {
        while (assembly.bricks.some((piece) => piece.id === `ai-${nextId}`)) nextId += 1;
        return `ai-${nextId++}`;
      },
    });
    const { added, swapped, counts } = smoothed;
    if (!added.length && !swapped.length) {
      nextId = firstId;
      return {
        ok: true,
        revision,
        data: {
          changed: 0,
          detail:
            'Nothing to smooth: no exposed studs or outside corners of plain bricks and plates in the region.',
        },
      };
    }
    const evaluation = evaluateAssemblyPolicy(smoothed.assembly, editPolicy);
    if (!evaluation.allowed) {
      nextId = firstId;
      const issue = evaluation.issues[0];
      return fail(
        issue.code,
        issue.message,
        Array.isArray(issue.details) ? issue.details.slice(0, 20) : issue.details,
      );
    }
    if (args.preview === true) nextId = firstId;
    else {
      assembly = smoothed.assembly;
      physicalAssessment = evaluation.physical!;
      policyAssessment = evaluation;
      revision += 1;
    }
    return {
      ok: true,
      revision,
      data: {
        ...(args.preview === true && { purpose: 'preview-only' }),
        pieceCount: smoothed.assembly.bricks.length,
        counts,
        added: added.length
          ? {
              pieces: added.length,
              ids: [added[0].id, added.at(-1)!.id],
              billOfMaterials: getBillOfMaterials({ ...assembly, bricks: added }),
            }
          : { pieces: 0 },
        swappedIds: swapped.slice(0, 40),
        physical: {
          status: evaluation.physical!.status,
          gravity: evaluation.physical!.gravity,
        },
      },
    };
  }

  function runTool(name: string, input: unknown): BuilderToolResult {
    const validate = validators.get(name);
    if (!validate) return fail('unknown_tool', `Unknown builder tool: ${name}`);
    if (!validate(input)) return fail('invalid_input', ajv.errorsText(validate.errors));
    const args = input as Record<string, unknown>;
    if (name === 'model_gaps' || name === 'model_layer') {
      const reference = options.reference;
      if (!reference) return fail('no_reference', 'This build has no reference 3D model.');
      if (name === 'model_gaps')
        return {
          ok: true,
          revision,
          data: findVoxelGaps(reference.model, reference.origin, assembly),
        };
      if ((args.layer as number) >= reference.model.layers)
        return fail('invalid_input', `The model has layers 0-${reference.model.layers - 1}.`);
      return {
        ok: true,
        revision,
        data: describeVoxelLayer(reference.model, reference.origin, assembly, args.layer as number),
      };
    }
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
      const before = assembly;
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
      // The full assembly and per-piece physics grow with every piece and stay in the
      // conversation for each patch, so patch results carry only the changes and a summary.
      const { physical, buildability, ...assessment } = structuredClone(result.assessment);
      return {
        ok: true,
        revision,
        data: {
          purpose: name === 'brick_apply_patch' ? 'applied-final-arrangement' : 'preview-only',
          changes: changedBricks(before, result.assembly),
          assessment: {
            ...assessment,
            physical: physical && {
              status: physical.status,
              gravity: physical.gravity,
              massBasis: physical.massBasis,
              connectionStrength: physical.connectionStrength,
              totalMassGrams: physical.totalMassGrams,
              centerOfMassStuds: physical.centerOfMassStuds,
              missingMassPartIds: physical.missingMassPartIds,
              minimumStudTensionNewtons: physical.minimumStudTensionNewtons,
              reasons: physical.reasons,
              detail: 'Call brick_physics for masses, load paths and assembly order.',
            },
            buildability: buildability && {
              status: buildability.status,
              certified: buildability.certified,
              label: buildability.label,
            },
          },
        },
      };
    }
    if (name === 'brick_sculpt') {
      const palette = args.palette as Record<string, number>;
      // Consecutive layers of the same height are filled together, so their bricks stagger.
      const groups: { plates: boolean; grids: string[][] }[] = [];
      let height = 0;
      for (const { rows, repeat = 1, plates = false } of args.layers as {
        rows: string[];
        repeat?: number;
        plates?: boolean;
      }[]) {
        const expanded = rows.map((row) =>
          row.replace(/([A-Za-z.])(\d+)/g, (_, symbol: string, count: string) =>
            symbol.repeat(Math.min(Number(count), MAX_BUILD_AREA + 1)),
          ),
        );
        if (groups.at(-1)?.plates !== plates) groups.push({ plates, grids: [] });
        for (let copy = 0; copy < repeat && height <= MAX_HEIGHT; copy += 1) {
          groups.at(-1)!.grids.push(expanded);
          height += plates ? 1 : 3;
        }
      }
      const grids = groups.flatMap((group) => group.grids);
      const width = Math.max(...grids.flatMap((rows) => rows.map((row) => row.length)));
      const depth = Math.max(...grids.map((rows) => rows.length));
      const unknown = [...new Set(grids.flat().join('').replaceAll('.', ''))].filter(
        (letter) => !(letter in palette),
      );
      if (unknown.length)
        return fail('invalid_input', `Letters missing from the palette: ${unknown.join(', ')}.`);
      return placeVoxels(
        args.x as number,
        args.z as number,
        args.y as number,
        width,
        depth,
        groups.map(({ plates, grids: layers }) => ({
          plates,
          layers: layers.length,
          cells: layers.flatMap((rows) =>
            Array.from({ length: depth }, (_, row) =>
              Array.from({ length: width }, (_, column) => {
                const letter = rows[row]?.[column] ?? '.';
                return letter === '.' ? null : palette[letter];
              }),
            ).flat(),
          ),
        })),
      );
    }
    if (name === 'brick_shape') {
      const shapes = args.shapes as (Record<string, unknown> & { type: string; mode?: string })[];
      const needs: Record<string, string[]> = {
        ellipsoid: ['center', 'radii'],
        box: ['min', 'max'],
        capsule: ['from', 'to', 'radius'],
        cylinder: ['from', 'to', 'radius'],
      };
      for (const [position, shape] of shapes.entries()) {
        const missing = [...needs[shape.type], ...(shape.mode === 'cut' ? [] : ['color'])].filter(
          (key) => shape[key] === undefined,
        );
        if (missing.length)
          return fail(
            'invalid_input',
            `Shape ${position} (${shape.type}) needs ${missing.join(', ')}.`,
          );
        if (shape.type === 'ellipsoid' && (shape.radii as number[]).some((radius) => radius <= 0))
          return fail('invalid_input', `Shape ${position} needs positive radii.`);
      }
      const plates = args.resolution !== 'brick';
      const grid = voxelizeShapes(shapes as unknown as SculptShape[], {
        buildArea: getBuildArea(assembly),
        layerStuds: plates ? PLATE_STUDS : PLATE_STUDS * 3,
        shell: (args.shell as number | undefined) ?? 2,
      });
      if (!grid)
        return fail('invalid_input', 'The added shapes cover no cell on the board above y 0.');
      const result = placeVoxels(
        grid.x,
        grid.z,
        (args.y as number | undefined) ?? 0,
        grid.width,
        grid.depth,
        [{ plates, layers: grid.layers, cells: grid.cells }],
        args.preview === true,
      );
      if (!result.ok || !grid.unseen.length) return result;
      return {
        ...result,
        data: {
          ...(result.data as object),
          unseenShapes: grid.unseen,
          unseenDetail:
            'These shapes changed no cell: a shape shows only where it covers cell centres (x and z at whole studs + 0.5, y at layer middles), so make small features at least one stud wide and centred on a stud, and paint only where earlier shapes filled the surface.',
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
          // Connector cells and per-part colors are most of the catalogue and it stays in the
          // conversation for every later turn, so they are listed only for requested parts.
          ...(!args.partIds && {
            detail:
              'Call brick_catalog with partIds for the connector cells and observed colors of the parts you will use.',
          }),
          ...(!args.partIds && {
            partColumns: PART_COLUMNS,
            partRows: PARTS.map(({ id }) => {
              const part = getPartCapabilities(id);
              const row: unknown[] = PART_COLUMNS.map((column) => part[column]);
              return part.matchingInsertFrameId
                ? [...row, { matchingInsertFrameId: part.matchingInsertFrameId }]
                : row;
            }),
          }),
          parts: PARTS.filter(({ id }) => (args.partIds as string[] | undefined)?.includes(id)).map(
            ({ id }) => {
              const { connections, collisionModel, matchingInsertFrameId, ...part } =
                getPartCapabilities(id);
              return {
                ...part,
                ...(matchingInsertFrameId ? { matchingInsertFrameId } : {}),
                connections: Object.fromEntries(
                  Object.entries(connections).map(([key, cells]) => [
                    key,
                    compactCells(cells, part.width, part.depth),
                  ]),
                ),
                ...(collisionModel === getEngineCapabilities(assembly).collisionModel
                  ? {}
                  : { collisionModel }),
                observedColors: COLORS.filter(
                  (color) => getPartColorStatus(id, color.id, evidence).manufactured === 'observed',
                ).map((color) => color.id),
              };
            },
          ),
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
    if (name === 'brick_render') {
      const render = renderAssembly(assembly, {
        view: args.view as RenderView | undefined,
        region: args.region as RenderOptions['region'],
      });
      return {
        ok: true,
        revision,
        data: {
          view: render.view,
          pieces: render.pieces,
          width: render.width,
          height: render.height,
          ...(render.studs ? {} : { note: 'Studs are left off on builds this large.' }),
          image: { mediaType: 'image/png', data: render.png.toString('base64') },
        },
      };
    }
    if (name === 'brick_inspect') {
      const region = (args.region ?? {}) as Partial<
        Record<'minX' | 'maxX' | 'minY' | 'maxY' | 'minZ' | 'maxZ', number>
      >;
      const inside = (brick: Brick) =>
        brick.x >= (region.minX ?? -Infinity) &&
        brick.x <= (region.maxX ?? Infinity) &&
        brick.y >= (region.minY ?? -Infinity) &&
        brick.y <= (region.maxY ?? Infinity) &&
        brick.z >= (region.minZ ?? -Infinity) &&
        brick.z <= (region.maxZ ?? Infinity);
      return {
        ok: true,
        revision,
        data: {
          name: assembly.name,
          buildArea: getBuildArea(assembly),
          pieceCount: assembly.bricks.length,
          bricks: compactBricks(assembly.bricks.filter(inside)),
          billOfMaterials: getBillOfMaterials(assembly),
          partColorStatuses: statuses(),
          issues: validateAssembly(assembly),
          physical: {
            status: physicalAssessment.status,
            gravity: physicalAssessment.gravity,
            massBasis: physicalAssessment.massBasis,
            totalMassGrams: physicalAssessment.totalMassGrams,
            reasons: physicalAssessment.reasons,
            detail: 'Call brick_physics for masses, load paths and assembly order.',
          },
          buildability: getBuildabilityReport(physicalAssessment).status,
        },
      };
    }
    if (name === 'brick_smooth') return smooth(args);
    if (name === 'brick_board') {
      if (options.reference)
        return fail('reference_board', 'The board is fixed to the reference 3D model.');
      const resized = resizeBuildArea(assembly, args.size as number);
      if (!resized)
        return fail('board_too_small', `The current pieces do not fit a ${args.size}-stud board.`);
      const evaluation = evaluateAssemblyPolicy(resized, editPolicy);
      if (!evaluation.allowed)
        return fail(
          'policy_rejected',
          'The resized board violates host policy.',
          evaluation.issues,
        );
      const first = assembly.bricks[0];
      const moved = resized.bricks[0];
      assembly = resized;
      physicalAssessment = evaluation.physical!;
      policyAssessment = evaluation;
      revision += 1;
      return {
        ok: true,
        revision,
        data: {
          buildArea: getBuildArea(assembly),
          shift: first ? { x: moved.x - first.x, z: moved.z - first.z } : { x: 0, z: 0 },
          pieceCount: assembly.bricks.length,
        },
      };
    }
    if (name === 'brick_physics') {
      const { masses, connections, assemblyOrder, ...summary } =
        structuredClone(physicalAssessment);
      // Per-piece lists grow to hundreds of thousands of characters on converted models, and
      // past MAX_PHYSICS_PIECES the solver has not run, so large builds get masses by part.
      const perPiece = assembly.bricks.length <= MAX_PHYSICS_PIECES;
      const byPart = new Map<
        string,
        { partId: string; count: number; mass: (typeof masses)[number]['mass'] }
      >();
      for (const { partId, mass } of masses) {
        const entry = byPart.get(partId);
        if (entry) entry.count += 1;
        else byPart.set(partId, { partId, count: 1, mass });
      }
      return {
        ok: true,
        revision,
        data: {
          ...summary,
          ...(perPiece
            ? { masses, connections, assemblyOrder }
            : {
                massesByPart: [...byPart.values()],
                perPieceDetail: `Omitted: per-piece masses, connections and assembly order are only listed up to ${MAX_PHYSICS_PIECES} pieces.`,
              }),
          buildability: getBuildabilityReport(physicalAssessment),
          ...baseplateReport(assembly),
        },
      };
    }
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
  /** The host's finishing pass: smooths only the given pieces, with no flowers. */
  const smoothPieces = (ids: ReadonlySet<string>) => smooth({}, ids);
  return { snapshot, document, runTool, smoothPieces };
}

export type BuilderSession = ReturnType<typeof createBuilderSession>;

/** Whether the baseplates are tied into one board, and the seams that still need ties. */
function baseplateReport(assembly: Assembly) {
  const { seams, groups, joined } = getBaseplateJoins(assembly);
  if (!seams.length) return {};
  return {
    baseplates: {
      joined,
      groups: groups.length,
      untiedSeams: seams
        .filter((seam) => !seam.ties.length)
        .map(({ plates, axis, at, start, end }) => ({ plates, axis, at, start, end })),
      technique:
        'Baseplates have nothing underneath to connect to. For a board that lifts as one, lay a floor of 16 x 16 plates (91405) on a second plate layer shifted 8 studs both ways (8 x 16 plates 92438 and 8 x 8 plates 41539 at the edges) instead; otherwise tie each seam with plates across it.',
    },
  };
}
