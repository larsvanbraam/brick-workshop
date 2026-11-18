import { addRun } from '@brick-workshop/engine/examples/layout';
import type { Brick } from '@brick-workshop/engine';
import { hash2 } from '@brick-workshop/game/world/noise.ts';
import { RAIL_LAYER, stationSpots } from './rail.ts';
import type { StationSpot } from './rail.ts';

/**
 * The stations: a long platform beside the track, as high as the cab's floor so a minifigure steps
 * straight from it into the locomotive, with steps down at both ends. A gabled roof of red slopes
 * in two shades covers it, on brick posts with timber cross beams, tan gable ends, a ridge, a white
 * eave and a name board, over benches, planters and lamps. The platform stands on the left of the
 * way trains run.
 */

/** Studs along the platform, and across it from the track's centre line. */
const HALF = 24;
const NEAR = 4;
const FAR = 12;
/**
 * The platform's height above the ground, in plates: the cab floor, 10 plates over the track's top
 * (which stands a plate up on its bed of tiles).
 */
const TOP = 14;
/** The canopy's posts, in plates: low enough to reach, with room to stand under. */
const ROOF = 21;

const GROUND = RAIL_LAYER * 3;

type Add = Parameters<typeof addRun>[0];

/** A rectangle of world studs, `[x0, x1)` by `[z0, z1)`. */
interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/**
 * Local studs, `u` along the way trains run from the platform's middle and `v` out to the left of
 * the track's centre line, as a rectangle of the world.
 */
function rect(spot: StationSpot, u0: number, u1: number, v0: number, v1: number): Rect {
  const [fx, fz] = forward(spot);
  // `v` runs to the left of a train, turned by the side the platform is on.
  const [ax, az] = [fz * spot.side, -fx * spot.side];
  const at = (u: number, v: number): [number, number] => [
    spot.x + u * fx + v * ax,
    spot.z + u * fz + v * az,
  ];
  const [x0, z0] = at(u0, v0);
  const [x1, z1] = at(u1, v1);
  return {
    x0: Math.min(x0, x1),
    x1: Math.max(x0, x1),
    z0: Math.min(z0, z1),
    z1: Math.max(z0, z1),
  };
}

/** The way trains run past the station, as a step in the world: east is +x, south +z. */
const forward = (spot: StationSpot): [number, number] =>
  spot.heading === 0
    ? [1, 0]
    : spot.heading === 90
      ? [0, 1]
      : spot.heading === 180
        ? [-1, 0]
        : [0, -1];

/** The turn of a slope whose low side faces a step in the world (-z is 0, -x 90, +z 180, +x 270). */
const facing = ([dx, dz]: [number, number]): 0 | 90 | 180 | 270 =>
  dz < 0 ? 0 : dx < 0 ? 90 : dz > 0 ? 180 : 270;

/** The middle of the platform in the world, for the map. */
export function stationCentre(spot: StationSpot) {
  const area = rect(spot, -1, 1, NEAR, FAR);
  return { x: (area.x0 + area.x1) / 2, z: (area.z0 + area.z1) / 2 };
}

/** The ground the station stands on, levelled to the track's layer (a margin round the platform). */
export function stationFlat(spot: StationSpot): Rect {
  return rect(spot, -HALF - 8, HALF + 8, -6, FAR + 6);
}

/** One layer of runs along x over a rectangle. */
function fill(
  add: Add,
  kind: 'brick' | 'plate' | 'tile',
  color: number | ((x: number, z: number) => number),
  area: Rect,
  y: number,
  /** Studs to a patch of one colour, when the colour varies. */
  step = 2,
) {
  // Runs go along the longer way of the rectangle, so a platform running north-south is laid in
  // long pieces too, not in one-stud ones.
  const along = area.z1 - area.z0 > area.x1 - area.x0 ? 'z' : 'x';
  const [a0, a1, c0, c1] =
    along === 'x' ? [area.x0, area.x1, area.z0, area.z1] : [area.z0, area.z1, area.x0, area.x1];
  for (let across = c0; across < c1; across++) {
    const at = (position: number): [number, number] =>
      along === 'x' ? [position, across] : [across, position];
    if (typeof color === 'number') {
      const [x, z] = at(a0);
      addRun(add, kind, color, along, x, y, z, a1 - a0);
    } else
      for (let position = a0; position < a1; position += step) {
        const [x, z] = at(position);
        addRun(add, kind, color(x, z), along, x, y, z, Math.min(step, a1 - position));
      }
  }
}

/** A column of bricks and plates `height` plates tall over a rectangle. */
function column(add: Add, color: number, area: Rect, height: number) {
  let y = GROUND;
  for (; y + 3 <= GROUND + height; y += 3) fill(add, 'brick', color, area, y);
  for (; y < GROUND + height; y++) fill(add, 'plate', color, area, y);
}

/** The pieces of a station, in world studs. */
export function stationBricks(spot: StationSpot): Brick[] {
  const bricks: Brick[] = [];
  const add: Add = (partId, color, x, y, z, rotation = 0) => {
    bricks.push({ id: `station-${spot.id}-${bricks.length}`, partId, color, x, y, z, rotation });
  };
  const seed = spot.x * 7 + spot.z;
  const deck = rect(spot, -HALF, HALF, NEAR, FAR);

  // The platform: a hollow box, four courses of walls round its edge (a dark one at the foot, then
  // light grey), a deck of plates over it, tiled in tan and dark tan with a yellow edge along the
  // track. Nothing is built inside, where no one can go.
  const walls = [
    rect(spot, -HALF, HALF, NEAR, NEAR + 1),
    rect(spot, -HALF, HALF, FAR - 1, FAR),
    rect(spot, -HALF, -HALF + 1, NEAR + 1, FAR - 1),
    rect(spot, HALF - 1, HALF, NEAR + 1, FAR - 1),
  ];
  [72, 71, 71, 71].forEach((color, course) => {
    for (const wall of walls) fill(add, 'brick', color, wall, GROUND + course * 3);
  });
  fill(add, 'plate', 71, deck, GROUND + 12);
  fill(
    add,
    'tile',
    (x, z) => (hash2(seed, x, z) < 0.22 ? 28 : 19),
    rect(spot, -HALF, HALF, NEAR + 1, FAR),
    GROUND + TOP - 1,
    4,
  );
  fill(add, 'tile', 14, rect(spot, -HALF, HALF, NEAR, NEAR + 1), GROUND + TOP - 1);

  // Steps down at both ends, a stride of three plates each.
  [11, 8, 5, 2].forEach((height, index) => {
    for (const side of [-1, 1])
      column(
        add,
        71,
        side < 0
          ? rect(spot, -HALF - index - 1, -HALF - index, NEAR, FAR)
          : rect(spot, HALF + index, HALF + index + 1, NEAR, FAR),
        height,
      );
  });

  const top = GROUND + TOP;
  const roofY = top + ROOF;

  // A flight of steps down the back, to the town, a stride of three plates each.
  if (spot.access)
    [11, 8, 5, 2].forEach((height, index) =>
      column(add, 71, rect(spot, -3, 3, FAR + index, FAR + index + 1), height),
    );

  // Posts of a tan footing, brown shaft and dark cap along both edges, none within four studs of
  // the steps, so a clear lane runs from each flight to the middle of the platform.
  const courses = ROOF / 3;
  for (const u of [-20, -12, -4, 4, 12, 20])
    for (const v of [NEAR, FAR - 1]) {
      const post = rect(spot, u, u + 1, v, v + 1);
      for (let level = 0; level < courses; level++)
        fill(
          add,
          'brick',
          level === 0 ? 19 : level === courses - 1 ? 308 : 70,
          post,
          top + level * 3,
        );
      // A timber cross beam from each post to the one opposite, under the roof.
      if (v === NEAR) fill(add, 'brick', 70, rect(spot, u, u + 1, NEAR + 1, FAR - 1), roofY - 3);
    }

  // The roof: slopes in four courses either side, each a stud further in and three plates higher,
  // red in two shades, meeting in a ridge capped with tiles. The front, over the track side, has its
  // low edge one stud out past the platform edge.
  // The low side of the near slopes faces the track, of the far ones away from it.
  const [fx, fz] = forward(spot);
  const across: [number, number] = [fz * spot.side, -fx * spot.side];
  const front = facing([-across[0], -across[1]]);
  const back = facing(across);
  // Each course is laid in the longest slopes that fit, a different length first from course to
  // course so the joints do not line up, each piece in its own shade.
  const SLOPES: Record<number, string> = { 4: '3037', 3: '3038', 2: '3039', 1: '3040b' };
  for (let course = 0; course < 4; course++)
    for (const side of [1, 2]) {
      const [v0, turn] = side === 1 ? [NEAR - 1 + course, front] : [FAR - course - 1, back];
      let u = -HALF;
      let size = course % 3 === 0 ? 4 : course % 3;
      while (u < HALF) {
        size = Math.min(size, HALF - u);
        const piece = rect(spot, u, u + size, v0, v0 + 2);
        add(
          SLOPES[size]!,
          hash2(seed + side, u, course) < 0.3 ? 4 : 320,
          piece.x0,
          roofY + course * 3,
          piece.z0,
          turn,
        );
        u += size;
        size = 4;
      }
    }
  fill(add, 'tile', 70, rect(spot, -HALF, HALF, NEAR + 3, NEAR + 5), roofY + 12);
  // A white eave along the front and back.
  fill(add, 'tile', 15, rect(spot, -HALF, HALF, NEAR - 1, NEAR), roofY - 1);
  fill(add, 'tile', 15, rect(spot, -HALF, HALF, FAR, FAR + 1), roofY - 1);
  // Tan gable ends under the slopes, the lower course white, so the roof does not show hollow.
  for (const end of [-HALF, HALF - 1])
    for (let v = NEAR + 1; v < FAR - 1; v++) {
      const height = Math.min(v - NEAR, FAR - 1 - v);
      for (let level = 0; level < height; level++)
        fill(
          add,
          'brick',
          level === 0 ? 15 : 19,
          rect(spot, end, end + 1, v, v + 1),
          roofY + level * 3,
        );
    }
  // The name board hung between the middle posts: a white band over a red one.
  fill(add, 'brick', 15, rect(spot, -3, 3, NEAR, NEAR + 1), roofY - 6);
  fill(add, 'tile', 4, rect(spot, -3, 3, NEAR, NEAR + 1), roofY - 7);

  // Benches along the back, flower planters and lamps at the back corners: all clear of the lane.
  for (const start of [-16, -2, 12]) {
    fill(add, 'plate', 70, rect(spot, start, start + 4, FAR - 3, FAR - 2), top + 3);
    for (const u of [start, start + 3])
      fill(add, 'brick', 308, rect(spot, u, u + 1, FAR - 3, FAR - 2), top);
  }
  for (const u of [-9, 7]) {
    const box = rect(spot, u, u + 2, FAR - 3, FAR - 1);
    fill(add, 'brick', 70, box, top);
    fill(add, 'plate', 2, box, top + 3);
    [4, 14, 15, 13].forEach((flower, index) =>
      add('6141', flower, box.x0 + (index % 2), top + 4, box.z0 + (index > 1 ? 1 : 0)),
    );
  }
  for (const u of [-23, 21]) {
    const lamp = rect(spot, u, u + 2, FAR - 3, FAR - 1);
    add('2039', 0, lamp.x0, top, lamp.z0, 0);
  }
  return bricks;
}

let cached: { spot: StationSpot; bricks: Brick[] }[] | null = null;

/** Every station with its pieces, built once. */
export function stations() {
  cached ??= stationSpots().map((spot) => ({ spot, bricks: stationBricks(spot) }));
  return cached;
}
