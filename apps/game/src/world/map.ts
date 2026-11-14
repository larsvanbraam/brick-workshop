import { fbm, hash2, random } from './noise.ts';

/** The world is one board this many studs across. */
export const WORLD_SIZE = 128;
/** Brick layers (three plates each) of the tallest mountain; a volcano rises higher. */
const PEAK_LAYERS = 15;
/** Brick layers of the tallest thing on any island: a volcano's rim. */
export const MAX_LAYERS = 22;
/** The sea's surface, in brick layers: columns lower than this are under water. */
export const WATER_LAYERS = 3;

export type Biome =
  | 'sea'
  | 'beach'
  | 'meadow'
  | 'forest'
  | 'desert'
  | 'marsh'
  | 'snow'
  | 'rock'
  | 'river'
  | 'volcanic'
  | 'lava';

/** Biomes a minifigure can stand in, as opposed to water. */
export const LAND_BIOMES: ReadonlySet<Biome> = new Set([
  'beach',
  'meadow',
  'forest',
  'desert',
  'marsh',
  'snow',
  'rock',
  'volcanic',
  'lava',
]);

/** A volcano: where its crater is, in studs, and the brick layers of its lava lake. */
export interface Volcano {
  x: number;
  z: number;
  /** Studs from the crater's middle to the foot of the cone. */
  radius: number;
  /** Brick layers up to the lava lake's surface; the rim stands three higher. */
  lake: number;
}

/** Roughly one island in this many has a volcano. */
const VOLCANO_ODDS = 8;
/** Studs from the crater's middle to its rim. */
const CRATER = 6;

export interface WorldMap {
  seed: number;
  size: number;
  /** Brick layers of land per column, `heights[z * size + x]`. */
  heights: Uint8Array;
  /** Brick layers up to the water's surface, or 0 where the column is dry. */
  water: Uint8Array;
  biomes: Biome[];
  /** 0 cold to 1 hot, and 0 dry to 1 wet, per column: they pick the biomes and the shades. */
  warmth: Float32Array;
  moisture: Float32Array;
  /** Clearings levelled for broadleaf trees: the stud each trunk stands on. */
  trees: { x: number; z: number }[];
  /** Each river's course, source to sea, for tests and debugging. */
  rivers: { x: number; z: number }[][];
  volcano: Volcano | null;
}

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * An island for a seed. Its coast wanders round bays and headlands; rolling hills cover it with a
 * peak or two. A climate laid over it (warmer or cooler, wetter or drier per island, and colder
 * higher up) decides where meadow, forest, desert, marsh and snow lie. Rivers then run from the
 * hills to the sea, and clearings are levelled for trees.
 */
export function generateMap(seed: number, size = WORLD_SIZE): WorldMap {
  const count = size * size;
  const heights = new Uint8Array(count);
  const water = new Uint8Array(count);
  const biomes: Biome[] = new Array(count);
  const warmth = new Float32Array(count);
  const moisture = new Float32Array(count);
  const peaks = new Float32Array(count);
  const centre = (size - 1) / 2;
  // Each island leans one way: a hot dry one is mostly desert, a cold wet one snow and marsh.
  const islandWarmth = (hash2(seed, 7, 1) - 0.5) * 0.36;
  const islandMoisture = (hash2(seed, 7, 2) - 0.5) * 0.3;
  const volcano: Volcano | null =
    hash2(seed, 11, 5) * VOLCANO_ODDS < 1
      ? {
          x: Math.round(centre + (hash2(seed, 11, 6) - 0.5) * 24),
          z: Math.round(centre + (hash2(seed, 11, 7) - 0.5) * 24),
          radius: 30,
          lake: MAX_LAYERS - 4,
        }
      : null;
  /** How far a column is from the crater's middle, with the cone's foot ragged. */
  const fromCrater = (x: number, z: number) =>
    volcano
      ? Math.hypot(x - volcano.x, z - volcano.z) + (fbm(seed + 91, x, z, 8, 2) - 0.5) * 5
      : Infinity;

  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) {
      const index = z * size + x;
      // The coast: distance from the middle, warped by noise so bays and headlands form.
      const dx = (x - centre) / centre;
      const dz = (z - centre) / centre;
      const warp = (fbm(seed + 11, x, z, 48, 3) - 0.5) * 0.7;
      const land = 1 - smoothstep(0.5, 0.98, Math.hypot(dx, dz) + warp);
      // Rolling hills over the whole island, and a peak or two where a slow mask rises.
      const hills = fbm(seed + 23, x, z, 40, 3);
      const base = land * (1.2 + hills * 5.5);
      const peakMask =
        smoothstep(0.58, 0.85, fbm(seed + 41, x, z, 44, 2)) * smoothstep(0.5, 0.9, land);
      peaks[index] = peakMask;
      const rise = peakMask * (4 + fbm(seed + 43, x, z, 12, 3) * 8);
      let layers = 1 + base + rise;
      // Mountains climb in terraces: flat shelves with sheer faces three bricks tall, their edges
      // wavering so the faces bend round the mountain.
      if (peakMask > 0.3 && layers > WATER_LAYERS + 3) {
        const above = layers - WATER_LAYERS - 1 + (fbm(seed + 45, x, z, 9, 2) - 0.5) * 2.4;
        layers = WATER_LAYERS + 1 + Math.round(above / 3) * 3;
      }
      // Here and there the coast rises straight out of the sea instead of ending on a beach.
      const cliffs = fbm(seed + 81, x, z, 30, 2);
      if (cliffs > 0.64 && land > 0.08)
        layers = Math.max(layers, WATER_LAYERS + 3 + (cliffs > 0.7 ? 1 : 0));
      layers = Math.max(1, Math.min(PEAK_LAYERS, Math.round(layers)));
      // A volcano's steep cone, its rim highest round the crater and its lake three layers down.
      const crater = fromCrater(x, z);
      if (volcano && crater < volcano.radius) {
        const rim = volcano.lake + 3;
        const slope = (crater - CRATER) / (volcano.radius - CRATER);
        const cone =
          crater < CRATER ? volcano.lake : WATER_LAYERS + (rim - WATER_LAYERS) * (1 - slope) ** 1.2;
        layers = crater < CRATER ? volcano.lake : Math.max(layers, Math.round(cone));
      }
      // The board's own edge always stays sea.
      const edge = Math.min(x, z, size - 1 - x, size - 1 - z);
      heights[index] = edge < 2 ? Math.min(layers, WATER_LAYERS - 1) : layers;
      // Colder higher up; the climate's own noise is broad, so biomes come in large areas.
      const height = heights[index];
      warmth[index] =
        fbm(seed + 51, x, z, 64, 2) + islandWarmth - Math.max(0, height - WATER_LAYERS - 3) * 0.045;
      moisture[index] = fbm(seed + 61, x, z, 56, 2) + islandMoisture;
    }

  for (let index = 0; index < count; index++)
    biomes[index] = biomeFor(heights[index], peaks[index], warmth[index], moisture[index]);
  // The volcano's cone is bare black rock, whatever the climate, with lava in its crater.
  if (volcano)
    for (let z = 0; z < size; z++)
      for (let x = 0; x < size; x++) {
        const index = z * size + x;
        const crater = fromCrater(x, z);
        if (crater < CRATER) biomes[index] = 'lava';
        else if (crater < volcano.radius * 0.85 && heights[index] > WATER_LAYERS)
          biomes[index] = 'volcanic';
      }

  const map: WorldMap = {
    seed,
    size,
    heights,
    water,
    biomes,
    warmth,
    moisture,
    trees: [],
    rivers: [],
    volcano,
  };
  if (volcano) pourLava(map, fromCrater);
  floodSea(map);
  flattenMarshes(map);
  carveRivers(map);
  clearForTrees(map);
  return map;
}

function biomeFor(height: number, peak: number, warmth: number, moisture: number): Biome {
  if (height < WATER_LAYERS) return 'sea';
  if (height === WATER_LAYERS) return warmth > 0.58 && moisture < 0.48 ? 'desert' : 'beach';
  if (height >= 12 || (height >= 9 && warmth < 0.42)) return 'snow';
  if (height >= 9 || peak > 0.35) return 'rock';
  if (warmth > 0.55 && moisture < 0.48) return 'desert';
  if (warmth < 0.3) return 'snow';
  if (moisture > 0.6 && height <= WATER_LAYERS + 2) return 'marsh';
  if (moisture > 0.5) return 'forest';
  return 'meadow';
}

/**
 * Lava flows: one or two tongues that spill through a notch in the rim and run down the cone
 * toward the sea, wavering as they go, two or three studs wide.
 */
function pourLava(map: WorldMap, fromCrater: (x: number, z: number) => number) {
  const { size, heights, biomes, seed } = map;
  const volcano = map.volcano!;
  const flows = 1 + Math.floor(hash2(seed, 13, 1) * 2);
  for (let flow = 0; flow < flows; flow++) {
    const heading = hash2(seed, 13, 2 + flow) * Math.PI * 2 + flow * Math.PI * 0.8;
    for (let reach = CRATER - 1; reach < volcano.radius + 4; reach += 0.5) {
      const angle = heading + Math.sin(reach * 0.35 + flow) * 0.22;
      const cx = volcano.x + Math.cos(angle) * reach;
      const cz = volcano.z + Math.sin(angle) * reach;
      const width = reach < volcano.radius * 0.5 ? 1 : 1.5;
      for (let dz = -2; dz <= 2; dz++)
        for (let dx = -2; dx <= 2; dx++) {
          const x = Math.round(cx + dx);
          const z = Math.round(cz + dz);
          if (x < 2 || z < 2 || x >= size - 2 || z >= size - 2) continue;
          if (Math.hypot(x - cx, z - cz) > width) continue;
          const index = z * size + x;
          if (heights[index] <= WATER_LAYERS) continue;
          // Through the rim, a notch down to the lake, so the lava has somewhere to spill from.
          if (fromCrater(x, z) < CRATER + 3)
            heights[index] = Math.min(heights[index], volcano.lake);
          biomes[index] = 'lava';
        }
    }
  }
}

/** The sea stands at its surface over every column below it. */
function floodSea(map: WorldMap) {
  for (let index = 0; index < map.heights.length; index++)
    if (map.heights[index] < WATER_LAYERS) map.water[index] = WATER_LAYERS;
}

/**
 * Marshes lie flat, a layer over the sea, with pools a layer deep in their hollows: the water is
 * level everywhere, so no pool stands above its neighbour.
 */
function flattenMarshes(map: WorldMap) {
  const { size, heights, water, biomes, seed } = map;
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) {
      const index = z * size + x;
      if (biomes[index] !== 'marsh') continue;
      heights[index] = WATER_LAYERS + 1;
      if (fbm(seed + 71, x, z, 6, 2) > 0.6) {
        heights[index] = WATER_LAYERS;
        water[index] = WATER_LAYERS + 1;
      }
    }
}

const STEPS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Rivers from the hills to the sea. Each starts high up and steps to the lowest neighbour,
 * drifting outward when the ground is level, until it reaches the sea. Its surface only ever
 * stays level or drops, a layer below the banks, so where the ground rises in its way it cuts a
 * gorge, and where the ground falls away it drops in a short fall. It is two studs wide, three
 * as it nears the sea.
 */
function carveRivers(map: WorldMap) {
  const { size, heights, water, biomes, seed } = map;
  const next = random(seed * 17 + 5);
  const wanted = 1 + Math.floor(hash2(seed, 9, 3) * 3);
  const centre = (size - 1) / 2;
  const sources: { x: number; z: number; order: number }[] = [];
  for (let z = 10; z < size - 10; z++)
    for (let x = 10; x < size - 10; x++) {
      const index = z * size + x;
      const height = heights[index];
      const biome = biomes[index];
      if (
        height >= WATER_LAYERS + 4 &&
        height <= 10 &&
        !['desert', 'volcanic', 'lava'].includes(biome)
      )
        sources.push({ x, z, order: next() });
    }
  sources.sort((a, b) => a.order - b.order);
  const taken: { x: number; z: number }[] = [];
  for (const source of sources) {
    if (map.rivers.length >= wanted) break;
    if (taken.some((spot) => Math.hypot(spot.x - source.x, spot.z - source.z) < 28)) continue;
    const course = traceRiver(map, source, centre, next);
    if (!course) continue;
    taken.push(source);
    map.rivers.push(course);
    let surface = heights[source.z * size + source.x] - 1;
    course.forEach(({ x, z }, step) => {
      const index = z * size + x;
      if (water[index] && biomes[index] === 'sea') return;
      surface = Math.max(WATER_LAYERS, Math.min(surface, heights[index] - 1));
      const wide = step > course.length * 0.6;
      const cells = wide
        ? [
            [0, 0],
            [1, 0],
            [0, 1],
            [-1, 0],
            [0, -1],
          ]
        : [
            [0, 0],
            [1, 0],
            [0, 1],
          ];
      for (const [dx, dz] of cells) {
        const cx = x + dx;
        const cz = z + dz;
        if (cx < 2 || cz < 2 || cx >= size - 2 || cz >= size - 2) continue;
        const cell = cz * size + cx;
        if (biomes[cell] === 'sea') continue;
        // Only where the ground stands at least as high as the river's bed, so the water always
        // has banks and never stands as a wall over lower ground.
        if (heights[cell] < surface) continue;
        heights[cell] = surface - 1;
        water[cell] = surface;
        biomes[cell] = 'river';
      }
    });
  }
}

function traceRiver(
  map: WorldMap,
  source: { x: number; z: number },
  centre: number,
  next: () => number,
): { x: number; z: number }[] | null {
  const { size, heights, biomes } = map;
  const course = [source];
  const seen = new Set([source.z * size + source.x]);
  let { x, z } = source;
  for (let step = 0; step < 400; step++) {
    let best: { x: number; z: number; score: number } | null = null;
    for (const [dx, dz] of STEPS) {
      const nx = x + dx;
      const nz = z + dz;
      const index = nz * size + nx;
      if (nx < 1 || nz < 1 || nx >= size - 1 || nz >= size - 1 || seen.has(index)) continue;
      // Downhill first; outward from the middle where it is level; a little wander.
      const outward = Math.hypot(nx - centre, nz - centre) - Math.hypot(x - centre, z - centre);
      const score = heights[index] * 4 - outward * 1.5 + next() * 1.2;
      if (!best || score < best.score) best = { x: nx, z: nz, score };
    }
    if (!best) return null;
    x = best.x;
    z = best.z;
    seen.add(z * size + x);
    course.push({ x, z });
    if (biomes[z * size + x] === 'sea') return course.length > 12 ? course : null;
  }
  return null;
}

/** At most this many broadleaf trees: each is a couple of hundred pieces. */
const MAX_TREES = 30;
/** Studs round a trunk kept level for its roots, and kept clear of higher ground for its crown. */
export const ROOTS = 2;
const CROWN = 5;
/** Trees stand closer together in a forest than out in a meadow. */
const SPACING: Partial<Record<Biome, number>> = { forest: 9, meadow: 14 };

/**
 * Picks spots for broadleaf trees in forests and meadows, spaced apart, and levels each: the
 * ground under the roots flat, and nothing higher where the crown spreads, cut down to the
 * trunk's footing. Never across a river.
 */
function clearForTrees(map: WorldMap) {
  const { size, heights, biomes, water, seed } = map;
  const next = random(seed * 31 + 7);
  const candidates: { x: number; z: number; order: number }[] = [];
  for (let z = 8; z < size - 8; z++)
    for (let x = 8; x < size - 8; x++)
      if (SPACING[biomes[z * size + x]]) candidates.push({ x, z, order: next() });
  candidates.sort((a, b) => a.order - b.order);
  for (const { x, z } of candidates) {
    if (map.trees.length >= MAX_TREES) break;
    const biome = biomes[z * size + x];
    const spacing = SPACING[biome]!;
    if (map.trees.some((spot) => Math.hypot(spot.x - x, spot.z - z) < spacing)) continue;
    const height = heights[z * size + x];
    let gentle = true;
    for (let dz = -CROWN; dz <= CROWN && gentle; dz++)
      for (let dx = -CROWN; dx <= CROWN && gentle; dx++) {
        const index = (z + dz) * size + x + dx;
        const roots = Math.max(Math.abs(dx), Math.abs(dz)) <= ROOTS;
        if (water[index] || heights[index] - height > 2) gentle = false;
        if (roots && (Math.abs(heights[index] - height) > 1 || !SPACING[biomes[index]]))
          gentle = false;
      }
    if (!gentle) continue;
    for (let dz = -CROWN; dz <= CROWN; dz++)
      for (let dx = -CROWN; dx <= CROWN; dx++) {
        const index = (z + dz) * size + x + dx;
        const roots = Math.max(Math.abs(dx), Math.abs(dz)) <= ROOTS;
        if (roots || heights[index] > height) {
          heights[index] = height;
          if (roots) biomes[index] = biome;
        }
      }
    map.trees.push({ x, z });
  }
}
