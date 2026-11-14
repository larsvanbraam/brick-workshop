import { getConnectionSites, validateAssembly } from '@brick-workshop/engine';
import type { Brick, Rotation } from '@brick-workshop/engine';
import { addTree } from '@brick-workshop/engine/examples/trees';
import type { Box } from '@brick-workshop/engine/examples/trees';
import { hash2, random } from './noise.ts';
import { COLOR } from './palette.ts';
import type { Biome, WorldMap } from './map.ts';

/** A plant's pieces, kept or left out together. */
type Plant = Brick[];

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

/** Broadleaf trees on the clearings the map levelled for them. */
function broadleaves(map: WorldMap, plants: Plant[]) {
  const { size, heights, seed } = map;
  const next = random(seed * 53 + 3);
  /** What the trees planted so far take up, so each crown grows round its neighbours. */
  const around: Box[] = [];
  map.trees.forEach(({ x, z }, index) => {
    const { pieces, add } = collector(`tree${index}`);
    addTree(
      add,
      x,
      z,
      heights[z * size + x] * 3,
      CROWNS[Math.floor(hash2(seed, x, z) * CROWNS.length)],
      COLOR.bark,
      4 + Math.floor(next() * 4),
      Math.floor(next() * 1e6),
      around,
    );
    plants.push(pieces);
  });
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

/** One plant per spot: what grows depends on the biome. */
function smallPlants(map: WorldMap, plants: Plant[]) {
  const { size, heights, water, biomes, seed } = map;
  const next = random(seed * 97 + 11);
  const taken: { x: number; z: number; r: number }[] = map.trees.map(({ x, z }) => ({
    x,
    z,
    r: 6,
  }));
  const free = (x: number, z: number, r: number) =>
    taken.every((spot) => Math.hypot(spot.x - x, spot.z - z) >= Math.max(r, spot.r));
  /**
   * Dry ground of one biome round a stud: level within `reach`, and nothing higher out to
   * `clear`, where a wide plant (a conifer's skirt) would reach into the hillside.
   */
  const level = (x: number, z: number, reach: number, biome: Biome, clear = reach) => {
    const height = heights[z * size + x];
    for (let dz = -clear; dz <= clear; dz++)
      for (let dx = -clear; dx <= clear; dx++) {
        const index = (z + dz) * size + x + dx;
        if (heights[index] > height || water[index]) return false;
        if (Math.max(Math.abs(dx), Math.abs(dz)) > reach) continue;
        if (heights[index] !== height || biomes[index] !== biome) return false;
      }
    return true;
  };
  const chances: Partial<Record<Biome, number>> = {
    desert: 0.035,
    forest: 0.05,
    meadow: 0.008,
    snow: 0.04,
    marsh: 0.05,
  };
  let index = 0;
  for (let z = 4; z < size - 4; z++)
    for (let x = 4; x < size - 4; x++) {
      const cell = z * size + x;
      const biome = biomes[cell];
      // Lily pads float on the marsh pools.
      if (biome === 'marsh' && water[cell] && next() < 0.08 && free(x, z, 1)) {
        const { pieces, add } = collector(`plant${index++}`);
        add('6141', next() < 0.6 ? COLOR.grass : COLOR.lightGrass, x, water[cell] * 3, z);
        plants.push(pieces);
        taken.push({ x, z, r: 1 });
        continue;
      }
      const chance = chances[biome];
      if (!chance || water[cell] || next() >= chance) continue;
      const base = heights[cell] * 3;
      const { pieces, add } = collector(`plant${index++}`);
      if (biome === 'desert') {
        if (!free(x, z, 4) || !level(x, z, 1, biome)) continue;
        if (next() < 0.7) cactus(add, x, z, base, next);
        else {
          // Dry scrub.
          const spot = seat('6064', 0, x, z);
          add('6064', COLOR.olive, spot.x, base, spot.z);
        }
        taken.push({ x, z, r: 4 });
      } else if (biome === 'snow' || (biome === 'forest' && next() < 0.35)) {
        // Conifers: in the snow, and among the broadleaves at the forest's edge.
        if (!free(x, z, 5) || !level(x, z, 0, biome, 2)) continue;
        const kind = next() < 0.8 ? '3471' : '3470';
        const spot = seat(kind, 0, x, z);
        add(kind, COLOR.darkGrass, spot.x, base, spot.z);
        taken.push({ x, z, r: 5 });
      } else if (biome === 'marsh') {
        // Reeds.
        if (!free(x, z, 2) || !level(x, z, 0, biome, 2)) continue;
        const rotation: Rotation = next() < 0.5 ? 0 : 90;
        const spot = seat('30093', rotation, x, z);
        add('30093', next() < 0.6 ? COLOR.olive : COLOR.darkGrass, spot.x, base, spot.z, rotation);
        taken.push({ x, z, r: 2 });
      } else {
        // Bushes in the forest and the odd one out in the meadow.
        if (!free(x, z, 3) || !level(x, z, 1, biome)) continue;
        const spot = seat('6064', 0, x, z);
        add('6064', next() < 0.6 ? COLOR.darkGrass : COLOR.grass, spot.x, base, spot.z);
        taken.push({ x, z, r: 3 });
      }
      plants.push(pieces);
    }
}

/**
 * Everything that grows on the island: broadleaf trees on their clearings, and per biome cacti
 * and scrub, conifers, bushes, reeds and lily pads. They are checked together against the
 * ground, and any plant with a piece that does not fit is left out, until the rest all do.
 */
export function plantIsland(map: WorldMap, ground: readonly Brick[]): Brick[] {
  let plants: Plant[] = [];
  broadleaves(map, plants);
  smallPlants(map, plants);
  plants = plants.filter((pieces) => pieces.length);
  for (let round = 0; round < 8; round++) {
    const issues = validateAssembly({
      name: 'plants',
      bricks: [...ground, ...plants.flat()],
      buildArea: map.size,
    });
    if (!issues.length) break;
    const bad = new Set(issues.map((issue) => issue.brickId.split('-')[0]));
    plants = plants.filter((pieces) => !bad.has(pieces[0].id.split('-')[0]));
    if (round === 7) plants = [];
  }
  return plants.flat();
}

/** Whether a piece is a plant rather than ground or something a player built. */
export const isPlant = (brick: Brick) => /^(tree|plant)\d/.test(brick.id);
