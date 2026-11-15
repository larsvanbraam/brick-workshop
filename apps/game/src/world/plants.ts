import { getConnectionSites, getWorldBounds } from '@brick-workshop/engine';
import type { Brick, Rotation } from '@brick-workshop/engine';
import { addTree } from '@brick-workshop/engine/examples/trees';
import { hash2, random } from './noise.ts';
import { COLOR } from './palette.ts';
import { LAND_BIOMES } from './terrain.ts';
import type { Biome, Terrain, TreeSpot } from './terrain.ts';

/** A plant's pieces, kept or left out together. */
export type Plant = Brick[];

type Adder = (
  partId: string,
  color: number,
  x: number,
  y: number,
  z: number,
  rotation?: Rotation,
  facing?: Brick['facing'],
) => void;

function collector(prefix: string) {
  const pieces: Plant = [];
  let next = 0;
  const add: Adder = (partId, color, x, y, z, rotation = 0, facing) => {
    pieces.push({
      id: `${prefix}-${next++}`,
      partId,
      color,
      x,
      y,
      z,
      rotation,
      ...(facing ? { facing } : {}),
    });
  };
  return { pieces, add };
}

/** Where a part goes so its first receiver sits on the stud at (sx, sz): plants sit off-grid. */
function seat(partId: string, rotation: Rotation, sx: number, sz: number) {
  const [site] = getConnectionSites(
    { id: '', partId, color: 0, x: 0, y: 0, z: 0, rotation },
    'bottom',
  );
  return { x: sx + 0.5 - site.x, z: sz + 0.5 - site.z };
}

const CROWNS = [
  [288, 2, 2],
  [288, 2, 326],
  [288, 288, 2],
] as const;

/**
 * The broadleaf tree on a spot. Its shape is seeded from the spot alone, so every chunk that
 * builds it, its own or a neighbour checking what overhangs, builds the same tree.
 */
export function treeAt(terrain: Terrain, spot: TreeSpot, prefix: string): Plant {
  const { seed } = terrain;
  const { pieces, add } = collector(prefix);
  addTree(
    add,
    spot.x,
    spot.z,
    spot.base * 3,
    CROWNS[Math.floor(hash2(seed, spot.x, spot.z) * CROWNS.length)],
    COLOR.bark,
    4 + Math.floor(hash2(seed + 205, spot.x, spot.z) * 4),
    Math.floor(hash2(seed + 206, spot.x, spot.z) * 1e6),
  );
  return pieces;
}

/**
 * A cactus from round bricks: a trunk two to four bricks tall, and often an arm, a plate laid
 * across from the trunk with round bricks rising from its far end and the trunk going on up.
 */
function cactus(add: Adder, x: number, z: number, base: number, next: () => number) {
  const color = next() < 0.7 ? COLOR.grass : COLOR.olive;
  const trunk = 2 + Math.floor(next() * 3);
  const arm = trunk >= 3 && next() < 0.65 ? 1 + Math.floor(next() * (trunk - 2)) : 0;
  let y = base;
  for (let level = 0; level < trunk; level++) {
    if (arm && level === arm) {
      // The arm's plate turns toward a side picked per cactus; the trunk stands on its near end.
      const toward = next() < 0.5 ? 1 : -1;
      add('3023b', color, toward > 0 ? x : x - 1, y, z, 90);
      y += 1;
      const ax = x + toward;
      for (let up = 0; up < 2; up++) add('3062b', color, ax, y + up * 3, z);
      add('6141', color, ax, y + 6, z);
    }
    add('3062b', color, x, y, z);
    y += 3;
  }
  add('6141', color, x, y, z);
}

/** Loose stones: what scree is made of, small to large. */
const STONES = ['6141', '3024', '3062b', '3005', '3004'] as const;

const CHANCES: Partial<Record<Biome, number>> = {
  desert: 0.035,
  forest: 0.05,
  meadow: 0.008,
  snow: 0.04,
  marsh: 0.05,
};

/**
 * What grows in a chunk besides its trees: per biome cacti and scrub, conifers, bushes, reeds and
 * lily pads, and scree at the foot of cliffs. Each lies wholly inside the chunk, so it can never
 * meet what a neighbouring chunk grows.
 */
function smallPlants(
  terrain: Terrain,
  x0: number,
  z0: number,
  size: number,
  trees: readonly TreeSpot[],
): Plant[] {
  const { seed } = terrain;
  const next = random(seed * 97 + 11 + Math.imul(x0, 73856093) + Math.imul(z0, 19349663));
  const plants: Plant[] = [];
  const taken: { x: number; z: number; r: number }[] = trees.map(({ x, z }) => ({ x, z, r: 6 }));
  const free = (x: number, z: number, r: number) =>
    taken.every((spot) => Math.hypot(spot.x - x, spot.z - z) >= Math.max(r, spot.r));
  /**
   * Dry ground of one biome round a stud: level within `reach`, and nothing higher out to
   * `clear`, where a wide plant (a conifer's skirt) would reach into the hillside.
   */
  const level = (x: number, z: number, reach: number, biome: Biome, clear = reach) => {
    const { height } = terrain.column(x, z);
    for (let dz = -clear; dz <= clear; dz++)
      for (let dx = -clear; dx <= clear; dx++) {
        const other = terrain.column(x + dx, z + dz);
        if (other.height > height || other.water) return false;
        if (Math.max(Math.abs(dx), Math.abs(dz)) > reach) continue;
        if (other.height !== height || other.biome !== biome) return false;
      }
    return true;
  };
  const inside = (pieces: Plant) =>
    pieces.every((brick) => {
      const bounds = getWorldBounds(brick);
      return (
        bounds.minX >= x0 - 1e-6 &&
        bounds.minZ >= z0 - 1e-6 &&
        bounds.maxX <= x0 + size + 1e-6 &&
        bounds.maxZ <= z0 + size + 1e-6
      );
    });
  let index = 0;
  let stones = 0;
  for (let z = z0; z < z0 + size; z++)
    for (let x = x0; x < x0 + size; x++) {
      const column = terrain.column(x, z);
      const { biome, water, height } = column;
      // Lily pads float on the marsh pools.
      if (biome === 'marsh' && water && next() < 0.08 && free(x, z, 1)) {
        const { pieces, add } = collector(`plant${index++}`);
        add('6141', next() < 0.6 ? COLOR.grass : COLOR.lightGrass, x, water * 3, z);
        plants.push(pieces);
        taken.push({ x, z, r: 1 });
        continue;
      }
      // Scree at the foot of a face three or more layers high.
      if (!water && biome !== 'lava' && LAND_BIOMES.has(biome)) {
        const below = [
          terrain.column(x + 1, z),
          terrain.column(x - 1, z),
          terrain.column(x, z + 1),
          terrain.column(x, z - 1),
        ].some((other) => other.height - height >= 3);
        if (below && next() < 0.3) {
          const stone = STONES[Math.floor(next() ** 1.6 * STONES.length)];
          const colors: readonly number[] =
            biome === 'volcanic'
              ? [COLOR.black, COLOR.darkRock]
              : [COLOR.rock, COLOR.rock, COLOR.darkRock, COLOR.lightRock];
          const rotation: Rotation = next() < 0.5 ? 0 : 90;
          // A two-stud stone turned across x needs its far stud on this column's level too.
          const across = stone === '3004' && rotation === 90 ? x + 1 : x;
          const { pieces, add } = collector(`plants${stones++}`);
          add(
            stone,
            colors[Math.floor(next() * colors.length)],
            x,
            height * 3,
            z,
            stone === '3004' ? rotation : 0,
          );
          if (terrain.column(across, z).height === height && inside(pieces)) plants.push(pieces);
          continue;
        }
      }
      const chance = CHANCES[biome];
      if (!chance || water || next() >= chance) continue;
      const base = height * 3;
      const { pieces, add } = collector(`plant${index++}`);
      let reach = 0;
      if (biome === 'desert') {
        if (!free(x, z, 4) || !level(x, z, 1, biome)) continue;
        if (next() < 0.7) cactus(add, x, z, base, next);
        else {
          // Dry scrub.
          const spot = seat('6064', 0, x, z);
          add('6064', COLOR.olive, spot.x, base, spot.z);
        }
        reach = 4;
      } else if (biome === 'snow' || (biome === 'forest' && next() < 0.35)) {
        // Conifers: in the snow, and among the broadleaves at the forest's edge.
        if (!free(x, z, 5) || !level(x, z, 0, biome, 2)) continue;
        const kind = next() < 0.8 ? '3471' : '3470';
        const spot = seat(kind, 0, x, z);
        add(kind, COLOR.darkGrass, spot.x, base, spot.z);
        reach = 5;
      } else if (biome === 'marsh') {
        // Reeds.
        if (!free(x, z, 2) || !level(x, z, 0, biome, 2)) continue;
        const rotation: Rotation = next() < 0.5 ? 0 : 90;
        const spot = seat('30093', rotation, x, z);
        add('30093', next() < 0.6 ? COLOR.olive : COLOR.darkGrass, spot.x, base, spot.z, rotation);
        reach = 2;
      } else {
        // Bushes in the forest and the odd one out in the meadow.
        if (!free(x, z, 3) || !level(x, z, 1, biome)) continue;
        const spot = seat('6064', 0, x, z);
        add('6064', next() < 0.6 ? COLOR.darkGrass : COLOR.grass, spot.x, base, spot.z);
        reach = 3;
      }
      if (!inside(pieces)) continue;
      plants.push(pieces);
      taken.push({ x, z, r: reach });
    }
  return plants;
}

/**
 * Everything that grows in a chunk: the broadleaf trees whose trunks stand in it, and its small
 * plants and scree. Also the trees of neighbouring chunks that reach over its edges, which it
 * does not own but must keep clear of, and every tree's priority by its ID's prefix, for settling
 * crowns that meet.
 */
export function plantChunk(
  terrain: Terrain,
  x0: number,
  z0: number,
  size: number,
): { plants: Plant[]; nearby: Brick[]; priorities: Map<string, number> } {
  const own = terrain.treesIn(x0, z0, x0 + size, z0 + size);
  // A crown spreads up to about eight studs from its trunk, so two crowns can meet when their
  // trunks stand up to twice that apart: every tree that close to the chunk is looked at.
  const reach = 16;
  const around = terrain
    .treesIn(x0 - reach, z0 - reach, x0 + size + reach, z0 + size + reach)
    .filter((spot) => !own.includes(spot));
  const priorities = new Map<string, number>();
  const plants = own.map((spot, index) => {
    priorities.set(`tree${index}`, spot.priority);
    return treeAt(terrain, spot, `tree${index}`);
  });
  plants.push(...smallPlants(terrain, x0, z0, size, [...own, ...around]));
  const nearby = around.flatMap((spot, index) => {
    priorities.set(`nearby${index}`, spot.priority);
    return treeAt(terrain, spot, `nearby${index}`);
  });
  return { plants, nearby, priorities };
}

/** Whether a piece is a plant rather than ground or something a player built. */
export const isPlant = (brick: Brick) => /^(tree|plant)s?\d/.test(brick.id);
