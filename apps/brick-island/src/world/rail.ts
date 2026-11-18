import { traceTrack } from '@brick-workshop/engine';
import type { Brick, TrackPath } from '@brick-workshop/engine';
import { layTrack } from '@brick-workshop/engine/examples/layout';

/**
 * The railway on Brick Island: one big closed loop of 9V track, a rectangle of long straights
 * joined by four rounded corners (each four 22.5° curves of the 40 stud radius), about 370 by 145
 * studs. Its straights run along x or z only, so every section lies on the studs. It runs east
 * along the foot of the mountain above the speedway, down the east side, west along the north
 * edge of the town and north again up the lake's east shore, with a station for the speedway,
 * the city and the lake. Its ground is levelled to one layer all the way (see `column.ts`), and
 * the track stands on it.
 */

/** The layer the whole line is levelled to. */
export const RAIL_LAYER = 5;
/** Where the loop begins, the west end of its north side, heading east. */
const START = { x: 272, z: 170 } as const;
/** Straight sections along the east-west sides and the north-south sides. */
const ACROSS = 18;
const DOWN = 4;
const TRACK_COLOR = 72;
/** Studs between the points the ground corridor is drawn through. */
const SAMPLE = 4;

const CORNER = 'RRRR';
const ROUTE = `${'S'.repeat(ACROSS)}${CORNER}${'S'.repeat(DOWN)}${CORNER}${'S'.repeat(ACROSS)}${CORNER}${'S'.repeat(DOWN)}${CORNER}`;

function lay(): Brick[] {
  const bricks: Brick[] = [];
  layTrack(
    (partId, color, bx, by, bz, rotation = 0, _facing, _flipped, _tilt, _strung, yaw) => {
      bricks.push({
        id: `rail-${bricks.length}`,
        partId,
        color,
        x: bx,
        y: by,
        z: bz,
        rotation,
        ...(yaw ? { yaw } : {}),
      });
    },
    TRACK_COLOR,
    { x: START.x, z: START.z, y: RAIL_LAYER * 3, angle: 0 },
    ROUTE,
  );
  return bricks;
}

function sample(path: TrackPath) {
  const points: [number, number][] = [];
  const count = Math.round(path.length / SAMPLE);
  for (let i = 0; i <= count; i++) {
    const at = path.pointAt((i * path.length) / count);
    points.push([at.x, at.z]);
  }
  return points;
}

let built: { bricks: Brick[]; path: TrackPath; points: [number, number][] } | null = null;

/** The track pieces, their path, and the points the ground corridor follows. Worked out once. */
export function railway() {
  if (built) return built;
  const bricks = lay();
  const path = traceTrack({ bricks });
  built = { bricks, path, points: sample(path) };
  return built;
}

export interface StationSpot {
  id: string;
  name: string;
  /** Studs along the line to the middle of its platform. */
  distance: number;
  /** The track's centre line there, in world studs, and the way trains run past, in degrees:
   * 0 east, 90 south, 180 west, 270 north. */
  x: number;
  z: number;
  heading: 0 | 90 | 180 | 270;
  /** Which side of the way trains run the platform is on: 1 left, -1 right. */
  side: 1 | -1;
}

/** The distance along the line of the point nearest a spot of the world. */
function distanceNear(path: TrackPath, x: number, z: number) {
  let best = { distance: 0, gap: Infinity };
  for (let d = 0; d <= path.length; d += 0.5) {
    const at = path.pointAt(d);
    const gap = Math.hypot(at.x - x, at.z - z);
    if (gap < best.gap) best = { distance: d, gap };
  }
  return best.distance;
}

/**
 * The three stations, well apart round the loop (trains run clockwise): the Speedway's on the north
 * side above the oval, the City's on the south side under the town, with its platform on the
 * inside, and Mirror Lake's on the west side, on the lake's east shore, with its platform on the
 * inside too, away from the water.
 */
export function stationSpots(): StationSpot[] {
  const { path } = railway();
  const spot = (id: string, name: string, x: number, z: number, side: 1 | -1): StationSpot => {
    const distance = distanceNear(path, x, z);
    const at = path.pointAt(distance);
    const heading = ((Math.round(at.angle / 90) * 90) % 360) as 0 | 90 | 180 | 270;
    return { id, name, distance, x: Math.round(at.x), z: Math.round(at.z), heading, side };
  };
  const south = START.z + 40 * 2 + DOWN * 16;
  return [
    spot('city', 'City Station', 380, south, -1),
    spot('speedway', 'Speedway Station', 540, START.z, 1),
    spot('mirror-lake', 'Mirror Lake Station', START.x - 40, START.z + 40 + (DOWN * 16) / 2, -1),
  ];
}
