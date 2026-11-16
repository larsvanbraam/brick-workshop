import type { AnimalPart, Gait } from '@brick-workshop/npc/animal';
import type { Temper, WanderRules } from '@brick-workshop/npc/wander';
import { CHUNK } from './chunks.ts';
import { hash2, random } from './world/noise.ts';
import type { Biome, Terrain } from './world/terrain.ts';

/**
 * The animals of Studlands and Brick Island: wildlife that suits the ground it lives on, and on
 * Brick Island's farm, cows, pigs, sheep, goats, chickens, horses and ducks kept in its
 * pastures. Like the people (`npcs.ts`), who lives where follows from the seed.
 */

export interface Species {
  name: string;
  parts: readonly AnimalPart[];
  gait: Gait;
  temper: Temper;
  /** Strolling pace, a fraction of the walker's walking speed. */
  pace: number;
}

const species = (
  name: string,
  parts: readonly AnimalPart[],
  gait: Gait,
  temper: Temper,
  pace: number,
): Species => ({ name, parts, gait, temper, pace });
const part = (id: string, color: number): AnimalPart => ({ part: id, color });

/** LDraw colours: white, black, tan, reddish brown, medium nougat, bright pink, and so on. */
export const SPECIES = {
  cow: species(
    'cow',
    [
      { part: '64779p01c01', color: 15 },
      { part: '64835p01c01', color: 15, at: [0, -10, -36] },
    ],
    'walk',
    'calm',
    0.15,
  ),
  pig: species('pig', [part('87621p01', 29)], 'walk', 'calm', 0.2),
  piglet: species('piglet', [part('1410', 29)], 'walk', 'calm', 0.25),
  lamb: species('lamb', [part('1569p01', 15)], 'walk', 'calm', 0.2),
  goat: species('goat', [part('95341p03', 15)], 'walk', 'calm', 0.22),
  chicken: species('chicken', [part('95342p01', 15)], 'waddle', 'calm', 0.25),
  horse: species('horse', [part('4493c01', 70)], 'walk', 'calm', 0.25),
  whiteHorse: species('horse', [part('4493c01', 15)], 'walk', 'calm', 0.25),
  foal: species('foal', [part('82445p01', 84)], 'walk', 'calm', 0.3),
  duckling: species('duckling', [part('49661p01', 14)], 'waddle', 'shy', 0.25),
  rabbit: species('rabbit', [part('33207p01', 15)], 'hop', 'shy', 0.3),
  brownRabbit: species('rabbit', [part('33207p01', 19)], 'hop', 'shy', 0.3),
  hedgehog: species('hedgehog', [part('98389p01', 19)], 'walk', 'shy', 0.12),
  fawn: species('fawn', [part('13393', 84)], 'walk', 'shy', 0.3),
  squirrel: species('squirrel', [part('80679p01', 484)], 'hop', 'shy', 0.35),
  crab: species('crab', [part('33121', 4)], 'walk', 'calm', 0.12),
  seagull: species('seagull', [part('12891p01', 15)], 'waddle', 'shy', 0.2),
  frog: species('frog', [part('33320', 2)], 'hop', 'shy', 0.25),
  penguin: species('penguin', [part('26074p01', 0)], 'waddle', 'calm', 0.15),
  camel: species('camel', [part('88291p01', 19)], 'walk', 'calm', 0.2),
} as const;

/** Who lives wild on each kind of ground; a chunk's animals are one kind, in a small group. */
const WILD: Partial<Record<Biome, readonly (keyof typeof SPECIES)[]>> = {
  meadow: ['rabbit', 'brownRabbit', 'hedgehog', 'rabbit'],
  forest: ['fawn', 'squirrel', 'hedgehog', 'brownRabbit'],
  beach: ['crab', 'seagull'],
  marsh: ['frog', 'duckling'],
  snow: ['penguin'],
  desert: ['camel'],
};
/** How many of a kind go about together, at most. */
const GROUP: Partial<Record<keyof typeof SPECIES, number>> = {
  rabbit: 3,
  brownRabbit: 3,
  crab: 3,
  seagull: 2,
  frog: 2,
  duckling: 4,
  penguin: 4,
  fawn: 2,
};
/** How often a chunk has wild animals in it. */
const WILD_CHANCE = 0.3;
/** How far animals stray from home, in studs. */
const WILD_LEASH = 12;
const HERD_LEASH = 9;

/** What each kind is called, and the sound it makes, in Dutch (English is the species name). */
export const ANIMAL_WORDS: Record<string, { nl: string; sound: { en: string; nl: string } }> = {
  cow: { nl: 'koe', sound: { en: 'Moo!', nl: 'Boe!' } },
  pig: { nl: 'varken', sound: { en: 'Oink!', nl: 'Knor!' } },
  piglet: { nl: 'big', sound: { en: 'Oink!', nl: 'Knor!' } },
  lamb: { nl: 'lammetje', sound: { en: 'Baa!', nl: 'Mè!' } },
  goat: { nl: 'geit', sound: { en: 'Meh!', nl: 'Mè!' } },
  chicken: { nl: 'kip', sound: { en: 'Cluck!', nl: 'Tok tok!' } },
  horse: { nl: 'paard', sound: { en: 'Neigh!', nl: 'Hihihi!' } },
  foal: { nl: 'veulen', sound: { en: 'Neigh!', nl: 'Hihihi!' } },
  crab: { nl: 'krab', sound: { en: 'Click click!', nl: 'Klik klik!' } },
  penguin: { nl: 'pinguïn', sound: { en: 'Honk!', nl: 'Toet!' } },
  camel: { nl: 'kameel', sound: { en: 'Grumph!', nl: 'Bwoeh!' } },
};

/** Whether the player can pet this kind: the calm ones stay put; the shy ones run off. */
export const pettable = (kind: Species) => kind.temper === 'calm' && kind.name in ANIMAL_WORDS;

export interface Animal {
  id: string;
  species: Species;
  /** Where it lives, in world studs, and the brick layers of ground there. */
  x: number;
  z: number;
  ground: number;
  seed: number;
  /** Farm animals keep to their pasture. */
  pasture?: Pasture;
}

/** A farm's pasture: an area of grass, in world studs, its animals do not leave. */
export interface Pasture {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** Ground animals may stand on: dry, and neither crops, road nor pavement. */
const GRAZING: ReadonlySet<Biome> = new Set([
  'beach',
  'meadow',
  'forest',
  'desert',
  'snow',
  'marsh',
  'yard',
]);

function grazing(terrain: Terrain, x: number, z: number) {
  const column = terrain.column(x, z);
  return !column.water && GRAZING.has(column.biome);
}

/** Whether the ground round a spot is open and level enough to live on. */
function roomy(terrain: Terrain, x: number, z: number, height: number) {
  if (terrain.treesIn(x - 2, z - 2, x + 3, z + 3).length) return false;
  for (let dz = -2; dz <= 2; dz++)
    for (let dx = -2; dx <= 2; dx++)
      if (
        !grazing(terrain, x + dx, z + dz) ||
        Math.abs(terrain.column(x + dx, z + dz).height - height) > 1
      )
        return false;
  return true;
}

/** A group of one kind round a spot, each on open ground of its own. */
function group(
  terrain: Terrain,
  next: () => number,
  id: string,
  kind: Species,
  size: number,
  x: number,
  z: number,
  pasture?: Pasture,
): Animal[] {
  const found: Animal[] = [];
  for (let attempt = 0; attempt < size * 6 && found.length < size; attempt++) {
    const ax = x + Math.floor((next() - 0.5) * 8);
    const az = z + Math.floor((next() - 0.5) * 8);
    if (pasture && !inside(pasture, ax, az)) continue;
    const column = terrain.column(ax, az);
    if (!grazing(terrain, ax, az) || Math.abs(column.height - terrain.column(x, z).height) > 1)
      continue;
    if (found.some((other) => Math.hypot(other.x - ax, other.z - az) < 2.5)) continue;
    found.push({
      id: `${id}:${found.length}`,
      species: kind,
      x: ax + 0.5,
      z: az + 0.5,
      ground: column.height,
      seed: Math.floor(next() * 2 ** 31),
      pasture,
    });
  }
  return found;
}

/** The chunk's wild animals: now and then a small group of a kind that suits the ground. */
export function wildlifeOf(terrain: Terrain, cx: number, cz: number): Animal[] {
  const { seed } = terrain;
  if (hash2(seed + 801, cx, cz) >= WILD_CHANCE) return [];
  const next = random(Math.floor(hash2(seed + 802, cx, cz) * 2 ** 31));
  for (let attempt = 0; attempt < 24; attempt++) {
    const x = cx * CHUNK + 4 + Math.floor(next() * (CHUNK - 8));
    const z = cz * CHUNK + 4 + Math.floor(next() * (CHUNK - 8));
    const column = terrain.column(x, z);
    const kinds = WILD[column.biome];
    if (!kinds || column.water || !roomy(terrain, x, z, column.height)) continue;
    const name = kinds[Math.floor(next() * kinds.length)];
    const size = 1 + Math.floor(next() * (GROUP[name] ?? 1));
    return group(terrain, next, `wild${cx},${cz}`, SPECIES[name], size, x, z);
  }
  return [];
}

/** The herds a farm keeps, and how many of each. */
const HERDS: readonly (readonly [keyof typeof SPECIES, number])[] = [
  ['cow', 3],
  ['pig', 2],
  ['piglet', 2],
  ['lamb', 3],
  ['goat', 2],
  ['chicken', 4],
  ['horse', 1],
  ['whiteHorse', 1],
  ['foal', 1],
  ['duckling', 3],
];

const inside = (area: Pasture, x: number, z: number) =>
  x >= area.x0 && x < area.x1 && z >= area.z0 && z < area.z1;

/**
 * The farm's animals: each herd round a spot of its own on the farm's open grass, away from the
 * crops, the lane and the buildings (a herd whose spot is built on is left out where it is
 * drawn). Worked out once per farm.
 */
export function farmAnimals(terrain: Terrain, farm: Pasture): Animal[] {
  const next = random(terrain.seed * 7919 + 17);
  const animals: Animal[] = [];
  const homes: { x: number; z: number }[] = [];
  // Inset from the farm's edge, where the land blends back.
  const pasture = { x0: farm.x0 + 3, z0: farm.z0 + 3, x1: farm.x1 - 3, z1: farm.z1 - 3 };
  for (const [name, size] of HERDS) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const x = pasture.x0 + Math.floor(next() * (pasture.x1 - pasture.x0));
      const z = pasture.z0 + Math.floor(next() * (pasture.z1 - pasture.z0));
      if (homes.some((home) => Math.hypot(home.x - x, home.z - z) < 8)) continue;
      if (!roomy(terrain, x, z, terrain.column(x, z).height)) continue;
      homes.push({ x, z });
      animals.push(...group(terrain, next, `farm-${name}`, SPECIES[name], size, x, z, pasture));
      break;
    }
  }
  return animals;
}

/**
 * The rules an animal walks by, in scene units: onto grazing ground at most a brick up or down,
 * within the loaded chunks, and for farm animals within their pasture.
 */
export function animalRules(
  terrain: Terrain,
  frame: number,
  loaded: (cx: number, cz: number) => boolean,
  pasture?: Pasture,
): WanderRules {
  const half = frame / 2;
  return {
    leash: pasture ? HERD_LEASH : WILD_LEASH,
    canWalk(from, to) {
      // Scene to world studs: the scene centres the frame and runs z the other way.
      const fx = Math.floor(from.x + half);
      const fz = Math.floor(half - from.z);
      const tx = Math.floor(to.x + half);
      const tz = Math.floor(half - to.z);
      if (!loaded(Math.floor(tx / CHUNK), Math.floor(tz / CHUNK))) return false;
      if (pasture && !inside(pasture, tx, tz)) return false;
      if (!grazing(terrain, tx, tz)) return false;
      return Math.abs(terrain.column(tx, tz).height - terrain.column(fx, fz).height) <= 1;
    },
  };
}
