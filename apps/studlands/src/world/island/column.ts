import { fbm } from '../noise.ts';
import type { Biome, Column } from '../terrain.ts';
import {
  BEACHES,
  CENTRE,
  CLIFFS,
  COAST,
  FARM,
  FIELDS,
  FORESTS,
  HARBOUR,
  HILLS,
  LAKE,
  LIGHTHOUSE,
  LOOKOUT,
  PEAK,
  RIVER,
  ROADS,
  SPEEDWAY,
  SPEEDWAY_FLAT,
  SQUARE,
  TOWN,
} from './map.ts';
import type { Flat, Hill, Road, RoadPoint } from './map.ts';

/**
 * Brick Island's ground, column by column, from the drawn map: the coast and the sea round it,
 * hills and the terraced mountain, woods, beaches, the lake and the river, levelled ground for
 * the town, farm and speedway, and the roads over all of it with their verges blended into the
 * land. Noise only roughens what the map draws, so the island is the same every time.
 */

/** The sea's surface, in brick layers (`WATER_LAYERS`, kept here to stay clear of a cycle). */
const SEA = 3;
/** Studs either side of a road's tarmac over which the land is graded back to its own height. */
const VERGE = 7;
/** Studs either side of a town street that are pavement. */
const PAVEMENT = 3;

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** The coast's distance from the middle at an angle, curving smoothly between the drawn ones. */
function coastRadius(angle: number) {
  const step = (Math.PI * 2) / COAST.length;
  const at = (((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / step;
  const i = Math.floor(at);
  const t = at - i;
  const p = (k: number) => COAST[(((i + k) % COAST.length) + COAST.length) % COAST.length];
  const [p0, p1, p2, p3] = [p(-1), p(0), p(1), p(2)];
  // Catmull-Rom through the drawn radii.
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t)
  );
}

/** Studs inland from the coast: negative out at sea. */
export function inland(seed: number, x: number, z: number) {
  const dx = x - CENTRE.x;
  const dz = z - CENTRE.z;
  const wobble =
    (fbm(seed + 501, x, z, 46, 3) - 0.5) * 30 + (fbm(seed + 503, x, z, 11, 2) - 0.5) * 6;
  return coastRadius(Math.atan2(dz, dx)) + wobble - Math.hypot(dx, dz);
}

/** How much of a round area a point is in: 1 at the middle, 0 past its edge. */
const within = (area: { x: number; z: number; radius: number }, x: number, z: number) =>
  1 - smoothstep(area.radius * 0.6, area.radius, Math.hypot(x - area.x, z - area.z));

const rise = (hill: Hill, x: number, z: number) => {
  const t = Math.hypot(x - hill.x, z - hill.z) / hill.radius;
  return t >= 1 ? 0 : hill.height * (1 - t * t) ** 2;
};

/** How far into a flat area a point is: 1 inside, falling to 0 over its blend. */
function flatness(flat: Flat, x: number, z: number) {
  const outside = Math.hypot(
    Math.max(flat.x0 - x, 0, x - (flat.x1 - 1)),
    Math.max(flat.z0 - z, 0, z - (flat.z1 - 1)),
  );
  return 1 - smoothstep(0, flat.blend, outside);
}

const inside = (box: { x0: number; z0: number; x1: number; z1: number }, x: number, z: number) =>
  x >= box.x0 && x < box.x1 && z >= box.z0 && z < box.z1;

/** The nearest point on a polyline: its distance, the side it lies on, and the layer there. */
interface Nearest {
  distance: number;
  /** Signed distance across the line, positive to its right. */
  across: number;
  /** Studs along the line from its start. */
  along: number;
  layer: number;
}

interface Segment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  la: number;
  lb: number;
  /** Studs along the line where the segment starts. */
  start: number;
  road: Road;
}

function segmentsOf(points: readonly RoadPoint[], road: Road, loop = false): Segment[] {
  const segments: Segment[] = [];
  let start = 0;
  const count = loop ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    const [ax, az, la] = points[i];
    const [bx, bz, lb] = points[(i + 1) % points.length];
    segments.push({ ax, az, bx, bz, la, lb, start, road });
    start += Math.hypot(bx - ax, bz - az);
  }
  return segments;
}

function nearestOn(segment: Segment, x: number, z: number): Nearest {
  const { ax, az, bx, bz } = segment;
  const vx = bx - ax;
  const vz = bz - az;
  const length = Math.hypot(vx, vz) || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (length * length)));
  const px = ax + vx * t;
  const pz = az + vz * t;
  return {
    distance: Math.hypot(x - px, z - pz),
    across: ((x - ax) * vz - (z - az) * vx) / length,
    along: segment.start + t * length,
    layer: segment.la + (segment.lb - segment.la) * t,
  };
}

/** Road segments by cell of the map, so a column only looks at the roads near it. */
const CELL = 16;
const REACH = 6 + VERGE + PAVEMENT;
const roadCells = new Map<string, Segment[]>();
for (const road of ROADS)
  for (const segment of segmentsOf(road.points, road, road.loop)) {
    const x0 = Math.floor((Math.min(segment.ax, segment.bx) - REACH) / CELL);
    const x1 = Math.floor((Math.max(segment.ax, segment.bx) + REACH) / CELL);
    const z0 = Math.floor((Math.min(segment.az, segment.bz) - REACH) / CELL);
    const z1 = Math.floor((Math.max(segment.az, segment.bz) + REACH) / CELL);
    for (let cz = z0; cz <= z1; cz++)
      for (let cx = x0; cx <= x1; cx++) {
        const key = `${cx},${cz}`;
        const list = roadCells.get(key);
        if (list) list.push(segment);
        else roadCells.set(key, [segment]);
      }
  }
const riverSegments = segmentsOf(RIVER, { name: 'River', width: 3, points: RIVER });

/** The road nearest a stud, measured from the stud's middle, if any is within reach. */
export function nearestRoad(x: number, z: number): (Nearest & { road: Road }) | null {
  const segments = roadCells.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
  if (!segments) return null;
  let best: (Nearest & { road: Road }) | null = null;
  // Where roads meet, the nearer tarmac wins, so a junction's corners fill in.
  for (const segment of segments) {
    const near = nearestOn(segment, x + 0.5, z + 0.5);
    const edge = near.distance - segment.road.width / 2;
    if (!best || edge < best.distance - best.road.width / 2) best = { ...near, road: segment.road };
  }
  return best;
}

export function nearestRiver(x: number, z: number): Nearest {
  let best: Nearest | null = null;
  for (const segment of riverSegments) {
    const near = nearestOn(segment, x + 0.5, z + 0.5);
    if (!best || near.distance < best.distance) best = near;
  }
  return best!;
}

/** The river's channel: studs from its middle that hold water. */
export const CHANNEL = 2;
const VALLEY = 8;

/** The land's own height before roads and flats, and whether its coast is cliff. */
function landHeight(seed: number, x: number, z: number, coast: number) {
  const cliff = Math.max(...CLIFFS.map((area) => within(area, x, z)));
  const beachWidth = 8 + Math.max(...BEACHES.map((bay) => within(bay, x, z) * bay.width));
  // Rolling ground inland, low along the shore.
  const rolling = fbm(seed + 511, x, z, 52, 3) * 3.2 + (fbm(seed + 513, x, z, 17, 2) - 0.5) * 1.2;
  const inlandness = smoothstep(beachWidth - 4, beachWidth + 40, coast);
  let layers = SEA + 1 + rolling * inlandness;
  for (const hill of HILLS) layers += rise(hill, x, z);
  // The mountain: ridges running out from its summit, in terraces two layers tall.
  const peak = rise(PEAK, x, z);
  if (peak > 0) {
    const ridge = 1 - Math.abs(fbm(seed + 521, x, z, 26, 3) - 0.5) * 2;
    layers += peak * (0.75 + ridge * 0.35);
  }
  const shore = coast < beachWidth * 0.45 ? SEA : SEA + 1;
  let height = coast < beachWidth ? Math.min(shore, layers) : layers;
  // Where the coast is cliff, the land stands high right to the sea.
  if (cliff > 0.3) height = Math.max(height, SEA + 3 + Math.round(cliff * 3), layers);
  if (height > SEA + 6) height = SEA + 6 + Math.round((height - SEA - 6) / 2) * 2;
  return {
    height: Math.max(SEA, Math.round(height)),
    beach: coast < beachWidth && cliff <= 0.3,
    peak,
  };
}

function naturalBiome(seed: number, x: number, z: number, height: number, beach: boolean): Biome {
  if (beach && height <= SEA + 1) return 'beach';
  if (height >= SEA + 13) return 'snow';
  if (height >= SEA + 9) return 'rock';
  const woods = Math.max(...FORESTS.map((forest) => within(forest, x, z)));
  if (woods + (fbm(seed + 531, x, z, 14, 2) - 0.5) * 0.6 > 0.5) return 'forest';
  return 'meadow';
}

/** A column of the island. */
export function islandColumn(seed: number, x: number, z: number): Column {
  const climate = { warmth: 0.5, moisture: 0.5 };
  // A road always keeps land under it, with a stud of shore beside it, wherever the coast wanders.
  const kept = nearestRoad(x, z);
  const coast = Math.max(
    inland(seed, x, z),
    kept && kept.distance < kept.road.width / 2 + 3 ? 4 : -Infinity,
  );

  // The harbour basin: deep water with straight quays.
  if (inside(HARBOUR, x, z)) return { height: 1, water: SEA, biome: 'sea', ...climate };

  if (coast < 0) {
    // The sea floor shelves away from the shore.
    const height = coast > -8 ? 2 : coast > -26 ? 1 : 0;
    return { height, water: SEA, biome: 'sea', ...climate };
  }

  const land = landHeight(seed, x, z, coast);
  let height = land.height;
  let biome = naturalBiome(seed, x, z, height, land.beach);
  let water = 0;
  let paint: number | undefined;

  // Level ground for the town, farm, speedway, lookout and lighthouse, blending into the land.
  for (const flat of [TOWN, FARM, SPEEDWAY_FLAT, LOOKOUT, LIGHTHOUSE]) {
    const share = flatness(flat, x, z);
    if (share > 0) height = Math.round(height + (flat.layer - height) * share);
    if (share === 1 && biome === 'beach') biome = 'meadow';
  }

  // Mirror Lake, a layer up in the woods, with a bank round it.
  const lake = Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz);
  const shoreline = lake + (fbm(seed + 541, x, z, 9, 2) - 0.5) * 0.25;
  if (shoreline < 1) {
    height = shoreline < 0.55 ? LAKE.level - 3 : LAKE.level - 1 - (shoreline < 0.8 ? 1 : 0);
    water = LAKE.level;
    biome = 'river';
  } else if (shoreline < 1.35) {
    height = Math.max(height, LAKE.level);
    if (biome !== 'forest') biome = 'meadow';
  }

  // The river, with its valley sides dipping to its banks.
  const river = nearestRiver(x, z);
  const level = Math.round(river.layer);
  if (river.distance < VALLEY && water === 0) {
    const bank = Math.max(
      level,
      Math.round(level + (height - level) * smoothstep(CHANNEL, VALLEY, river.distance)),
    );
    height = Math.min(height, bank);
    if (river.distance < CHANNEL) {
      height = level - 1;
      water = level;
      biome = 'river';
    } else if (biome === 'beach' || biome === 'rock' || biome === 'snow') biome = 'meadow';
  }

  // Roads, and the verges graded between them and the land.
  const road = nearestRoad(x, z);
  if (road) {
    const half = road.road.width / 2;
    const roadLayer = Math.round(road.layer);
    const off = road.distance - half;
    const verge = road.road.street ? PAVEMENT : VERGE;
    if (off < 0) {
      if (water) {
        // A bridge carries the road over the river: the water runs on under it.
        height = roadLayer - 1;
        water = roadLayer;
        biome = 'river';
      } else {
        height = roadLayer;
        biome = 'road';
        water = 0;
        // A dashed white line down the middle, and a chequered line across the speedway.
        if (Math.abs(road.across) < 0.5 && Math.floor(road.along / 4) % 2 === 0) paint = 15;
        if (road.road.loop && road.along < 2) paint = (x + z) % 2 ? 0 : 15;
      }
    } else if (off < verge && !water) {
      if (road.road.street) {
        height = roadLayer;
        biome = 'pavement';
        if (off >= verge - 1) paint = 19;
      } else {
        // The verge is levelled near the road and rises or falls to the land further out.
        const share = smoothstep(1, verge, off);
        height = Math.round(roadLayer + (height - roadLayer) * share);
        if (off < 1.5 && biome !== 'forest') biome = 'meadow';
      }
    }
  }

  // The town: pavement round the harbour and in the square, gardens everywhere else.
  if (inside(TOWN, x, z) && biome !== 'road' && biome !== 'pavement' && !water) {
    height = TOWN.layer;
    const quay = x >= HARBOUR.x0 - 4 && x < HARBOUR.x1 + 4 && z >= HARBOUR.z0 - 4 && z < HARBOUR.z1;
    if (quay || inside(SQUARE, x, z)) biome = 'pavement';
    else biome = 'yard';
  }

  // The farm's fields, ploughed in rows of soil and green crops.
  for (const field of FIELDS)
    if (inside(field, x, z) && biome !== 'road' && !water) {
      height = FARM.layer;
      biome = 'field';
      const row = field.turn ? x - field.x0 : z - field.z0;
      paint = row % 3 === 2 ? 70 : field.turn ? 27 : 2;
    }

  // The speedway's infield is a lawn.
  const infield =
    Math.hypot(Math.max(Math.abs(x + 0.5 - SPEEDWAY.x) - SPEEDWAY.half, 0), z + 0.5 - SPEEDWAY.z) <
    SPEEDWAY.radius - SPEEDWAY.width / 2;
  if (infield && biome !== 'road' && biome !== 'pavement') biome = 'yard';

  if (biome === 'beach' && height > SEA + 1) biome = 'meadow';
  return {
    height: Math.max(1, height),
    water,
    biome,
    ...climate,
    ...(paint === undefined ? {} : { paint }),
  };
}
