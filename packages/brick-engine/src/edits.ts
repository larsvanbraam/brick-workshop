import {
  BUILD_AREA,
  MAX_BUILD_AREA,
  MAX_PIECES,
  COLORS,
  FACINGS,
  getBillOfMaterials,
  getPart,
  isMatchingInsertFrame,
  validateAssembly,
} from './core.ts';
import type { Assembly, Brick } from './core.ts';
import { getPartColorStatus, importPartColorEvidence } from './part-colors.ts';
import type { PartColorEvidence } from './part-colors.ts';
import { assessPhysicalFeasibility, getBuildabilityReport, importPhysicalData } from './physics.ts';
import type { PhysicalAssessment, PhysicalOptions } from './physics.ts';

export const MAX_PATCH_OPERATIONS = 100;

export type PatchOperation =
  | { type: 'add'; brick: Brick }
  | { type: 'remove'; id: string }
  | { type: 'update'; id: string; changes: Partial<Omit<Brick, 'id'>> };

export interface AssemblyPatch {
  operations: readonly PatchOperation[];
  expectedRevision?: number;
}

export interface InventoryEntry {
  partId: string;
  color: number;
  quantity: number;
}

export interface EditPolicy {
  evidence?: PartColorEvidence;
  requireObservedColors?: boolean;
  inventory?: readonly InventoryEntry[];
  requireInventory?: boolean;
  physical?: PhysicalOptions;
  rejectInfeasible?: boolean;
  maxPieces?: number;
}

export interface EditIssue {
  code:
    | 'invalid_policy'
    | 'piece_limit'
    | 'geometry_rejected'
    | 'unverified_color'
    | 'inventory_unknown'
    | 'inventory_exceeded'
    | 'physical_rejected';
  message: string;
  details?: unknown;
}

export function evaluateAssemblyPolicy(assembly: Assembly, policy: EditPolicy = {}) {
  const issues: EditIssue[] = [];
  if (!object(policy)) {
    issues.push({ code: 'invalid_policy', message: 'Expected a host policy object.' });
    policy = {};
  }
  const geometry = validateAssembly(assembly);
  if (geometry.length)
    issues.push({ code: 'geometry_rejected', message: geometry[0].message, details: geometry });
  if (
    policy.maxPieces !== undefined &&
    (!Number.isSafeInteger(policy.maxPieces) || policy.maxPieces < 1)
  )
    issues.push({ code: 'invalid_policy', message: 'Piece limit must be a positive integer.' });
  else if (assembly.bricks.length > (policy.maxPieces ?? Infinity))
    issues.push({
      code: 'piece_limit',
      message: `The policy allows at most ${policy.maxPieces} pieces.`,
    });
  for (const name of ['requireObservedColors', 'requireInventory', 'rejectInfeasible'] as const)
    if (policy[name] !== undefined && typeof policy[name] !== 'boolean')
      issues.push({ code: 'invalid_policy', message: `Expected a boolean for ${name}.` });
  const bill = geometry.length ? [] : getBillOfMaterials(assembly);
  let evidence: PartColorEvidence | undefined;
  try {
    evidence = policy.evidence === undefined ? undefined : importPartColorEvidence(policy.evidence);
  } catch {
    issues.push({ code: 'invalid_policy', message: 'Invalid manufacturing evidence.' });
  }
  const manufacturing = bill.map(({ partId, color }) => ({
    partId,
    color,
    ...getPartColorStatus(partId, color, evidence),
  }));
  if (
    policy.requireObservedColors &&
    manufacturing.some((entry) => entry.manufactured !== 'observed')
  )
    issues.push({
      code: 'unverified_color',
      message: 'The assembly contains unverified part/color combinations.',
      details: manufacturing.filter((entry) => entry.manufactured !== 'observed'),
    });
  const inventory = new Map<string, number>();
  let validInventory = true;
  if (policy.inventory !== undefined) {
    if (!Array.isArray(policy.inventory) || policy.inventory.length > 10_000)
      validInventory = false;
    else
      for (const entry of policy.inventory) {
        try {
          getPart(entry.partId);
          const key = `${entry.partId}:${entry.color}`;
          if (
            !COLORS.some((color) => color.id === entry.color) ||
            !Number.isSafeInteger(entry.quantity) ||
            entry.quantity < 0 ||
            inventory.has(key)
          ) {
            validInventory = false;
            break;
          }
          inventory.set(key, entry.quantity);
        } catch {
          validInventory = false;
          break;
        }
      }
  }
  if (!validInventory)
    issues.push({
      code: 'invalid_policy',
      message:
        'Inventory requires unique supported part/color entries and nonnegative integer quantities.',
    });
  const inventoryUsage = bill.map(({ partId, color, quantity }) => {
    const available = validInventory ? inventory.get(`${partId}:${color}`) : undefined;
    return {
      partId,
      color,
      required: quantity,
      available: available ?? null,
      status:
        available === undefined
          ? ('unknown' as const)
          : quantity > available
            ? ('exceeds-declared-inventory' as const)
            : ('within-declared-inventory' as const),
    };
  });
  if (inventoryUsage.some((entry) => entry.status === 'exceeds-declared-inventory'))
    issues.push({
      code: 'inventory_exceeded',
      message: 'The assembly exceeds declared inventory quantities.',
      details: inventoryUsage,
    });
  if (
    policy.requireInventory &&
    (policy.inventory === undefined || inventoryUsage.some((entry) => entry.status === 'unknown'))
  )
    issues.push({
      code: 'inventory_unknown',
      message: 'Required inventory quantities are unknown.',
      details: inventoryUsage,
    });
  let physical: PhysicalAssessment | null = null;
  try {
    if (policy.physical !== undefined && !object(policy.physical))
      throw new Error('Invalid physical options');
    for (const name of ['useCatalogMasses', 'estimateMissingMasses'] as const)
      if (policy.physical?.[name] !== undefined && typeof policy.physical[name] !== 'boolean')
        throw new Error('Invalid physical option');
    const physicalOptions = {
      ...policy.physical,
      data: importPhysicalData(policy.physical?.data ?? { version: 1, parts: {} }),
    };
    if (!geometry.length) physical = assessPhysicalFeasibility(assembly, physicalOptions);
  } catch {
    issues.push({ code: 'invalid_policy', message: 'Invalid physical data or options.' });
  }
  if ((policy.rejectInfeasible ?? true) && physical?.status === 'infeasible')
    issues.push({ code: 'physical_rejected', message: physical.reasons[0], details: physical });
  return structuredClone({
    allowed: issues.length === 0,
    issues,
    geometry,
    manufacturing,
    inventory: inventoryUsage,
    physical,
    buildability: physical ? getBuildabilityReport(physical) : null,
    constructionSequence: 'not-validated' as const,
  });
}

export type PolicyAssessment = ReturnType<typeof evaluateAssemblyPolicy>;
export type PatchResult =
  | { ok: true; revision: number; assembly: Assembly; assessment: PolicyAssessment }
  | {
      ok: false;
      revision: number;
      error: { code: string; message: string; issues?: unknown };
      assessment?: PolicyAssessment;
    };

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fields(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

const brickFields = ['partId', 'color', 'x', 'y', 'z', 'rotation', 'facing'] as const;
function validChanges(value: unknown, complete: boolean): boolean {
  if (
    !object(value) ||
    !fields(value, complete ? ['id', ...brickFields] : brickFields) ||
    !Object.keys(value).length
  )
    return false;
  if (complete && (typeof value.id !== 'string' || !value.id.trim() || value.id.length > 100))
    return false;
  for (const field of brickFields) {
    // Facing is optional even on complete bricks: upright pieces leave it out.
    if (!(field in value) && (!complete || field === 'facing')) continue;
    if (field === 'facing') {
      if (!FACINGS.includes(value[field] as never)) return false;
    } else if (field === 'partId') {
      if (typeof value[field] !== 'string' || !value[field]) return false;
    } else if (typeof value[field] !== 'number' || !Number.isFinite(value[field])) return false;
  }
  return true;
}

/** 1 x 3 x 3 doors that older builds hung in 1 x 3 x 4 frames, and the doors that fit them. */
const LEGACY_DOORS: Readonly<Record<string, string>> = { '801a': '3193a', '802a': '3192a' };

/** Whole windows that older builds hung inside window frames, and the glass that fits each frame. */
const LEGACY_PANES: Readonly<Record<string, { frame: string; glass: string }>> = {
  '4035': { frame: '60593', glass: '60602' },
  '3853': { frame: '60594', glass: '86210' },
};

/**
 * Swaps legacy doors for fitting ones, nudged half a stud if that is what seats them, and
 * windows that sat inside a frame for the frame's glass.
 */
function migrateLegacyInserts(bricks: readonly Brick[]): Brick[] {
  return bricks.map((brick) => {
    const pane = LEGACY_PANES[brick.partId];
    if (pane) {
      const frame = bricks.find(
        (candidate) =>
          candidate.partId === pane.frame &&
          candidate.y === brick.y &&
          candidate.rotation === brick.rotation &&
          Math.abs(candidate.x - brick.x) <= 0.5 &&
          Math.abs(candidate.z - brick.z) <= 0.5,
      );
      return frame ? { ...brick, partId: pane.glass, x: frame.x, z: frame.z } : brick;
    }
    const partId = LEGACY_DOORS[brick.partId];
    if (!partId) return brick;
    const door = { ...brick, partId };
    for (const [dx, dz] of [
      [0, 0],
      [0.5, 0],
      [-0.5, 0],
      [0, 0.5],
      [0, -0.5],
    ]) {
      const moved = { ...door, x: door.x + dx, z: door.z + dz };
      if (bricks.some((frame) => isMatchingInsertFrame(moved, frame))) return moved;
    }
    return door;
  });
}

export function importAssembly(value: unknown, maxPieces = MAX_PIECES): Assembly {
  if (!Number.isInteger(maxPieces) || maxPieces < 1 || maxPieces > MAX_PIECES)
    throw new Error(`Import piece limit must be 1-${MAX_PIECES}.`);
  if (object(value) && 'assembly' in value) {
    if (value.version !== 1) throw new Error('Unsupported assembly document version.');
    value = value.assembly;
  }
  if (
    !object(value) ||
    !fields(value, ['name', 'buildArea', 'bricks']) ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    value.name.length > 200 ||
    !Array.isArray(value.bricks) ||
    value.bricks.length > maxPieces ||
    !value.bricks.every((brick) => validChanges(brick, true)) ||
    (value.buildArea !== undefined &&
      (!Number.isInteger(value.buildArea) ||
        (value.buildArea as number) < BUILD_AREA ||
        (value.buildArea as number) > MAX_BUILD_AREA))
  )
    throw new Error(
      `Invalid assembly: expected a name, complete bricks and a ${BUILD_AREA}-${MAX_BUILD_AREA} stud board, at most ${maxPieces} pieces.`,
    );
  const assembly = structuredClone(value) as unknown as Assembly;
  assembly.bricks = migrateLegacyInserts(assembly.bricks);
  const issues = validateAssembly(assembly);
  if (issues.length) throw new Error(`Invalid assembly geometry: ${issues[0].message}`);
  return assembly;
}

function validOperation(value: unknown): value is PatchOperation {
  if (!object(value)) return false;
  if (value.type === 'add')
    return fields(value, ['type', 'brick']) && validChanges(value.brick, true);
  if (value.type !== 'remove' && value.type !== 'update') return false;
  return (
    fields(value, value.type === 'remove' ? ['type', 'id'] : ['type', 'id', 'changes']) &&
    typeof value.id === 'string' &&
    !!value.id.trim() &&
    value.id.length <= 100 &&
    (value.type === 'remove' || validChanges(value.changes, false))
  );
}

export function previewPatch(
  assembly: Assembly,
  patch: AssemblyPatch,
  context: { policy?: EditPolicy; revision?: number } = {},
): PatchResult {
  const revision = context.revision ?? 0;
  const fail = (code: string, message: string): PatchResult => ({
    ok: false,
    revision,
    error: { code, message },
  });
  if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER)
    return fail(
      'invalid_revision',
      'Current revision must be a nonnegative safe integer with room to increment.',
    );
  if (
    !object(patch) ||
    !fields(patch, ['operations', 'expectedRevision']) ||
    !Array.isArray(patch.operations) ||
    !patch.operations.length ||
    patch.operations.length > MAX_PATCH_OPERATIONS
  )
    return fail('invalid_patch', `A patch requires 1-${MAX_PATCH_OPERATIONS} operations.`);
  if (
    patch.expectedRevision !== undefined &&
    (!Number.isSafeInteger(patch.expectedRevision) || patch.expectedRevision < 0)
  )
    return fail('invalid_patch', 'Expected revision must be a nonnegative safe integer.');
  if (patch.expectedRevision !== undefined && patch.expectedRevision !== revision)
    return fail('revision_conflict', 'The assembly revision changed; preview the patch again.');
  const initialIssues = validateAssembly(assembly);
  if (initialIssues.length)
    return {
      ok: false,
      revision,
      error: {
        code: 'geometry_rejected',
        message: initialIssues[0].message,
        issues: initialIssues,
      },
    };
  const next = structuredClone(assembly);
  const bricks = new Map(next.bricks.map((brick) => [brick.id, brick]));
  const targets = new Set<string>();
  for (const operation of patch.operations) {
    if (!validOperation(operation))
      return fail(
        'invalid_patch',
        'Invalid patch operation; additions require complete bricks and updates preserve IDs.',
      );
    const id = operation.type === 'add' ? operation.brick.id : operation.id;
    if (targets.has(id))
      return fail('duplicate_target', 'Each piece may be targeted only once per patch.');
    targets.add(id);
    if (operation.type === 'add') {
      if (bricks.has(id)) return fail('duplicate_id', `Piece ${id} already exists.`);
      bricks.set(id, structuredClone(operation.brick));
    } else {
      const brick = bricks.get(id);
      if (!brick) return fail('piece_not_found', `Piece ${id} not found.`);
      if (operation.type === 'remove') bricks.delete(id);
      else bricks.set(id, { ...brick, ...operation.changes });
    }
  }
  next.bricks = [...bricks.values()];
  const assessment = evaluateAssemblyPolicy(next, context.policy);
  if (!assessment.allowed) {
    const issue = assessment.issues[0];
    return {
      ok: false,
      revision,
      error: { code: issue.code, message: issue.message, issues: issue.details },
      assessment,
    };
  }
  return { ok: true, revision, assembly: next, assessment };
}

export function applyPatch(
  assembly: Assembly,
  patch: AssemblyPatch,
  context: { policy?: EditPolicy; revision?: number } = {},
): PatchResult {
  const result = previewPatch(assembly, patch, context);
  return result.ok ? { ...result, revision: result.revision + 1 } : result;
}
