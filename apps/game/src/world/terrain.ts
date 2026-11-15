import { fbm, hash2 } from './noise.ts';

/**
 * The world's terrain, column by column, from noise alone: any stud column's height, water,
 * biome and climate follow from its world position and the seed, with no pass over a whole map.
 * So the world can be built a chunk at a time and every chunk agrees with its neighbours along
 * their shared edges.
 */

/** Brick layers (three plates each) of the tallest mountain; a volcano rises higher. */
const PEAK_LAYERS = 15;
/** Brick layers of the tallest thing anywhere: a volcano's rim. */
export const MAX_LAYERS = 22;
/** The sea's surface, in brick layers: columns lower than this are under water. */
export const WATER_LAYERS = 3;
/** Where the world starts: land is kept round it, so the walker begins on an island. */
export const START = { x: 64, z: 64 } as const;

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

export interface Column {
  /** Brick layers of land. */
  height: number;
  /** Brick layers up to the water's surface, or 0 where the column is dry. */
  water: number;
  biome: Biome;
  /** 0 cold to 1 hot, and 0 dry to 1 wet. */
  warmth: number;
  moisture: number;
}

/** A volcano: where its crater is, in studs, and the brick layers of its lava lake. */
export interface Volcano {
  x: number;
  z: number;
  /** Studs from the crater's middle to the foot of the cone. */
  radius: number;
  /** Brick layers up to the lava lake's surface; the rim stands three higher. */
  lake: number;
}

/** Volcanoes stand one to a region at most, well inside it. */
export const REGION = 128;
/** Roughly one region in this many has a volcano. */
const VOLCANO_ODDS = 8;
/** Studs from the crater's middle to its rim. */
const CRATER = 6;

/**
 * Rivers follow where a broad noise crosses its middle: within `CHANNEL` of it the channel, within
 * `VALLEY` the valley sides dipping toward it. Narrow bands, so rivers are long and few.
 */
const RIVER_SCALE = 120;
const CHANNEL = 0.007;
const VALLEY = 0.026;

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** The region's volcano, if it has one: near the region's middle, so its cone stays inside. */
export function volcanoIn(seed: number, rx: number, rz: number): Volcano | null {
  if (hash2(seed + rx * 7919, 11, 5 + rz * 104729) * VOLCANO_ODDS >= 1) return null;
  return {
    x: Math.round(rx * REGION + REGION / 2 + (hash2(seed + rx, 11, 6 + rz) - 0.5) * 24),
    z: Math.round(rz * REGION + REGION / 2 + (hash2(seed + rx, 11, 7 + rz) - 0.5) * 24),
    radius: 30,
    lake: MAX_LAYERS - 4,
  };
}

/** The volcano whose region holds this column. */
export function volcanoAt(seed: number, x: number, z: number) {
  return volcanoIn(seed, Math.floor(x / REGION), Math.floor(z / REGION));
}

/**
 * Lava flows: one or two tongues per volcano that spill through a notch in the rim and wind down
 * the cone, two or three studs wide. Whether a column lies on one, from its distance and angle.
 */
function onLavaFlow(seed: number, volcano: Volcano, x: number, z: number) {
  const dx = x - volcano.x;
  const dz = z - volcano.z;
  const distance = Math.hypot(dx, dz);
  if (distance < CRATER - 1 || distance > volcano.radius + 4) return false;
  const angle = Math.atan2(dz, dx);
  const flows = 1 + Math.floor(hash2(seed + volcano.x, 13, 1 + volcano.z) * 2);
  for (let flow = 0; flow < flows; flow++) {
    const heading =
      hash2(seed + volcano.x, 13, 2 + flow + volcano.z) * Math.PI * 2 + flow * Math.PI * 0.8;
    const course = heading + Math.sin(distance * 0.35 + flow) * 0.22;
    let off = angle - course;
    off = Math.atan2(Math.sin(off), Math.cos(off));
    const width = distance < volcano.radius * 0.5 ? 1 : 1.5;
    if (Math.abs(off) * distance <= width + 0.5) return true;
  }
  return false;
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
 * A column before trees level the ground round them: continents and their coasts, rolling hills
 * with terraced peaks, sea cliffs, volcanoes, the climate and its biomes, flat marshes with pools,
 * and rivers in valleys.
 */
export function baseColumn(seed: number, x: number, z: number): Column {
  // Land where a slow continent map rises, warped so coasts wander round bays and headlands,
  // and always round the start, so the walker begins on an island.
  const start = 1 - smoothstep(28, 70, Math.hypot(x - START.x, z - START.z));
  const continent =
    fbm(seed + 3, x, z, 190, 4) - 0.5 + (fbm(seed + 11, x, z, 48, 3) - 0.5) * 0.35 + start * 0.45;
  const land = smoothstep(0.04, 0.22, continent);
  // Rolling hills, and a peak or two where a slow mask rises.
  const hills = fbm(seed + 23, x, z, 40, 3);
  const base = land * (1.2 + hills * 5.5);
  const peak = smoothstep(0.58, 0.85, fbm(seed + 41, x, z, 44, 2)) * smoothstep(0.5, 0.9, land);
  let layers = 1 + base + peak * (4 + fbm(seed + 43, x, z, 12, 3) * 8);
  // Mountains climb in terraces: flat shelves with sheer faces three bricks tall.
  if (peak > 0.3 && layers > WATER_LAYERS + 3) {
    const above = layers - WATER_LAYERS - 1 + (fbm(seed + 45, x, z, 9, 2) - 0.5) * 2.4;
    layers = WATER_LAYERS + 1 + Math.round(above / 3) * 3;
  }
  // Here and there the coast rises straight out of the sea instead of ending on a beach.
  const cliffs = fbm(seed + 81, x, z, 30, 2);
  if (cliffs > 0.64 && land > 0.08)
    layers = Math.max(layers, WATER_LAYERS + 3 + (cliffs > 0.7 ? 1 : 0));
  let height = Math.max(1, Math.min(PEAK_LAYERS, Math.round(layers)));

  // A volcano's steep cone, its rim highest round the crater and its lake three layers down.
  const volcano = volcanoAt(seed, x, z);
  let crater = Infinity;
  if (volcano) {
    crater = Math.hypot(x - volcano.x, z - volcano.z) + (fbm(seed + 91, x, z, 8, 2) - 0.5) * 5;
    if (crater < volcano.radius) {
      const rim = volcano.lake + 3;
      const slope = (crater - CRATER) / (volcano.radius - CRATER);
      height =
        crater < CRATER
          ? volcano.lake
          : Math.max(height, Math.round(WATER_LAYERS + (rim - WATER_LAYERS) * (1 - slope) ** 1.2));
    }
  }

  // Colder higher up; the climate's own noise is broad, so biomes come in large areas, and a
  // slower lean makes whole stretches hot and dry or cold and wet.
  const warmth =
    fbm(seed + 51, x, z, 64, 2) +
    (fbm(seed + 7, x, z, 320, 2) - 0.5) * 0.4 -
    Math.max(0, height - WATER_LAYERS - 3) * 0.045;
  const moisture = fbm(seed + 61, x, z, 56, 2) + (fbm(seed + 8, x, z, 300, 2) - 0.5) * 0.34;
  let biome = biomeFor(height, peak, warmth, moisture);
  let water = 0;

  if (volcano && crater < volcano.radius) {
    // The cone is bare black rock whatever the climate, with lava in its crater and its flows.
    if (crater < CRATER) biome = 'lava';
    else if (onLavaFlow(seed, volcano, x, z) && height > WATER_LAYERS) {
      biome = 'lava';
      // Through the rim, a notch down to the lake, so the lava has somewhere to spill from.
      if (crater < CRATER + 3) height = Math.min(height, volcano.lake);
    } else if (crater < volcano.radius * 0.85 && height > WATER_LAYERS) biome = 'volcanic';
  } else if (biome === 'marsh') {
    // Marshes lie flat, a layer over the sea, with pools a layer deep in their hollows.
    height = WATER_LAYERS + 1;
    if (fbm(seed + 71, x, z, 6, 2) > 0.6) {
      height = WATER_LAYERS;
      water = WATER_LAYERS + 1;
    }
  } else if (['meadow', 'forest', 'snow', 'beach'].includes(biome) && height <= 10) {
    // Rivers wind along valleys where a noise crosses its middle: the ground dips toward the
    // channel, and the channel holds water a layer below its banks.
    const valley = Math.abs(fbm(seed + 101, x, z, RIVER_SCALE, 3) - 0.5);
    if (valley < VALLEY) {
      const dip = Math.round((1 - smoothstep(CHANNEL, VALLEY, valley)) * 2);
      height = Math.max(WATER_LAYERS + 1, height - dip);
      if (valley < CHANNEL) {
        water = height;
        height -= 1;
        biome = 'river';
      }
    }
  }
  if (height < WATER_LAYERS) water = WATER_LAYERS;
  return { height, water, biome, warmth, moisture };
}

/** Studs between candidate tree spots: one spot to a cell of this size. */
const TREE_CELL = 9;
/**
 * Kept trees stand at least this far apart. Crowns of trees this close can still meet; where they
 * do, the weaker tree gives way (see `generateChunk`).
 */
const TREE_SPACING = 10;
/** Studs round a trunk kept level for its roots, and kept clear of higher ground for its crown. */
export const ROOTS = 2;
const CROWN = 5;
/** Ground a tree's roots may spread over. */
const GREEN: ReadonlySet<Biome> = new Set(['forest', 'meadow']);
/** Spots a cell tries before it gives up on a tree. */
const TREE_ATTEMPTS = 16;
/** How often a meadow cell grows a tree; a forest's always does if the ground suits it. */
const MEADOW_TREES = 0.5;

export interface TreeSpot {
  x: number;
  z: number;
  /** The ground's height at the trunk, which the roots are levelled to. */
  base: number;
  biome: Biome;
  /** Ties between spots too close together go to the higher. */
  priority: number;
}

/**
 * Columns and tree spots for one seed, worked out on demand and remembered. Trees stand on a
 * seeded grid: each cell offers one spot, taken when the ground round it suits a tree and no
 * stronger spot is too close. Any chunk asking about a spot gets the same answer, so a tree on a
 * chunk's edge is the same tree on both sides, and the ground round it is levelled alike.
 */
export class Terrain {
  readonly seed: number;
  private readonly bases = new Map<string, Column>();
  private readonly columns = new Map<string, Column>();
  private readonly candidates = new Map<string, TreeSpot | null>();
  private readonly kept = new Map<string, TreeSpot | null>();

  constructor(seed: number) {
    this.seed = seed;
  }

  base(x: number, z: number): Column {
    const key = `${x},${z}`;
    let column = this.bases.get(key);
    if (!column) this.bases.set(key, (column = baseColumn(this.seed, x, z)));
    return column;
  }

  /**
   * A cell's candidate spot: the first of a few seeded spots in the cell where the ground would
   * take a tree, or none.
   */
  private candidate(gx: number, gz: number): TreeSpot | null {
    const key = `${gx},${gz}`;
    if (this.candidates.has(key)) return this.candidates.get(key)!;
    const { seed } = this;
    let spot: TreeSpot | null = null;
    for (let attempt = 0; attempt < TREE_ATTEMPTS && !spot; attempt++) {
      const x = gx * TREE_CELL + Math.floor(hash2(seed + 201 + attempt * 31, gx, gz) * TREE_CELL);
      const z = gz * TREE_CELL + Math.floor(hash2(seed + 202 + attempt * 31, gx, gz) * TREE_CELL);
      const here = this.base(x, z);
      const grows =
        here.biome === 'forest' ||
        (here.biome === 'meadow' && hash2(seed + 204, gx, gz) < MEADOW_TREES);
      if (!grows || here.water) continue;
      // Gentle ground only: dry green ground under the roots, at most a layer up or down, and
      // nothing more than three layers higher where the crown spreads; the crown may hang over
      // water.
      let gentle = true;
      for (let dz = -CROWN; dz <= CROWN && gentle; dz++)
        for (let dx = -CROWN; dx <= CROWN && gentle; dx++) {
          const other = this.base(x + dx, z + dz);
          const roots = Math.max(Math.abs(dx), Math.abs(dz)) <= ROOTS;
          if (other.height - here.height > 3) gentle = false;
          if (
            roots &&
            (other.water || Math.abs(other.height - here.height) > 1 || !GREEN.has(other.biome))
          )
            gentle = false;
        }
      if (gentle)
        spot = {
          x,
          z,
          base: here.height,
          biome: here.biome,
          priority: hash2(seed + 203, gx, gz),
        };
    }
    this.candidates.set(key, spot);
    return spot;
  }

  /** A cell's tree, if its candidate is not crowded out by a stronger one nearby. */
  treeIn(gx: number, gz: number): TreeSpot | null {
    const key = `${gx},${gz}`;
    if (this.kept.has(key)) return this.kept.get(key)!;
    let spot = this.candidate(gx, gz);
    const reach = Math.ceil(TREE_SPACING / TREE_CELL);
    if (spot)
      for (let oz = -reach; oz <= reach && spot; oz++)
        for (let ox = -reach; ox <= reach && spot; ox++) {
          if (!ox && !oz) continue;
          const other = this.candidate(gx + ox, gz + oz);
          if (
            other &&
            Math.hypot(other.x - spot.x, other.z - spot.z) < TREE_SPACING &&
            other.priority > spot.priority
          )
            spot = null;
        }
    this.kept.set(key, spot);
    return spot;
  }

  /** The trees whose trunks stand in this box of studs, `[x0, x1)` by `[z0, z1)`. */
  treesIn(x0: number, z0: number, x1: number, z1: number): TreeSpot[] {
    const found: TreeSpot[] = [];
    for (let gz = Math.floor(z0 / TREE_CELL); gz <= Math.floor((z1 - 1) / TREE_CELL); gz++)
      for (let gx = Math.floor(x0 / TREE_CELL); gx <= Math.floor((x1 - 1) / TREE_CELL); gx++) {
        const spot = this.treeIn(gx, gz);
        if (spot && spot.x >= x0 && spot.x < x1 && spot.z >= z0 && spot.z < z1) found.push(spot);
      }
    return found;
  }

  /** A column as it stands: the base column, levelled round any tree near it. */
  column(x: number, z: number): Column {
    const key = `${x},${z}`;
    let column = this.columns.get(key);
    if (column) return column;
    column = this.base(x, z);
    // Water keeps its banks: a crown may hang over a river, but the river is not lowered.
    if (column.water) {
      this.columns.set(key, column);
      return column;
    }
    for (const tree of this.treesIn(x - CROWN, z - CROWN, x + CROWN + 1, z + CROWN + 1)) {
      const roots = Math.max(Math.abs(tree.x - x), Math.abs(tree.z - z)) <= ROOTS;
      if (roots) column = { ...column, height: tree.base, biome: tree.biome };
      else if (column.height > tree.base) column = { ...column, height: tree.base };
    }
    this.columns.set(key, column);
    return column;
  }
}
