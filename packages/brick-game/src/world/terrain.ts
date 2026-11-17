import type { Brick } from '@brick-workshop/engine';
import { hash2 } from './noise.ts';

/**
 * A world's terrain, column by column, from its source: any stud column's height, water, biome
 * and climate follow from its world position and the seed, with no pass over a whole map. So the
 * world can be built a chunk at a time and every chunk agrees with its neighbours along their
 * shared edges.
 */

/** Brick layers of the tallest thing anywhere: a volcano's rim. */
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
  | 'lava'
  // Ground people made: roads, pavements and squares, gardens, and ploughed fields.
  | 'road'
  | 'pavement'
  | 'yard'
  | 'field';

/** Ground people made: no trees, plants, sights or caves on it, and trees keep their crowns off. */
export const BUILT_BIOMES: ReadonlySet<Biome> = new Set(['road', 'pavement', 'yard', 'field']);

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
  'road',
  'pavement',
  'yard',
  'field',
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
  /** A colour for the top that overrides the biome's own: road markings, crop rows. */
  paint?: number;
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

/**
 * The world is cut into regions, and each region holds at most one landform, well inside it, so
 * a landform never reaches into the next region and any column can tell which one it belongs to.
 */
export const REGION = 128;
/**
 * Something built that stands on the world: a house, a lighthouse, a bridge. Its pieces are in
 * world studs and plates, and it belongs to the chunk holding its anchor, which builds all of it.
 */
export interface Structure {
  /** Unique in the world, and the start of its pieces' IDs. */
  id: string;
  /** The stud whose chunk owns it. */
  anchor: { x: number; z: number };
  /** Its footprint, `[x0, x1)` by `[z0, z1)`, and its top, in plates. */
  bounds: { x0: number; z0: number; x1: number; z1: number; top: number; bottom: number };
  /** The colour the far view draws it in. */
  color: number;
  /** Its pieces. Built on demand: most structures are only ever seen from afar. */
  pieces: () => readonly Brick[];
}

/**
 * What shapes a world, which a game supplies: the ground, column by column, where the walker
 * starts, any volcanoes and structures. `NOISE_WORLD` (see `noise-world.ts`) is one made of noise;
 * a game may draw its own map instead.
 */
export interface WorldSource {
  column: (seed: number, x: number, z: number) => Column;
  start: { x: number; z: number };
  volcanoIn: (seed: number, rx: number, rz: number) => Volcano | null;
  /** Whether caves and undercut cliffs are carved. */
  caves: boolean;
  structuresIn?: (
    seed: number,
    x0: number,
    z0: number,
    x1: number,
    z1: number,
  ) => readonly Structure[];
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
  readonly source: WorldSource;
  private readonly bases = new Map<string, Column>();
  private readonly columns = new Map<string, Column>();
  private readonly candidates = new Map<string, TreeSpot | null>();
  private readonly kept = new Map<string, TreeSpot | null>();

  constructor(seed: number, source: WorldSource) {
    this.seed = seed;
    this.source = source;
  }

  /** Where the walker begins: land is kept round it. */
  get start(): { x: number; z: number } {
    return this.source.start;
  }

  /** The region's volcano, if it has one. */
  volcanoIn(rx: number, rz: number): Volcano | null {
    return this.source.volcanoIn(this.seed, rx, rz);
  }

  /** Whether the ground may be cut into caves and undercut cliffs. */
  get caves(): boolean {
    return this.source.caves;
  }

  /** Structures standing on the world, whose footprint meets this box of studs. */
  structuresIn(x0: number, z0: number, x1: number, z1: number): readonly Structure[] {
    return this.source.structuresIn?.(this.seed, x0, z0, x1, z1) ?? [];
  }

  /** How many columns and spots are remembered, so a long walk can start afresh. */
  get remembered() {
    return this.bases.size + this.columns.size + this.candidates.size;
  }

  base(x: number, z: number): Column {
    const key = `${x},${z}`;
    let column = this.bases.get(key);
    if (!column) this.bases.set(key, (column = this.source.column(this.seed, x, z)));
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
          // Trees level the ground round them, which a road or a garden must not be.
          if (BUILT_BIOMES.has(other.biome)) gentle = false;
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
