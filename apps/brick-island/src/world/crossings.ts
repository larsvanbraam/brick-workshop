import { RAIL_LAYER, railway } from './rail.ts';
import { ROADS } from './map.ts';

/**
 * Where a road crosses the railway, the road is laid over the track so it can be driven across: the
 * cells of the road inside the track's width. The ground there stays at the track's own layer and
 * the cells either side of the rails are built up to the top of the track in plates and tiles, so
 * the road runs flush with the rails and wheels roll straight across.
 */

/** Studs from the track's centre line to its edge, and to the edge of the rails' trough. */
const HALF_TRACK = 4;
const RAILS = 2.5;

export interface CrossingCells {
  /** Cells either side of the rails, raised and tiled. */
  flank: ReadonlySet<string>;
  /** Cells between and under the rails, left at the track's layer. */
  trough: ReadonlySet<string>;
}

export const cellKey = (x: number, z: number) => `${x},${z}`;

function distanceToSegment(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const [vx, vz] = [bx - ax, bz - az];
  const length = vx * vx + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / length));
  return Math.hypot(x - (ax + vx * t), z - (az + vz * t));
}

let found: CrossingCells | null = null;

/** The cells of every road crossing, worked out once. */
export function crossings(): CrossingCells {
  if (found) return found;
  const { path } = railway();
  // Each cell the track covers, with how far its middle is from the track's centre line.
  const near = new Map<string, number>();
  for (let d = 0; d < path.length; d += 1) {
    const at = path.pointAt(d);
    for (let dz = -5; dz <= 5; dz++)
      for (let dx = -5; dx <= 5; dx++) {
        const [x, z] = [Math.floor(at.x) + dx, Math.floor(at.z) + dz];
        const gap = Math.hypot(x + 0.5 - at.x, z + 0.5 - at.z);
        const key = cellKey(x, z);
        if (gap <= HALF_TRACK + 0.5 && gap < (near.get(key) ?? Infinity)) near.set(key, gap);
      }
  }
  const roads = ROADS.filter((road) => !road.rail);
  const onRoad = (x: number, z: number) =>
    roads.some((road) => {
      const half = road.width / 2;
      for (let i = 0; i < road.points.length - 1; i++) {
        const [ax, az] = road.points[i]!;
        const [bx, bz] = road.points[i + 1]!;
        if (distanceToSegment(x + 0.5, z + 0.5, ax, az, bx, bz) < half) return true;
      }
      return false;
    });
  const flank = new Set<string>();
  const trough = new Set<string>();
  for (const [key, gap] of near) {
    const [x, z] = key.split(',').map(Number) as [number, number];
    if (!onRoad(x, z)) continue;
    (gap < RAILS ? trough : flank).add(key);
  }
  found = { flank, trough };
  return found;
}

/** How far a road climbs or falls to meet a crossing's deck, in studs; a layer to every four. */
const APPROACH = 12;

let approach: Map<string, number> | null = null;

/**
 * How many studs a cell is from a crossing's deck, up to a dozen, or null further away: a road is
 * stepped a layer for every four of them so that it meets the deck level.
 */
export function crossingApproach(x: number, z: number): number | null {
  if (!approach) {
    approach = new Map();
    const { flank, trough } = crossings();
    for (const key of [...flank, ...trough]) {
      const [cx, cz] = key.split(',').map(Number) as [number, number];
      for (let dz = -APPROACH; dz <= APPROACH; dz++)
        for (let dx = -APPROACH; dx <= APPROACH; dx++) {
          const at = cellKey(cx + dx, cz + dz);
          const gap = Math.max(Math.abs(dx), Math.abs(dz));
          if (gap < (approach.get(at) ?? Infinity)) approach.set(at, gap);
        }
    }
  }
  return approach.get(cellKey(x, z)) ?? null;
}

/**
 * The height a crossing cell is levelled to, in layers, or null off a crossing: the track's own
 * layer all across, with the flanks then built up to the top of the track in pavers.
 */
export function crossingLayer(x: number, z: number): number | null {
  const { flank, trough } = crossings();
  const key = cellKey(x, z);
  return flank.has(key) || trough.has(key) ? RAIL_LAYER : null;
}

/** A road crossing the railway: where its cells are, and which way the track runs through it. */
export interface Crossing {
  /** The middle of its cells, in world studs. */
  x: number;
  z: number;
  /** The axis the track runs along there, and half the crossing's length along it. */
  axis: 'x' | 'z';
  half: number;
}

let clusters: Crossing[] | null = null;

/**
 * The crossings one by one, each a group of neighbouring cells on a straight, axis-aligned stretch
 * of track (the barriers and signals stand on those; a crossing on a curve gets none).
 */
export function crossingList(): Crossing[] {
  if (clusters) return clusters;
  const { flank, trough } = crossings();
  const all = new Set([...flank, ...trough]);
  const seen = new Set<string>();
  const { path } = railway();
  clusters = [];
  for (const start of all) {
    if (seen.has(start)) continue;
    const cells: [number, number][] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const key = queue.pop()!;
      const [x, z] = key.split(',').map(Number) as [number, number];
      cells.push([x, z]);
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const next = cellKey(x + dx, z + dz);
          if (all.has(next) && !seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
    }
    const xs = cells.map(([x]) => x);
    const zs = cells.map(([, z]) => z);
    const [x0, x1, z0, z1] = [
      Math.min(...xs),
      Math.max(...xs) + 1,
      Math.min(...zs),
      Math.max(...zs) + 1,
    ];
    const [x, z] = [(x0 + x1) / 2, (z0 + z1) / 2];
    // The track's heading at the nearest point of the line.
    let nearest = { gap: Infinity, angle: 0 };
    for (let d = 0; d < path.length; d += 2) {
      const at = path.pointAt(d);
      const gap = Math.hypot(at.x - x, at.z - z);
      if (gap < nearest.gap) nearest = { gap, angle: at.angle };
    }
    const turn = ((nearest.angle % 180) + 180) % 180;
    const axis = turn < 1 || turn > 179 ? 'x' : Math.abs(turn - 90) < 1 ? 'z' : null;
    if (axis) clusters.push({ x, z, axis, half: (axis === 'x' ? x1 - x0 : z1 - z0) / 2 });
  }
  return clusters;
}
