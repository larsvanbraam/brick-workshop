import { createExampleAssembly, getWorldBounds } from '@brick-workshop/engine';
import type { Brick } from '@brick-workshop/engine';
import { hash2, random } from '@brick-workshop/game/world/noise.ts';
import type { Structure } from '@brick-workshop/game/world/terrain.ts';
import { CHANNEL, islandColumn, nearestRiver, nearestRoad } from './column.ts';
import { buildFireStation, buildPoliceStation, FIRE_STATION, POLICE_STATION } from './civic.ts';
import { buildHouse, turnPieces } from './houses.ts';
import { addRun } from '@brick-workshop/engine/examples/layout';
import { crossingList, crossings } from './crossings.ts';
import { RAIL_LAYER, railway } from './rail.ts';
import { stations } from './stations.ts';
import type { HousePlan, Piece } from './houses.ts';
import {
  FARM,
  FIRE_STATION_AT,
  LIGHTHOUSE,
  POLICE_STATION_AT,
  ROADS,
  SQUARE,
  TOWN,
} from './map.ts';

/**
 * What stands on Brick Island: the town's houses along its streets, the fire station and the
 * police station on Main Street, the farmhouse and barn,
 * the lighthouse on its point and the flower stall in the square (two of the workshop's example
 * builds), bridges where roads cross the river, and lampposts along the streets.
 */

/** House colours, by the build standard's town palettes: walls, their shade, upper storey, trim. */
const WALLS: readonly [number, number, number, number][] = [
  [15, 19, 19, 71], // white render with a tan upper storey
  [19, 28, 15, 15], // tan with white
  [70, 308, 19, 19], // red-brown brick, tan
  [378, 15, 15, 15], // sand green shopfront
  [84, 70, 15, 19], // nougat brick
  [379, 15, 15, 15], // sand blue
  [15, 151, 335, 71], // white with a sand red upper storey
  [72, 71, 15, 15], // grey stone
];
const ROOFS: readonly [number, number][] = [
  [320, 4],
  [72, 71],
  [70, 308],
  [378, 330],
  [0, 72],
  [272, 72],
];

interface Placed {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  /** Plates up to its foot, and its height in plates. */
  y: number;
  height: number;
  color: number;
  build: () => readonly Piece[];
  /** Studs round it that street furniture keeps clear of: a doorway or bays on the pavement. */
  clear?: number;
}

const columnOf = (seed: number, x: number, z: number) => islandColumn(seed, x, z);

/** Whether a footprint stands on level ground of the given layer, all of it yard or meadow. */
function fitsOn(seed: number, x0: number, z0: number, width: number, depth: number, layer: number) {
  for (let z = z0 - 1; z < z0 + depth + 1; z++)
    for (let x = x0 - 1; x < x0 + width + 1; x++) {
      const column = columnOf(seed, x, z);
      const under = x >= x0 && x < x0 + width && z >= z0 && z < z0 + depth;
      if (column.water || column.height !== layer) return false;
      if (under && column.biome !== 'yard' && column.biome !== 'meadow') return false;
      if (!under && column.biome === 'road') return false;
    }
  return true;
}

const overlaps = (a: Placed, b: Placed, gap: number) =>
  a.x < b.x + b.width + gap &&
  b.x < a.x + a.width + gap &&
  a.z < b.z + b.depth + gap &&
  b.z < a.z + a.depth + gap;

function housePlan(seed: number, index: number, width: number, depth: number): HousePlan {
  const next = random(Math.floor(hash2(seed + 601, index, 3) * 1e9));
  const [wall, wallShade, upper, trim] = WALLS[Math.floor(next() * WALLS.length)];
  const [roof, roofLight] = ROOFS[Math.floor(next() * ROOFS.length)];
  return {
    width,
    depth,
    storeys: next() < 0.55 ? 2 : 1,
    wall,
    wallShade,
    upper,
    trim,
    roof,
    roofLight,
    frame: wall === 15 ? 72 : 15,
  };
}

/** A house facing its street, turned so its door opens onto it. */
function house(
  seed: number,
  index: number,
  plan: HousePlan,
  x: number,
  z: number,
  quarters: number,
  layer: number,
): Placed {
  const turned = quarters % 2 === 1;
  return {
    id: `house${index}`,
    x,
    z,
    width: turned ? plan.depth : plan.width,
    depth: turned ? plan.width : plan.depth,
    y: layer * 3,
    height: plan.storeys * 22 + (plan.depth / 2 + 1) * 3,
    color: plan.roof,
    build: () => {
      const next = random(Math.floor(hash2(seed + 603, index, 5) * 1e9));
      return turnPieces(buildHouse(plan, next), quarters, plan.width, plan.depth);
    },
  };
}

/**
 * Houses along both sides of every town street, set back a stud behind the pavement, wherever
 * a lot is level garden with room round it.
 */
function townHouses(seed: number, placed: Placed[]) {
  let index = 0;
  for (const road of ROADS) {
    if (!road.street) continue;
    const [[ax, az], [bx, bz]] = road.points;
    const alongX = az === bz;
    const from = Math.min(alongX ? ax : az, alongX ? bx : bz);
    const to = Math.max(alongX ? ax : az, alongX ? bx : bz);
    const line = alongX ? az : ax;
    // The street's edge plus its pavement, and a stud of front garden.
    const setback = Math.floor(road.width / 2) + 5;
    for (const side of [-1, 1]) {
      let at = from + 6;
      while (at < to - 6) {
        const pick = hash2(seed + 611, at, line * 2 + side);
        const width = [8, 10, 10, 12][Math.floor(pick * 4)];
        const depth = pick > 0.5 ? 8 : 6;
        const plan = housePlan(seed, index, width, depth);
        // The front faces the street: across x for a street along x, across z otherwise.
        const front = side < 0 ? setback : setback;
        const x = alongX ? at : side < 0 ? line - front - depth : line + front;
        const z = alongX ? (side < 0 ? line - front - depth : line + front) : at;
        const quarters = alongX ? (side < 0 ? 0 : 2) : side < 0 ? 1 : 3;
        const candidate = house(seed, index, plan, x, z, quarters, TOWN.layer);
        if (
          fitsOn(seed, candidate.x, candidate.z, candidate.width, candidate.depth, TOWN.layer) &&
          placed.every((other) => !overlaps(candidate, other, 2))
        ) {
          placed.push(candidate);
          index++;
          at += width + 2 + Math.floor(hash2(seed + 613, at, line) * 3);
        } else at += 2;
      }
    }
  }
  return index;
}

/** One of the workshop's example builds, without its base plate, standing on the ground. */
function example(
  id: string,
  exampleId: string,
  x: number,
  z: number,
  layer: number,
  color: number,
  height: number,
): Placed {
  return {
    id,
    x,
    z,
    width: 16,
    depth: 16,
    y: layer * 3,
    height,
    color,
    build: () =>
      createExampleAssembly(exampleId)
        .bricks.filter((brick) => brick.y > 0)
        .map((brick) => ({ ...brick, y: brick.y - 1 })),
  };
}

/** A hand-built town building on Main Street, its front on the pavement. */
function civic(
  seed: number,
  id: string,
  at: { x: number; z: number },
  size: { width: number; depth: number },
  color: number,
  build: (next: () => number) => Piece[],
): Placed {
  const next = random(Math.floor(hash2(seed + 617, at.x, at.z) * 1e9));
  const pieces = build(next);
  return {
    id,
    x: at.x,
    z: at.z,
    width: size.width,
    depth: size.depth,
    y: TOWN.layer * 3,
    height: Math.max(...pieces.map((piece) => getWorldBounds({ ...piece, id: '' }).maxY)),
    color,
    build: () => pieces,
    clear: 4,
  };
}

/** Where roads cross the river: a deck over the water, and a low parapet along each side. */
function bridges(seed: number): Placed[] {
  const cells = new Map<string, { x: number; z: number; layer: number; edge: boolean }>();
  for (let z = 100; z < 540; z++)
    for (let x = 300; x < 520; x++) {
      if (nearestRiver(x, z).distance >= CHANNEL + 1) continue;
      const road = nearestRoad(x, z);
      if (!road || road.distance >= road.road.width / 2) continue;
      const column = columnOf(seed, x, z);
      if (!column.water) continue;
      cells.set(`${x},${z}`, {
        x,
        z,
        layer: column.water,
        edge: road.distance >= road.road.width / 2 - 1,
      });
    }
  // Neighbouring cells make one bridge.
  const groups: { x: number; z: number; layer: number; edge: boolean }[][] = [];
  const seen = new Set<string>();
  for (const [key, cell] of cells) {
    if (seen.has(key)) continue;
    const group = [cell];
    seen.add(key);
    for (let i = 0; i < group.length; i++)
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const other = `${group[i].x + dx},${group[i].z + dz}`;
        if (cells.has(other) && !seen.has(other)) {
          seen.add(other);
          group.push(cells.get(other)!);
        }
      }
    groups.push(group);
  }
  return groups.map((group, index) => {
    const x0 = Math.min(...group.map((cell) => cell.x));
    const z0 = Math.min(...group.map((cell) => cell.z));
    const x1 = Math.max(...group.map((cell) => cell.x)) + 1;
    const z1 = Math.max(...group.map((cell) => cell.z)) + 1;
    const layer = group[0].layer;
    return {
      id: `bridge${index}`,
      x: x0,
      z: z0,
      width: x1 - x0,
      depth: z1 - z0,
      y: layer * 3,
      height: 5,
      color: 71,
      build: () =>
        group.flatMap((cell) => {
          const deck: Piece = {
            partId: '3070b',
            color: 72,
            x: cell.x - x0,
            y: 0,
            z: cell.z - z0,
            rotation: 0,
          };
          if (!cell.edge) return [deck];
          const post: Piece = {
            partId: '3024',
            color: 71,
            x: cell.x - x0,
            y: 0,
            z: cell.z - z0,
            rotation: 0,
          };
          return [
            post,
            { ...post, partId: '3005', y: 1 },
            { ...post, partId: '3070b', color: 151, y: 4 },
          ];
        }),
    };
  });
}

/** Lampposts along the town streets, on alternate sides, every so often. */
function lamps(seed: number, placed: readonly Placed[]): Placed[] {
  const found: Placed[] = [];
  for (const road of ROADS) {
    if (!road.street) continue;
    const [[ax, az], [bx, bz]] = road.points;
    const alongX = az === bz;
    const from = Math.min(alongX ? ax : az, alongX ? bx : bz);
    const to = Math.max(alongX ? ax : az, alongX ? bx : bz);
    const line = alongX ? az : ax;
    const edge = Math.floor(road.width / 2) + 1;
    let side = 1;
    for (let at = from + 10; at < to - 8; at += 18) {
      const off = side > 0 ? edge : -edge - 2;
      const x = alongX ? at : line + off;
      const z = alongX ? line + off : at;
      side = -side;
      const lamp: Placed = {
        id: `lamp${found.length}`,
        x,
        z,
        width: 2,
        depth: 2,
        y: TOWN.layer * 3,
        height: 21,
        color: 0,
        build: () => [{ partId: '2039', color: 0, x: 0, y: 0, z: 0, rotation: 0 }],
      };
      let level = true;
      for (let dz = 0; dz < 2; dz++)
        for (let dx = 0; dx < 2; dx++) {
          const column = columnOf(seed, x + dx, z + dz);
          if (column.biome !== 'pavement' || column.height !== TOWN.layer) level = false;
        }
      if (level && [...placed, ...found].every((other) => !overlaps(lamp, other, other.clear ?? 0)))
        found.push(lamp);
    }
  }
  return found;
}

function layout(seed: number): Placed[] {
  const placed: Placed[] = [
    example(
      'lighthouse',
      'seaside-lighthouse',
      LIGHTHOUSE.x0 + 3,
      LIGHTHOUSE.z0 + 2,
      LIGHTHOUSE.layer,
      15,
      69,
    ),
    example('stall', 'flower-stall', SQUARE.x0 + 18, SQUARE.z0 + 10, TOWN.layer, 4, 40),
    civic(seed, 'fire-station', FIRE_STATION_AT, FIRE_STATION, 4, buildFireStation),
    civic(seed, 'police-station', POLICE_STATION_AT, POLICE_STATION, 71, buildPoliceStation),
  ];
  // The farm: a farmhouse by the lane and a big red barn behind it.
  const farmhouse = housePlan(seed, 900, 10, 8);
  placed.push(
    house(
      seed,
      900,
      {
        ...farmhouse,
        storeys: 2,
        wall: 15,
        wallShade: 151,
        upper: 15,
        trim: 70,
        roof: 70,
        roofLight: 308,
      },
      156,
      286,
      3,
      FARM.layer,
    ),
  );
  placed.push(
    house(
      seed,
      901,
      {
        width: 16,
        depth: 12,
        storeys: 1,
        wall: 320,
        wallShade: 4,
        upper: 320,
        trim: 15,
        roof: 72,
        roofLight: 71,
        frame: 15,
      },
      160,
      300,
      3,
      FARM.layer,
    ),
  );
  townHouses(seed, placed);
  placed.push(...bridges(seed));
  placed.push(...lamps(seed, placed));
  return placed;
}

const cache = new Map<number, Structure[]>();

/** The railway's track, a structure for each section so every chunk builds the pieces in it. */
function railStructures(): Structure[] {
  return railway().bricks.map((brick) => {
    const bounds = getWorldBounds(brick);
    return {
      id: brick.id,
      anchor: { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 },
      bounds: {
        x0: Math.floor(bounds.minX),
        z0: Math.floor(bounds.minZ),
        x1: Math.ceil(bounds.maxX),
        z1: Math.ceil(bounds.maxZ),
        bottom: bounds.minY,
        top: bounds.maxY,
      },
      color: brick.color,
      pieces: () => [brick],
    };
  });
}

/**
 * The pavers of each road crossing: two plates and a tile over the ground either side of the rails,
 * which brings the road flush with the top of the track. One structure to a 16 stud block so each
 * chunk builds the ones it holds.
 */
function crossingStructures(): Structure[] {
  const blocks = new Map<string, Set<string>>();
  for (const key of crossings().flank) {
    const [x, z] = key.split(',').map(Number) as [number, number];
    const block = `${Math.floor(x / 16)},${Math.floor(z / 16)}`;
    blocks.set(block, (blocks.get(block) ?? new Set()).add(key));
  }
  const ground = RAIL_LAYER * 3;
  return [...blocks].map(([block, cells]) => {
    const tiles: Brick[] = [];
    const add = (partId: string, color: number, x: number, y: number, z: number, rotation = 0) => {
      tiles.push({
        id: `crossing-${block}-${tiles.length}`,
        partId,
        color,
        x,
        y,
        z,
        rotation: rotation as Brick['rotation'],
      });
    };
    const found = [...cells].map((key) => key.split(',').map(Number) as [number, number]);
    // Runs of neighbouring cells along x, laid in the longest pieces that fit.
    const rows = new Map<number, number[]>();
    for (const [x, z] of found) rows.set(z, [...(rows.get(z) ?? []), x]);
    for (const [z, xs] of rows) {
      xs.sort((a, b) => a - b);
      for (let i = 0; i < xs.length;) {
        let end = i;
        while (end + 1 < xs.length && xs[end + 1] === xs[end]! + 1) end++;
        const [x0, length] = [xs[i]!, end - i + 1];
        addRun(add, 'plate', 71, 'x', x0, ground, z, length);
        addRun(add, 'plate', 71, 'x', x0, ground + 1, z, length);
        addRun(add, 'tile', 71, 'x', x0, ground + 2, z, length);
        i = end + 1;
      }
    }
    const xs = found.map(([x]) => x);
    const zs = found.map(([, z]) => z);
    return {
      id: `crossing-${block}`,
      anchor: { x: xs[0]!, z: zs[0]! },
      bounds: {
        x0: Math.min(...xs),
        z0: Math.min(...zs),
        x1: Math.max(...xs) + 1,
        z1: Math.max(...zs) + 1,
        bottom: ground,
        top: ground + 3,
      },
      color: 72,
      pieces: () => tiles,
    };
  });
}

/**
 * The barriers and signals of each crossing, as at a toy level crossing: on opposite corners, a
 * grey housing with a tall red and white striped barrier pole standing up, and beside it a mast
 * with a cross sign and two red lights.
 */
function crossingGates(seed: number): Structure[] {
  return crossingList().map((crossing, index) => {
    const pieces: Brick[] = [];
    const add = (partId: string, color: number, x: number, y: number, z: number, rotation = 0) => {
      pieces.push({
        id: `gate-${index}-${pieces.length}`,
        partId,
        color,
        x,
        y,
        z,
        rotation: rotation as Brick['rotation'],
      });
    };
    const { axis, half } = crossing;
    // Each corner in the track's own frame: `u` along the track, `v` across it, then in the world.
    for (const side of [1, -1]) {
      const u = side * (half + 1.5);
      const v = side * 6.5;
      const [bx, bz] =
        axis === 'x' ? [crossing.x + u, crossing.z + v] : [crossing.x + v, crossing.z + u];
      const [x, z] = [Math.floor(bx), Math.floor(bz)];
      const ground = columnOf(seed, x, z).height * 3;
      // The housing, then the barrier pole of round bricks, red and white in turn.
      add('3003', 72, x, ground, z);
      add('3003', 72, x, ground + 3, z);
      for (let level = 0; level < 12; level++)
        add('3062b', level % 2 ? 15 : 4, x, ground + 6 + level * 3, z);
      // The signal mast two studs along the track, outward, with a cross sign and red lights.
      const [mx, mz] = axis === 'x' ? [x + side * 3, z] : [x, z + side * 3];
      const mastGround = columnOf(seed, mx, mz).height * 3;
      for (let level = 0; level < 6; level++) add('3062b', 72, mx, mastGround + level * 3, mz);
      const top = mastGround + 18;
      const along = axis === 'x' ? 'x' : 'z';
      // The cross: a post of alternating bricks with an arm across it, along the track.
      for (let level = 0; level < 4; level++)
        add('3005', level % 2 ? 15 : 4, mx, top + level * 3, mz);
      const arm = (offset: number, length: number, color: number) =>
        addRun(
          add,
          'brick',
          color,
          along,
          axis === 'x' ? mx + offset : mx,
          top + 3,
          axis === 'x' ? mz : mz + offset,
          length,
        );
      arm(-2, 1, 4);
      arm(-1, 3, 15);
      arm(2, 1, 4);
      // Two red lights on a bar across the top.
      add('3005', 0, mx, top + 12, mz);
      for (const light of [-1, 1])
        add('6141', 36, axis === 'x' ? mx + light : mx, top + 15, axis === 'x' ? mz : mz + light);
    }
    const bounds = pieces.map((piece) => getWorldBounds(piece));
    return {
      id: `gate-${index}`,
      anchor: { x: crossing.x, z: crossing.z },
      bounds: {
        x0: Math.floor(Math.min(...bounds.map((b) => b.minX))),
        z0: Math.floor(Math.min(...bounds.map((b) => b.minZ))),
        x1: Math.ceil(Math.max(...bounds.map((b) => b.maxX))),
        z1: Math.ceil(Math.max(...bounds.map((b) => b.maxZ))),
        bottom: Math.min(...bounds.map((b) => b.minY)),
        top: Math.max(...bounds.map((b) => b.maxY)),
      },
      color: 4,
      pieces: () => pieces,
    };
  });
}

/** The stations, split into one structure to a 16 stud block like the crossings. */
function stationStructures(): Structure[] {
  return stations().flatMap(({ spot, bricks }) => {
    const blocks = new Map<string, Brick[]>();
    for (const brick of bricks) {
      const block = `${Math.floor(brick.x / 16)},${Math.floor(brick.z / 16)}`;
      blocks.set(block, [...(blocks.get(block) ?? []), brick]);
    }
    return [...blocks].map(([block, pieces]) => {
      const bounds = pieces.map((piece) => getWorldBounds(piece));
      return {
        id: `station-${spot.id}-${block}`,
        anchor: { x: pieces[0]!.x, z: pieces[0]!.z },
        bounds: {
          x0: Math.floor(Math.min(...bounds.map((b) => b.minX))),
          z0: Math.floor(Math.min(...bounds.map((b) => b.minZ))),
          x1: Math.ceil(Math.max(...bounds.map((b) => b.maxX))),
          z1: Math.ceil(Math.max(...bounds.map((b) => b.maxZ))),
          bottom: Math.min(...bounds.map((b) => b.minY)),
          top: Math.max(...bounds.map((b) => b.maxY)),
        },
        color: 71,
        pieces: () => pieces,
      };
    });
  });
}

/** Every structure on the island, worked out once per seed. */
export function islandStructures(seed: number): readonly Structure[] {
  let structures = cache.get(seed);
  if (structures) return structures;
  structures = layout(seed).map((placed) => {
    let pieces: Brick[] | null = null;
    const build = () => {
      pieces ??= placed.build().map((piece, index) => ({
        ...piece,
        id: `${placed.id}-${index}`,
        x: piece.x + placed.x,
        y: piece.y + placed.y,
        z: piece.z + placed.z,
      }));
      return pieces;
    };
    return {
      id: placed.id,
      anchor: { x: placed.x, z: placed.z },
      bounds: {
        x0: placed.x,
        z0: placed.z,
        x1: placed.x + placed.width,
        z1: placed.z + placed.depth,
        bottom: placed.y,
        top: placed.y + placed.height,
      },
      color: placed.color,
      pieces: build,
    };
  });
  structures = [
    ...structures,
    ...railStructures(),
    ...crossingStructures(),
    ...crossingGates(seed),
    ...stationStructures(),
  ];
  cache.set(seed, structures);
  return structures;
}

/** The real top of a structure, from its pieces: for the far view. */
export function structureTop(structure: Structure) {
  let top = structure.bounds.bottom;
  for (const piece of structure.pieces()) top = Math.max(top, getWorldBounds(piece).maxY);
  return top;
}

export function islandStructuresIn(seed: number, x0: number, z0: number, x1: number, z1: number) {
  return islandStructures(seed).filter(
    (structure) =>
      structure.bounds.x0 < x1 &&
      structure.bounds.x1 > x0 &&
      structure.bounds.z0 < z1 &&
      structure.bounds.z1 > z0,
  );
}
