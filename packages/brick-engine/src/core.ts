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

/** A point in an upright part: studs from its min corner across, plates up from its bottom. */
export type PartPoint = readonly [x: number, y: number, z: number];

/** A 3.2 mm bar a clip can grip anywhere along: the centre line from one end to the other. */
export interface Bar {
  from: PartPoint;
  to: PartPoint;
}

/** A clip: the middle of its grip and the axis of the bar it holds, before the part turns. */
export interface Clip {
  at: PartPoint;
  axis: 'x' | 'y' | 'z';
}

/**
 * One half of a hinge: the base stands on studs, and the top that turns on it pivots about a
 * level axis through `pivot`. A top fitted on a base shares its pivot and can tilt (`Brick.tilt`)
 * about that axis, taking the pieces stacked on it along.
 */
export interface Hinge {
  role: 'base' | 'top';
  pivot: PartPoint;
  axis: 'x' | 'z';
}

/** Angles a tilted piece can take, in degrees from upright: the hinges' click positions. */
export const TILT_ANGLES: readonly number[] = Object.freeze([22.5, 45, 67.5, 90]);

/**
 * Tipped about a level hinge line, so the piece's top leans toward one side, as a roof panel
 * does. The piece is placed upright as usual (x, y, z and rotation), then the whole of it turns
 * about the line by `angle` degrees, its top going `toward` that side. Pieces with the same tilt
 * share one tilted frame: they stack on each other's studs exactly as they would upright.
 */
export interface Tilt {
  /** The side the top leans to: the tilted plane's low side faces this way. */
  toward: Facing;
  /** Degrees from upright, one of TILT_ANGLES. */
  angle: number;
  /** The hinge line's height, in plates (on 0.25 steps). */
  y: number;
  /** Where the hinge line crosses the axis `toward` runs along, in studs (on 0.5 steps). */
  at: number;
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
  /**
   * Can be fitted upside down (`Brick.upsideDown`): one moulding then serves as both
   * mirror-image halves, like the casement panes hung at either end of a window frame.
   */
  flippable?: true;
  clearance?: 'reserved';
  ldrawRotation: Rotation;
  connections: {
    topStuds: readonly ConnectionSite[];
    bottomReceivers: readonly ConnectionSite[];
  };
  /** Studs on the sides, which hold pieces mounted on their side (SNOT). */
  sideStuds?: readonly SideStud[];
  /** Bars clips can grip, such as an antenna's shaft or a handle. */
  bars?: readonly Bar[];
  /** Clips that grip bars. */
  clips?: readonly Clip[];
  /** Half of a hinge, which lets the pieces on its top tilt. */
  hinge?: Hinge;
  /**
   * Stands on whatever its base touches, without studs, the way a wheel stands on the road: a
   * piece resting on a held piece's top is held itself, and can hold what clips onto it.
   */
  rests?: true;
  /**
   * Bends like a braided string: besides lying straight, it can be strung (`Brick.strung`) from
   * its first end stud to its last anywhere within its length, the cord running straight between.
   */
  flexible?: true;
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
  options: Partial<
    Pick<Part, 'connections' | 'ldrawRotation' | 'ldrawCenter' | 'ldrawBaseY' | 'flippable'>
  > = {},
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
  family: 'detail' | 'foliage' | 'slope' | 'round' | 'arch',
  options: Partial<
    Pick<
      Part,
      | 'connections'
      | 'ldrawRotation'
      | 'ldrawCenter'
      | 'ldrawBaseY'
      | 'kind'
      | 'shape'
      | 'bars'
      | 'clips'
      | 'sideStuds'
      | 'hinge'
      | 'rests'
      | 'flexible'
    >
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

/** Cells row by row from the front: each row is an inclusive [from, to] run of x, or null. */
function spans(...rows: readonly (readonly [number, number] | null)[]): ConnectionSite[] {
  return rows.flatMap((row, z) =>
    row
      ? Array.from({ length: row[1] - row[0] + 1 }, (_, index) => ({
          x: row[0] + index,
          z,
        }))
      : [],
  );
}

/**
 * A piece whose outline is not a full rectangle: corner, wedge, rounded and macaroni tiles,
 * plates and bricks. It reserves its whole envelope, and connects only on the cells its LDraw
 * mesh covers, measured from the mesh rather than inferred from the grid. Full circles keep the
 * round shape; the rest bear load only at their studs and receivers.
 */
function contouredPart(
  id: string,
  name: string,
  width: number,
  depth: number,
  height: number,
  kind: Part['kind'],
  family: 'detail' | 'round' | 'arch' | 'slope',
  connections: { top?: ConnectionSite[]; bottom: ConnectionSite[] },
  options: Partial<Pick<Part, 'ldrawCenter' | 'ldrawBaseY' | 'shape' | 'bars' | 'clips'>> = {},
): Part {
  return sculptedPart(id, name, width, depth, height, family, {
    kind,
    shape: 'detail',
    connections: {
      topStuds: connections.top ?? [],
      bottomReceivers: connections.bottom,
    },
    ...options,
  });
}

/** A curved slope: smooth but for any studs on its high rear end, held off its thin front lip. */
function curvedSlopePart(
  id: string,
  name: string,
  width: number,
  depth: number,
  studRows = 0,
  ldrawCenter?: Part['ldrawCenter'],
): Part {
  const row = [0, width - 1] as const;
  return sculptedPart(id, name, width, depth, 3, 'slope', {
    ...(ldrawCenter ? { ldrawCenter } : {}),
    connections: {
      topStuds: spans(
        ...Array.from({ length: depth }, (_, z) => (z >= depth - studRows ? row : null)),
      ),
      bottomReceivers: spans(null, ...Array.from({ length: depth - 1 }, () => row)),
    },
  });
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
  const sites = rectangularConnections(1, depth).topStuds.map(({ z }) => ({
    x: 0.5,
    z,
  }));
  return {
    ...sculptedPart(id, name, 1.5, depth, height, 'detail', {
      ldrawRotation: 90,
      ldrawCenter: { x: 0, z: -5 },
      connections: { topStuds: sites, bottomReceivers: sites },
    }),
    ...(height === 3
      ? {
          sideStuds: sites.map(({ z }) => ({
            x: 0.5,
            y: 1.75,
            z: z + 0.5,
            facing: '-x' as const,
          })),
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
    connections: {
      topStuds: [],
      bottomReceivers: rectangularConnections(1, 1).bottomReceivers,
    },
  },
  {
    id: '3069b',
    name: 'Tile 1 x 2',
    width: 1,
    depth: 2,
    height: 1,
    kind: 'tile',
    ldrawRotation: 90,
    connections: {
      topStuds: [],
      bottomReceivers: rectangularConnections(1, 2).bottomReceivers,
    },
  },
  {
    id: '63864',
    name: 'Tile 1 x 3',
    width: 1,
    depth: 3,
    height: 1,
    kind: 'tile',
    ldrawRotation: 90,
    connections: {
      topStuds: [],
      bottomReceivers: rectangularConnections(1, 3).bottomReceivers,
    },
  },
  {
    id: '2431',
    name: 'Tile 1 x 4',
    width: 1,
    depth: 4,
    height: 1,
    kind: 'tile',
    ldrawRotation: 90,
    connections: {
      topStuds: [],
      bottomReceivers: rectangularConnections(1, 4).bottomReceivers,
    },
  },
  {
    id: '3068b',
    name: 'Tile 2 x 2',
    width: 2,
    depth: 2,
    height: 1,
    kind: 'tile',
    ldrawRotation: 0,
    connections: {
      topStuds: [],
      bottomReceivers: rectangularConnections(2, 2).bottomReceivers,
    },
  },
  {
    id: '87079',
    name: 'Tile 2 x 4',
    width: 2,
    depth: 4,
    height: 1,
    kind: 'tile',
    ldrawRotation: 90,
    connections: {
      topStuds: [],
      bottomReceivers: rectangularConnections(2, 4).bottomReceivers,
    },
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
    connections: {
      topStuds: [],
      bottomReceivers: rectangularConnections(1, 1).bottomReceivers,
    },
  }),
  sculptedPart('85984', 'Cheese slope 1 x 2', 2, 1, 2, 'slope', {
    ldrawBaseY: 0,
    connections: {
      topStuds: [],
      bottomReceivers: rectangularConnections(2, 1).bottomReceivers,
    },
  }),
  sculptedPart('35464', 'Roof ridge slope 1 x 1 double', 1, 1, 2, 'slope', {
    ldrawBaseY: 0,
    connections: {
      topStuds: [],
      bottomReceivers: rectangularConnections(1, 1).bottomReceivers,
    },
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
    connections: {
      topStuds: [{ x: 0, z: 1 }],
      bottomReceivers: [{ x: 0, z: 1 }],
    },
  }),
  sculptedPart('24866', 'Foliage: five-petal flower', 2, 2, 1, 'foliage', {
    kind: 'plate',
    connections: {
      topStuds: [{ x: 0.5, z: 0.5 }],
      bottomReceivers: [{ x: 0.5, z: 0.5 }],
    },
  }),
  sculptedPart('4727', 'Foliage: flower leaves 2 x 2', 2, 2, 3, 'foliage', {
    connections: {
      topStuds: [{ x: 0.5, z: 0.5 }],
      bottomReceivers: [{ x: 0.5, z: 0.5 }],
    },
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
  // Its opening is a half circle two studs round from the base, which a half-round window fills.
  architecturalPart('15254', 'Arch 1 x 6 x 2, thin top', 1, 6, 6, 'arch'),
  architecturalPart('3865', 'Baseplate 8 x 16', 8, 16, 0.5, 'baseplate'),
  architecturalPart('3867', 'Baseplate 16 x 16', 16, 16, 0.5, 'baseplate'),
  architecturalPart('4589', 'Cone 1 x 1', 1, 1, 3, 'cone', {
    connections: coneConnections(1, 1),
  }),
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
    connections: {
      topStuds: [{ x: 0, z: 0 }],
      bottomReceivers: [{ x: 0, z: 0 }],
    },
  }),
  architecturalPart('3192a', 'Door 1 x 3 x 4, right hinge', 1.5, 3, 12, 'door', {
    ldrawRotation: 0,
    ldrawCenter: { x: -5, z: 20 },
    connections: {
      topStuds: [{ x: 0.5, z: 0 }],
      bottomReceivers: [{ x: 0.5, z: 0 }],
    },
  }),
  architecturalPart('3861c', 'Door 1 x 4 x 5, reinforced hinge', 1.5, 4, 15, 'door', {
    ldrawRotation: 0,
    ldrawCenter: { x: -5, z: 30 },
    connections: {
      topStuds: [{ x: 0.5, z: 0 }],
      bottomReceivers: [{ x: 0.5, z: 0 }],
    },
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
  // Hung by its corner pins in the pockets at either end of the 1 x 4 x 3 frame, in place of
  // its glass: native pin at frame-local (-33, 4, 3.5), the pane reaching 31.5 LDU along -z.
  // The pane for the other end is the same one upside down.
  architecturalPart('60607', 'Window pane 1 x 2 x 3, latticed', 1, 2, 9, 'window', {
    ldrawRotation: 0,
    ldrawCenter: { x: -3.5, z: -13 },
    ldrawBaseY: 68,
    flippable: true,
    connections: { topStuds: [], bottomReceivers: [] },
  }),
  // The same hanging, with two glazing bars across instead of a lattice: a pair makes a grid.
  architecturalPart('60608', 'Window pane 1 x 2 x 3, two bars', 1, 2, 9, 'window', {
    ldrawRotation: 0,
    ldrawCenter: { x: -3.5, z: -13 },
    ldrawBaseY: 68,
    flippable: true,
    connections: { topStuds: [], bottomReceivers: [] },
  }),
  architecturalPart('57894', 'Window frame 1 x 4 x 6, three lights', 1, 4, 18, 'window', {
    connections: {
      topStuds: [
        { x: 0, z: 1 },
        { x: 0, z: 2 },
      ],
      bottomReceivers: rectangularConnections(1, 4).bottomReceivers,
    },
  }),
  // Pinned into the frame's top holes, 4.5 LDU down and 3 LDU in front of its origin.
  architecturalPart('57895', 'Glass for window 1 x 4 x 6', 1, 4, 18, 'window', {
    ldrawCenter: { x: 0, z: 3 },
    ldrawBaseY: 139.5,
    connections: { topStuds: [], bottomReceivers: [] },
  }),
  // A half-round fanlight with three radial bars: its native base is 8 LDU below the origin and
  // its curve, two studs round about the middle of the base, fills a 1 x 6 x 2 arch's opening.
  architecturalPart('20309', 'Window 1 x 4 x 1 2/3, half round', 1, 4, 5, 'window', {
    ldrawBaseY: 8,
    connections: {
      topStuds: [],
      bottomReceivers: rectangularConnections(1, 4).bottomReceivers,
    },
  }),
  architecturalPart('30044', 'Window 1 x 2 x 2 2/3, rounded top', 1, 2, 8, 'window'),
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
  // Finishing tiles. Connection cells are those whose stud the mesh fully covers.
  basicPart('10202', 'Tile 6 x 6', 6, 6, 1, 'tile'),
  contouredPart(
    '14719',
    'Corner tile 2 x 2',
    2,
    2,
    1,
    'tile',
    'detail',
    {
      bottom: spans([0, 1], [0, 0]),
    },
    { ldrawCenter: { x: 10, z: 10 } },
  ),
  contouredPart('5091', 'Wedge tile 1 x 2, cut left', 2, 1, 1, 'tile', 'detail', {
    bottom: spans([0, 0]),
  }),
  contouredPart('5092', 'Wedge tile 1 x 2, cut right', 2, 1, 1, 'tile', 'detail', {
    bottom: spans([0, 0]),
  }),
  contouredPart('35787', 'Triangular tile 2 x 2', 2, 2, 1, 'tile', 'detail', {
    bottom: spans([0, 0]),
  }),
  contouredPart('22385', 'Tile 2 x 3 with angled end', 2, 3, 1, 'tile', 'detail', {
    bottom: spans(null, [0, 1], [0, 1]),
  }),
  contouredPart('1126', 'Tile 1 x 2 with rounded ends', 2, 1, 1, 'tile', 'round', {
    bottom: spans([0, 1]),
  }),
  contouredPart('5520', 'Tile 2 x 2 with rounded end', 2, 2, 1, 'tile', 'round', {
    bottom: spans(null, [0, 1]),
  }),
  contouredPart('66857', 'Tile 2 x 4 with rounded ends', 2, 4, 1, 'tile', 'round', {
    bottom: spans(null, [0, 1], [0, 1], null),
  }),
  // Macaroni tiles are a quarter ring one stud wide, held only at their two ends (and the
  // middle of the 4 x 4), with the inside corner left open.
  contouredPart(
    '27925',
    'Macaroni tile 2 x 2',
    2,
    2,
    1,
    'tile',
    'round',
    {
      bottom: spans([0, 0], [1, 1]),
    },
    { ldrawCenter: { x: 10, z: -10 } },
  ),
  contouredPart(
    '79393',
    'Macaroni tile 3 x 3',
    3,
    3,
    1,
    'tile',
    'round',
    {
      bottom: spans([0, 0], null, [2, 2]),
    },
    { ldrawCenter: { x: 30, z: -30 } },
  ),
  contouredPart(
    '27507',
    'Macaroni tile 4 x 4',
    4,
    4,
    1,
    'tile',
    'round',
    {
      bottom: spans([0, 0], [2, 2], null, [3, 3]),
    },
    { ldrawCenter: { x: 40, z: -40 } },
  ),
  contouredPart(
    '67095',
    'Round tile 3 x 3',
    3,
    3,
    1,
    'tile',
    'round',
    {
      bottom: spans([1, 1], [0, 2], [1, 1]),
    },
    { shape: 'round' },
  ),
  contouredPart(
    '7212',
    'Round tile 6 x 6',
    6,
    6,
    1,
    'tile',
    'round',
    {
      bottom: spans([2, 3], [1, 4], [0, 5], [0, 5], [1, 4], [2, 3]),
    },
    { shape: 'round' },
  ),
  // Rounded plates and bricks: circles, half circles, quarter circles and macaroni corners.
  contouredPart('35480', 'Plate 1 x 2 with rounded ends', 2, 1, 1, 'plate', 'round', {
    top: spans([0, 1]),
    bottom: spans([0, 1]),
  }),
  contouredPart('77845', 'Plate 1 x 4 with rounded ends', 4, 1, 1, 'plate', 'round', {
    top: spans([0, 3]),
    bottom: spans([0, 3]),
  }),
  contouredPart('18980', 'Plate 2 x 6 with rounded corners', 6, 2, 1, 'plate', 'round', {
    top: spans([1, 4], [0, 5]),
    bottom: spans([1, 4], [0, 5]),
  }),
  contouredPart('7904', 'Quarter-circle plate 2 x 2', 2, 2, 1, 'plate', 'round', {
    top: spans([0, 0], [0, 1]),
    bottom: spans([0, 0], [0, 1]),
  }),
  contouredPart(
    '30357',
    'Round corner plate 3 x 3',
    3,
    3,
    1,
    'plate',
    'round',
    {
      top: spans([0, 2], [0, 2], [0, 1]),
      bottom: spans([0, 2], [0, 2], [0, 1]),
    },
    { ldrawCenter: { x: 20, z: 20 } },
  ),
  contouredPart('30565', 'Round corner plate 4 x 4', 4, 4, 1, 'plate', 'round', {
    top: spans([0, 0], [0, 2], [0, 2], [0, 3]),
    bottom: spans([0, 1], [0, 2], [0, 3], [0, 3]),
  }),
  contouredPart('6003', 'Round corner plate 6 x 6', 6, 6, 1, 'plate', 'round', {
    top: spans([0, 2], [0, 4], [0, 4], [0, 5], [0, 5], [0, 5]),
    bottom: spans([0, 3], [0, 4], [0, 5], [0, 5], [0, 5], [0, 5]),
  }),
  contouredPart('22888', 'Half-circle plate 4 x 8', 8, 4, 1, 'plate', 'round', {
    top: spans([3, 4], [1, 6], [1, 6], [0, 7]),
    bottom: spans([2, 5], [1, 6], [0, 7], [0, 7]),
  }),
  contouredPart(
    '11213',
    'Round plate 6 x 6',
    6,
    6,
    1,
    'plate',
    'round',
    {
      top: spans([2, 3], [1, 4], [0, 5], [0, 5], [1, 4], [2, 3]),
      bottom: spans([2, 3], [1, 4], [0, 5], [0, 5], [1, 4], [2, 3]),
    },
    { shape: 'round' },
  ),
  contouredPart(
    '74611',
    'Round plate 8 x 8',
    8,
    8,
    1,
    'plate',
    'round',
    {
      top: spans([3, 4], [1, 6], [1, 6], [0, 7], [0, 7], [1, 6], [1, 6], [3, 4]),
      bottom: spans([2, 5], [1, 6], [0, 7], [0, 7], [0, 7], [0, 7], [1, 6], [2, 5]),
    },
    { shape: 'round' },
  ),
  contouredPart(
    '85080',
    'Macaroni brick 2 x 2',
    2,
    2,
    3,
    'brick',
    'round',
    {
      top: spans([0, 0], [1, 1]),
      bottom: spans([0, 0], [1, 1]),
    },
    { ldrawCenter: { x: 10, z: -10 } },
  ),
  contouredPart(
    '48092',
    'Macaroni brick 4 x 4',
    4,
    4,
    3,
    'brick',
    'round',
    {
      top: spans([0, 0], [2, 2], null, [3, 3]),
      bottom: spans([0, 0], [2, 2], null, [3, 3]),
    },
    { ldrawCenter: { x: 40, z: -40 } },
  ),
  contouredPart(
    '2577',
    'Round corner brick 4 x 4',
    4,
    4,
    3,
    'brick',
    'round',
    {
      top: spans([0, 0], [0, 2], [0, 2], [0, 3]),
      bottom: spans([0, 1], [0, 2], [0, 3], [0, 3]),
    },
    { ldrawCenter: { x: 40, z: -40 } },
  ),
  contouredPart(
    '47974',
    'Half-circle brick 4 x 8',
    8,
    4,
    3,
    'brick',
    'round',
    {
      top: spans([3, 4], [1, 6], [1, 6], [0, 7]),
      bottom: spans([2, 5], [1, 6], [0, 7], [0, 7]),
    },
    { ldrawCenter: { x: 0, z: -40 } },
  ),
  contouredPart(
    '87081',
    'Round brick 4 x 4',
    4,
    4,
    3,
    'brick',
    'round',
    {
      top: spans([1, 2], [0, 3], [0, 3], [1, 2]),
      bottom: spans([1, 2], [0, 3], [0, 3], [1, 2]),
    },
    { shape: 'round' },
  ),
  contouredPart('37352', 'Curved-top brick 1 x 2', 2, 1, 3, 'brick', 'round', {
    bottom: spans([0, 1]),
  }),
  contouredPart('6191', 'Curved-top brick 1 x 4 x 1 1/3', 4, 1, 4, 'brick', 'round', {
    bottom: spans([0, 3]),
  }),
  curvedSlopePart('24309', 'Curved slope 3 x 2', 2, 3),
  curvedSlopePart('61678', 'Curved slope 4 x 1', 1, 4),
  curvedSlopePart('93606', 'Curved slope 4 x 2', 2, 4),
  curvedSlopePart('42022', 'Curved slope 6 x 1', 1, 6, 2, { x: 0, z: -40 }),
  curvedSlopePart('44126', 'Curved slope 6 x 2', 2, 6, 2, { x: 0, z: -40 }),
  // Hipped roofs and towers: corner slopes, caps and steep spire roofs. Corner pieces have their
  // native origin at the stud of the corner they turn round.
  contouredPart(
    '3045',
    'Slope 45 2 x 2 outside corner',
    2,
    2,
    3,
    'brick',
    'slope',
    {
      top: spans(null, [0, 0]),
      bottom: spans([0, 1], [0, 1]),
    },
    { shape: 'slope', ldrawCenter: { x: 10, z: -10 } },
  ),
  contouredPart(
    '3046',
    'Slope 45 2 x 2 inside corner',
    2,
    2,
    3,
    'brick',
    'slope',
    {
      top: spans([0, 0], [0, 1]),
      bottom: spans([0, 1], [0, 1]),
    },
    { shape: 'slope', ldrawCenter: { x: 10, z: -10 } },
  ),
  contouredPart(
    '3043',
    'Slope 45 2 x 2 double ridge',
    2,
    2,
    3,
    'brick',
    'slope',
    {
      bottom: spans([0, 1], [0, 1]),
    },
    { shape: 'slope' },
  ),
  contouredPart(
    '3048b',
    'Slope 45 1 x 2 triple ridge end',
    2,
    1,
    3,
    'brick',
    'slope',
    {
      bottom: spans([0, 1]),
    },
    { shape: 'slope' },
  ),
  contouredPart(
    '3675',
    'Slope 33 3 x 3 outside corner',
    3,
    3,
    3,
    'brick',
    'slope',
    {
      top: spans(null, null, [0, 0]),
      bottom: spans([0, 2], [0, 2], [0, 2]),
    },
    { shape: 'slope', ldrawCenter: { x: 20, z: -20 } },
  ),
  contouredPart(
    '99301',
    'Slope 33 3 x 3 inside corner',
    3,
    3,
    3,
    'brick',
    'slope',
    {
      top: spans([0, 0], [0, 0], [0, 2]),
      bottom: spans([0, 2], [0, 2], [0, 2]),
    },
    { shape: 'slope', ldrawCenter: { x: 20, z: -20 } },
  ),
  // An inverted corner stands on the single cell under its corner stud.
  contouredPart(
    '3676',
    'Inverted slope 45 2 x 2 outside corner',
    2,
    2,
    3,
    'brick',
    'slope',
    {
      top: spans([0, 1], [0, 1]),
      bottom: spans(null, [0, 0]),
    },
    { shape: 'inverted-slope', ldrawCenter: { x: 10, z: -10 } },
  ),
  contouredPart(
    '3685',
    'Slope 75 2 x 2 x 3 outside corner',
    2,
    2,
    9,
    'brick',
    'slope',
    {
      top: spans(null, [0, 0]),
      bottom: spans([0, 1], [0, 1]),
    },
    { shape: 'slope', ldrawCenter: { x: 10, z: -10 } },
  ),
  contouredPart(
    '3688',
    'Slope 75 2 x 2 x 2 pyramid',
    2,
    2,
    6,
    'brick',
    'slope',
    {
      top: [{ x: 0.5, z: 0.5 }],
      bottom: spans([0, 1], [0, 1]),
    },
    { shape: 'slope' },
  ),
  contouredPart(
    '4740',
    'Inverted dish 2 x 2',
    2,
    2,
    1,
    'plate',
    'round',
    {
      top: [{ x: 0.5, z: 0.5 }],
      bottom: spans([0, 1], [0, 1]),
    },
    { shape: 'round' },
  ),
  // A finial or spire needle: a 4-brick antenna on a one-plate round base. Its shaft is a bar
  // from the base to just under the rounded tip, so a flag can clip on anywhere up it.
  contouredPart(
    '3957a',
    'Antenna 1 x 1 x 4',
    1,
    1,
    12,
    'brick',
    'detail',
    {
      bottom: spans([0, 0]),
    },
    { ldrawBaseY: 8, bars: [{ from: [0.5, 1.5, 0.5], to: [0.5, 11.5, 0.5] }] },
  ),
  // Clips and bars, measured from the bar cylinders (4 LDU radius) in their meshes. Loose bars
  // stand on nothing: clips hold them, upright or mounted on their side to lie level.
  contouredPart(
    '30374',
    'Bar 4L',
    1,
    1,
    10,
    'brick',
    'detail',
    { bottom: [] },
    {
      ldrawBaseY: 80,
      bars: [{ from: [0.5, 0, 0.5], to: [0.5, 10, 0.5] }],
    },
  ),
  contouredPart(
    '87994',
    'Bar 3L',
    1,
    1,
    7.5,
    'brick',
    'detail',
    { bottom: [] },
    {
      ldrawBaseY: 60,
      bars: [{ from: [0.5, 0, 0.5], to: [0.5, 7.5, 0.5] }],
    },
  ),
  // A tile whose handle arches a brick high over it, the bar along its length.
  contouredPart(
    '2432',
    'Tile 1 x 2 with handle',
    2,
    1,
    4,
    'brick',
    'detail',
    {
      bottom: spans([0, 1]),
    },
    { ldrawBaseY: 32, bars: [{ from: [0.2, 3.5, 0.8], to: [1.8, 3.5, 0.8] }] },
  ),
  // A plate with a handle along its front edge, half a stud out.
  contouredPart(
    '2540',
    'Plate 1 x 2 with handle on side',
    2,
    2,
    1,
    'plate',
    'detail',
    {
      top: spans(null, [0, 1]),
      bottom: spans(null, [0, 1]),
    },
    {
      ldrawCenter: { x: 0, z: -10 },
      bars: [{ from: [0.4, 0.75, 0.5], to: [1.6, 0.75, 0.5] }],
    },
  ),
  // Clip plates: each clip half a stud out from the plate's front edge, its grip level with the
  // plate, holding a bar that runs along the edge (or, on the end clip, straight out).
  contouredPart(
    '4081b',
    'Plate 1 x 1 with clip',
    1,
    2,
    1,
    'plate',
    'detail',
    {
      top: spans(null, [0, 0]),
      bottom: spans(null, [0, 0]),
    },
    { ldrawCenter: { x: 0, z: -10 }, clips: [{ at: [0.5, 0.75, 0.5], axis: 'x' }] },
  ),
  contouredPart(
    '60470a',
    'Plate 1 x 2 with 2 clips',
    2,
    2,
    1,
    'plate',
    'detail',
    {
      top: spans(null, [0, 1]),
      bottom: spans(null, [0, 1]),
    },
    {
      ldrawCenter: { x: 0, z: -10 },
      clips: [
        { at: [0.5, 0.75, 0.5], axis: 'x' },
        { at: [1.5, 0.75, 0.5], axis: 'x' },
      ],
    },
  ),
  contouredPart(
    '63868',
    'Plate 1 x 2 with clip on end',
    3,
    1,
    1,
    'plate',
    'detail',
    {
      top: spans([0, 1]),
      bottom: spans([0, 1]),
    },
    { ldrawCenter: { x: 10, z: 0 }, clips: [{ at: [2.5, 0.75, 0.5], axis: 'z' }] },
  ),
  // A flag hung by two clips up its edge on a vertical bar, the cloth reaching two studs out.
  contouredPart(
    '2335',
    'Flag 2 x 2',
    1,
    3,
    5,
    'brick',
    'detail',
    { bottom: [] },
    {
      ldrawBaseY: 40,
      ldrawCenter: { x: 0, z: 20 },
      clips: [
        { at: [0.5, 0.5, 0.5], axis: 'y' },
        { at: [0.5, 4.5, 0.5], axis: 'y' },
      ],
    },
  ),
  // Grounds: a one-piece lamppost with an open stud on its lantern, a spindled fence that
  // can carry more on its studs, and a leaf spray held by one stud at its stem.
  contouredPart('2039', 'Lamppost 2 x 2 x 7', 2, 2, 21, 'brick', 'detail', {
    top: [{ x: 0.5, z: 0.5 }],
    bottom: spans([0, 1], [0, 1]),
  }),
  detailPart('15332', 'Spindled fence 1 x 4 x 2 with studs', 1, 4, 6),
  sculptedPart('2423', 'Foliage: leaves 4 x 3', 3, 4, 1, 'foliage', {
    kind: 'plate',
    ldrawCenter: { x: 0, z: -30 },
    connections: {
      topStuds: [
        [1, 0],
        [0, 1],
        [2, 1],
        [0, 2],
        [2, 2],
        [1, 3],
      ].map(([x, z]) => ({ x, z })),
      bottomReceivers: [{ x: 1, z: 3 }],
    },
  }),
  // Facade detail. Half-arch bricks stand on one centred stud, like a jumper, with the arches
  // reaching half a stud out over the openings either side.
  contouredPart(
    '38583',
    'Brick 1 x 1 with half arches on opposite sides',
    2,
    1,
    3,
    'brick',
    'arch',
    {
      top: [{ x: 0.5, z: 0 }],
      bottom: [{ x: 0.5, z: 0 }],
    },
  ),
  contouredPart(
    '38585',
    'Brick 1 x 1 with half arches on adjacent sides',
    1.5,
    1.5,
    3,
    'brick',
    'arch',
    {
      top: [{ x: 0, z: 0.5 }],
      bottom: [{ x: 0, z: 0.5 }],
    },
    { ldrawCenter: { x: 5, z: -5 } },
  ),
  // Quarter arches stand on their one leg. The stud partway down the curve is not a mounting
  // site: the engine only has studs on a part's top.
  contouredPart(
    '6005',
    'Quarter arch 1 x 3 x 2, curved top',
    1,
    3,
    6,
    'brick',
    'arch',
    {
      bottom: spans([0, 0]),
    },
    { ldrawCenter: { x: 0, z: -20 } },
  ),
  contouredPart(
    '88292',
    'Quarter arch 1 x 3 x 2, ogee',
    1,
    3,
    6,
    'brick',
    'arch',
    {
      top: spans(null, [0, 0], [0, 0]),
      bottom: spans([0, 0]),
    },
    { ldrawCenter: { x: 0, z: 20 } },
  ),
  contouredPart(
    '43888',
    'Round column 1 x 1 x 6',
    1,
    1,
    18,
    'brick',
    'round',
    {
      top: spans([0, 0]),
      bottom: spans([0, 0]),
    },
    { shape: 'round' },
  ),
  contouredPart('4865b', 'Panel 1 x 2 x 1', 2, 1, 3, 'brick', 'detail', {
    bottom: spans([0, 1]),
  }),
  contouredPart('30413', 'Panel 1 x 4 x 1', 4, 1, 3, 'brick', 'detail', {
    bottom: spans([0, 3]),
  }),
  // Wedge plates for angled walls and octagonal towers: studs on the full-width side only.
  contouredPart('41769a', 'Wedge plate 2 x 4, right', 2, 4, 1, 'plate', 'detail', {
    top: spans([1, 1], [1, 1], [1, 1], [1, 1]),
    bottom: spans([1, 1], [1, 1], [1, 1], [0, 1]),
  }),
  contouredPart('41770a', 'Wedge plate 2 x 4, left', 2, 4, 1, 'plate', 'detail', {
    top: spans([0, 0], [0, 0], [0, 0], [0, 0]),
    bottom: spans([0, 0], [0, 0], [0, 0], [0, 1]),
  }),
  contouredPart('43722a', 'Wedge plate 2 x 3, right', 2, 3, 1, 'plate', 'detail', {
    top: spans([1, 1], [1, 1], [1, 1]),
    bottom: spans([1, 1], [1, 1], [0, 1]),
  }),
  contouredPart('43723a', 'Wedge plate 2 x 3, left', 2, 3, 1, 'plate', 'detail', {
    top: spans([0, 0], [0, 0], [0, 0]),
    bottom: spans([0, 0], [0, 0], [0, 1]),
  }),
  // Spires and onion domes: a dome-topped round brick with a hollow stud for a finial, inverted
  // dishes that flare out under a lantern (the 3 x 3 sits on one centred stud, the 4 x 4 on the
  // middle 2 x 2), and a cone with a groove round its stud for gilded tips.
  contouredPart(
    '30367c',
    'Round brick 2 x 2 with dome top',
    2,
    2,
    3,
    'brick',
    'round',
    {
      top: [{ x: 0.5, z: 0.5 }],
      bottom: spans([0, 1], [0, 1]),
    },
    { shape: 'round' },
  ),
  contouredPart(
    '43898',
    'Inverted dish 3 x 3',
    3,
    3,
    2,
    'brick',
    'round',
    {
      top: spans(null, [1, 1]),
      bottom: spans(null, [1, 1]),
    },
    { shape: 'round' },
  ),
  contouredPart(
    '3960',
    'Inverted dish 4 x 4',
    4,
    4,
    2,
    'brick',
    'round',
    {
      top: [{ x: 1.5, z: 1.5 }],
      bottom: spans(null, [1, 2], [1, 2]),
    },
    { shape: 'round' },
  ),
  architecturalPart('59900', 'Cone 1 x 1 with top groove', 1, 1, 3, 'cone', {
    connections: coneConnections(1, 1),
  }),
  // Studs out of more than one side. The reserved half stud round the body takes the side studs,
  // which stand 14 LDU up on its faces, so nothing butts up against them.
  sculptedPart('4733', 'Brick 1 x 1 with studs on four sides', 2, 2, 3, 'detail', {
    connections: { topStuds: [{ x: 0.5, z: 0.5 }], bottomReceivers: [{ x: 0.5, z: 0.5 }] },
    sideStuds: [
      { x: 1, y: 1.75, z: 0.5, facing: '-z' },
      { x: 0.5, y: 1.75, z: 1, facing: '-x' },
      { x: 1, y: 1.75, z: 1.5, facing: '+z' },
      { x: 1.5, y: 1.75, z: 1, facing: '+x' },
    ],
  }),
  sculptedPart('47905', 'Brick 1 x 1 with studs on two opposite sides', 1, 2, 3, 'detail', {
    connections: { topStuds: [{ x: 0, z: 0.5 }], bottomReceivers: [{ x: 0, z: 0.5 }] },
    sideStuds: [
      { x: 0.5, y: 1.75, z: 0.5, facing: '-z' },
      { x: 0.5, y: 1.75, z: 1.5, facing: '+z' },
    ],
  }),
  // A 1 x 2 plate with a 1 x 2 plate standing up off its front edge, studs out, for signs and
  // trim. Its envelope reaches up to the top of the standing plate, so the lying plate's own
  // studs are covered: it takes pieces only on the two studs out front.
  sculptedPart('99780', 'Bracket 1 x 2 - 1 x 2 up', 2, 1.5, 2.5, 'detail', {
    kind: 'plate',
    ldrawCenter: { x: 0, z: -5 },
    ldrawBaseY: 8,
    connections: {
      topStuds: [],
      bottomReceivers: [
        { x: 0, z: 0.5 },
        { x: 1, z: 0.5 },
      ],
    },
    sideStuds: [
      { x: 0.5, y: 1.25, z: 0.3, facing: '-z' },
      { x: 1.5, y: 1.25, z: 0.3, facing: '-z' },
    ],
  }),
  // A hinge brick in two halves: the base is a 1 x 2 brick with a cradle on top, the top a
  // 1 x 2 plate whose knuckle drops into the cradle. Together they stand a brick tall, and the
  // top turns about the pair's long axis, 10 LDU under its studs, to tilt what it carries.
  sculptedPart('3937', 'Hinge brick 1 x 2 base', 2, 1, 3, 'detail', {
    connections: { topStuds: [], bottomReceivers: spans([0, 1]) },
    hinge: { role: 'base', pivot: [1, 1.75, 0.5], axis: 'x' },
  }),
  sculptedPart('3938', 'Hinge brick 1 x 2 top', 2, 1, 2, 'detail', {
    kind: 'plate',
    connections: { topStuds: spans([0, 1]), bottomReceivers: [] },
    hinge: { role: 'top', pivot: [1, 0.75, 0.5], axis: 'x' },
  }),
  // A 2 x 2 brick cut along one diagonal for octagonal towers: studs on the two whole corners.
  contouredPart('87620', 'Facet brick 2 x 2', 2, 2, 3, 'brick', 'detail', {
    top: spans([0, 0], [1, 1]),
    bottom: spans([0, 0], [1, 1]),
  }),
  // A boat's sail, a sheet lying flat with its straight luff along z and the peak at high z,
  // the clew out towards +x. Mounted on its side (`facing` ±z or ±x) it stands up with the peak
  // at the top. The holes at the tack and head lie half a stud outside the box, on the luff's
  // line, so they grip a bar beside it, such as an antenna topping a mast, while the rest of the
  // mast stands clear of the sheet. The sheet lies in the middle of the box's one-plate
  // thickness, and its hemmed luff reaches past the box towards the mast, as cloth wraps one.
  contouredPart(
    'u66',
    'Sail 6 x 12 Triangular',
    5,
    13,
    1,
    'brick',
    'detail',
    { bottom: [] },
    {
      ldrawCenter: { x: 60, z: 100 },
      ldrawBaseY: 4,
      clips: [
        { at: [-0.5, 0.5, 1.5], axis: 'z' },
        { at: [-0.5, 0.5, 11.4], axis: 'z' },
      ],
    },
  ),
  // A pennant or a boat's sail: the 2 x 2 flag's two clips, with the cloth tapering away.
  contouredPart(
    '44676a',
    'Flag 2 x 2 trapezoid',
    1,
    3,
    5,
    'brick',
    'detail',
    { bottom: [] },
    {
      ldrawBaseY: 40,
      ldrawCenter: { x: 0, z: 20 },
      clips: [
        { at: [0.5, 0.5, 0.5], axis: 'y' },
        { at: [0.5, 4.5, 0.5], axis: 'y' },
      ],
    },
  ),
  // Wheels: a 2 x 2 plate whose two pins (bars here) reach a stud and a half out either side,
  // and a small wheel with its tyre that clips onto a pin by its hub. Pin and wheel share space,
  // so the wheel stands in the plate's outer columns, its tyre one LDU off the ground.
  contouredPart(
    '4600',
    'Plate 2 x 2 with wheel pins',
    4,
    2,
    1,
    'plate',
    'detail',
    { top: spans([1, 2], [1, 2]), bottom: spans([1, 2], [1, 2]) },
    {
      bars: [
        { from: [0.3, 0.375, 1], to: [0.9, 0.375, 1] },
        { from: [3.1, 0.375, 1], to: [3.7, 0.375, 1] },
      ],
    },
  ),
  sculptedPart('4624c01', 'Wheel 6.4 x 8 with tyre', 1, 2, 5, 'detail', {
    rests: true,
    ldrawRotation: 90,
    ldrawBaseY: 19,
    clips: [{ at: [0.5, 2.375, 1], axis: 'x' }],
  }),
  // Minifigures, stacked like the real thing: hips and legs on two studs, the torso (with arms
  // and yellow hands) on the hips, the head on the neck and hair or a hat on the head's stud.
  // Each faces -z at rotation 0. Hips and neck rise into the piece above, and hair falls round
  // the head below its own base, as clips dip under their plates.
  sculptedPart('3815c01', 'Minifigure hips and legs', 2, 2, 5, 'detail', {
    ldrawCenter: { x: 0, z: -10 },
    ldrawBaseY: 40,
    connections: { topStuds: spans(null, [0, 1]), bottomReceivers: spans(null, [0, 1]) },
  }),
  sculptedPart('76382p00', 'Minifigure torso with arms and hands', 4, 2, 4, 'detail', {
    ldrawCenter: { x: 0, z: -10 },
    ldrawBaseY: 32,
    connections: { topStuds: [{ x: 1.5, z: 1 }], bottomReceivers: spans(null, [1, 2]) },
  }),
  sculptedPart('3626bp01', 'Minifigure head with grin', 2, 2, 3, 'detail', {
    connections: { topStuds: [{ x: 0.5, z: 0.5 }], bottomReceivers: [{ x: 0.5, z: 0.5 }] },
  }),
  ...(
    [
      ['3901', 'Minifigure hair, short'],
      ['21268', 'Minifigure hair, swept back'],
      ['29633', 'Minifigure hair, bob'],
      ['3624', 'Minifigure police hat'],
    ] as const
  ).map(([id, name]) =>
    sculptedPart(id, name, 2, 2, 2, 'detail', {
      ldrawBaseY: 0,
      connections: { topStuds: [], bottomReceivers: [{ x: 0.5, z: 0.5 }] },
    }),
  ),
  sculptedPart('13565', 'Minifigure fedora', 3, 3, 2, 'detail', {
    ldrawBaseY: 0,
    connections: { topStuds: [], bottomReceivers: [{ x: 1, z: 1 }] },
  }),
  // Braided string pulled straight between its end studs, which are round one-plate plugs with
  // a stud on top and a hollow below, so either end can sit on a stud or carry a piece. The cord
  // runs along x between them, just under their tops.
  ...(
    [
      ['75924', 'String braided 21L with end studs', 21],
      ['71149', 'String braided 41L with end studs', 41],
    ] as const
  ).map(([id, name, length]) =>
    sculptedPart(id, name, length, 1, 1, 'detail', {
      kind: 'plate',
      flexible: true,
      connections: {
        topStuds: [
          { x: 0, z: 0 },
          { x: length - 1, z: 0 },
        ],
        bottomReceivers: [
          { x: 0, z: 0 },
          { x: length - 1, z: 0 },
        ],
      },
    }),
  ),
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
    // Hinges need measured pivots, so only catalogue parts have them.
    part.hinge !== undefined ||
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
  /**
   * Tipped about a hinge line, carried by a hinge top (`3938`) or by pieces stacked on one with
   * the same tilt. x, y, z and rotation place it as if upright; the tilt then turns it.
   */
  tilt?: Tilt;
  /**
   * Fitted upside down, turned half round about its width through the middle of its cells, so
   * it keeps its cells. Only parts that declare `flippable` can be, such as a casement pane,
   * which hangs this way at the far end of its frame. Left out when false.
   */
  upsideDown?: true;
  /**
   * A flexible part strung from its first end stud, whose cell x, y and z give, to its last end
   * stud at this cell. The cord runs straight between them, so the ends may sit at different
   * heights and in any direction, as long as they are no further apart than the cord's length.
   * Rotation stays 0.
   */
  strung?: StrungEnd;
}

/** The cell a strung part's far end stud sits in: its min corner, studs and plates. */
export interface StrungEnd {
  x: number;
  y: number;
  z: number;
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
    const bounds = getWorldBounds(brick);
    minX = Math.min(minX, bounds.minX);
    maxX = Math.max(maxX, bounds.maxX);
    minZ = Math.min(minZ, bounds.minZ);
    maxZ = Math.max(maxZ, bounds.maxZ);
  }
  const dx = assembly.bricks.length ? shift(minX, maxX) : 0;
  const dz = assembly.bricks.length ? shift(minZ, maxZ) : 0;
  if (dx === null || dz === null) return null;
  const { buildArea: _, ...rest } = assembly;
  return {
    ...rest,
    ...(size === BUILD_AREA ? {} : { buildArea: size }),
    bricks: assembly.bricks.map((brick) => ({
      ...brick,
      x: brick.x + dx,
      z: brick.z + dz,
      ...(brick.tilt
        ? {
            tilt: {
              ...brick.tilt,
              at: brick.tilt.at + (brick.tilt.toward.endsWith('z') ? dz : dx),
            },
          }
        : {}),
      ...(brick.strung
        ? { strung: { ...brick.strung, x: brick.strung.x + dx, z: brick.strung.z + dz } }
        : {}),
    })),
  };
}

export function getPart(partId: string): Part {
  const part = PARTS_BY_ID.get(partId) ?? RUNTIME_PARTS.get(partId);
  if (!part) throw new Error(`Unknown part: ${partId}`);
  return part;
}

export function footprint(brick: Brick) {
  const part = getPart(brick.partId);
  // A strung part's grid footprint is its first end stud; the rest follows the cord.
  if (brick.strung) return { width: 1, depth: 1, height: part.height };
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

// ---------------------------------------------------------------------------------------------
// Tilted frames. Worked in "level" LDU: x and z as in LDraw, y up (LDraw's -y).

/** Pieces with equal keys share a tilted frame. */
const tiltKey = (tilt: Tilt) => `${tilt.toward}:${tilt.angle}:${tilt.y}:${tilt.at}`;

/** Whether two pieces stand in the same frame: both untilted, or tilted alike. */
function sameFrame(first: Brick, second: Brick): boolean {
  if (!first.tilt || !second.tilt) return !first.tilt && !second.tilt;
  return tiltKey(first.tilt) === tiltKey(second.tilt);
}

/**
 * The tilt's turn, row-major, with x and z along the grid and y up: straight up ends up leaning
 * toward the tilt's side.
 */
export function getTiltTurn(tilt: Tilt): Matrix {
  return tiltTurn(tilt);
}

function tiltTurn({ toward, angle }: Tilt): Matrix {
  const radians = (angle * Math.PI) / 180;
  const [c, s] = [Math.cos(radians), Math.sin(radians)];
  if (toward === '+z') return [1, 0, 0, 0, c, -s, 0, s, c];
  if (toward === '-z') return [1, 0, 0, 0, c, s, 0, -s, c];
  if (toward === '+x') return [c, s, 0, -s, c, 0, 0, 0, 1];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/** A point on the tilt's hinge line, in level LDU. */
function tiltPivot({ toward, y, at }: Tilt): Point {
  return toward.endsWith('z') ? [0, y * 8, at * 20] : [at * 20, y * 8, 0];
}

/** Turns a point in level LDU about the tilt's hinge line. */
function tiltPoint(tilt: Tilt, point: Point): Point {
  const pivot = tiltPivot(tilt);
  const [x, y, z] = apply(tiltTurn(tilt), [
    point[0] - pivot[0],
    point[1] - pivot[1],
    point[2] - pivot[2],
  ]);
  return [x + pivot[0], y + pivot[1], z + pivot[2]];
}

/** A strung part's end studs' bases, the tops of its plugs, in level LDU. */
function strungEnds(brick: Brick): [Point, Point] {
  const height = getPart(brick.partId).height;
  const end = (cell: StrungEnd): Point => [
    (cell.x + 0.5) * 20,
    (cell.y + height) * 8,
    (cell.z + 0.5) * 20,
  ];
  return [end(brick), end(brick.strung!)];
}

/**
 * What a strung part fills: its two plugs, standing upright like 1 x 1 round plates, and the cord
 * between them as a thin turned box. The box starts where the cord leaves each plug's own cell.
 */
function strungBodies(brick: Brick): (Brick | Box)[] {
  if (!brick.strung) return [brick];
  const plug = (cell: StrungEnd): Brick => ({
    id: brick.id,
    partId: '6141',
    color: brick.color,
    x: cell.x,
    y: cell.y,
    z: cell.z,
    rotation: 0,
  });
  // The cord runs 1.5 LDU under the plugs' tops.
  const [a, b] = strungEnds(brick).map(([x, y, z]): Point => [x, y - 1.5, z]);
  const offset: Point = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const length = Math.hypot(...offset);
  const along: Point = [offset[0] / length, offset[1] / length, offset[2] / length];
  const flat = Math.hypot(along[0], along[2]);
  const across: Point = [-along[2] / flat, 0, along[0] / flat];
  // How far along the cord it crosses the edge of a plug's 1 x 1 cell.
  const leaves = 10 / Math.max(Math.abs(along[0]), Math.abs(along[2]));
  const cord: Box = {
    center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
    axes: [along, cross(across, along), across],
    half: [Math.max(0, length / 2 - leaves), 2, 2],
  };
  return [plug(brick), plug(brick.strung), cord];
}

/** A piece's body as an oriented box in level LDU: centre, unit axes and half extents. */
interface Box {
  center: Point;
  axes: readonly [Point, Point, Point];
  half: Point;
}

function bodyBox(brick: Brick): Box {
  const size = footprint(brick);
  const center: Point = [
    (brick.x + size.width / 2) * 20,
    (brick.y + size.height / 2) * 8,
    (brick.z + size.depth / 2) * 20,
  ];
  const half: Point = [size.width * 10, size.height * 4, size.depth * 10];
  if (!brick.tilt)
    return {
      center,
      half,
      axes: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
    };
  const turn = tiltTurn(brick.tilt);
  const column = (index: number): Point => [turn[index], turn[index + 3], turn[index + 6]];
  return { center: tiltPoint(brick.tilt, center), half, axes: [column(0), column(1), column(2)] };
}

/**
 * The level box a piece fills in the world: studs across, plates up. A tilted piece's box holds
 * its whole turned body.
 */
export function getWorldBounds(brick: Brick) {
  if (brick.strung) {
    const ends = [brick, brick.strung];
    const height = getPart(brick.partId).height;
    return {
      minX: Math.min(...ends.map((end) => end.x)),
      maxX: Math.max(...ends.map((end) => end.x)) + 1,
      minY: Math.min(...ends.map((end) => end.y)),
      maxY: Math.max(...ends.map((end) => end.y)) + height,
      minZ: Math.min(...ends.map((end) => end.z)),
      maxZ: Math.max(...ends.map((end) => end.z)) + 1,
    };
  }
  if (!brick.tilt) {
    const size = footprint(brick);
    return {
      minX: brick.x,
      maxX: brick.x + size.width,
      minY: brick.y,
      maxY: brick.y + size.height,
      minZ: brick.z,
      maxZ: brick.z + size.depth,
    };
  }
  const { center, axes, half } = bodyBox(brick);
  const reach = [0, 1, 2].map((axis) =>
    axes.reduce((sum, direction, index) => sum + Math.abs(direction[axis]) * half[index], 0),
  );
  return {
    minX: (center[0] - reach[0]) / 20,
    maxX: (center[0] + reach[0]) / 20,
    minY: (center[1] - reach[1]) / 8,
    maxY: (center[1] + reach[1]) / 8,
    minZ: (center[2] - reach[2]) / 20,
    maxZ: (center[2] + reach[2]) / 20,
  };
}

const cross = (first: Point, second: Point): Point => [
  first[1] * second[2] - first[2] * second[1],
  first[2] * second[0] - first[0] * second[2],
  first[0] * second[1] - first[1] * second[0],
];

/**
 * How far, in LDU, pieces in different frames may press into each other: a tilted panel's
 * edge rounds over its neighbours where real plates flex or leave a sliver of air.
 */
const TILT_SLACK = 2;

/** Whether two oriented boxes overlap by more than the slack, by separating axes. */
function boxesOverlap(first: Box, second: Box): boolean {
  const offset: Point = [
    second.center[0] - first.center[0],
    second.center[1] - first.center[1],
    second.center[2] - first.center[2],
  ];
  const candidates: Point[] = [...first.axes, ...second.axes];
  for (const a of first.axes) for (const b of second.axes) candidates.push(cross(a, b));
  for (const candidate of candidates) {
    const size = Math.hypot(...candidate);
    if (size < 1e-6) continue;
    const axis: Point = [candidate[0] / size, candidate[1] / size, candidate[2] / size];
    const reach = (box: Box) =>
      box.axes.reduce(
        (sum, direction, index) => sum + Math.abs(dot(direction, axis)) * box.half[index],
        0,
      );
    if (Math.abs(dot(offset, axis)) >= reach(first) + reach(second) - TILT_SLACK) return false;
  }
  return true;
}

/** A part's hinge pivot and axis where an upright piece puts them, in level LDU. */
function hingeLine(brick: Brick, part: Part) {
  const hinge = part.hinge!;
  const [x, y, z] = uprightPoint(brick, part, hinge.pivot);
  const along = (hinge.axis === 'x') === (brick.rotation % 180 === 0) ? 'x' : 'z';
  return { pivot: [x, -y, z] as Point, along };
}

/**
 * Whether a hinge top sits on a hinge base: their pivots meet, along the same axis, and a tilted
 * top turns about that very line.
 */
export function isHingePair(top: Brick, base: Brick): boolean {
  const topPart = getPart(top.partId);
  const basePart = getPart(base.partId);
  if (topPart.hinge?.role !== 'top' || basePart.hinge?.role !== 'base') return false;
  if (top.facing || base.facing || base.tilt || base.upsideDown || top.upsideDown) return false;
  const upper = hingeLine(top, topPart);
  const lower = hingeLine(base, basePart);
  if (
    upper.along !== lower.along ||
    upper.pivot.some((value, axis) => Math.abs(value - lower.pivot[axis]) > EPSILON)
  )
    return false;
  if (!top.tilt) return true;
  // The tilt turns about a line level across the way it leans, through the pivot.
  if (top.tilt.toward.endsWith(upper.along)) return false;
  const [pivotX, pivotY, pivotZ] = tiltPivot(top.tilt);
  return (
    Math.abs(pivotY - upper.pivot[1]) < EPSILON &&
    Math.abs(upper.along === 'x' ? pivotZ - upper.pivot[2] : pivotX - upper.pivot[0]) < EPSILON
  );
}

/**
 * The tilt that turns pieces on this hinge base's top by `angle` degrees toward `toward`, or
 * null when the base isn't a hinge or can't lean that way.
 */
export function getHingeTilt(base: Brick, toward: Facing, angle: number): Tilt | null {
  const part = getPart(base.partId);
  if (part.hinge?.role !== 'base' || base.facing || base.tilt) return null;
  const { pivot, along } = hingeLine(base, part);
  if (toward.endsWith(along)) return null;
  return {
    toward,
    angle,
    y: pivot[1] / 8,
    at: (along === 'x' ? pivot[2] : pivot[0]) / 20,
  };
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
  // Tilted frames have no side-stud grid of their own.
  if (brick.tilt) return [];
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

/**
 * A mounted piece slid the least way that sets its underside on one of `host`'s side studs
 * pointing the way it faces, or null when the host has none it can reach on the grid. The
 * piece keeps its facing and rotation; only its position moves.
 */
export function seatOnSideStuds(brick: Brick, host: Brick): Brick | null {
  if (!brick.facing) return null;
  const parse = (key: string) => {
    const [facing, ...point] = key.split(':');
    return { facing, point: point.map(Number) };
  };
  const studs = getSideStuds(host)
    .map(parse)
    .filter(({ facing }) => facing === brick.facing);
  if (!studs.length) return null;
  let best: Brick | null = null;
  let bestDistance = Infinity;
  for (const receiver of getSideReceivers(brick).map(parse))
    for (const stud of studs) {
      const [dx, dy, dz] = stud.point.map((value, axis) => value - receiver.point[axis]);
      const seated: Brick = {
        ...brick,
        x: Math.round((brick.x + dx / 20) * 10) / 10,
        y: Math.round((brick.y - dy / 8) * 10) / 10,
        z: Math.round((brick.z + dz / 20) * 10) / 10,
      };
      const distance = Math.hypot(dx / 20, dy / 20, dz / 20);
      if (distance < bestDistance && isValid(seated, MAX_BUILD_AREA)) {
        best = seated;
        bestDistance = distance;
      }
    }
  return best;
}

/**
 * For each piece that hangs rather than stands, the pieces holding it: those whose side studs a
 * mounted piece sits on, whose clips or bars a piece grips, or under a piece standing on one
 * of those. Mounted pieces nothing holds get an empty list. Pieces standing on the ground or on
 * studs of standing pieces are left out.
 */
export function getMountHosts(bricks: readonly Brick[]): Map<string, string[]> {
  const { hosts, unsupported } = hang(bricks);
  const result = new Map<string, string[]>([...hosts].map(([id, ids]) => [id, [...ids]]));
  for (const brick of unsupported) if (brick.facing || brick.tilt) result.set(brick.id, []);
  return result;
}

/** @deprecated Use getMountHosts, which also covers pieces held by clips. */
export const getSideMountHosts = getMountHosts;

export function getConnectionSites(
  brick: Brick,
  surface: 'top' | 'bottom',
  part: Part = getPart(brick.partId),
) {
  // Mounted pieces connect through side studs only, tilted ones only within their frame.
  if (brick.facing || brick.tilt) return [];
  return frameSites(brick, surface, part);
}

/** Stud and receiver centres as if the piece stood upright: within its frame, if tilted. */
function frameSites(brick: Brick, surface: 'top' | 'bottom', part: Part = getPart(brick.partId)) {
  if (brick.strung)
    return [brick, brick.strung].map((end) => ({
      x: end.x + 0.5,
      y: end.y + (surface === 'top' ? part.height : 0),
      z: end.z + 0.5,
    }));
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

/** Where a point of a part lands, in LDraw units, upright, mounted on its side or tilted. */
function placePoint(brick: Brick, part: Part, point: PartPoint): Point {
  if (brick.facing) return mounting(brick, part).place(partPoint(...point));
  const upright = uprightPoint(brick, part, point);
  if (!brick.tilt) return upright;
  const [x, y, z] = tiltPoint(brick.tilt, [upright[0], -upright[1], upright[2]]);
  return [x, -y, z];
}

/** Where a point of a part lands, in LDraw units, before any tilt. */
function uprightPoint(brick: Brick, part: Part, [x, y, z]: PartPoint): Point {
  let [across, along] = [x, z];
  if (brick.rotation === 90) [across, along] = [z, part.width - x];
  else if (brick.rotation === 180) [across, along] = [part.width - x, part.depth - z];
  else if (brick.rotation === 270) [across, along] = [part.depth - z, x];
  return partPoint(brick.x + across, brick.y + y, brick.z + along);
}

const AXES: Readonly<Record<Clip['axis'], PartPoint>> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};
const minus = (first: Point, second: Point): Point => [
  first[0] - second[0],
  first[1] - second[1],
  first[2] - second[2],
];
const dot = (first: Point, second: Point) =>
  first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
const length = (vector: Point) => Math.sqrt(dot(vector, vector));

function hasClipsOrBars(part: Part): boolean {
  return !!(part.clips?.length || part.bars?.length);
}

/** A piece's bars as world segments in LDraw units. */
function getBars(brick: Brick, part: Part = getPart(brick.partId)) {
  return (part.bars ?? []).map((bar) => ({
    from: placePoint(brick, part, bar.from),
    to: placePoint(brick, part, bar.to),
  }));
}

/** A piece's clips: where each grips, in LDraw units, and the way the bar it holds runs. */
function getClips(brick: Brick, part: Part = getPart(brick.partId)) {
  return (part.clips ?? []).map((clip) => {
    const at = placePoint(brick, part, clip.at);
    const step = AXES[clip.axis];
    const ahead = placePoint(brick, part, [
      clip.at[0] + step[0],
      clip.at[1] + step[1],
      clip.at[2] + step[2],
    ]);
    return { at, direction: minus(ahead, at) };
  });
}

/** How far, in LDraw units, a clip may sit off a bar's centre line or past its ends. */
const GRIP_SLACK = 0.5;

/** Whether one of `holder`'s clips grips one of `bar`'s bars: on its line, along it, within it. */
function grips(holder: Brick, bar: Brick): boolean {
  const clips = getClips(holder);
  if (!clips.length) return false;
  const bars = getBars(bar);
  return clips.some(({ at, direction }) =>
    bars.some(({ from, to }) => {
      const axis = minus(to, from);
      const span = length(axis);
      const unit: Point = [axis[0] / span, axis[1] / span, axis[2] / span];
      const turn = dot(unit, direction) / length(direction);
      if (Math.abs(Math.abs(turn) - 1) > 1e-6) return false;
      const offset = minus(at, from);
      const along = dot(offset, unit);
      if (along < -GRIP_SLACK || along > span + GRIP_SLACK) return false;
      return (
        length(minus(offset, [unit[0] * along, unit[1] * along, unit[2] * along])) < GRIP_SLACK
      );
    }),
  );
}

/**
 * A piece slid the least way that puts one of its bars through one of `host`'s clips, or one
 * of its clips onto one of the host's bars, keeping its pose; null when no bar and clip of the
 * two run the same way, or none lines up on the grid. The bar stays where it is along its
 * length as far as its ends allow, so the pointer picks where along it the clip grips.
 */
export function seatOnClips(brick: Brick, host: Brick): Brick | null {
  const pairs = [
    { clips: getClips(host), bars: getBars(brick), sign: 1 },
    { clips: getClips(brick), bars: getBars(host), sign: -1 },
  ];
  let best: Brick | null = null;
  let bestDistance = Infinity;
  for (const { clips, bars, sign } of pairs)
    for (const { at, direction } of clips)
      for (const { from, to } of bars) {
        const axis = minus(to, from);
        const span = length(axis);
        const unit: Point = [axis[0] / span, axis[1] / span, axis[2] / span];
        if (Math.abs(Math.abs(dot(unit, direction) / length(direction)) - 1) > 1e-6) continue;
        const along = Math.min(Math.max(dot(minus(at, from), unit), 0), span);
        const nearest: Point = [
          from[0] + unit[0] * along,
          from[1] + unit[1] * along,
          from[2] + unit[2] * along,
        ];
        // Move the bar onto the clip, or the clip onto the bar.
        const [dx, dy, dz] = minus(at, nearest).map((value) => value * sign);
        const seated: Brick = {
          ...brick,
          x: Math.round((brick.x + dx / 20) * 10) / 10,
          y: Math.round((brick.y - dy / 8) * 2) / 2,
          z: Math.round((brick.z + dz / 20) * 10) / 10,
        };
        const distance = Math.hypot(dx, dy, dz);
        if (
          distance < bestDistance &&
          isValid(seated, MAX_BUILD_AREA) &&
          hasClipConnection(seated, host)
        ) {
          best = seated;
          bestDistance = distance;
        }
      }
  return best;
}

/** Whether a clip on either piece grips a bar on the other. */
export function hasClipConnection(first: Brick, second: Brick): boolean {
  return grips(first, second) || grips(second, first);
}

export function hasStudConnection(
  support: Brick,
  brick: Brick,
  supportPart: Part = getPart(support.partId),
  part: Part = getPart(brick.partId),
): boolean {
  // A strung part's two ends stand at their own heights.
  if (!support.strung && !brick.strung && support.y + supportPart.height !== brick.y) return false;
  if (support.facing || brick.facing || !sameFrame(support, brick)) return false;
  const studs = new Set(frameSites(support, 'top', supportPart).map(studKey));
  return frameSites(brick, 'bottom', part).some((site) => studs.has(studKey(site)));
}

/** Slack for mounted pieces, whose 0.4 stud thickness doesn't add up exactly in floating point. */
const EPSILON = 1e-6;
const onGrid = (value: number, step: number) =>
  Math.abs(Math.round(value / step) * step - value) < EPSILON;

function isValidTilt(tilt: Tilt): boolean {
  return (
    typeof tilt === 'object' &&
    tilt !== null &&
    FACINGS.includes(tilt.toward) &&
    TILT_ANGLES.includes(tilt.angle) &&
    [tilt.y, tilt.at].every((value) => Number.isFinite(value) && value >= 0) &&
    onGrid(tilt.y, 0.25) &&
    onGrid(tilt.at, 0.5) &&
    Object.keys(tilt).length === 4
  );
}

/**
 * Whether a strung part's far end is a cell on the grid, upright and unturned, its cord no
 * longer than the part's, and the ends at least a stud apart across the board.
 */
function isValidStrung(brick: Brick): boolean {
  const end = brick.strung;
  if (
    typeof end !== 'object' ||
    end === null ||
    Object.keys(end).length !== 3 ||
    !getPart(brick.partId).flexible ||
    brick.rotation !== 0 ||
    brick.facing ||
    brick.tilt ||
    brick.upsideDown ||
    ![end.x, end.y, end.z].every((value) => Number.isFinite(value) && value >= 0) ||
    !onGrid(end.x, 0.5) ||
    !onGrid(end.y, 0.5) ||
    !onGrid(end.z, 0.5)
  )
    return false;
  const [a, b] = strungEnds(brick);
  const across = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const length = (getPart(brick.partId).width - 1) * 20;
  return across >= 20 - EPSILON && Math.hypot(across, b[1] - a[1]) <= length + EPSILON;
}

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
    (brick.tilt !== undefined && (!!brick.facing || !isValidTilt(brick.tilt))) ||
    (brick.strung !== undefined && !isValidStrung(brick)) ||
    (brick.upsideDown !== undefined &&
      (brick.upsideDown !== true ||
        !!brick.facing ||
        !!brick.tilt ||
        !getPart(brick.partId).flippable)) ||
    ![brick.x, brick.y, brick.z].every((value) => Number.isFinite(value) && value >= 0) ||
    !onGrid(brick.x, step('x')) ||
    !onGrid(brick.y, 0.5) ||
    !onGrid(brick.z, step('z'))
  )
    return false;
  if (brick.tilt || brick.strung) {
    const bounds = getWorldBounds(brick);
    return (
      bounds.minX >= -EPSILON &&
      bounds.minZ >= -EPSILON &&
      bounds.minY >= -EPSILON &&
      bounds.maxX <= buildArea + EPSILON &&
      bounds.maxZ <= buildArea + EPSILON &&
      bounds.maxY <= MAX_HEIGHT
    );
  }
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
  '60607': '60594',
  '60608': '60594',
  '57895': '57894',
  '2494': '2493b',
  '3193a': '3579',
  '3192a': '3579',
  '60616a': '60596',
  '60623': '60596',
});

/**
 * Pieces that fill an arch's opening, and the arch each fits. The infill stands on the studs
 * below and goes in first; the arch then comes down over it.
 */
export const ARCH_INFILL_PARTS: Readonly<Record<string, string>> = Object.freeze({
  '20309': '15254',
});

/** Whether `infill` fills the opening of `arch`: level with it and centred between its legs. */
export function isArchInfill(infill: Brick, arch: Brick): boolean {
  if (
    ARCH_INFILL_PARTS[infill.partId] !== arch.partId ||
    infill.y !== arch.y ||
    infill.rotation % 180 !== arch.rotation % 180 ||
    infill.facing ||
    arch.facing
  )
    return false;
  const along = footprint(arch).width > footprint(arch).depth;
  return along
    ? infill.x === arch.x + 1 && infill.z === arch.z
    : infill.z === arch.z + 1 && infill.x === arch.x;
}

/** Doors hung on their own hinge stud, which stands at one end of the frame's opening. */
const HINGED_DOORS = new Set(['3193a', '3192a']);
/** Doors hung on the frame's hinge pins: native origin at frame-local (±32, 5), turned to match. */
const PINNED_DOORS = new Set(['60616a', '60623']);
/** Panes hung by their corner pins in the pockets at either end of a frame's opening. */
const CASEMENT_PANES = new Set(['60607', '60608']);

export function isMatchingInsertFrame(insert: Brick, frame: Brick): boolean {
  const framePartId = INSERT_FRAME_PARTS[insert.partId];
  if (
    !framePartId ||
    frame.partId !== framePartId ||
    frame.y !== insert.y ||
    insert.facing ||
    frame.facing ||
    frame.upsideDown
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
  if (CASEMENT_PANES.has(insert.partId)) {
    // Turned like the frame, the pane hangs at the frame-local -x end; upside down it hangs at
    // the +x end with its pin at the bottom. Turned round, it would face into the building.
    if (insert.rotation !== frame.rotation) return false;
    const pin = insert.upsideDown ? [33, 68] : [-33, 4];
    const pane = getLDrawTransform(insert);
    const pockets = getLDrawTransform(frame);
    const cosine = Math.round(Math.cos((pockets.rotation * Math.PI) / 180));
    const sine = Math.round(Math.sin((pockets.rotation * Math.PI) / 180));
    return (
      pane.x === pockets.x + cosine * pin[0] + sine * 3.5 &&
      pane.y === pockets.y + pin[1] &&
      pane.z === pockets.z - sine * pin[0] + cosine * 3.5
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
  /** How many pieces are tilted or strung; with any, additions are validated in full. */
  tilted: number;
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
const UNTILTED_MESSAGE =
  'Nothing holds this tilted piece: it needs a hinge base under a hinge top, or a stud of a held piece with the same tilt.';

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

/** The buckets a piece reaches into: its whole turned body, if tilted. */
function cellsOf(brick: Brick, size: Size): string[] {
  if (!brick.tilt && !brick.strung) return bucketKeys(brick, size);
  const bounds = getWorldBounds(brick);
  return bucketKeys(
    { ...brick, x: bounds.minX, y: bounds.minY, z: bounds.minZ },
    {
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY,
      depth: bounds.maxZ - bounds.minZ,
    },
  );
}

/**
 * Whether a tilted piece turns about this hinge base's line. The base's cradle is cut away for
 * the top to swing in, so what the top carries may lean over it.
 */
function swingsOn(brick: Brick, base: Brick): boolean {
  if (!brick.tilt) return false;
  const line = getHingeTilt(base, brick.tilt.toward, brick.tilt.angle);
  return !!line && tiltKey(line) === tiltKey(brick.tilt);
}

/**
 * Whether two pieces' bodies overlap: on the grid when they share a frame, else as turned boxes.
 * A hinge's halves share the space round their pivot.
 */
function collides(brick: Brick, size: Size, other: Brick, otherSize: Size): boolean {
  if (brick.strung || other.strung) {
    // A cord drapes over the edge of what its end studs stand on and carry.
    const drapes = hasStudConnection(brick, other) || hasStudConnection(other, brick);
    return strungBodies(brick).some((first) =>
      strungBodies(other).some((second) => {
        if ('center' in first || 'center' in second)
          return (
            !drapes &&
            boxesOverlap(
              'center' in first ? first : bodyBox(first),
              'center' in second ? second : bodyBox(second),
            )
          );
        return collides(first, footprint(first), second, footprint(second));
      }),
    );
  }
  if (isHingePair(brick, other) || isHingePair(other, brick)) return false;
  if (swingsOn(brick, other) || swingsOn(other, brick)) return false;
  if (sameFrame(brick, other)) return overlaps(brick, size, other, otherSize);
  return boxesOverlap(bodyBox(brick), bodyBox(other));
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

/** What holds every piece: the studs, side studs and clips each one is hung from. */
interface Hanging {
  /** Top studs of upright pieces, keyed `${y}:${x}:${z}`. */
  groundedStuds: Set<string>;
  groundedByTopHeight: Map<number, Brick[]>;
  runtimeBricks: number;
  sideStuds: Map<string, string[]>;
  /** The pass that hung each piece: 0 for pieces standing on the ground or on studs. */
  rounds: Map<string, number>;
  /** For pieces hung in later passes, the pieces holding them. */
  hosts: Map<string, Set<string>>;
  mountedReceivers: Set<string>;
  /** Upright pieces nothing holds, lowest first, then mounted ones. */
  unsupported: Brick[];
}

/**
 * Hangs valid pieces from the ground up. Upright pieces stand on the ground or on studs of the
 * pieces under them, lowest first. Then, a pass at a time, the rest hang from pieces already
 * held: mounted pieces from side studs, pieces with clips or bars from a clip or bar of a held
 * piece, and upright pieces from the top studs of upright pieces hung that way.
 */
function hang(valid: readonly Brick[]): Hanging {
  const groundedStuds = new Set<string>();
  const studOwners = new Map<string, string[]>();
  const runtimeBrickIds = new Set(
    valid.filter((brick) => isRuntimePart(brick.partId)).map((brick) => brick.id),
  );
  const groundedByTopHeight = new Map<number, Brick[]>();
  const sideStuds = new Map<string, string[]>();
  const rounds = new Map<string, number>();
  const hosts = new Map<string, Set<string>>();
  const mountedReceivers = new Set<string>();
  /** Held pieces with clips or bars, which can hold others. */
  const gripping: Brick[] = [];
  /** Top studs of held tilted pieces, keyed by frame and stud. */
  const frameStudOwners = new Map<string, string[]>();
  /** Held upright hinge bases, which can carry a hinge top. */
  const hingeBases: Brick[] = [];
  const hingeHosts = (brick: Brick) =>
    getPart(brick.partId).hinge?.role === 'top'
      ? hingeBases.filter((base) => isHingePair(brick, base))
      : [];
  // A hinge top hangs from its base in a later pass, even level, so that what it carries is
  // carried by the base.
  const hold = (brick: Brick, round: number) => {
    rounds.set(brick.id, round);
    if (brick.tilt) {
      const frame = tiltKey(brick.tilt);
      for (const site of frameSites(brick, 'top')) {
        const key = `${frame}|${studKey(site)}`;
        frameStudOwners.set(key, [...(frameStudOwners.get(key) ?? []), brick.id]);
      }
    } else if (!brick.facing) {
      if (getPart(brick.partId).hinge?.role === 'base') hingeBases.push(brick);
      for (const site of getConnectionSites(brick, 'top')) {
        const key = studKey(site);
        groundedStuds.add(key);
        studOwners.set(key, [...(studOwners.get(key) ?? []), brick.id]);
      }
      const topHeight = brick.y + footprint(brick).height;
      const groundedAtHeight = groundedByTopHeight.get(topHeight) ?? [];
      groundedAtHeight.push(brick);
      groundedByTopHeight.set(topHeight, groundedAtHeight);
    }
    for (const key of getSideStuds(brick))
      sideStuds.set(key, [...(sideStuds.get(key) ?? []), brick.id]);
    if (hasClipsOrBars(getPart(brick.partId))) gripping.push(brick);
  };
  const unheld: Brick[] = [];
  for (const brick of valid
    .filter((brick) => !brick.facing && !brick.tilt)
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
    const restsOnSupport =
      getPart(brick.partId).rests &&
      (groundedByTopHeight.get(brick.y) ?? []).some((support) =>
        hasEnvelopeContact(brick, support),
      );
    if (
      brick.y === 0 ||
      isSupportedInsert(brick, valid) ||
      hasStudSupport ||
      hasUnknownEnvelopeSupport ||
      restsOnSupport
    )
      hold(brick, 0);
    else unheld.push(brick);
  }
  let pending = [...unheld, ...valid.filter((brick) => brick.facing || brick.tilt)];
  for (let progress = true, round = 1; progress && pending.length; round += 1) {
    progress = false;
    pending = pending.filter((brick) => {
      const ids = new Set<string>();
      const receivers = getSideReceivers(brick);
      for (const key of receivers) for (const id of sideStuds.get(key) ?? []) ids.add(id);
      if (!brick.facing)
        for (const site of getConnectionSites(brick, 'bottom'))
          for (const id of studOwners.get(studKey(site)) ?? []) ids.add(id);
      if (brick.tilt) {
        const frame = tiltKey(brick.tilt);
        for (const site of frameSites(brick, 'bottom'))
          for (const id of frameStudOwners.get(`${frame}|${studKey(site)}`) ?? []) ids.add(id);
      }
      for (const base of hingeHosts(brick)) ids.add(base.id);
      if (hasClipsOrBars(getPart(brick.partId)))
        for (const other of gripping) if (hasClipConnection(brick, other)) ids.add(other.id);
      if (!ids.size) return true;
      hosts.set(brick.id, ids);
      for (const key of receivers) mountedReceivers.add(key);
      hold(brick, round);
      progress = true;
      return false;
    });
  }
  return {
    groundedStuds,
    groundedByTopHeight,
    runtimeBricks: runtimeBrickIds.size,
    sideStuds,
    rounds,
    hosts,
    mountedReceivers,
    unsupported: pending,
  };
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
      issues.push({
        brickId: brick.id,
        code: 'invalid',
        message: INVALID_MESSAGE,
      });
    } else {
      valid.push(brick);
    }
    seen.add(brick.id);
  }
  const hung = hang(valid);
  for (const brick of hung.unsupported)
    issues.push({
      brickId: brick.id,
      code: 'unsupported',
      message: brick.facing
        ? UNMOUNTED_MESSAGE
        : brick.tilt
          ? UNTILTED_MESSAGE
          : UNSUPPORTED_MESSAGE,
    });
  const { groundedStuds, groundedByTopHeight, sideStuds, rounds, hosts, mountedReceivers } = hung;
  // A mounted piece reaches into the recess or stud space of the pieces that hold it, down to
  // the upright brick the whole chain hangs from.
  const bounds = valid.map((brick) => footprint(brick));
  const buckets = new Map<string, number[]>();
  const cells = valid.map((brick, index) => {
    const keys = cellsOf(brick, bounds[index]);
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
    runtimeBricks: hung.runtimeBricks,
    sideStuds,
    rounds,
    hosts,
    mountedReceivers,
    bounds,
    buckets,
    chains: new Map(),
    tilted: valid.filter((brick) => brick.tilt || brick.strung).length,
  };
  const holds = (piece: Brick, host: Brick) =>
    !!piece.facing && chainOf(index, piece.id).has(host.id);
  // A clip closes round the bar it grips, so the two always share space.
  const clipped = (first: Brick, second: Brick) =>
    hasClipsOrBars(getPart(first.partId)) &&
    hasClipsOrBars(getPart(second.partId)) &&
    hasClipConnection(first, second);
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
        collides(brick, size, other, bounds[otherIndex]) &&
        !isMatchingInsertFrame(brick, other) &&
        !isMatchingInsertFrame(other, brick) &&
        !isArchInfill(brick, other) &&
        !isArchInfill(other, brick) &&
        !holds(brick, other) &&
        !holds(other, brick) &&
        !clipped(brick, other)
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
  // A clip or bar can hang the piece, or let it overlap what it grips: check those in full.
  const part = PARTS_BY_ID.get(brick.partId) ?? RUNTIME_PARTS.get(brick.partId);
  if (part && hasClipsOrBars(part)) return null;
  // Tilted frames and hinges are checked in full, as is anything added among tilted pieces.
  if (brick.tilt || brick.strung || part?.hinge || index.tilted) return null;
  const bricks = [...assembly.bricks, brick];
  const next: Assembly = { ...assembly, bricks };
  const issues: Issue[] = [];
  let derive: (() => ValidationIndex) | null = null;
  if (!isValid(brick, getBuildArea(assembly)) || index.ids.has(brick.id)) {
    issues.push({
      brickId: brick.id,
      code: 'invalid',
      message: INVALID_MESSAGE,
    });
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
        issues.push({
          brickId: brick.id,
          code: 'unsupported',
          message: UNSUPPORTED_MESSAGE,
        });
    } else {
      receivers = getSideReceivers(brick);
      const providers = receivers.flatMap((key) => index.sideStuds.get(key) ?? []);
      if (providers.length) {
        // The full pass hangs it in the first round that offers one of its studs, after the
        // pieces already hung that round: it comes last.
        round = Math.max(1, Math.min(...providers.map((id) => index.rounds.get(id)!)));
        hosts = new Set(providers.filter((id) => index.rounds.get(id)! <= round));
      } else
        issues.push({
          brickId: brick.id,
          code: 'unsupported',
          message: UNMOUNTED_MESSAGE,
        });
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
        !isArchInfill(other, brick) &&
        !isArchInfill(brick, other) &&
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
          tilted: 0,
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
  const next = added?.assembly ?? {
    ...assembly,
    bricks: [...assembly.bricks, brick],
  };
  const issues = added?.issues ?? validateAssembly(next);
  return issues.length ? { ok: false, issues } : { ok: true, assembly: next };
}

export function removeBrick(assembly: Assembly, brickId: string): PlacementResult {
  if (!assembly.bricks.some((brick) => brick.id === brickId)) {
    return {
      ok: false,
      issues: [{ brickId, code: 'invalid', message: 'Piece not found.' }],
    };
  }
  const next = {
    ...assembly,
    bricks: assembly.bricks.filter((brick) => brick.id !== brickId),
  };
  const issues = validateAssembly(next);
  return issues.length ? { ok: false, issues } : { ok: true, assembly: next };
}

export function getBillOfMaterials(assembly: Assembly) {
  const entries = new Map<string, { partId: string; color: number; quantity: number }>();
  for (const brick of assembly.bricks) {
    const key = `${brick.partId}:${brick.color}`;
    const entry = entries.get(key);
    if (entry) entry.quantity += 1;
    else
      entries.set(key, {
        partId: brick.partId,
        color: brick.color,
        quantity: 1,
      });
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
  if (brick.strung) {
    // The part's own x runs from one end stud to the other; leaning it that way keeps the plugs
    // upright, so the cord runs straight between end studs at different heights.
    const [a, b] = strungEnds(brick).map(([x, y, z]): Point => [x, -y, z]);
    const span = (part.width - 1) * 20;
    const along: Point = [(b[0] - a[0]) / span, (b[1] - a[1]) / span, (b[2] - a[2]) / span];
    const flat = Math.hypot(along[0], along[2]);
    const round = (value: number) => Math.round(value * 10000) / 10000 + 0;
    return {
      x: round((a[0] + b[0]) / 2),
      y: round((a[1] + b[1]) / 2),
      z: round((a[2] + b[2]) / 2),
      rotation: 0,
      matrix: [along[0], 0, -along[2] / flat, along[1], 1, 0, along[2], 0, along[0] / flat].map(
        round,
      ) as unknown as Matrix,
    };
  }
  if (brick.tilt) {
    // Placed upright, then turned about the hinge line; LDraw's y points down.
    const { tilt, ...rest } = brick;
    const upright = getLDrawTransform(rest);
    const flip: Matrix = [1, 0, 0, 0, -1, 0, 0, 0, 1];
    const turn = multiply(multiply(flip, tiltTurn(tilt)), flip);
    const round = (value: number) => Math.round(value * 10000) / 10000 + 0;
    const [x, y, z] = tiltPoint(tilt, [upright.x, -upright.y, upright.z]);
    return {
      x: round(x),
      y: round(-y),
      z: round(z),
      rotation: upright.rotation,
      matrix: multiply(turn, upright.matrix).map(round) as unknown as Matrix,
    };
  }
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
  if (brick.upsideDown) {
    // Turned as usual, then half round about the part's width through the middle of its cells.
    const turned = getLDrawTransform({ ...brick, upsideDown: undefined });
    const flip = brick.rotation % 180 === 0 ? [1, -1, -1] : [-1, -1, 1];
    const center = [
      (brick.x + size.width / 2) * 20,
      -(brick.y + size.height / 2) * 8,
      (brick.z + size.depth / 2) * 20,
    ];
    const [x, y, z] = [turned.x, turned.y, turned.z].map(
      (value, axis) => center[axis] + flip[axis] * (value - center[axis]) + 0,
    );
    return {
      x,
      y,
      z,
      rotation: turned.rotation,
      matrix: turned.matrix.map(
        (value, index) => flip[Math.floor(index / 3)] * value + 0,
      ) as unknown as Matrix,
    };
  }
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
