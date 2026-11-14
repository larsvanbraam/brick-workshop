import { fillVoxelModel, smoothAssembly, validateAssembly } from '@brick-workshop/engine';
import type { Assembly, Brick } from '@brick-workshop/engine';
import { addTree } from '@brick-workshop/engine/examples/trees';
import type { Box } from '@brick-workshop/engine/examples/trees';
import { fbm, hash2, random } from './noise.ts';

/** The world is one board this many studs across. */
export const WORLD_SIZE = 128;
/** Brick layers (three plates each) of the tallest peak. */
const MAX_LAYERS = 15;
/** The sea's surface, in brick layers: columns lower than this are under water. */
export const WATER_LAYERS = 3;

const COLOR = {
  grass: 2,
  darkGrass: 288,
  lightGrass: 326,
  sand: 19,
  darkSand: 28,
  soil: 70,
  rock: 71,
  darkRock: 72,
  lightRock: 151,
  snow: 15,
  seabed: 28,
  deepBed: 72,
  shallows: 73,
  sea: 1,
  deep: 272,
  bark: 70,
} as const;

/** At most this many trees: each is a couple of hundred pieces. */
const MAX_TREES = 24;
/** Studs round a trunk kept level for its roots, and kept clear of higher ground for its crown. */
const ROOTS = 2;
const CROWN = 5;

type Biome = 'sea' | 'beach' | 'meadow' | 'rock' | 'snow';

export interface WorldMap {
  seed: number;
  size: number;
  /** Brick layers of land per column, `heights[z * size + x]`. */
  heights: Uint8Array;
  biomes: Biome[];
  /** Clearings levelled for trees: the stud each trunk stands on. */
  trees: { x: number; z: number }[];
}

/** Heights and biomes: an island whose coast wanders, with hills and a rocky ridge or two. */
export function generateMap(seed: number, size = WORLD_SIZE): WorldMap {
  const heights = new Uint8Array(size * size);
  const biomes: Biome[] = new Array(size * size);
  const centre = (size - 1) / 2;
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) {
      // The coast: distance from the middle, warped by noise so bays and headlands form.
      const dx = (x - centre) / centre;
      const dz = (z - centre) / centre;
      const warp = (fbm(seed + 11, x, z, 48, 3) - 0.5) * 0.7;
      const distance = Math.hypot(dx, dz) + warp;
      const land = 1 - smoothstep(0.5, 0.98, distance);
      // Rolling meadows over the whole island, and a peak or two where a slow mask rises.
      const hills = fbm(seed + 23, x, z, 40, 3);
      const base = land * (1.2 + hills * 5.5);
      const peakMask =
        smoothstep(0.58, 0.85, fbm(seed + 41, x, z, 44, 2)) * smoothstep(0.5, 0.9, land);
      const peaks = peakMask * (4 + fbm(seed + 43, x, z, 12, 3) * 8);
      const layers = Math.max(1, Math.min(MAX_LAYERS, Math.round(1 + base + peaks)));
      // The board's own edge always stays sea.
      const edge = Math.min(x, z, size - 1 - x, size - 1 - z);
      const height = edge < 2 ? Math.min(layers, WATER_LAYERS - 1) : layers;
      heights[z * size + x] = height;
      biomes[z * size + x] =
        height < WATER_LAYERS
          ? 'sea'
          : height === WATER_LAYERS
            ? 'beach'
            : height >= 12
              ? 'snow'
              : height >= 9 || peakMask > 0.35
                ? 'rock'
                : 'meadow';
    }
  const map = { seed, size, heights, biomes, trees: [] };
  clearForTrees(map);
  return map;
}

/**
 * Picks spots for trees in the meadows, spaced apart, and levels each: the ground under the roots
 * flat, and nothing higher where the crown spreads, cut down to the trunk's footing.
 */
function clearForTrees(map: WorldMap) {
  const { size, heights, biomes, seed } = map;
  const next = random(seed * 31 + 7);
  // Every meadow stud in a shuffled order, so trees spread over the whole island.
  const candidates: { x: number; z: number; order: number }[] = [];
  for (let z = 8; z < size - 8; z++)
    for (let x = 8; x < size - 8; x++)
      if (biomes[z * size + x] === 'meadow') candidates.push({ x, z, order: next() });
  candidates.sort((a, b) => a.order - b.order);
  for (const { x, z } of candidates) {
    if (map.trees.length >= MAX_TREES) break;
    if (map.trees.some((spot) => Math.hypot(spot.x - x, spot.z - z) < 11)) continue;
    const height = heights[z * size + x];
    // Gentle ground only: meadow under the roots, at most a layer up or down round it.
    let gentle = true;
    for (let dz = -CROWN; dz <= CROWN && gentle; dz++)
      for (let dx = -CROWN; dx <= CROWN && gentle; dx++) {
        const index = (z + dz) * size + x + dx;
        const roots = Math.max(Math.abs(dx), Math.abs(dz)) <= ROOTS;
        if (heights[index] - height > 2) gentle = false;
        if (roots && (Math.abs(heights[index] - height) > 1 || biomes[index] !== 'meadow'))
          gentle = false;
      }
    if (!gentle) continue;
    for (let dz = -CROWN; dz <= CROWN; dz++)
      for (let dx = -CROWN; dx <= CROWN; dx++) {
        const index = (z + dz) * size + x + dx;
        const roots = Math.max(Math.abs(dx), Math.abs(dz)) <= ROOTS;
        if (roots || heights[index] > height) {
          heights[index] = height;
          biomes[index] = 'meadow';
        }
      }
    map.trees.push({ x, z });
  }
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * One of a material's shades, chosen in patches a few studs across so the ground reads as calm
 * areas rather than confetti: mostly the base, some shadow, a little highlight.
 */
function shade(seed: number, x: number, z: number, base: number, dark: number, light: number) {
  const patch = fbm(seed, x, z, 7, 2);
  if (patch < 0.3) return dark;
  if (patch > 0.74) return light;
  return base;
}

/** The colour of the cell `depth` layers below a column's top (0 is the top). */
function cellColor(map: WorldMap, x: number, z: number, depth: number): number {
  const index = z * map.size + x;
  const biome = map.biomes[index];
  const { seed } = map;
  if (biome === 'sea') {
    if (depth > 0) return COLOR.deepBed;
    return map.heights[index] === WATER_LAYERS - 1
      ? shade(seed + 1, x, z, COLOR.sand, COLOR.darkSand, COLOR.sand)
      : COLOR.seabed;
  }
  if (depth >= 3) return shade(seed + 2, x, z, COLOR.darkRock, COLOR.darkRock, COLOR.rock);
  switch (biome) {
    case 'beach':
      return depth === 0
        ? shade(seed + 3, x, z, COLOR.sand, COLOR.darkSand, COLOR.sand)
        : COLOR.darkSand;
    case 'meadow':
      return depth === 0
        ? shade(seed + 4, x, z, COLOR.grass, COLOR.darkGrass, COLOR.lightGrass)
        : COLOR.soil;
    case 'rock':
      return shade(seed + 5 + depth, x, z, COLOR.rock, COLOR.darkRock, COLOR.lightRock);
    case 'snow':
      return depth === 0
        ? shade(seed + 6, x, z, COLOR.snow, COLOR.lightRock, COLOR.snow)
        : shade(seed + 7, x, z, COLOR.rock, COLOR.darkRock, COLOR.lightRock);
  }
}

/** The sea's colour over a column `depth` layers under water: light at the shore, dark far out. */
function waterColor(map: WorldMap, x: number, z: number, depth: number) {
  const ripple = fbm(map.seed + 8, x, z, 9, 2) - 0.5;
  const shade = depth + ripple * 1.2;
  return shade < 1.3 ? COLOR.shallows : shade < 2.4 ? COLOR.sea : COLOR.deep;
}

export interface World {
  seed: number;
  assembly: Assembly;
  map: WorldMap;
  /** Where to start: a stud on dry land near the middle, in build-grid coordinates. */
  spawn: { x: number; z: number };
  /** IDs of the pieces that form the ground, as opposed to trees and what players add. */
  terrain: ReadonlySet<string>;
}

/**
 * The whole world for a seed: the island as brick layers, the sea as see-through bricks up to
 * its surface, slopes and round corners where the ground steps, flowers in the meadows, and
 * trees. Every piece rests on the one below, so the result validates like any build.
 */
export function generateWorld(seed: number): World {
  const map = generateMap(seed);
  const { size, heights } = map;
  const layers = MAX_LAYERS;
  const cells: (number | null)[] = new Array(size * size * layers).fill(null);
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) {
      const height = heights[z * size + x];
      for (let layer = 0; layer < height; layer++)
        cells[(layer * size + z) * size + x] = cellColor(map, x, z, height - 1 - layer);
      // Water up to the surface over the sea floor, darker where it is deeper.
      const water = waterColor(map, x, z, WATER_LAYERS - height);
      for (let layer = height; layer < WATER_LAYERS; layer++)
        cells[(layer * size + z) * size + x] = water;
    }
  const fill = fillVoxelModel(
    { name: `World ${seed}`, width: size, depth: size, layers, cells },
    { buildArea: size, details: false },
  );
  let assembly: Assembly = { ...fill.assembly, name: `World ${seed}` };
  const terrain = new Set(assembly.bricks.map((brick) => brick.id));
  // Trees first, on bare level ground, so smoothing then works round their roots.
  assembly = { ...assembly, bricks: [...assembly.bricks, ...plantTrees(map, assembly.bricks)] };

  // Round the land off: slopes against steps, round corners and flowers in the meadows, with
  // studs left open to build on. Only the ground counts, so the trees keep their shape.
  const smoothed = smoothAssembly(assembly, {
    ids: terrain,
    tiles: false,
    accents: true,
    accentDensity: 0.04,
    nextId: counter('ground'),
  });
  assembly = smoothed.assembly;
  for (const brick of smoothed.added) terrain.add(brick.id);
  return { seed, assembly, map, spawn: findSpawn(map), terrain };
}

function counter(prefix: string) {
  let next = 0;
  return () => `${prefix}-${next++}`;
}

/**
 * A tree on each clearing. They are checked together against the ground, and any tree with a
 * piece that does not fit is left out, until the rest all do.
 */
function plantTrees(map: WorldMap, ground: readonly Brick[]): Brick[] {
  const { size, heights, seed } = map;
  const next = random(seed * 53 + 3);
  /** What the trees planted so far take up, so each crown grows round its neighbours. */
  const around: Box[] = [];
  const crowns = [
    [288, 2, 2],
    [288, 2, 326],
    [288, 288, 2],
  ] as const;
  let trees = map.trees.map(({ x, z }, index) => {
    const pieces: Brick[] = [];
    const nextId = counter(`tree${index}`);
    const add = (
      partId: string,
      color: number,
      px: number,
      y: number,
      pz: number,
      rotation: Brick['rotation'] = 0,
      facing?: Brick['facing'],
    ) => {
      pieces.push({
        id: nextId(),
        partId,
        color,
        x: px,
        y,
        z: pz,
        rotation,
        ...(facing ? { facing } : {}),
      });
    };
    addTree(
      add,
      x,
      z,
      heights[z * size + x] * 3,
      crowns[Math.floor(hash2(seed, x, z) * crowns.length)],
      COLOR.bark,
      4 + Math.floor(next() * 4),
      Math.floor(next() * 1e6),
      around,
    );
    return pieces;
  });
  for (let round = 0; round < 6; round++) {
    const issues = validateAssembly({
      name: 'trees',
      bricks: [...ground, ...trees.flat()],
      buildArea: size,
    });
    if (!issues.length) break;
    const bad = new Set(issues.map((issue) => issue.brickId.split('-')[0]));
    trees = trees.filter((pieces) => !bad.has(pieces[0]?.id.split('-')[0]));
    if (round === 5) trees = [];
  }
  return trees.flat();
}

/** The dry stud closest to the middle of the island. */
function findSpawn(map: WorldMap): { x: number; z: number } {
  const { size, biomes } = map;
  const centre = Math.floor(size / 2);
  for (let radius = 0; radius < size / 2; radius++)
    for (let dz = -radius; dz <= radius; dz++)
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const x = centre + dx;
        const z = centre + dz;
        if (biomes[z * size + x] === 'meadow') return { x: x + 0.5, z: z + 0.5 };
      }
  return { x: centre, z: centre };
}
