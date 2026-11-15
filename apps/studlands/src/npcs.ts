import type { MinifigOutfit } from '@brick-workshop/walk/minifig';
import type { WanderRules } from '@brick-workshop/npc/wander';
import { CHUNK } from './chunks.ts';
import { hash2, random } from './world/noise.ts';
import type { Biome, Terrain } from './world/terrain.ts';

/**
 * The people of Studlands: minifigures who live about the world and stroll round their homes.
 * Who lives where follows from the seed, so a chunk has the same people whenever it loads. They
 * keep to open dry ground: no water, lava or bare rock, and no climbing more than a brick.
 */

/** How often a chunk has someone living in it. */
const CHANCE = 0.2;
/** Spots tried before a chunk gives up on its person. */
const ATTEMPTS = 24;
/** How far a person strays from home, in studs. */
export const LEASH = 14;
/** Chunks this far from the walker's (in chunks, either way) have their people about. */
export const NPC_RADIUS = 2;

/** Ground a person lives on and walks over. */
const HOMELY: ReadonlySet<Biome> = new Set([
  'beach',
  'meadow',
  'forest',
  'desert',
  'snow',
  'marsh',
  // Brick Island's built ground.
  'road',
  'pavement',
  'yard',
  'field',
]);
/** Town ground: a chunk with a town in it has a few people about rather than one or none. */
const TOWN: ReadonlySet<Biome> = new Set(['road', 'pavement']);
/** How far apart people's homes are, in studs. */
const SPACING = 6;

export interface Resident {
  id: string;
  /** Where they live, in world studs. */
  x: number;
  z: number;
  /** Brick layers of ground under their home. */
  ground: number;
  /** Whether they are a woman or a man: their face, hair, name and voice all follow it. */
  figure: Figure;
  outfit: MinifigOutfit;
  seed: number;
  /** The ground they live on, for what they talk about. */
  biome: Biome;
}

/** A woman or a man. */
export type Figure = 'woman' | 'man';

/** LDraw colours: everyday shirts, trousers, and faces, hair and hats. */
const SHIRTS = [4, 1, 2, 15, 14, 25, 272, 320, 378, 379, 73, 70, 19, 0, 5, 288];
const TROUSERS = [1, 0, 72, 70, 19, 272, 308, 28, 71, 15];
const HAIR_COLORS = [70, 308, 0, 19, 14, 25, 72];
/** Faces: a grin, a moustache, sunglasses or eyebrows for a man, lips and lashes for a woman. */
const FACES: Record<Figure, readonly string[]> = {
  man: ['3626cp01', '3626cp01', '3626bp03', '3626bp04', '3626bp05'],
  woman: ['3626bp02', '3626bp08', '3626bp09'],
};
/** Hair: short cuts for a man; a ponytail, pigtails or long hair for a woman. */
const HAIR: Record<Figure, readonly string[]> = {
  man: ['3901', '92081', '40233', '62810'],
  woman: ['62696', '3625', '85974', '92083', '87990'],
};
/** Hats: police, top hat, construction helmet, cowboy hat, cap. */
const HATS: Record<string, readonly { part: string; color: number }[]> = {
  any: [
    { part: '3624', color: 0 },
    { part: '3878', color: 0 },
    { part: '3833', color: 14 },
    { part: '86035', color: 4 },
    { part: '86035', color: 1 },
  ],
  desert: [
    { part: '3629', color: 70 },
    { part: '3629', color: 19 },
    { part: '3629', color: 0 },
  ],
  snow: [
    { part: '86035', color: 15 },
    { part: '86035', color: 4 },
  ],
};

const pick = <T>(next: () => number, list: readonly T[]) => list[Math.floor(next() * list.length)];

/**
 * What someone living on this ground wears: a hat to suit it now and then, else hair, with a
 * face and hair to suit a woman or a man.
 */
export function outfitFor(next: () => number, biome: Biome, figure: Figure): MinifigOutfit {
  const torso = pick(next, SHIRTS);
  const legs = pick(next, TROUSERS);
  const local = HATS[biome];
  const hatChance = local ? 0.6 : 0.25;
  const headgear =
    next() < hatChance
      ? pick(next, local && next() < 0.8 ? local : HATS.any)
      : { part: pick(next, HAIR[figure]), color: pick(next, HAIR_COLORS) };
  return {
    head: pick(next, FACES[figure]),
    skin: 14,
    torso,
    // Now and then bare arms in the skin colour, or sleeves of another shade.
    arms: next() < 0.15 ? 14 : torso,
    hips: next() < 0.2 ? pick(next, TROUSERS) : legs,
    legs,
    headgear,
  };
}

/** Whether a stud column is ground a person walks on. */
function homely(terrain: Terrain, x: number, z: number) {
  const column = terrain.column(x, z);
  return !column.water && HOMELY.has(column.biome);
}

/**
 * Whoever lives in the chunk, on open dry ground clear of tree trunks, with a little room round
 * them to walk: now and then one person out in the country, one or two in a town.
 */
export function residentsOf(terrain: Terrain, cx: number, cz: number): Resident[] {
  const { seed } = terrain;
  const x0 = cx * CHUNK;
  const z0 = cz * CHUNK;
  const middle = terrain.column(x0 + CHUNK / 2, z0 + CHUNK / 2);
  const roll = hash2(seed + 701, cx, cz);
  const count = TOWN.has(middle.biome) ? 1 + Math.floor(roll * 2) : roll < CHANCE ? 1 : 0;
  if (!count) return [];
  const next = random(Math.floor(hash2(seed + 702, cx, cz) * 2 ** 31));
  const found: Resident[] = [];
  for (let attempt = 0; attempt < ATTEMPTS * count && found.length < count; attempt++) {
    const x = x0 + 4 + Math.floor(next() * (CHUNK - 8));
    const z = z0 + 4 + Math.floor(next() * (CHUNK - 8));
    const here = terrain.column(x, z);
    if (!homely(terrain, x, z)) continue;
    if (found.some((other) => Math.hypot(other.x - x, other.z - z) < SPACING)) continue;
    // Some level ground round the spot, and no trunk on it.
    let open = terrain.treesIn(x - 2, z - 2, x + 3, z + 3).length === 0;
    for (let dz = -2; dz <= 2 && open; dz++)
      for (let dx = -2; dx <= 2 && open; dx++) {
        const other = terrain.column(x + dx, z + dz);
        if (!homely(terrain, x + dx, z + dz) || Math.abs(other.height - here.height) > 1)
          open = false;
      }
    if (!open) continue;
    // From the spot rather than the chunk's stream, so where people live stays as it was.
    const figure: Figure = hash2(seed + 703, x, z) < 0.5 ? 'woman' : 'man';
    found.push({
      id: `npc${cx},${cz}:${found.length}`,
      x: x + 0.5,
      z: z + 0.5,
      ground: here.height,
      figure,
      outfit: outfitFor(next, here.biome, figure),
      seed: Math.floor(next() * 2 ** 31),
      biome: here.biome,
    });
  }
  return found;
}

/** The resident with this ID (see `residentsOf`), or null if there is none. */
export function residentById(terrain: Terrain, id: string): Resident | null {
  const match = /^npc(-?\d+),(-?\d+):\d+$/.exec(id);
  if (!match) return null;
  return (
    residentsOf(terrain, Number(match[1]), Number(match[2])).find((one) => one.id === id) ?? null
  );
}

/**
 * The rules people walk by, in scene units: onto dry homely ground at most a brick up or down
 * from where they stand, and only within the loaded chunks.
 */
export function wanderRules(
  terrain: Terrain,
  frame: number,
  loaded: (cx: number, cz: number) => boolean,
): WanderRules {
  const half = frame / 2;
  return {
    leash: LEASH,
    canWalk(from, to) {
      // Scene to world studs: the scene centres the frame and runs z the other way.
      const fx = Math.floor(from.x + half);
      const fz = Math.floor(half - from.z);
      const tx = Math.floor(to.x + half);
      const tz = Math.floor(half - to.z);
      if (!loaded(Math.floor(tx / CHUNK), Math.floor(tz / CHUNK))) return false;
      if (!homely(terrain, tx, tz)) return false;
      return Math.abs(terrain.column(tx, tz).height - terrain.column(fx, fz).height) <= 1;
    },
  };
}
