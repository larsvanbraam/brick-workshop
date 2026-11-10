import { COLORS } from './color-catalog.ts';
export { COLORS, COLOR_SOURCE } from './color-catalog.ts';

export type Rotation = 0 | 90 | 180 | 270;

/** Level directions a side stud, or a piece mounted on one, can point. */
export type Facing = '-z' | '-x' | '+z' | '+x';
/** In quarter turns about the vertical: a part's own -z side ends up facing each one in turn. */
export const FACINGS: readonly Facing[] = Object.freeze(['-z', '-x', '+z', '+x']);

/** A stud on a side face: its base centre, and the way it points before the part turns. */
export interface SideStud {
  /** Studs from the part's min corner. */
  x: number;
  /** Plate units up from the part's bottom. */
  y: number;
  z: number;
  facing: Facing;
}

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
  family?:
    | 'tall'
    | 'slope'
    | 'round'
    | 'arch'
    | 'baseplate'
    | 'cone'
    | 'door'
    | 'window'
    | 'detail'
    | 'foliage';
  shape?:
    | 'slope'
    | 'inverted-slope'
    | 'round'
    | 'arch'
    | 'baseplate'
    | 'cone'
    | 'door'
    | 'window'
    | 'detail'
    | 'foliage';
  ldrawCenter?: { x: number; z: number };
  ldrawBaseY?: number;
  clearance?: 'reserved';
  ldrawRotation: Rotation;
  connections: {
    topStuds: readonly ConnectionSite[];
    bottomReceivers: readonly ConnectionSite[];
  };
  /** Studs on the sides, which hold pieces mounted on their side (SNOT). */
  sideStuds?: readonly SideStud[];
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
    family:
      shape === 'inverted-slope'
        ? 'slope'
        : (shape ?? (kind === 'brick' && height > 3 ? 'tall' : undefined)),
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
  options: Partial<Pick<Part, 'connections' | 'ldrawRotation' | 'ldrawCenter' | 'ldrawBaseY'>> = {},
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

function detailPart(
  id: string,
  name: string,
  width: number,
  depth: number,
  height: number,
  kind: Part['kind'] = 'brick',
  connections?: Part['connections'],
): Part {
  return {
    ...basicPart(id, name, width, depth, height, kind),
    family: 'detail',
    shape: 'detail',
    ...(connections ? { connections } : {}),
  };
}

function sculptedPart(
  id: string,
  name: string,
  width: number,
  depth: number,
  height: number,
  family: 'detail' | 'foliage' | 'slope',
  options: Partial<
    Pick<Part, 'connections' | 'ldrawRotation' | 'ldrawCenter' | 'ldrawBaseY' | 'kind' | 'shape'>
  > = {},
): Part {
  return {
    id,
    name,
    width,
    depth,
    height,
    kind: 'brick',
    family,
    shape: family,
    clearance: 'reserved',
    ldrawRotation: 0,
    connections: { topStuds: [], bottomReceivers: [] },
    ...options,
  };
}

function roofPart(
  id: string,
  name: string,
  width: number,
  depth: number,
  height: number,
  inverted = false,
): Part {
  const grid = rectangularConnections(width, depth);
  const rear = grid.topStuds.filter((site) => site.z === depth - 1);
  return sculptedPart(id, name, width, depth, height, 'slope', {
    shape: inverted ? 'inverted-slope' : 'slope',
    ldrawCenter: { x: 0, z: -(depth - 1) * 10 },
    connections: {
      topStuds: inverted ? grid.topStuds : rear,
      bottomReceivers: inverted ? rear : grid.bottomReceivers,
    },
  });
}

/**
 * A brick with studs on one side. The reserved half stud in front of the body takes the side
 * studs, which stand 14 LDU up on the body's face; only the plain brick height places them.
 */
function sideStudPart(id: string, name: string, depth: number, height = 3): Part {
  const sites = rectangularConnections(1, depth).topStuds.map(({ z }) => ({ x: 0.5, z }));
  return {
    ...sculptedPart(id, name, 1.5, depth, height, 'detail', {
      ldrawRotation: 90,
      ldrawCenter: { x: 0, z: -5 },
      connections: { topStuds: sites, bottomReceivers: sites },
    }),
    ...(height === 3
      ? {
          sideStuds: sites.map(({ z }) => ({ x: 0.5, y: 1.75, z: z + 0.5, facing: '-x' as const })),
        }
      : {}),
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
  detailPart('98283', 'Masonry brick 1 x 2', 1, 2, 3),
  detailPart('15533', 'Masonry brick 1 x 4', 1, 4, 3),
  detailPart('2877', 'Brick 1 x 2 with grille', 1, 2, 3),
  detailPart('4216', 'Brick 1 x 2 with groove', 1, 2, 3),
  sculptedPart('30136', 'Log brick 1 x 2', 1, 2, 3, 'detail', {
    ldrawRotation: 90,
    connections: rectangularConnections(1, 2),
  }),
  sculptedPart('30137', 'Log brick 1 x 4', 1, 4, 3, 'detail', {
    ldrawRotation: 90,
    connections: rectangularConnections(1, 4),
  }),
  {
    // The stud stands on a face recessed 4 LDU above a lip, 14 LDU up: a tile on it sits on the
    // lip, half a plate proud of the wall.
    ...detailPart('4070', 'Headlight brick 1 x 1', 1, 1, 3),
    sideStuds: [{ x: 0.5, y: 1.75, z: 0.2, facing: '-z' }],
  },
  sculptedPart('2357', 'Corner brick 2 x 2', 2, 2, 3, 'detail', {
    ldrawCenter: { x: 10, z: 10 },
    connections: {
      topStuds: [
        { x: 0, z: 0 },
        { x: 1, z: 0 },
        { x: 0, z: 1 },
      ],
      bottomReceivers: [
        { x: 0, z: 0 },
        { x: 1, z: 0 },
        { x: 0, z: 1 },
      ],
    },
  }),
  sideStudPart('87087', 'Brick 1 x 1 with side stud', 1),
  sideStudPart('11211', 'Brick 1 x 2 with side studs', 2),
  sideStudPart('30414', 'Brick 1 x 4 with side studs', 4),
  sideStudPart('22885', 'Brick 1 x 2 x 1 2/3 with side studs', 2, 5),
  detailPart('2412b', 'Grille tile 1 x 2', 1, 2, 1, 'tile'),
  detailPart('3794b', 'Jumper plate 1 x 2', 1, 2, 1, 'plate', {
    topStuds: [{ x: 0, z: 0.5 }],
    bottomReceivers: rectangularConnections(1, 2).bottomReceivers,
  }),
  detailPart('87580', 'Jumper plate 2 x 2', 2, 2, 1, 'plate', {
    topStuds: [{ x: 0.5, z: 0.5 }],
    bottomReceivers: rectangularConnections(2, 2).bottomReceivers,
  }),
  detailPart('25269', 'Quarter-round corner tile 1 x 1', 1, 1, 1, 'tile'),
  detailPart('24246', 'Rounded-end tile 1 x 1', 1, 1, 1, 'tile'),
  detailPart('60581', 'Wall panel 1 x 4 x 3', 1, 4, 9),
  detailPart('59349', 'Wall panel 1 x 6 x 5', 1, 6, 15),
  detailPart('3185', 'Lattice railing 1 x 4 x 2', 1, 4, 6, 'brick', {
    topStuds: [],
    bottomReceivers: rectangularConnections(1, 4).bottomReceivers,
  }),
  detailPart('3633', 'Lattice railing 1 x 4 x 1', 1, 4, 3, 'brick', {
    topStuds: [],
    bottomReceivers: rectangularConnections(1, 4).bottomReceivers,
  }),
  detailPart('33303', 'Picket fence 1 x 4 x 2', 1, 4, 6, 'brick', {
    topStuds: [],
    bottomReceivers: rectangularConnections(1, 4).bottomReceivers,
  }),
  detailPart('30055', 'Spindled balustrade 1 x 4 x 2', 1, 4, 6, 'brick', {
    topStuds: [
      { x: 0, z: 0 },
      { x: 0, z: 3 },
    ],
    bottomReceivers: rectangularConnections(1, 4).bottomReceivers,
  }),
  roofPart('4286', 'Slope 33 3 x 1', 1, 3, 3),
  roofPart('3298', 'Slope 33 3 x 2', 2, 3, 3),
  roofPart('4161', 'Slope 33 3 x 3', 3, 3, 3),
  roofPart('3297', 'Slope 33 3 x 4', 4, 3, 3),
  roofPart('30363', 'Slope 18 4 x 2', 2, 4, 3),
  roofPart('4460b', 'Slope 75 2 x 1 x 3', 1, 2, 9),
  roofPart('3678b', 'Slope 65 2 x 2 x 2', 2, 2, 6),
  roofPart('3660a', 'Inverted slope 45 2 x 2', 2, 2, 3, true),
  roofPart('3665a', 'Inverted slope 45 2 x 1', 1, 2, 3, true),
  roofPart('3747b', 'Inverted slope 33 3 x 2', 2, 3, 3, true),
  sculptedPart('54200', 'Cheese slope 1 x 1', 1, 1, 2, 'slope', {
    ldrawBaseY: 0,
    connections: { topStuds: [], bottomReceivers: rectangularConnections(1, 1).bottomReceivers },
  }),
  sculptedPart('85984', 'Cheese slope 1 x 2', 2, 1, 2, 'slope', {
    ldrawBaseY: 0,
    connections: { topStuds: [], bottomReceivers: rectangularConnections(2, 1).bottomReceivers },
  }),
  sculptedPart('35464', 'Roof ridge slope 1 x 1 double', 1, 1, 2, 'slope', {
    ldrawBaseY: 0,
    connections: { topStuds: [], bottomReceivers: rectangularConnections(1, 1).bottomReceivers },
  }),
  sculptedPart('11477', 'Curved slope 2 x 1', 1, 2, 2, 'slope', {
    ldrawBaseY: 0,
    connections: { topStuds: [], bottomReceivers: [{ x: 0, z: 1 }] },
  }),
  sculptedPart('15068', 'Curved slope 2 x 2', 2, 2, 2, 'slope', {
    ldrawBaseY: 0,
    connections: {
      topStuds: [],
      bottomReceivers: [
        { x: 0, z: 1 },
        { x: 1, z: 1 },
      ],
    },
  }),
  sculptedPart('50950', 'Curved slope 3 x 1', 1, 3, 3, 'slope', {
    connections: {
      topStuds: [],
      bottomReceivers: [
        { x: 0, z: 1 },
        { x: 0, z: 2 },
      ],
    },
  }),
  sculptedPart('6091', 'Curved-top brick 2 x 1 x 1 1/3', 1, 2, 4, 'slope', {
    ldrawCenter: { x: 0, z: -10 },
    connections: { topStuds: [], bottomReceivers: [{ x: 0, z: 1 }] },
  }),
  {
    ...basicPart('60474', 'Round plate 4 x 4 with hole', 4, 4, 1, 'plate', 'round'),
    clearance: 'reserved',
    connections: {
      topStuds: rectangularConnections(4, 4).topStuds.filter(
        (site) => Math.hypot(site.x - 1.5, site.z - 1.5) < 2,
      ),
      bottomReceivers: rectangularConnections(4, 4).bottomReceivers.filter(
        (site) => Math.hypot(site.x - 1.5, site.z - 1.5) < 2,
      ),
    },
  },
  basicPart('4150', 'Round tile 2 x 2 with cross underside', 2, 2, 1, 'tile', 'round'),
  sculptedPart('18674', 'Round jumper plate 2 x 2', 2, 2, 1, 'detail', {
    kind: 'plate',
    connections: {
      topStuds: [{ x: 0.5, z: 0.5 }],
      bottomReceivers: rectangularConnections(2, 2).bottomReceivers,
    },
  }),
  sculptedPart('3470', 'Foliage: oval tree', 5, 5, 18, 'foliage', {
    ldrawBaseY: 8,
    connections: { topStuds: [], bottomReceivers: [{ x: 2, z: 2 }] },
  }),
  sculptedPart('3471', 'Foliage: pyramidal evergreen tree', 5, 5, 20, 'foliage', {
    ldrawBaseY: 8,
    connections: { topStuds: [], bottomReceivers: [{ x: 2, z: 2 }] },
  }),
  sculptedPart('6064', 'Foliage: bush', 4, 4, 14.5, 'foliage', {
    ldrawBaseY: 0,
    connections: { topStuds: [], bottomReceivers: [{ x: 1.5, z: 1.5 }] },
  }),
  sculptedPart('30093', 'Foliage: tall grass', 4, 1, 14, 'foliage', {
    ldrawBaseY: 8,
    connections: { topStuds: [], bottomReceivers: [{ x: 1.5, z: 0 }] },
  }),
  sculptedPart('2417', 'Foliage: large leaf canopy 6 x 5', 5, 6, 1, 'foliage', {
    kind: 'plate',
    ldrawCenter: { x: 0, z: -10 },
    connections: {
      topStuds: [
        [4, 5],
        [3, 5],
        [1, 5],
        [0, 5],
        [4, 4],
        [0, 4],
        [4, 3],
        [2, 3],
        [0, 3],
        [3, 2],
        [1, 2],
        [3, 1],
        [1, 1],
        [2, 0],
      ].map(([x, z]) => ({ x, z })),
      bottomReceivers: [
        [4, 5],
        [0, 5],
        [4, 3],
        [2, 3],
        [0, 3],
        [2, 0],
      ].map(([x, z]) => ({ x, z })),
    },
  }),
  sculptedPart('32607', 'Foliage: three-leaf sprig', 2, 2, 1, 'foliage', {
    kind: 'plate',
    ldrawCenter: { x: 10, z: -10 },
    connections: { topStuds: [{ x: 0, z: 1 }], bottomReceivers: [{ x: 0, z: 1 }] },
  }),
  sculptedPart('24866', 'Foliage: five-petal flower', 2, 2, 1, 'foliage', {
    kind: 'plate',
    connections: { topStuds: [{ x: 0.5, z: 0.5 }], bottomReceivers: [{ x: 0.5, z: 0.5 }] },
  }),
  sculptedPart('4727', 'Foliage: flower leaves 2 x 2', 2, 2, 3, 'foliage', {
    connections: { topStuds: [{ x: 0.5, z: 0.5 }], bottomReceivers: [{ x: 0.5, z: 0.5 }] },
  }),
  sculptedPart('30176', 'Foliage: bamboo leaves', 4, 4, 3, 'foliage', {
    ldrawCenter: { x: 20, z: 0 },
    connections: { topStuds: [], bottomReceivers: [{ x: 0.5, z: 1.5 }] },
  }),
  sculptedPart('6255', 'Foliage: three large leaves', 5, 5, 6, 'foliage', {
    ldrawBaseY: 16,
    ldrawCenter: { x: 0, z: 10 },
    connections: { topStuds: [], bottomReceivers: [{ x: 2, z: 1.5 }] },
  }),
  architecturalPart('3659', 'Arch 1 x 4', 1, 4, 3, 'arch'),
  architecturalPart('4490', 'Arch 1 x 3', 1, 3, 3, 'arch'),
  architecturalPart('6182', 'Arch 1 x 4 x 2', 1, 4, 6, 'arch'),
  architecturalPart('3307', 'Arch 1 x 6 x 2', 1, 6, 6, 'arch'),
  architecturalPart('3308', 'Arch 1 x 8 x 2', 1, 8, 6, 'arch'),
  architecturalPart('92950', 'Raised arch 1 x 6', 1, 6, 3, 'arch'),
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
  architecturalPart('3193a', 'Door 1 x 3 x 4, left hinge', 1.5, 3, 12, 'door', {
    ldrawRotation: 0,
    ldrawCenter: { x: 5, z: 20 },
    connections: { topStuds: [{ x: 0, z: 0 }], bottomReceivers: [{ x: 0, z: 0 }] },
  }),
  architecturalPart('3192a', 'Door 1 x 3 x 4, right hinge', 1.5, 3, 12, 'door', {
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
  // Hung on pins in the 1 x 4 x 6 frame's hinge holes, which sit 2 LDU past the end stud and
  // 5 LDU behind the frame's centre line, so the leaf stands half a stud proud of the frame.
  architecturalPart('60616a', 'Door 1 x 4 x 6, smooth', 1.5, 4, 18, 'door', {
    ldrawCenter: { x: 32, z: 0 },
    connections: { topStuds: [], bottomReceivers: [] },
  }),
  architecturalPart('60623', 'Door 1 x 4 x 6 with 4 panes', 1.5, 4, 18, 'door', {
    ldrawCenter: { x: 32, z: 0 },
    connections: { topStuds: [], bottomReceivers: [] },
  }),
  architecturalPart('60592', 'Window frame 1 x 2 x 2', 1, 2, 6, 'window'),
  // Glass shares its frame's native origin and cells; the frame's groove holds it.
  architecturalPart('60601', 'Glass for window 1 x 2 x 2', 1, 2, 6, 'window', {
    connections: { topStuds: [], bottomReceivers: [] },
  }),
  architecturalPart('60593', 'Window frame 1 x 2 x 3', 1, 2, 9, 'window'),
  architecturalPart('60602', 'Glass for window 1 x 2 x 3', 1, 2, 9, 'window', {
    connections: { topStuds: [], bottomReceivers: [] },
  }),
  architecturalPart('4035', 'Window 1 x 2 x 3', 1, 2, 9, 'window'),
  architecturalPart('60594', 'Window frame 1 x 4 x 3', 1, 4, 9, 'window', {
    connections: {
      topStuds: [
        { x: 0, z: 1 },
        { x: 0, z: 2 },
      ],
      bottomReceivers: rectangularConnections(1, 4).bottomReceivers,
    },
  }),
  // Hung on side pins in the frame's top holes, 5 LDU down and 3.5 LDU behind its origin.
  architecturalPart('86210', 'Glass for window 1 x 4 x 3, opening', 1, 4, 9, 'window', {
    ldrawCenter: { x: 0, z: -3.5 },
    ldrawBaseY: 67,
    connections: { topStuds: [], bottomReceivers: [] },
  }),
  architecturalPart('2493b', 'Window frame 1 x 4 x 5, hollow studs', 1, 4, 15, 'window'),
  architecturalPart('2494', 'Glass for window 1 x 4 x 5', 1, 4, 15, 'window', {
    connections: { topStuds: [], bottomReceivers: [] },
  }),
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

const PARTS_BY_ID = new Map(PARTS.map((part) => [part.id, part]));
const COLOR_IDS = new Set(COLORS.map((color) => color.id));
const RUNTIME_PARTS = new Map<string, Part>();
/** Counts registered parts, which can make cached validations stale. */
let partsVersion = 0;

export function registerPart(part: Part): void {
  if (PARTS_BY_ID.has(part.id)) return;
  if (
    !/^[a-z0-9_-]+$/i.test(part.id) ||
    !part.name.trim() ||
    ![part.width, part.depth, part.height].every((value) => Number.isFinite(value) && value > 0) ||
    ![0, 90, 180, 270].includes(part.ldrawRotation) ||
    !part.connections ||
    ![...part.connections.topStuds, ...part.connections.bottomReceivers].every(
      (site) =>
        Number.isFinite(site.x) &&
        Number.isFinite(site.z) &&
        site.x >= 0 &&
        site.x < part.width &&
        site.z >= 0 &&
        site.z < part.depth,
    ) ||
    (part.sideStuds !== undefined &&
      (!Array.isArray(part.sideStuds) ||
        !part.sideStuds.every(
          (stud) =>
            [stud.x, stud.y, stud.z].every(Number.isFinite) && FACINGS.includes(stud.facing),
        )))
  )
    throw new Error(`Invalid runtime part definition: ${part.id}`);
  RUNTIME_PARTS.set(part.id, part);
  partsVersion += 1;
}

export function isRuntimePart(partId: string): boolean {
  return RUNTIME_PARTS.has(partId);
}

export interface Brick {
  id: string;
  partId: string;
  color: number;
  x: number;
  y: number;
  z: number;
  rotation: Rotation;
  /**
   * Mounted on its side: the part's top points this way and its underside sits on side studs
   * pointing the same way. Rotation then spins it about that direction; at 0 its width runs
   * level and its depth stands up. x/z stay the min corner, so the coordinate along the facing
   * is in 0.1 stud (2 LDU) steps.
   */
  facing?: Facing;
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
export const MAX_BUILD_AREA = 128;
export const MAX_HEIGHT = 384;
/** Most pieces in one assembly: imports, Claude builds and model conversions. */
export const MAX_PIECES = 50000;
export const PLATE_HEIGHT = 0.4;

export function getBuildArea(assembly: Assembly): number {
  return assembly.buildArea ?? BUILD_AREA;
}

/**
 * Moves the build onto a board of another size, keeping it centred where the pieces allow.
 * Returns null when the size is out of range or the pieces don't fit on the smaller board.
 */
export function resizeBuildArea(assembly: Assembly, size: number): Assembly | null {
  if (!Number.isInteger(size) || size < BUILD_AREA || size > MAX_BUILD_AREA) return null;
  const centred = Math.floor((size - getBuildArea(assembly)) / 2);
  // Whole-stud shifts keep every piece on the same studs relative to its neighbours.
  const shift = (low: number, high: number) => {
    const min = Math.ceil(-low);
    const max = Math.floor(size - high);
    return min > max ? null : Math.min(max, Math.max(min, centred));
  };
  let [minX, maxX, minZ, maxZ] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const brick of assembly.bricks) {
    const { width, depth } = footprint(brick);
    minX = Math.min(minX, brick.x);
    maxX = Math.max(maxX, brick.x + width);
    minZ = Math.min(minZ, brick.z);
    maxZ = Math.max(maxZ, brick.z + depth);
  }
  const dx = assembly.bricks.length ? shift(minX, maxX) : 0;
  const dz = assembly.bricks.length ? shift(minZ, maxZ) : 0;
  if (dx === null || dz === null) return null;
  const { buildArea: _, ...rest } = assembly;
  return {
    ...rest,
    ...(size === BUILD_AREA ? {} : { buildArea: size }),
    bricks: assembly.bricks.map((brick) => ({ ...brick, x: brick.x + dx, z: brick.z + dz })),
  };
}

export function getPart(partId: string): Part {
  const part = PARTS_BY_ID.get(partId) ?? RUNTIME_PARTS.get(partId);
  if (!part) throw new Error(`Unknown part: ${partId}`);
  return part;
}

export function footprint(brick: Brick) {
  const part = getPart(brick.partId);
  const turned = brick.rotation === 90 || brick.rotation === 270;
  const width = turned ? part.depth : part.width;
  const depth = turned ? part.width : part.depth;
  if (!brick.facing) return { width, depth, height: part.height };
  // On its side the depth stands up (2.5 plates a stud) and the height becomes the thickness
  // out from the wall (0.4 studs a plate).
  const thickness = (part.height * 2) / 5;
  const across = brick.facing.endsWith('z');
  return {
    width: across ? width : thickness,
    depth: across ? thickness : width,
    height: depth * 2.5,
  };
}

type Matrix = readonly [number, number, number, number, number, number, number, number, number];
type Point = readonly [number, number, number];

/** LDraw's turn about the vertical, row-major, as in a type 1 line. */
function turnY(degrees: number): Matrix {
  const cosine = Math.round(Math.cos((degrees * Math.PI) / 180));
  const sine = Math.round(Math.sin((degrees * Math.PI) / 180));
  return [cosine, 0, sine, 0, 1, 0, -sine, 0, cosine];
}

/** Tips a part forward so its studs (LDraw -y) point to -z and its depth (+z) stands up. */
const TIP: Matrix = [1, 0, 0, 0, 0, -1, 0, 1, 0];

function multiply(first: Matrix, second: Matrix): Matrix {
  return Array.from({ length: 9 }, (_, index) => {
    const row = Math.floor(index / 3);
    const column = index % 3;
    return [0, 1, 2].reduce(
      (sum, step) => sum + first[row * 3 + step] * second[step * 3 + column],
      0,
    );
  }) as unknown as Matrix;
}

function apply(matrix: Matrix, [x, y, z]: Point): Point {
  return [
    matrix[0] * x + matrix[1] * y + matrix[2] * z,
    matrix[3] * x + matrix[4] * y + matrix[5] * z,
    matrix[6] * x + matrix[7] * y + matrix[8] * z,
  ];
}

/**
 * Where a mounted piece puts each point of the upright part, in LDraw units: the part's box,
 * spun by its rotation, tipped over and turned to its facing, lands centred on its footprint.
 */
function mounting(brick: Brick, part: Part) {
  const size = footprint(brick);
  const turn = multiply(
    multiply(turnY(FACINGS.indexOf(brick.facing!) * 90), TIP),
    turnY(brick.rotation),
  );
  const from: Point = [part.width * 10, -part.height * 4, part.depth * 10];
  const to: Point = [
    (brick.x + size.width / 2) * 20,
    -(brick.y + size.height / 2) * 8,
    (brick.z + size.depth / 2) * 20,
  ];
  return {
    turn,
    place: (point: Point): Point => {
      const [x, y, z] = apply(turn, [point[0] - from[0], point[1] - from[1], point[2] - from[2]]);
      return [x + to[0], y + to[1], z + to[2]];
    },
  };
}

/** A side stud's base as a key in whole LDU, from LDraw coordinates. */
const sideKey = (facing: Facing, [x, y, z]: Point) =>
  `${facing}:${Math.round(x)}:${Math.round(y)}:${Math.round(z)}`;

/** Upright part sites, studs and plates up from its min corner, in LDraw units. */
const partPoint = (x: number, y: number, z: number): Point => [x * 20, -y * 8, z * 20];

/**
 * The side studs a piece offers, keyed by facing and base position: an upright part's own side
 * studs, turned with it, or the top studs of a piece mounted on its side.
 */
export function getSideStuds(brick: Brick, part: Part = getPart(brick.partId)): string[] {
  if (brick.facing) {
    const { place } = mounting(brick, part);
    return part.connections.topStuds.map((site) =>
      sideKey(brick.facing!, place(partPoint(site.x + 0.5, part.height, site.z + 0.5))),
    );
  }
  return (part.sideStuds ?? []).map((stud) => {
    let [x, z] = [stud.x, stud.z];
    if (brick.rotation === 90) [x, z] = [stud.z, part.width - stud.x];
    else if (brick.rotation === 180) [x, z] = [part.width - stud.x, part.depth - stud.z];
    else if (brick.rotation === 270) [x, z] = [part.depth - stud.z, stud.x];
    const facing = FACINGS[(FACINGS.indexOf(stud.facing) + brick.rotation / 90) % 4];
    return sideKey(facing, partPoint(brick.x + x, brick.y + stud.y, brick.z + z));
  });
}

/** The side studs a mounted piece's underside takes, keyed like getSideStuds. */
function getSideReceivers(brick: Brick, part: Part = getPart(brick.partId)): string[] {
  if (!brick.facing) return [];
  const { place } = mounting(brick, part);
  return part.connections.bottomReceivers.map((site) =>
    sideKey(brick.facing!, place(partPoint(site.x + 0.5, 0, site.z + 0.5))),
  );
}

/** For each mounted piece, the pieces whose side studs it sits on. */
export function getSideMountHosts(bricks: readonly Brick[]): Map<string, string[]> {
  const studs = new Map<string, string[]>();
  for (const brick of bricks)
    for (const key of getSideStuds(brick)) studs.set(key, [...(studs.get(key) ?? []), brick.id]);
  const hosts = new Map<string, string[]>();
  for (const brick of bricks) {
    if (!brick.facing) continue;
    const ids = new Set(getSideReceivers(brick).flatMap((key) => studs.get(key) ?? []));
    ids.delete(brick.id);
    hosts.set(brick.id, [...ids]);
  }
  return hosts;
}

export function getConnectionSites(
  brick: Brick,
  surface: 'top' | 'bottom',
  part: Part = getPart(brick.partId),
) {
  // Mounted pieces connect through side studs only.
  if (brick.facing) return [];
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

/** Slack for mounted pieces, whose 0.4 stud thickness doesn't add up exactly in floating point. */
const EPSILON = 1e-6;
const onGrid = (value: number, step: number) =>
  Math.abs(Math.round(value / step) * step - value) < EPSILON;

function isValid(brick: Brick, buildArea: number): boolean {
  // Upright pieces sit on the half-stud grid; recessed studs and 0.4 stud plates put a mounted
  // piece's coordinate along the facing on 0.1 stud steps.
  const step = (axis: 'x' | 'z') => (brick.facing?.endsWith(axis) ? 0.1 : 0.5);
  if (
    !brick.id.trim() ||
    (!PARTS_BY_ID.has(brick.partId) && !RUNTIME_PARTS.has(brick.partId)) ||
    !COLOR_IDS.has(brick.color) ||
    ![0, 90, 180, 270].includes(brick.rotation) ||
    (brick.facing !== undefined && !FACINGS.includes(brick.facing)) ||
    ![brick.x, brick.y, brick.z].every((value) => Number.isFinite(value) && value >= 0) ||
    !onGrid(brick.x, step('x')) ||
    !onGrid(brick.y, 0.5) ||
    !onGrid(brick.z, step('z'))
  )
    return false;
  const size = footprint(brick);
  return (
    brick.x + size.width <= buildArea + EPSILON &&
    brick.z + size.depth <= buildArea + EPSILON &&
    brick.y + size.height <= MAX_HEIGHT
  );
}

export const INSERT_FRAME_PARTS: Readonly<Record<string, string>> = Object.freeze({
  '60601': '60592',
  '60602': '60593',
  '86210': '60594',
  '2494': '2493b',
  '3193a': '3579',
  '3192a': '3579',
  '60616a': '60596',
  '60623': '60596',
});

/** Doors hung on their own hinge stud, which stands at one end of the frame's opening. */
const HINGED_DOORS = new Set(['3193a', '3192a']);
/** Doors hung on the frame's hinge pins: native origin at frame-local (±32, 5), turned to match. */
const PINNED_DOORS = new Set(['60616a', '60623']);

export function isMatchingInsertFrame(insert: Brick, frame: Brick): boolean {
  const framePartId = INSERT_FRAME_PARTS[insert.partId];
  if (
    !framePartId ||
    frame.partId !== framePartId ||
    frame.y !== insert.y ||
    insert.facing ||
    frame.facing
  )
    return false;

  const frameSize = footprint(frame);
  const insertSize = footprint(insert);
  if (HINGED_DOORS.has(insert.partId)) {
    // Either end and either face: the leaf spans the opening from a hinge on its centre line.
    const [hinge] = getConnectionSites(insert, 'top');
    return frameSize.width > frameSize.depth
      ? insert.x === frame.x &&
          insertSize.width === frameSize.width &&
          hinge.z === frame.z + 0.5 &&
          (hinge.x === frame.x + 0.5 || hinge.x === frame.x + frameSize.width - 0.5)
      : insert.z === frame.z &&
          insertSize.depth === frameSize.depth &&
          hinge.x === frame.x + 0.5 &&
          (hinge.z === frame.z + 0.5 || hinge.z === frame.z + frameSize.depth - 0.5);
  }
  if (PINNED_DOORS.has(insert.partId)) {
    // Either hinge hole: the door turned like the frame, or half a turn round for the other end.
    const hingeX = { 0: -32, 180: 32 }[(insert.rotation - frame.rotation + 360) % 360];
    if (hingeX === undefined) return false;
    const door = getLDrawTransform(insert);
    const pins = getLDrawTransform(frame);
    const cosine = Math.round(Math.cos((pins.rotation * Math.PI) / 180));
    const sine = Math.round(Math.sin((pins.rotation * Math.PI) / 180));
    return (
      door.x === pins.x + cosine * hingeX + sine * 5 &&
      door.z === pins.z - sine * hingeX + cosine * 5
    );
  }
  // Glass fills its frame's own cells, turned the same way.
  return frame.rotation === insert.rotation && frame.x === insert.x && frame.z === insert.z;
}

function isSupportedInsert(brick: Brick, bricks: readonly Brick[]): boolean {
  // Only insert parts can sit in a frame, so other pieces skip the scan; that keeps validating
  // large builds linear.
  return (
    brick.partId in INSERT_FRAME_PARTS &&
    bricks.some((frame) => isMatchingInsertFrame(brick, frame))
  );
}

function hasEnvelopeContact(upper: Brick, lower: Brick): boolean {
  const upperSize = footprint(upper);
  const lowerSize = footprint(lower);
  return (
    lower.y + lowerSize.height === upper.y &&
    upper.x < lower.x + lowerSize.width &&
    lower.x < upper.x + upperSize.width &&
    upper.z < lower.z + lowerSize.depth &&
    lower.z < upper.z + upperSize.depth
  );
}

type Size = ReturnType<typeof footprint>;

/**
 * What validating a valid assembly leaves behind, so that one more piece can be checked on its
 * own: every piece is grounded or hung, so these are the studs and spaces the next one meets.
 */
interface ValidationIndex {
  bricks: readonly Brick[];
  ids: ReadonlySet<string>;
  /** Top studs of upright pieces, keyed `${y}:${x}:${z}`. */
  groundedStuds: ReadonlySet<string>;
  /** Upright pieces by the height of their top, for the envelope contacts of runtime parts. */
  groundedByTopHeight: ReadonlyMap<number, readonly Brick[]>;
  runtimeBricks: number;
  /** Side studs keyed like getSideStuds, with the pieces that offer them. */
  sideStuds: ReadonlyMap<string, readonly string[]>;
  /** The pass that hung each piece: 0 for upright pieces, 1 and up for mounted ones. */
  rounds: ReadonlyMap<string, number>;
  hosts: ReadonlyMap<string, ReadonlySet<string>>;
  /** Side studs that mounted pieces sit on. */
  mountedReceivers: ReadonlySet<string>;
  bounds: readonly Size[];
  /** Pieces by the 4 x 3 x 4 cells they reach into, as indices into `bricks`. */
  buckets: ReadonlyMap<string, readonly number[]>;
  /** Each mounted piece's hosts, down to the upright piece the chain hangs from. */
  chains: Map<string, Set<string>>;
}

interface Validation {
  buildArea: number | undefined;
  partsVersion: number;
  issues: readonly Issue[];
  /** Only for valid assemblies; built on first use for those checked one piece at a time. */
  index: ValidationIndex | (() => ValidationIndex) | null;
}

/**
 * Validations by bricks array. Assemblies are treated as immutable: an array whose pieces are
 * changed in place after validating keeps its old result.
 */
const validations = new WeakMap<readonly Brick[], Validation>();

const INVALID_MESSAGE =
  'Use a unique ID, supported part/color, quarter-turn rotation, and a half-unit grid position inside the build area.';
const UNSUPPORTED_MESSAGE = 'No stud connection to a grounded brick below this piece.';
const UNMOUNTED_MESSAGE =
  'No side stud on a grounded piece pointing the way this mounted piece faces.';

const studKey = (site: { x: number; y: number; z: number }) => `${site.y}:${site.x}:${site.z}`;

function bucketKeys(brick: Brick, size: Size): string[] {
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
      )
        keys.push(`${horizontal}:${vertical}:${depth}`);
  return keys;
}

function overlaps(brick: Brick, size: Size, other: Brick, otherSize: Size): boolean {
  return (
    brick.x < other.x + otherSize.width - EPSILON &&
    brick.x + size.width - EPSILON > other.x &&
    brick.z < other.z + otherSize.depth - EPSILON &&
    brick.z + size.depth - EPSILON > other.z &&
    brick.y < other.y + otherSize.height &&
    brick.y + size.height > other.y
  );
}

function chainOf(index: ValidationIndex, id: string): Set<string> {
  let ids = index.chains.get(id);
  if (!ids) {
    ids = new Set(index.hosts.get(id));
    for (const host of index.hosts.get(id) ?? [])
      for (const below of chainOf(index, host)) ids.add(below);
    index.chains.set(id, ids);
  }
  return ids;
}

function computeValidation(assembly: Assembly): Validation {
  const result = (issues: Issue[], index: ValidationIndex | null = null): Validation => ({
    buildArea: assembly.buildArea,
    partsVersion,
    issues,
    index,
  });
  if (
    assembly.buildArea !== undefined &&
    (!Number.isInteger(assembly.buildArea) ||
      assembly.buildArea < BUILD_AREA ||
      assembly.buildArea > MAX_BUILD_AREA)
  )
    return result([
      {
        brickId: '',
        code: 'invalid',
        message: `Build area must be a whole number from ${BUILD_AREA} to ${MAX_BUILD_AREA} studs.`,
      },
    ]);
  const buildArea = getBuildArea(assembly);
  const issues: Issue[] = [];
  const seen = new Set<string>();
  const valid: Brick[] = [];
  for (const brick of assembly.bricks) {
    if (!isValid(brick, buildArea) || seen.has(brick.id)) {
      issues.push({ brickId: brick.id, code: 'invalid', message: INVALID_MESSAGE });
    } else {
      valid.push(brick);
    }
    seen.add(brick.id);
  }
  const groundedStuds = new Set<string>();
  const runtimeBrickIds = new Set(
    valid.filter((brick) => isRuntimePart(brick.partId)).map((brick) => brick.id),
  );
  const groundedByTopHeight = new Map<number, Brick[]>();
  const sideStuds = new Map<string, string[]>();
  const rounds = new Map<string, number>();
  for (const brick of valid
    .filter((brick) => !brick.facing)
    .toSorted((first, second) => first.y - second.y)) {
    const hasStudSupport = getConnectionSites(brick, 'bottom').some((site) =>
      groundedStuds.has(studKey(site)),
    );
    const hasUnknownEnvelopeSupport =
      (runtimeBrickIds.has(brick.id) || runtimeBrickIds.size > 0) &&
      (groundedByTopHeight.get(brick.y) ?? []).some(
        (support) =>
          (runtimeBrickIds.has(brick.id) || runtimeBrickIds.has(support.id)) &&
          hasEnvelopeContact(brick, support),
      );
    if (
      brick.y === 0 ||
      isSupportedInsert(brick, valid) ||
      hasStudSupport ||
      hasUnknownEnvelopeSupport
    ) {
      for (const site of getConnectionSites(brick, 'top')) groundedStuds.add(studKey(site));
      for (const key of getSideStuds(brick))
        sideStuds.set(key, [...(sideStuds.get(key) ?? []), brick.id]);
      rounds.set(brick.id, 0);
      const topHeight = brick.y + footprint(brick).height;
      const groundedAtHeight = groundedByTopHeight.get(topHeight) ?? [];
      groundedAtHeight.push(brick);
      groundedByTopHeight.set(topHeight, groundedAtHeight);
    } else {
      issues.push({ brickId: brick.id, code: 'unsupported', message: UNSUPPORTED_MESSAGE });
    }
  }
  // Mounted pieces hang off grounded side studs, or off the faces of pieces mounted before them.
  const hosts = new Map<string, Set<string>>();
  const mountedReceivers = new Set<string>();
  let pending = valid.filter((brick) => brick.facing);
  for (let progress = true, round = 1; progress && pending.length; round += 1) {
    progress = false;
    pending = pending.filter((brick) => {
      const receivers = getSideReceivers(brick);
      const ids = receivers.flatMap((key) => sideStuds.get(key) ?? []);
      if (!ids.length) return true;
      hosts.set(brick.id, new Set(ids));
      rounds.set(brick.id, round);
      for (const key of receivers) mountedReceivers.add(key);
      for (const key of getSideStuds(brick))
        sideStuds.set(key, [...(sideStuds.get(key) ?? []), brick.id]);
      progress = true;
      return false;
    });
  }
  for (const brick of pending)
    issues.push({ brickId: brick.id, code: 'unsupported', message: UNMOUNTED_MESSAGE });
  // A mounted piece reaches into the recess or stud space of the pieces that hold it, down to
  // the upright brick the whole chain hangs from.
  const bounds = valid.map((brick) => footprint(brick));
  const buckets = new Map<string, number[]>();
  const cells = valid.map((brick, index) => {
    const keys = bucketKeys(brick, bounds[index]);
    for (const key of keys) {
      const occupants = buckets.get(key);
      if (occupants) occupants.push(index);
      else buckets.set(key, [index]);
    }
    return keys;
  });
  const index: ValidationIndex = {
    bricks: valid,
    ids: seen,
    groundedStuds,
    groundedByTopHeight,
    runtimeBricks: runtimeBrickIds.size,
    sideStuds,
    rounds,
    hosts,
    mountedReceivers,
    bounds,
    buckets,
    chains: new Map(),
  };
  const holds = (piece: Brick, host: Brick) =>
    !!piece.facing && chainOf(index, piece.id).has(host.id);
  for (let brickIndex = 0; brickIndex < valid.length; brickIndex += 1) {
    const brick = valid[brickIndex];
    const size = bounds[brickIndex];
    const candidates = new Set<number>();
    for (const key of cells[brickIndex])
      for (const otherIndex of buckets.get(key)!)
        if (otherIndex > brickIndex) candidates.add(otherIndex);
    for (const otherIndex of [...candidates].sort((first, second) => first - second)) {
      const other = valid[otherIndex];
      if (
        overlaps(brick, size, other, bounds[otherIndex]) &&
        !isMatchingInsertFrame(brick, other) &&
        !isMatchingInsertFrame(other, brick) &&
        !holds(brick, other) &&
        !holds(other, brick)
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
  return result(issues, issues.length ? null : index);
}

function getValidation(assembly: Assembly): Validation {
  const cached = validations.get(assembly.bricks);
  if (
    cached &&
    cached.buildArea === assembly.buildArea &&
    // Registering a part can make pieces that use it valid.
    cached.partsVersion === partsVersion
  )
    return cached;
  const validation = computeValidation(assembly);
  validations.set(assembly.bricks, validation);
  return validation;
}

function resolveIndex(validation: Validation): ValidationIndex | null {
  if (typeof validation.index === 'function') validation.index = validation.index();
  return validation.index;
}

export function validateAssembly(assembly: Assembly): Issue[] {
  return getValidation(assembly).issues.map((issue) => ({ ...issue }));
}

/**
 * Validates the assembly with one more piece, which gives the same issues as validating it in
 * full. A new piece can't unground others, so only it is checked: its own fields, its support
 * and what it overlaps. The result is remembered for the new assembly, and the index for the
 * next addition is built from this one when it is first needed.
 *
 * Returns null when the assembly itself is invalid, or when the piece offers side studs that a
 * mounted piece already sits on, which can change how others hang: validate in full then.
 */
export function validateAddition(
  assembly: Assembly,
  brick: Brick,
): { assembly: Assembly; issues: Issue[] } | null {
  const base = getValidation(assembly);
  const index = base.issues.length ? null : resolveIndex(base);
  if (!index) return null;
  const bricks = [...assembly.bricks, brick];
  const next: Assembly = { ...assembly, bricks };
  const issues: Issue[] = [];
  let derive: (() => ValidationIndex) | null = null;
  if (!isValid(brick, getBuildArea(assembly)) || index.ids.has(brick.id)) {
    issues.push({ brickId: brick.id, code: 'invalid', message: INVALID_MESSAGE });
  } else {
    const offered = getSideStuds(brick);
    if (offered.some((key) => index.mountedReceivers.has(key))) return null;
    let round = 0;
    let hosts: Set<string> | null = null;
    let receivers: string[] = [];
    if (!brick.facing) {
      const runtime = isRuntimePart(brick.partId);
      const supported =
        brick.y === 0 ||
        isSupportedInsert(brick, bricks) ||
        getConnectionSites(brick, 'bottom').some((site) =>
          index.groundedStuds.has(studKey(site)),
        ) ||
        ((runtime || index.runtimeBricks > 0) &&
          (index.groundedByTopHeight.get(brick.y) ?? []).some(
            (support) =>
              (runtime || isRuntimePart(support.partId)) && hasEnvelopeContact(brick, support),
          ));
      if (!supported)
        issues.push({ brickId: brick.id, code: 'unsupported', message: UNSUPPORTED_MESSAGE });
    } else {
      receivers = getSideReceivers(brick);
      const providers = receivers.flatMap((key) => index.sideStuds.get(key) ?? []);
      if (providers.length) {
        // The full pass hangs it in the first round that offers one of its studs, after the
        // pieces already hung that round: it comes last.
        round = Math.max(1, Math.min(...providers.map((id) => index.rounds.get(id)!)));
        hosts = new Set(providers.filter((id) => index.rounds.get(id)! <= round));
      } else issues.push({ brickId: brick.id, code: 'unsupported', message: UNMOUNTED_MESSAGE });
    }
    let chain: Set<string> | null = null;
    if (hosts) {
      chain = new Set(hosts);
      for (const host of hosts) for (const below of chainOf(index, host)) chain.add(below);
    }
    const size = footprint(brick);
    const cells = bucketKeys(brick, size);
    const candidates = new Set<number>();
    for (const key of cells)
      for (const otherIndex of index.buckets.get(key) ?? []) candidates.add(otherIndex);
    for (const otherIndex of [...candidates].sort((first, second) => first - second)) {
      const other = index.bricks[otherIndex];
      if (
        overlaps(other, index.bounds[otherIndex], brick, size) &&
        !isMatchingInsertFrame(other, brick) &&
        !isMatchingInsertFrame(brick, other) &&
        !chain?.has(other.id)
      ) {
        issues.push({
          brickId: other.id,
          code: 'collision',
          message: `Overlaps piece ${brick.id}.`,
        });
        issues.push({
          brickId: brick.id,
          code: 'collision',
          message: `Overlaps piece ${other.id}.`,
        });
      }
    }
    if (!issues.length)
      derive = () => {
        const groundedStuds = new Set(index.groundedStuds);
        const groundedByTopHeight = new Map(index.groundedByTopHeight);
        if (!brick.facing) {
          for (const site of getConnectionSites(brick, 'top')) groundedStuds.add(studKey(site));
          const topHeight = brick.y + size.height;
          groundedByTopHeight.set(topHeight, [
            ...(groundedByTopHeight.get(topHeight) ?? []),
            brick,
          ]);
        }
        const sideStuds = new Map(index.sideStuds);
        for (const key of offered) sideStuds.set(key, [...(sideStuds.get(key) ?? []), brick.id]);
        const buckets = new Map(index.buckets);
        for (const key of cells)
          buckets.set(key, [...(buckets.get(key) ?? []), index.bricks.length]);
        return {
          bricks,
          ids: new Set(index.ids).add(brick.id),
          groundedStuds,
          groundedByTopHeight,
          runtimeBricks: index.runtimeBricks + (isRuntimePart(brick.partId) ? 1 : 0),
          sideStuds,
          rounds: new Map(index.rounds).set(brick.id, round),
          hosts: hosts ? new Map(index.hosts).set(brick.id, hosts) : index.hosts,
          mountedReceivers: receivers.length
            ? new Set([...index.mountedReceivers, ...receivers])
            : index.mountedReceivers,
          bounds: [...index.bounds, size],
          buckets,
          chains: new Map(),
        };
      };
  }
  validations.set(bricks, {
    buildArea: assembly.buildArea,
    partsVersion,
    issues,
    index: derive,
  });
  return { assembly: next, issues: issues.map((issue) => ({ ...issue })) };
}

export function placeBrick(assembly: Assembly, brick: Brick): PlacementResult {
  const added = validateAddition(assembly, brick);
  const next = added?.assembly ?? { ...assembly, bricks: [...assembly.bricks, brick] };
  const issues = added?.issues ?? validateAssembly(next);
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

/**
 * Where a part's LDraw origin goes and how it is turned. `rotation` is the turn about the
 * vertical for upright pieces; `matrix` is the full row-major turn, which mounted pieces need.
 */
export function getLDrawTransform(brick: Brick): {
  x: number;
  y: number;
  z: number;
  rotation: Rotation;
  matrix: Matrix;
} {
  const part = getPart(brick.partId);
  if (brick.facing) {
    const upright = getLDrawTransform({
      ...brick,
      x: 0,
      y: 0,
      z: 0,
      rotation: 0,
      facing: undefined,
    });
    const { turn, place } = mounting(brick, part);
    const round = (value: number) => Math.round(value * 1000) / 1000 + 0;
    const [x, y, z] = place([upright.x, upright.y, upright.z]).map(round);
    return {
      x,
      y,
      z,
      rotation: upright.rotation,
      matrix: multiply(turn, upright.matrix).map(round) as unknown as Matrix,
    };
  }
  const size = footprint(brick);
  const rotation = ((brick.rotation + part.ldrawRotation) % 360) as Rotation;
  const cosine = Math.round(Math.cos((rotation * Math.PI) / 180));
  const sine = Math.round(Math.sin((rotation * Math.PI) / 180));
  const center = part.ldrawCenter ?? { x: 0, z: 0 };
  return {
    x: (brick.x + size.width / 2) * 20 - cosine * center.x - sine * center.z,
    y: -brick.y * 8 - (part.ldrawBaseY ?? size.height * 8),
    z: (brick.z + size.depth / 2) * 20 + sine * center.x - cosine * center.z,
    rotation,
    matrix: turnY(rotation),
  };
}

export function exportLDraw(assembly: Assembly): string {
  const issues = validateAssembly(assembly);
  if (issues.length) throw new Error('Cannot export an invalid assembly.');
  const lines = [
    `0 ${assembly.name.replace(/[\r\n]/g, ' ')}`,
    '0 Generated by Brick Workshop',
    '0 UNVERIFIED DRAFT: physical buildability is not certified; not approved for construction.',
    '0 Upright bricks and plates, and pieces mounted on side studs; layers are 8 LDU.',
  ];
  let previousLayer = -1;
  for (const brick of assembly.bricks.toSorted((first, second) => first.y - second.y)) {
    if (previousLayer !== -1 && brick.y !== previousLayer) lines.push('0 STEP');
    previousLayer = brick.y;
    const transform = getLDrawTransform(brick);
    lines.push(
      `1 ${brick.color} ${transform.x} ${transform.y} ${transform.z} ${transform.matrix.join(' ')} ${brick.partId}.dat`,
    );
  }
  return `${lines.join('\n')}\n`;
}
