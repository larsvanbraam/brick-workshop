import { COLORS } from './color-catalog.ts';
export { COLORS, COLOR_SOURCE } from './color-catalog.ts';

export type Rotation = 0 | 90 | 180 | 270;

export interface ConnectionSite {
  x: number;
  z: number;
}

export interface Part {
  id: string;
  name: string;
  width: number;
  depth: number;
  height: number;
  kind: 'brick' | 'plate' | 'tile';
  family?: 'tall' | 'slope' | 'round' | 'arch' | 'baseplate' | 'cone' | 'door' | 'window';
  shape?: 'slope' | 'round' | 'arch' | 'baseplate' | 'cone' | 'door' | 'window';
  ldrawCenter?: { x: number; z: number };
  ldrawRotation: Rotation;
  connections: {
    topStuds: readonly ConnectionSite[];
    bottomReceivers: readonly ConnectionSite[];
  };
}

function rectangularConnections(width: number, depth: number): Part['connections'] {
  const sites = Array.from({ length: width * depth }, (_, index) => ({
    x: index % width,
    z: Math.floor(index / width),
  }));
  return { topStuds: sites, bottomReceivers: sites };
}

function basicPart(
  id: string,
  name: string,
  width: number,
  depth: number,
  height: number,
  kind: Part['kind'] = 'brick',
  shape?: Part['shape'],
): Part {
  const connections = rectangularConnections(width, depth);
  return {
    id,
    name,
    width,
    depth,
    height,
    kind,
    family: shape ?? (kind === 'brick' && height > 3 ? 'tall' : undefined),
    shape,
    ldrawRotation: shape ? 0 : width === depth ? 0 : 90,
    ...(shape === 'slope' ? { ldrawCenter: { x: 0, z: -10 } } : {}),
    connections: {
      ...connections,
      topStuds:
        kind === 'tile'
          ? []
          : shape === 'slope'
            ? connections.topStuds.filter((site) => site.z === depth - 1)
            : connections.topStuds,
    },
  };
}

function architecturalPart(
  id: string,
  name: string,
  width: number,
  depth: number,
  height: number,
  family: 'arch' | 'baseplate' | 'cone' | 'door' | 'window',
  options: Partial<Pick<Part, 'connections' | 'ldrawRotation' | 'ldrawCenter'>> = {},
): Part {
  const grid =
    Number.isInteger(width) && Number.isInteger(depth)
      ? rectangularConnections(width, depth)
      : { topStuds: [], bottomReceivers: [] };
  const connections =
    family === 'baseplate'
      ? { topStuds: grid.topStuds, bottomReceivers: [] }
      : family === 'arch'
        ? {
            topStuds: grid.topStuds,
            bottomReceivers: grid.bottomReceivers.filter(
              (site) => site.z === 0 || site.z === depth - 1,
            ),
          }
        : grid;
  return {
    id,
    name,
    width,
    depth,
    height,
    kind: family === 'baseplate' ? 'plate' : 'brick',
    family,
    shape: family,
    ldrawRotation: family === 'cone' || width === depth ? 0 : 90,
    connections,
    ...options,
  };
}

function coneConnections(width: number, topWidth: number): Part['connections'] {
  const topStuds = rectangularConnections(topWidth, topWidth).topStuds.map((site) => ({
    x: site.x + (width - topWidth) / 2,
    z: site.z + (width - topWidth) / 2,
  }));
  return {
    topStuds,
    bottomReceivers: rectangularConnections(width, width).bottomReceivers.filter(
      (site) => Math.hypot(site.x + 0.5 - width / 2, site.z + 0.5 - width / 2) < width / 2,
    ),
  };
}

export const PARTS: readonly Part[] = [
  {
    id: '3001',
    name: 'Brick 2 x 4',
    width: 2,
    depth: 4,
    height: 3,
    kind: 'brick',
    ldrawRotation: 90,
    connections: rectangularConnections(2, 4),
  },
  {
    id: '3003',
    name: 'Brick 2 x 2',
    width: 2,
    depth: 2,
    height: 3,
    kind: 'brick',
    ldrawRotation: 0,
    connections: rectangularConnections(2, 2),
  },
  {
    id: '3004',
    name: 'Brick 1 x 2',
    width: 1,
    depth: 2,
    height: 3,
    kind: 'brick',
    ldrawRotation: 90,
    connections: rectangularConnections(1, 2),
  },
  {
    id: '3005',
    name: 'Brick 1 x 1',
    width: 1,
    depth: 1,
    height: 3,
    kind: 'brick',
    ldrawRotation: 0,
    connections: rectangularConnections(1, 1),
  },
  {
    id: '3622',
    name: 'Brick 1 x 3',
    width: 1,
    depth: 3,
    height: 3,
    kind: 'brick',
    ldrawRotation: 90,
    connections: rectangularConnections(1, 3),
  },
  {
    id: '3010',
    name: 'Brick 1 x 4',
    width: 1,
    depth: 4,
    height: 3,
    kind: 'brick',
    ldrawRotation: 90,
    connections: rectangularConnections(1, 4),
  },
  {
    id: '3009',
    name: 'Brick 1 x 6',
    width: 1,
    depth: 6,
    height: 3,
    kind: 'brick',
    ldrawRotation: 90,
    connections: rectangularConnections(1, 6),
  },
  {
    id: '3008',
    name: 'Brick 1 x 8',
    width: 1,
    depth: 8,
    height: 3,
    kind: 'brick',
    ldrawRotation: 90,
    connections: rectangularConnections(1, 8),
  },
  {
    id: '3002',
    name: 'Brick 2 x 3',
    width: 2,
    depth: 3,
    height: 3,
    kind: 'brick',
    ldrawRotation: 90,
    connections: rectangularConnections(2, 3),
  },
  {
    id: '2456',
    name: 'Brick 2 x 6',
    width: 2,
    depth: 6,
    height: 3,
    kind: 'brick',
    ldrawRotation: 90,
    connections: rectangularConnections(2, 6),
  },
  {
    id: '6111',
    name: 'Brick 1 x 10',
    width: 1,
    depth: 10,
    height: 3,
    kind: 'brick',
    ldrawRotation: 90,
    connections: rectangularConnections(1, 10),
  },
  {
    id: '3020',
    name: 'Plate 2 x 4',
    width: 2,
    depth: 4,
    height: 1,
    kind: 'plate',
    ldrawRotation: 90,
    connections: rectangularConnections(2, 4),
  },
  {
    id: '3022',
    name: 'Plate 2 x 2',
    width: 2,
    depth: 2,
    height: 1,
    kind: 'plate',
    ldrawRotation: 0,
    connections: rectangularConnections(2, 2),
  },
  {
    id: '3024',
    name: 'Plate 1 x 1',
    width: 1,
    depth: 1,
    height: 1,
    kind: 'plate',
    ldrawRotation: 0,
    connections: rectangularConnections(1, 1),
  },
  {
    id: '3023b',
    name: 'Plate 1 x 2',
    width: 1,
    depth: 2,
    height: 1,
    kind: 'plate',
    ldrawRotation: 90,
    connections: rectangularConnections(1, 2),
  },
  {
    id: '3623',
    name: 'Plate 1 x 3',
    width: 1,
    depth: 3,
    height: 1,
    kind: 'plate',
    ldrawRotation: 90,
    connections: rectangularConnections(1, 3),
  },
  {
    id: '3710',
    name: 'Plate 1 x 4',
    width: 1,
    depth: 4,
    height: 1,
    kind: 'plate',
    ldrawRotation: 90,
    connections: rectangularConnections(1, 4),
  },
  {
    id: '3666',
    name: 'Plate 1 x 6',
    width: 1,
    depth: 6,
    height: 1,
    kind: 'plate',
    ldrawRotation: 90,
    connections: rectangularConnections(1, 6),
  },
  {
    id: '3460',
    name: 'Plate 1 x 8',
    width: 1,
    depth: 8,
    height: 1,
    kind: 'plate',
    ldrawRotation: 90,
    connections: rectangularConnections(1, 8),
  },
  {
    id: '3021',
    name: 'Plate 2 x 3',
    width: 2,
    depth: 3,
    height: 1,
    kind: 'plate',
    ldrawRotation: 90,
    connections: rectangularConnections(2, 3),
  },
  {
    id: '3795',
    name: 'Plate 2 x 6',
    width: 2,
    depth: 6,
    height: 1,
    kind: 'plate',
    ldrawRotation: 90,
    connections: rectangularConnections(2, 6),
  },
  {
    id: '3070b',
    name: 'Tile 1 x 1',
    width: 1,
    depth: 1,
    height: 1,
    kind: 'tile',
    ldrawRotation: 0,
    connections: { topStuds: [], bottomReceivers: rectangularConnections(1, 1).bottomReceivers },
  },
  {
    id: '3069b',
    name: 'Tile 1 x 2',
    width: 1,
    depth: 2,
    height: 1,
    kind: 'tile',
    ldrawRotation: 90,
    connections: { topStuds: [], bottomReceivers: rectangularConnections(1, 2).bottomReceivers },
  },
  {
    id: '63864',
    name: 'Tile 1 x 3',
    width: 1,
    depth: 3,
    height: 1,
    kind: 'tile',
    ldrawRotation: 90,
    connections: { topStuds: [], bottomReceivers: rectangularConnections(1, 3).bottomReceivers },
  },
  {
    id: '2431',
    name: 'Tile 1 x 4',
    width: 1,
    depth: 4,
    height: 1,
    kind: 'tile',
    ldrawRotation: 90,
    connections: { topStuds: [], bottomReceivers: rectangularConnections(1, 4).bottomReceivers },
  },
  {
    id: '3068b',
    name: 'Tile 2 x 2',
    width: 2,
    depth: 2,
    height: 1,
    kind: 'tile',
    ldrawRotation: 0,
    connections: { topStuds: [], bottomReceivers: rectangularConnections(2, 2).bottomReceivers },
  },
  {
    id: '87079',
    name: 'Tile 2 x 4',
    width: 2,
    depth: 4,
    height: 1,
    kind: 'tile',
    ldrawRotation: 90,
    connections: { topStuds: [], bottomReceivers: rectangularConnections(2, 4).bottomReceivers },
  },
  basicPart('6112', 'Brick 1 x 12', 1, 12, 3),
  basicPart('2465', 'Brick 1 x 16', 1, 16, 3),
  basicPart('3006', 'Brick 2 x 10', 2, 10, 3),
  basicPart('3007', 'Brick 2 x 8', 2, 8, 3),
  basicPart('2356', 'Brick 4 x 6', 4, 6, 3),
  basicPart('6212', 'Brick 4 x 10', 4, 10, 3),
  basicPart('4201', 'Brick 8 x 8', 8, 8, 3),
  basicPart('4202', 'Brick 4 x 12', 4, 12, 3),
  basicPart('4204', 'Brick 8 x 16', 8, 16, 3),
  basicPart('78329', 'Plate 1 x 5', 1, 5, 1, 'plate'),
  basicPart('4477', 'Plate 1 x 10', 1, 10, 1, 'plate'),
  basicPart('60479', 'Plate 1 x 12', 1, 12, 1, 'plate'),
  basicPart('3034', 'Plate 2 x 8', 2, 8, 1, 'plate'),
  basicPart('3832', 'Plate 2 x 10', 2, 10, 1, 'plate'),
  basicPart('2445', 'Plate 2 x 12', 2, 12, 1, 'plate'),
  basicPart('91988', 'Plate 2 x 14', 2, 14, 1, 'plate'),
  basicPart('4282', 'Plate 2 x 16', 2, 16, 1, 'plate'),
  basicPart('11212', 'Plate 3 x 3', 3, 3, 1, 'plate'),
  basicPart('3031', 'Plate 4 x 4', 4, 4, 1, 'plate'),
  basicPart('3032', 'Plate 4 x 6', 4, 6, 1, 'plate'),
  basicPart('3035', 'Plate 4 x 8', 4, 8, 1, 'plate'),
  basicPart('3030', 'Plate 4 x 10', 4, 10, 1, 'plate'),
  basicPart('3029', 'Plate 4 x 12', 4, 12, 1, 'plate'),
  basicPart('3958', 'Plate 6 x 6', 6, 6, 1, 'plate'),
  basicPart('3036', 'Plate 6 x 8', 6, 8, 1, 'plate'),
  basicPart('3033', 'Plate 6 x 10', 6, 10, 1, 'plate'),
  basicPart('3028', 'Plate 6 x 12', 6, 12, 1, 'plate'),
  basicPart('3456', 'Plate 6 x 14', 6, 14, 1, 'plate'),
  basicPart('3027', 'Plate 6 x 16', 6, 16, 1, 'plate'),
  basicPart('41539', 'Plate 8 x 8', 8, 8, 1, 'plate'),
  basicPart('92438', 'Plate 8 x 16', 8, 16, 1, 'plate'),
  basicPart('91405', 'Plate 16 x 16', 16, 16, 1, 'plate'),
  basicPart('26603', 'Tile 2 x 3', 2, 3, 1, 'tile'),
  basicPart('6636', 'Tile 1 x 6', 1, 6, 1, 'tile'),
  basicPart('4162', 'Tile 1 x 8', 1, 8, 1, 'tile'),
  basicPart('69729', 'Tile 2 x 6', 2, 6, 1, 'tile'),
  basicPart('1751', 'Tile 4 x 4', 4, 4, 1, 'tile'),
  basicPart('6934', 'Tile 3 x 6', 3, 6, 1, 'tile'),
  basicPart('8165', 'Tile 4 x 8', 4, 8, 1, 'tile'),
  basicPart('6320', 'Tile 6 x 8', 6, 8, 1, 'tile'),
  basicPart('48288', 'Tile 8 x 16', 8, 16, 1, 'tile'),
  basicPart('14716', 'Brick 1 x 1 x 3', 1, 1, 9),
  basicPart('2453b', 'Brick 1 x 1 x 5', 1, 1, 15),
  basicPart('3245c', 'Brick 1 x 2 x 2', 1, 2, 6),
  basicPart('2454b', 'Brick 1 x 2 x 5', 1, 2, 15),
  basicPart('49311', 'Brick 1 x 4 x 3', 1, 4, 9),
  basicPart('3754', 'Brick 1 x 6 x 5', 1, 6, 15),
  basicPart('39266', 'Brick 1 x 5 x 2', 1, 5, 6),
  basicPart('30145', 'Brick 2 x 2 x 3', 2, 2, 9),
  basicPart('30144', 'Brick 2 x 4 x 3', 2, 4, 9),
  basicPart('6213', 'Brick 2 x 6 x 3', 2, 6, 9),
  basicPart('3040b', 'Slope 45 2 x 1', 1, 2, 3, 'brick', 'slope'),
  basicPart('3039', 'Slope 45 2 x 2', 2, 2, 3, 'brick', 'slope'),
  basicPart('3038', 'Slope 45 2 x 3', 3, 2, 3, 'brick', 'slope'),
  basicPart('3037', 'Slope 45 2 x 4', 4, 2, 3, 'brick', 'slope'),
  basicPart('3062b', 'Round brick 1 x 1', 1, 1, 3, 'brick', 'round'),
  basicPart('3941', 'Round brick 2 x 2', 2, 2, 3, 'brick', 'round'),
  basicPart('6141', 'Round plate 1 x 1', 1, 1, 1, 'plate', 'round'),
  basicPart('4032a', 'Round plate 2 x 2', 2, 2, 1, 'plate', 'round'),
  basicPart('98138', 'Round tile 1 x 1', 1, 1, 1, 'tile', 'round'),
  basicPart('14769', 'Round tile 2 x 2', 2, 2, 1, 'tile', 'round'),
  architecturalPart('3659', 'Arch 1 x 4', 1, 4, 3, 'arch'),
  architecturalPart('4490', 'Arch 1 x 3', 1, 3, 3, 'arch'),
  architecturalPart('6182', 'Arch 1 x 4 x 2', 1, 4, 6, 'arch'),
  architecturalPart('3307', 'Arch 1 x 6 x 2', 1, 6, 6, 'arch'),
  architecturalPart('3865', 'Baseplate 8 x 16', 8, 16, 0.5, 'baseplate'),
  architecturalPart('3867', 'Baseplate 16 x 16', 16, 16, 0.5, 'baseplate'),
  architecturalPart('4589', 'Cone 1 x 1', 1, 1, 3, 'cone', { connections: coneConnections(1, 1) }),
  architecturalPart('3942c', 'Cone 2 x 2 x 2, open stud', 2, 2, 6, 'cone', {
    connections: coneConnections(2, 1),
  }),
  architecturalPart('3943b', 'Cone 4 x 4 x 2, axle hole', 4, 4, 6, 'cone', {
    connections: coneConnections(4, 2),
  }),
  architecturalPart('6233', 'Cone 3 x 3 x 2', 3, 3, 6, 'cone', {
    connections: coneConnections(3, 2),
  }),
  architecturalPart('801a', 'Door 1 x 3 x 3, left hinge', 1.5, 3, 9, 'door', {
    ldrawRotation: 0,
    ldrawCenter: { x: 5, z: 20 },
    connections: { topStuds: [{ x: 0, z: 0 }], bottomReceivers: [{ x: 0, z: 0 }] },
  }),
  architecturalPart('802a', 'Door 1 x 3 x 3, right hinge', 1.5, 3, 9, 'door', {
    ldrawRotation: 0,
    ldrawCenter: { x: -5, z: 20 },
    connections: { topStuds: [{ x: 0.5, z: 0 }], bottomReceivers: [{ x: 0.5, z: 0 }] },
  }),
  architecturalPart('3861c', 'Door 1 x 4 x 5, reinforced hinge', 1.5, 4, 15, 'door', {
    ldrawRotation: 0,
    ldrawCenter: { x: -5, z: 30 },
    connections: { topStuds: [{ x: 0.5, z: 0 }], bottomReceivers: [{ x: 0.5, z: 0 }] },
  }),
  architecturalPart('3579', 'Door frame 1 x 3 x 4', 1, 3, 12, 'door'),
  architecturalPart('60596', 'Door frame 1 x 4 x 6', 1, 4, 18, 'door', {
    connections: {
      topStuds: [
        { x: 0, z: 1 },
        { x: 0, z: 2 },
      ],
      bottomReceivers: rectangularConnections(1, 4).bottomReceivers,
    },
  }),
  architecturalPart('60592', 'Window frame 1 x 2 x 2', 1, 2, 6, 'window'),
  architecturalPart('60593', 'Window frame 1 x 2 x 3', 1, 2, 9, 'window'),
  architecturalPart('60594', 'Window frame 1 x 4 x 3', 1, 4, 9, 'window', {
    connections: {
      topStuds: [
        { x: 0, z: 1 },
        { x: 0, z: 2 },
      ],
      bottomReceivers: rectangularConnections(1, 4).bottomReceivers,
    },
  }),
  architecturalPart('2493b', 'Window frame 1 x 4 x 5, hollow studs', 1, 4, 15, 'window'),
  architecturalPart('3853', 'Window 1 x 4 x 3 with sill', 1.5, 5, 9, 'window', {
    ldrawCenter: { x: 0, z: -5 },
    connections: {
      topStuds: [
        { x: 0.5, z: 1.5 },
        { x: 0.5, z: 2.5 },
      ],
      bottomReceivers: [0.5, 1.5, 2.5, 3.5].map((z) => ({ x: 0.5, z })),
    },
  }),
];

export interface Brick {
  id: string;
  partId: string;
  color: number;
  x: number;
  y: number;
  z: number;
  rotation: Rotation;
}

export interface Assembly {
  name: string;
  bricks: readonly Brick[];
  buildArea?: number;
}

export interface Issue {
  brickId: string;
  code: 'invalid' | 'collision' | 'unsupported';
  message: string;
}

export type PlacementResult = { ok: true; assembly: Assembly } | { ok: false; issues: Issue[] };

export const BUILD_AREA = 16;
export const MAX_BUILD_AREA = 64;
export const MAX_HEIGHT = 60;
export const PLATE_HEIGHT = 0.4;

export function getBuildArea(assembly: Assembly): number {
  return assembly.buildArea ?? BUILD_AREA;
}

export function getPart(partId: string): Part {
  const part = PARTS.find((candidate) => candidate.id === partId);
  if (!part) throw new Error(`Unknown part: ${partId}`);
  return part;
}

export function footprint(brick: Brick) {
  const part = getPart(brick.partId);
  const turned = brick.rotation === 90 || brick.rotation === 270;
  return {
    width: turned ? part.depth : part.width,
    depth: turned ? part.width : part.depth,
    height: part.height,
  };
}

export function getConnectionSites(
  brick: Brick,
  surface: 'top' | 'bottom',
  part: Part = getPart(brick.partId),
) {
  const sites = surface === 'top' ? part.connections.topStuds : part.connections.bottomReceivers;
  return sites.map((site) => {
    let x = site.x;
    let z = site.z;
    if (brick.rotation === 90) {
      x = site.z;
      z = part.width - 1 - site.x;
    } else if (brick.rotation === 180) {
      x = part.width - 1 - site.x;
      z = part.depth - 1 - site.z;
    } else if (brick.rotation === 270) {
      x = part.depth - 1 - site.z;
      z = site.x;
    }
    return {
      x: brick.x + x + 0.5,
      y: brick.y + (surface === 'top' ? part.height : 0),
      z: brick.z + z + 0.5,
    };
  });
}

export function hasStudConnection(
  support: Brick,
  brick: Brick,
  supportPart: Part = getPart(support.partId),
  part: Part = getPart(brick.partId),
): boolean {
  if (support.y + supportPart.height !== brick.y) return false;
  const studs = new Set(
    getConnectionSites(support, 'top', supportPart).map((site) => `${site.x}:${site.z}`),
  );
  return getConnectionSites(brick, 'bottom', part).some((site) => studs.has(`${site.x}:${site.z}`));
}

function isValid(brick: Brick, buildArea: number): boolean {
  if (
    !brick.id.trim() ||
    !PARTS.some((part) => part.id === brick.partId) ||
    !COLORS.some((color) => color.id === brick.color) ||
    ![0, 90, 180, 270].includes(brick.rotation) ||
    ![brick.x, brick.y, brick.z].every((value) => Number.isInteger(value * 2) && value >= 0)
  )
    return false;
  const size = footprint(brick);
  return (
    brick.x + size.width <= buildArea &&
    brick.z + size.depth <= buildArea &&
    brick.y + size.height <= MAX_HEIGHT
  );
}

export function validateAssembly(assembly: Assembly): Issue[] {
  if (
    assembly.buildArea !== undefined &&
    (!Number.isInteger(assembly.buildArea) ||
      assembly.buildArea < BUILD_AREA ||
      assembly.buildArea > MAX_BUILD_AREA)
  )
    return [
      {
        brickId: '',
        code: 'invalid',
        message: `Build area must be a whole number from ${BUILD_AREA} to ${MAX_BUILD_AREA} studs.`,
      },
    ];
  const buildArea = getBuildArea(assembly);
  const issues: Issue[] = [];
  const seen = new Set<string>();
  const valid: Brick[] = [];
  for (const brick of assembly.bricks) {
    if (!isValid(brick, buildArea) || seen.has(brick.id)) {
      issues.push({
        brickId: brick.id,
        code: 'invalid',
        message:
          'Use a unique ID, supported part/color, quarter-turn rotation, and a half-unit grid position inside the build area.',
      });
    } else {
      valid.push(brick);
    }
    seen.add(brick.id);
  }
  const groundedStuds = new Set<string>();
  for (const brick of valid.toSorted((first, second) => first.y - second.y)) {
    if (
      brick.y === 0 ||
      getConnectionSites(brick, 'bottom').some((site) =>
        groundedStuds.has(`${site.y}:${site.x}:${site.z}`),
      )
    ) {
      for (const site of getConnectionSites(brick, 'top'))
        groundedStuds.add(`${site.y}:${site.x}:${site.z}`);
    } else {
      issues.push({
        brickId: brick.id,
        code: 'unsupported',
        message: 'No stud connection to a grounded brick below this piece.',
      });
    }
  }
  const bounds = valid.map((brick) => footprint(brick));
  const buckets = new Map<string, number[]>();
  const cells = valid.map((brick, index) => {
    const size = bounds[index];
    const keys: string[] = [];
    for (
      let horizontal = Math.floor(brick.x / 4);
      horizontal < Math.ceil((brick.x + size.width) / 4);
      horizontal++
    )
      for (
        let vertical = Math.floor(brick.y / 3);
        vertical < Math.ceil((brick.y + size.height) / 3);
        vertical++
      )
        for (
          let depth = Math.floor(brick.z / 4);
          depth < Math.ceil((brick.z + size.depth) / 4);
          depth++
        ) {
          const key = `${horizontal}:${vertical}:${depth}`;
          keys.push(key);
          const occupants = buckets.get(key);
          if (occupants) occupants.push(index);
          else buckets.set(key, [index]);
        }
    return keys;
  });
  for (let index = 0; index < valid.length; index += 1) {
    const brick = valid[index];
    const size = bounds[index];
    const candidates = new Set<number>();
    for (const key of cells[index])
      for (const otherIndex of buckets.get(key)!)
        if (otherIndex > index) candidates.add(otherIndex);
    for (const otherIndex of [...candidates].sort((first, second) => first - second)) {
      const other = valid[otherIndex];
      const otherSize = bounds[otherIndex];
      if (
        brick.x < other.x + otherSize.width &&
        brick.x + size.width > other.x &&
        brick.z < other.z + otherSize.depth &&
        brick.z + size.depth > other.z &&
        brick.y < other.y + otherSize.height &&
        brick.y + size.height > other.y
      ) {
        issues.push({
          brickId: brick.id,
          code: 'collision',
          message: `Overlaps piece ${other.id}.`,
        });
        issues.push({
          brickId: other.id,
          code: 'collision',
          message: `Overlaps piece ${brick.id}.`,
        });
      }
    }
  }
  return issues;
}

export function placeBrick(assembly: Assembly, brick: Brick): PlacementResult {
  const next = { ...assembly, bricks: [...assembly.bricks, brick] };
  const issues = validateAssembly(next);
  return issues.length ? { ok: false, issues } : { ok: true, assembly: next };
}

export function removeBrick(assembly: Assembly, brickId: string): PlacementResult {
  if (!assembly.bricks.some((brick) => brick.id === brickId)) {
    return { ok: false, issues: [{ brickId, code: 'invalid', message: 'Piece not found.' }] };
  }
  const next = { ...assembly, bricks: assembly.bricks.filter((brick) => brick.id !== brickId) };
  const issues = validateAssembly(next);
  return issues.length ? { ok: false, issues } : { ok: true, assembly: next };
}

export function getBillOfMaterials(assembly: Assembly) {
  const entries = new Map<string, { partId: string; color: number; quantity: number }>();
  for (const brick of assembly.bricks) {
    const key = `${brick.partId}:${brick.color}`;
    const entry = entries.get(key);
    if (entry) entry.quantity += 1;
    else entries.set(key, { partId: brick.partId, color: brick.color, quantity: 1 });
  }
  return [...entries.values()];
}

export function getLDrawTransform(brick: Brick) {
  const size = footprint(brick);
  const part = getPart(brick.partId);
  const rotation = ((brick.rotation + part.ldrawRotation) % 360) as Rotation;
  const cosine = Math.round(Math.cos((rotation * Math.PI) / 180));
  const sine = Math.round(Math.sin((rotation * Math.PI) / 180));
  const center = part.ldrawCenter ?? { x: 0, z: 0 };
  return {
    x: (brick.x + size.width / 2) * 20 - cosine * center.x - sine * center.z,
    y: -(brick.y + size.height) * 8,
    z: (brick.z + size.depth / 2) * 20 + sine * center.x - cosine * center.z,
    rotation,
  };
}

export function exportLDraw(assembly: Assembly): string {
  const issues = validateAssembly(assembly);
  if (issues.length) throw new Error('Cannot export an invalid assembly.');
  const lines = [
    `0 ${assembly.name.replace(/[\r\n]/g, ' ')}`,
    '0 Generated by Brick Workshop',
    '0 UNVERIFIED DRAFT: physical buildability is not certified; not approved for construction.',
    '0 Upright bricks and plates; layers are 8 LDU.',
  ];
  let previousLayer = -1;
  for (const brick of assembly.bricks.toSorted((first, second) => first.y - second.y)) {
    if (previousLayer !== -1 && brick.y !== previousLayer) lines.push('0 STEP');
    previousLayer = brick.y;
    const transform = getLDrawTransform(brick);
    const cosine = Math.round(Math.cos((transform.rotation * Math.PI) / 180));
    const sine = Math.round(Math.sin((transform.rotation * Math.PI) / 180));
    lines.push(
      `1 ${brick.color} ${transform.x} ${transform.y} ${transform.z} ${cosine} 0 ${sine} 0 1 0 ${-sine} 0 ${cosine} ${brick.partId}.dat`,
    );
  }
  return `${lines.join('\n')}\n`;
}
