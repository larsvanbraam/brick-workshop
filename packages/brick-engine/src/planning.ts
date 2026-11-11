import {
  INSERT_FRAME_PARTS,
  MAX_HEIGHT,
  getBuildArea,
  getConnectionSites,
  getPart,
  hasStudConnection,
  isMatchingInsertFrame,
  isRuntimePart,
  placeBrick,
  validateAssembly,
} from './core.ts';
import type { Assembly, Brick, Rotation } from './core.ts';
import { MAX_PHYSICS_CONTACT_VARIABLES, MAX_PHYSICS_PIECES } from './physics.ts';

export function getPartCapabilities(partId: string) {
  const part = getPart(partId);
  return {
    id: part.id,
    name: part.name,
    width: part.width,
    depth: part.depth,
    height: part.height,
    kind: part.kind,
    family: part.family ?? part.kind,
    shape: part.shape ?? 'box',
    contactPhysics: isRuntimePart(partId)
      ? 'not-assessed'
      : part.shape
        ? 'connection-cell-model'
        : 'rectangular-model',
    connectorFit: isRuntimePart(partId) ? 'unknown' : 'curated',
    connections: structuredClone(part.connections),
    matchingInsertFrameId: INSERT_FRAME_PARTS[partId] ?? null,
    collisionModel: 'reserved-envelope-with-reviewed-insert-exceptions',
  };
}

export function getEngineCapabilities(assembly: Assembly) {
  const partIds = [...new Set(assembly.bricks.map((brick) => brick.partId))];
  return {
    buildArea: getBuildArea(assembly),
    maxHeight: MAX_HEIGHT,
    positionIncrement: 0.5,
    rotations: [0, 90, 180, 270],
    connectionModel: 'upright-studs-and-reviewed-static-inserts',
    insertFrames: { ...INSERT_FRAME_PARTS },
    collisionModel: 'reserved-envelope-with-reviewed-insert-exceptions',
    runtimeConnectorFit: 'unknown',
    staticGravity: {
      maxPieces: MAX_PHYSICS_PIECES,
      maxContactVariables: MAX_PHYSICS_CONTACT_VARIABLES,
      withinPieceLimit: assembly.bricks.length <= MAX_PHYSICS_PIECES,
      unsupportedPartIds: [],
      approximatedContactPartIds: partIds.filter((partId) => getPart(partId).shape),
      unknownConnectorPartIds: partIds.filter(isRuntimePart),
      certification: 'not-certified',
    },
    placementSearch: {
      maxCandidates: 50,
      maxChecks: 2000,
      scope: 'upright-stud-alignment-and-optional-ground-grid',
      inserts: 'not-enumerated',
    },
    unsupportedConnections: ['sideways-studs', 'clips', 'hinges-in-motion', 'technic'],
  };
}

export function explainConnection(assembly: Assembly, brick: Brick) {
  const next = {
    ...assembly,
    bricks: [...assembly.bricks.filter((piece) => piece.id !== brick.id), brick],
  };
  const receivers = new Set(
    getConnectionSites(brick, 'bottom').map((site) => `${site.y}:${site.x}:${site.z}`),
  );
  return {
    grounded: brick.y === 0,
    connectorFit: isRuntimePart(brick.partId) ? ('unknown' as const) : ('curated' as const),
    studSupports: assembly.bricks
      .filter((support) => support.id !== brick.id && hasStudConnection(support, brick))
      .map((support) => ({
        brickId: support.id,
        sites: getConnectionSites(support, 'top').filter((site) =>
          receivers.has(`${site.y}:${site.x}:${site.z}`),
        ),
      })),
    insertFrames: assembly.bricks
      .filter((frame) => isMatchingInsertFrame(brick, frame))
      .map((frame) => frame.id),
    issues: validateAssembly(next),
    strength: 'unknown' as const,
  };
}

export interface PlacementQuery {
  partId: string;
  color: number;
  supportId?: string;
  rotations?: readonly Rotation[];
  includeGround?: boolean;
  maxCandidates?: number;
  maxChecks?: number;
}

export function findPlacementCandidates(assembly: Assembly, query: PlacementQuery) {
  const issues = validateAssembly(assembly);
  if (issues.length) throw new Error('Resolve assembly geometry before searching placements.');
  getPart(query.partId);
  const maxCandidates = query.maxCandidates ?? 20;
  const maxChecks = query.maxChecks ?? 256;
  const rotations = query.rotations ?? [0, 90, 180, 270];
  if (
    !Number.isInteger(maxCandidates) ||
    maxCandidates < 1 ||
    maxCandidates > 50 ||
    !Number.isInteger(maxChecks) ||
    maxChecks < 1 ||
    maxChecks > 2000 ||
    !rotations.length ||
    rotations.some((rotation) => ![0, 90, 180, 270].includes(rotation))
  )
    throw new Error('Invalid placement search limits or rotations.');
  if (
    query.supportId !== undefined &&
    !assembly.bricks.some((brick) => brick.id === query.supportId)
  )
    throw new Error('Support piece not found.');
  let id = 'candidate';
  while (assembly.bricks.some((brick) => brick.id === id)) id += '-';
  const candidates: { brick: Brick; connection: ReturnType<typeof explainConnection> }[] = [];
  const seen = new Set<string>();
  let checked = 0;
  let truncated = false;
  function consider(brick: Brick) {
    const key = `${brick.x}:${brick.y}:${brick.z}:${brick.rotation}`;
    if (seen.has(key)) return true;
    if (checked >= maxChecks || candidates.length >= maxCandidates) {
      truncated = true;
      return false;
    }
    seen.add(key);
    checked += 1;
    if (placeBrick(assembly, brick).ok)
      candidates.push({ brick, connection: explainConnection(assembly, brick) });
    return true;
  }
  function search() {
    for (const rotation of [...new Set(rotations)]) {
      const origin: Brick = {
        id,
        partId: query.partId,
        color: query.color,
        x: 0,
        y: 0,
        z: 0,
        rotation,
      };
      const receivers = getConnectionSites(origin, 'bottom');
      for (const support of assembly.bricks) {
        if (query.supportId !== undefined && support.id !== query.supportId) continue;
        for (const stud of getConnectionSites(support, 'top'))
          for (const receiver of receivers)
            if (!consider({ ...origin, x: stud.x - receiver.x, y: stud.y, z: stud.z - receiver.z }))
              return;
      }
      if (query.includeGround ?? (assembly.bricks.length === 0 && query.supportId === undefined)) {
        const area = getBuildArea(assembly);
        for (let x = 0; x < area; x += 0.5)
          for (let z = 0; z < area; z += 0.5) if (!consider({ ...origin, x, z })) return;
      }
    }
  }
  search();
  return {
    candidates,
    checked,
    truncated,
    searchSpace: 'upright-stud-alignment-and-optional-ground-grid' as const,
    manufacturing: 'not-checked' as const,
    physics: 'not-checked' as const,
  };
}
