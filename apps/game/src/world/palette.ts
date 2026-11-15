import { fbm } from './noise.ts';
import { WATER_LAYERS } from './terrain.ts';
import type { Terrain } from './terrain.ts';

/** The colours of the ground, by the build standard's materials. */
export const COLOR = {
  grass: 2,
  darkGrass: 288,
  lightGrass: 326,
  olive: 330,
  sand: 19,
  darkSand: 28,
  nougat: 84,
  darkOrange: 484,
  soil: 70,
  darkSoil: 308,
  rock: 71,
  darkRock: 72,
  lightRock: 151,
  snow: 15,
  seabed: 28,
  shallows: 73,
  sea: 1,
  deep: 272,
  bark: 70,
  black: 0,
  lava: 25,
  lavaDark: 4,
  lavaBright: 14,
} as const;

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

/**
 * Sandstone in bands by height, so a desert outcrop's sides show its strata the way a mesa does:
 * dark orange, medium nougat and tan, with reddish brown low down, the bands wavering a little.
 */
function sandstone(seed: number, x: number, z: number, layer: number) {
  const bands = [COLOR.darkOrange, COLOR.nougat, COLOR.sand, COLOR.nougat, COLOR.darkOrange];
  const wobble = fbm(seed + 9, x, z, 11, 2) > 0.62 ? 1 : 0;
  if (layer + wobble <= WATER_LAYERS) return COLOR.soil;
  return bands[(layer + wobble) % bands.length];
}

/**
 * Rock and earth in layers by height, so a cliff face reads as strata, the way the reference
 * builds cut their bases away: dark bluish grey and light bluish grey with bands of tan and dark
 * tan, wavering a little from place to place.
 */
function strata(seed: number, x: number, z: number, layer: number) {
  const bands = [
    COLOR.darkRock,
    COLOR.rock,
    COLOR.rock,
    COLOR.sand,
    COLOR.darkRock,
    COLOR.darkSand,
    COLOR.rock,
  ];
  const wobble = fbm(seed + 19, x, z, 13, 2) > 0.6 ? 1 : 0;
  return bands[(layer + wobble) % bands.length];
}

/**
 * The colour of a column's cell `depth` layers below its top (0 is the top), `layer` brick
 * layers up from the board.
 */
export function cellColor(terrain: Terrain, x: number, z: number, depth: number, layer: number) {
  const column = terrain.column(x, z);
  const { biome } = column;
  const { seed } = terrain;
  const dry = column.warmth > 0.6 && column.moisture < 0.45;
  if (biome === 'sea' || biome === 'river') {
    if (depth > 0) return COLOR.darkRock;
    return column.water - column.height <= 1
      ? shade(seed + 1, x, z, COLOR.sand, COLOR.darkSand, COLOR.sand)
      : COLOR.seabed;
  }
  if (biome === 'lava') {
    if (depth > 0) return COLOR.black;
    // Molten orange with cooling red crust and bright yellow where it runs hottest.
    const patch = fbm(seed + 17, x, z, 4, 2);
    return patch < 0.36 ? COLOR.lavaDark : patch > 0.68 ? COLOR.lavaBright : COLOR.lava;
  }
  if (biome === 'volcanic')
    return depth === 0
      ? shade(seed + 18, x, z, COLOR.darkRock, COLOR.black, COLOR.darkRock)
      : layer % 3 === 0
        ? COLOR.darkRock
        : COLOR.black;
  if (depth >= 2) return dry ? sandstone(seed, x, z, layer) : strata(seed, x, z, layer);
  switch (biome) {
    case 'beach':
      return depth === 0
        ? shade(seed + 3, x, z, COLOR.sand, COLOR.darkSand, COLOR.sand)
        : COLOR.darkSand;
    case 'meadow':
      return depth === 0
        ? shade(seed + 4, x, z, COLOR.grass, COLOR.darkGrass, COLOR.lightGrass)
        : COLOR.soil;
    case 'forest':
      // A shadier floor than the meadow, with dark soil under it.
      return depth === 0
        ? shade(seed + 14, x, z, COLOR.darkGrass, COLOR.darkGrass, COLOR.grass)
        : COLOR.darkSoil;
    case 'marsh':
      return depth === 0
        ? shade(seed + 15, x, z, COLOR.olive, COLOR.darkGrass, COLOR.grass)
        : COLOR.darkSoil;
    case 'desert': {
      if (depth > 0) return depth === 1 ? COLOR.darkSand : sandstone(seed, x, z, layer);
      // Tan sand with dark tan hardpan, and here and there earth turned red.
      const patch = fbm(seed + 16, x, z, 9, 2);
      return patch < 0.32 ? COLOR.darkSand : patch > 0.78 ? COLOR.nougat : COLOR.sand;
    }
    case 'rock':
      if (dry) return sandstone(seed, x, z, layer);
      return depth === 0
        ? shade(seed + 5, x, z, COLOR.rock, COLOR.darkRock, COLOR.lightRock)
        : strata(seed, x, z, layer);
    case 'snow':
      return depth === 0
        ? shade(seed + 6, x, z, COLOR.snow, COLOR.lightRock, COLOR.snow)
        : shade(seed + 7, x, z, COLOR.rock, COLOR.darkRock, COLOR.lightRock);
  }
}

/** The water's colour over a column `depth` layers deep: light at the shore, dark far out. */
export function waterColor(seed: number, x: number, z: number, depth: number) {
  const ripple = fbm(seed + 8, x, z, 9, 2) - 0.5;
  const shaded = depth + ripple * 1.2;
  return shaded < 1.3 ? COLOR.shallows : shaded < 2.4 ? COLOR.sea : COLOR.deep;
}
