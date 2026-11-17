import type { Rotation } from '@brick-workshop/engine';
import type { Carving, Cave } from './caves.ts';
import { hash2, random } from './noise.ts';
import { COLOR } from './palette.ts';
import type { Plant } from './plants.ts';
import { WATER_LAYERS } from './terrain.ts';
import type { Biome, Terrain } from './terrain.ts';

/**
 * Sights: the small things a walker comes across between the hills, each a little story in a
 * handful of pieces. A well in a meadow, a campfire with log seats, a signpost at a crossroads,
 * a ring of standing stones, a cairn on the rocks, a snowman, a wreck on the beach; and in a
 * cave, stalagmites, crystals and a chest. Each lies wholly inside its chunk, like the small
 * plants, so it never meets what a neighbouring chunk builds.
 */

type Add = (
  partId: string,
  color: number,
  x: number,
  y: number,
  z: number,
  rotation?: Rotation,
) => void;

function collector(prefix: string) {
  const pieces: Plant = [];
  let next = 0;
  const add: Add = (partId, color, x, y, z, rotation = 0) => {
    pieces.push({ id: `${prefix}-${next++}`, partId, color, x, y, z, rotation });
  };
  return { pieces, add };
}

/** One of a few colours, picked by a seeded number. */
const pick = <T>(next: () => number, options: readonly T[]) =>
  options[Math.floor(next() * options.length)];

export type SightKind = 'well' | 'campfire' | 'signpost' | 'stones' | 'cairn' | 'snowman' | 'wreck';

/**
 * A light a sight or cave gives off: a campfire's flame or a cave's crystals, which the game
 * lights near the walker. In world studs, and plates up.
 */
export interface Glow {
  kind: 'fire' | 'crystal';
  x: number;
  y: number;
  z: number;
  color: string;
}

/** A sight's plan: how far it reaches from its corner, and how to build it there. */
interface Plan {
  /** Studs it covers from (x, z), along x and z. */
  width: number;
  depth: number;
  /** Studs round it kept free of other plants and level with it. */
  clear: number;
  build: (add: Add, x: number, y: number, z: number, next: () => number) => void;
}

/** Stone in the build standard's shades: mostly the base, some shadow and a little highlight. */
function stone(next: () => number, desert: boolean) {
  const roll = next();
  if (desert) return roll < 0.6 ? COLOR.nougat : roll < 0.85 ? COLOR.sand : COLOR.darkOrange;
  return roll < 0.6 ? COLOR.rock : roll < 0.85 ? COLOR.darkRock : COLOR.lightRock;
}

/**
 * A well: a round-ish shaft two courses high with dark water in it, two posts carrying a beam,
 * and a little pitched roof over the lot, with a bucket on the rim.
 */
function well(desert: boolean): Plan {
  return {
    width: 4,
    depth: 4,
    clear: 2,
    build(add, x, y, z, next) {
      add('3068b', COLOR.deep, x + 1, y, z + 1);
      add('3010', stone(next, desert), x, y, z);
      add('3010', stone(next, desert), x + 3, y, z);
      add('3004', stone(next, desert), x + 1, y, z, 90);
      add('3004', stone(next, desert), x + 1, y, z + 3, 90);
      add('3010', stone(next, desert), x, y + 3, z, 90);
      add('3010', stone(next, desert), x, y + 3, z + 3, 90);
      add('3004', stone(next, desert), x, y + 3, z + 1);
      add('3004', stone(next, desert), x + 3, y + 3, z + 1);
      for (const px of [x, x + 3])
        for (let level = 0; level < 3; level++)
          add('3062b', COLOR.bark, px, y + 6 + level * 3, z + 1);
      add('3710', COLOR.darkSoil, x, y + 15, z + 1, 90);
      const roof = desert ? COLOR.soil : pick(next, [320, 320, 72] as const);
      add('3020', roof, x, y + 16, z + 1, 90);
      add('3039', roof, x, y + 17, z + 1, 90);
      add('3039', roof, x + 2, y + 17, z + 1, 270);
      // The bucket, on the rim beside the posts.
      add('3062b', COLOR.darkSoil, x + 1, y + 6, z + 3);
    },
  };
}

/**
 * A campfire: a ring of stones round glowing logs and a flame, with a log to sit on either side
 * and a stump.
 */
const CAMPFIRE: Plan = {
  width: 7,
  depth: 5,
  clear: 1,
  build(add, x, y, z, next) {
    const cx = x + 3;
    const cz = z + 2;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++)
        if (dx || dz)
          add(
            '6141',
            pick(next, [COLOR.rock, COLOR.darkRock, COLOR.darkRock]),
            cx + dx,
            y,
            cz + dz,
          );
    add('3024', COLOR.darkSoil, cx, y, cz);
    add('3024', COLOR.lavaDark, cx, y + 1, cz);
    add('4589', 57, cx, y + 2, cz);
    // Log seats, either side of the fire, and a stump at one end.
    add('30136', COLOR.bark, x, y, z + 1);
    add('30136', COLOR.bark, x + 6, y, z + 2);
    add('3062b', COLOR.darkSoil, x + 3, y, z + 4);
    add('6141', COLOR.nougat, x + 3, y + 3, z + 4);
  },
};

/**
 * A signpost: a timber post with two arms pointing four ways, as at a crossroads, and a lamp
 * cap on top.
 */
const SIGNPOST: Plan = {
  width: 5,
  depth: 5,
  clear: 1,
  build(add, x, y, z, next) {
    const px = x + 2;
    const pz = z + 2;
    for (let level = 0; level < 3; level++) add('3062b', COLOR.bark, px, y + level * 3, pz);
    add('3710', pick(next, [COLOR.nougat, COLOR.sand]), px - 1, y + 9, pz, 90);
    add('3710', pick(next, [COLOR.nougat, COLOR.soil]), px, y + 10, pz - 2);
    add('6141', COLOR.darkSoil, px, y + 11, pz);
    // A stone at the foot, the way a post is wedged.
    add('6141', COLOR.darkRock, px + 1, y, pz + 1);
  },
};

/**
 * Standing stones: a ring of grey stones of different heights round a low altar, one of them
 * fallen over on its side.
 */
const STONES: Plan = {
  width: 9,
  depth: 9,
  clear: 1,
  build(add, x, y, z, next) {
    const cx = x + 4;
    const cz = z + 4;
    add('3003', COLOR.darkRock, cx - 1, y, cz - 1);
    add('3068b', COLOR.lightRock, cx - 1, y + 3, cz - 1);
    const count = 7;
    const turn = next() * Math.PI * 2;
    const fallen = Math.floor(next() * count);
    for (let index = 0; index < count; index++) {
      const angle = turn + (index / count) * Math.PI * 2;
      const sx = Math.round(cx - 0.5 + Math.cos(angle) * 3.6);
      const sz = Math.round(cz - 0.5 + Math.sin(angle) * 3.6);
      if (index === fallen) {
        add('3005', stone(next, false), sx, y, sz);
        continue;
      }
      const height = 2 + Math.floor(next() * 3);
      for (let level = 0; level < height; level++)
        add('3005', stone(next, false), sx, y + level * 3, sz);
      add('3024', pick(next, [COLOR.olive, COLOR.darkRock, COLOR.rock]), sx, y + height * 3, sz);
    }
  },
};

/** A cairn: stones piled into a small tower, smaller stones on top, as walkers mark a summit. */
const CAIRN: Plan = {
  width: 3,
  depth: 3,
  clear: 1,
  build(add, x, y, z, next) {
    add('3003', stone(next, false), x, y, z);
    add('3005', stone(next, false), x + 2, y, z + 1);
    add('3004', stone(next, false), x, y + 3, z, 90);
    add('3005', stone(next, false), x + 1, y + 3, z + 1);
    add('3062b', stone(next, false), x + 1, y + 6, z);
    add('6141', COLOR.lightRock, x + 1, y + 9, z);
  },
};

/** A snowman: two snowballs, a head on a jumper so it sits in the middle, and a black hat. */
const SNOWMAN: Plan = {
  width: 2,
  depth: 2,
  clear: 2,
  build(add, x, y, z, next) {
    add('3941', COLOR.snow, x, y, z);
    add('3941', COLOR.snow, x, y + 3, z);
    add('87580', COLOR.snow, x, y + 6, z);
    add('3062b', COLOR.snow, x + 0.5, y + 7, z + 0.5);
    add('6141', COLOR.black, x + 0.5, y + 10, z + 0.5);
    add('3062b', next() < 0.7 ? COLOR.black : COLOR.lavaDark, x + 0.5, y + 11, z + 0.5);
  },
};

/**
 * A wreck washed up on the sand: a broken hull of weathered planks, its bow still standing and
 * its stern stove in, the stump of its mast, and a crate that came ashore with it.
 */
const WRECK: Plan = {
  width: 6,
  depth: 10,
  clear: 1,
  build(add, x, y, z, next) {
    const plank = () => pick(next, [COLOR.bark, COLOR.bark, COLOR.darkSoil, COLOR.nougat]);
    add('3004', plank(), x + 1, y, z, 90);
    add('3010', plank(), x, y, z + 1);
    add('3010', plank(), x + 3, y, z + 1);
    add('3010', plank(), x, y, z + 5);
    add('3004', plank(), x + 3, y, z + 5);
    add('3004', plank(), x + 1, y, z + 8, 90);
    add('3039', plank(), x + 1, y + 3, z, 180);
    add('3010', plank(), x, y + 3, z + 2);
    add('3004', plank(), x + 3, y + 3, z + 1);
    add('3005', plank(), x, y + 6, z + 3);
    add('2431', COLOR.darkSoil, x + 1, y, z + 2);
    add('3069b', COLOR.darkSoil, x + 2, y, z + 6);
    for (let level = 0; level < 2; level++) add('3062b', COLOR.bark, x + 1, y + level * 3, z + 5);
    // The crate, off to the side.
    add('3003', COLOR.nougat, x + 4, y, z + 7);
    add('3068b', COLOR.bark, x + 4, y + 3, z + 7);
  },
};

/** Which sights turn up on which ground, the likelier first. */
const KINDS: Partial<Record<Biome, readonly SightKind[]>> = {
  meadow: ['well', 'stones', 'signpost', 'campfire'],
  forest: ['campfire', 'signpost', 'campfire'],
  desert: ['well', 'campfire', 'signpost'],
  snow: ['snowman', 'cairn', 'campfire'],
  rock: ['cairn', 'stones'],
  beach: ['wreck', 'campfire'],
};

const plan = (kind: SightKind, desert: boolean): Plan =>
  ({
    well: well(desert),
    campfire: CAMPFIRE,
    signpost: SIGNPOST,
    stones: STONES,
    cairn: CAIRN,
    snowman: SNOWMAN,
    wreck: WRECK,
  })[kind];

/** How often a chunk has a sight in it. */
const SIGHT_CHANCE = 0.55;
const SIGHT_ATTEMPTS = 60;

export interface Taken {
  x: number;
  z: number;
  r: number;
}

/**
 * The chunk's sight, if it has one and finds room for it: level dry ground of one biome under it
 * and round it, nothing higher close by, clear of the trees and of anything carved.
 */
export function sightIn(
  terrain: Terrain,
  carving: Carving,
  x0: number,
  z0: number,
  size: number,
  taken: readonly Taken[],
): { pieces: Plant; spot: Taken; kind: SightKind; glow: Glow | null } | null {
  const { seed } = terrain;
  const next = random(seed * 113 + 5 + Math.imul(x0, 19349663) + Math.imul(z0, 83492791));
  if (next() >= SIGHT_CHANCE) return null;
  for (let attempt = 0; attempt < SIGHT_ATTEMPTS; attempt++) {
    const x = x0 + 2 + Math.floor(next() * (size - 4));
    const z = z0 + 2 + Math.floor(next() * (size - 4));
    const here = terrain.column(x, z);
    const kinds = KINDS[here.biome];
    if (!kinds || here.water) continue;
    const kind = pick(next, kinds);
    // A wreck lies on the beach, at the sea's level; a dry beach far from it has none.
    if (kind === 'wreck' && here.height !== WATER_LAYERS + 1 && here.height !== WATER_LAYERS)
      continue;
    const desert = here.biome === 'desert';
    const { width, depth, clear, build } = plan(kind, desert);
    const x1 = x + width;
    const z1 = z + depth;
    if (x - clear < x0 || z - clear < z0 || x1 + clear > x0 + size || z1 + clear > z0 + size)
      continue;
    const middle = { x: x + width / 2, z: z + depth / 2, r: Math.max(width, depth) / 2 + clear };
    if (
      !taken.every((spot) => Math.hypot(spot.x - middle.x, spot.z - middle.z) >= spot.r + middle.r)
    )
      continue;
    let level = true;
    for (let cz = z - clear; cz < z1 + clear && level; cz++)
      for (let cx = x - clear; cx < x1 + clear && level; cx++) {
        const other = terrain.column(cx, cz);
        const under = cx >= x && cx < x1 && cz >= z && cz < z1;
        if (other.water || carving.hollows.has(`${cx},${cz}`)) level = false;
        else if (other.height > here.height + (under ? 0 : 1)) level = false;
        else if (under && other.height !== here.height) level = false;
        // Under a wreck the sand runs into a beach or a desert by the sea; elsewhere one biome.
        else if (under && other.biome !== here.biome && kind !== 'wreck') level = false;
      }
    if (!level) continue;
    const { pieces, add } = collector('sight0');
    const shaped = random(Math.floor(hash2(seed + 401, x, z) * 1e9));
    build(add, x, here.height * 3, z, shaped);
    // The campfire's flame, a brick over the fire.
    const glow: Glow | null =
      kind === 'campfire'
        ? { kind: 'fire', x: x + 3.5, y: here.height * 3 + 5, z: z + 2.5, color: '#ff8a3c' }
        : null;
    return { pieces, spot: middle, kind, glow };
  }
  return null;
}

/** Crystals in see-through shades, each with the colour of the light it gives the chamber. */
const CRYSTALS: readonly { color: number; light: string }[] = [
  { color: 43, light: '#7fd4ff' },
  { color: 52, light: '#b98cff' },
  { color: 43, light: '#7fd4ff' },
  { color: 35, light: '#7dffa0' },
];

/** The cave's crystals: their colour, and the light they fill the chamber with. */
function crystalsOf(seed: number, cave: Cave) {
  return CRYSTALS[Math.floor(hash2(seed + 411, cave.mouth.x, cave.mouth.z) * CRYSTALS.length)];
}

/** The glow of a cave's crystals, over the middle of its chamber; none without a chamber. */
export function caveGlow(terrain: Terrain, carving: Carving): Glow | null {
  const { cave } = carving;
  if (!cave?.chamber) return null;
  const floor = cave.floors[cave.length];
  return {
    kind: 'crystal',
    x: cave.chamber.x + 0.5,
    y: floor * 3 + 9,
    z: cave.chamber.z + 0.5,
    color: crystalsOf(terrain.seed, cave).light,
  };
}

/**
 * What lies in a cave: stalagmites along the foot of its walls, a cluster of crystals in the
 * chamber, and a chest at the far end, its lid in gold.
 */
export function caveProps(terrain: Terrain, carving: Carving): Plant[] {
  const { cave } = carving;
  if (!cave) return [];
  const { seed } = terrain;
  const next = random(Math.floor(hash2(seed + 409, cave.mouth.x, cave.mouth.z) * 1e9));
  const { dx, dz, mouth } = cave;
  const props: Plant[] = [];
  let index = 0;
  // The floor's height in plates where a stud lies on the cave's floor, under its roof (not in
  // the open cut) and with room for a piece two bricks high, or null.
  const floorAt = (x: number, z: number) => {
    const hollow = carving.hollows.get(`${x},${z}`);
    if (!hollow || hollow.to - hollow.from < 3) return null;
    return hollow.to < terrain.column(x, z).height ? hollow.from * 3 : null;
  };
  const add = (build: (put: Add) => void) => {
    const { pieces, add: put } = collector(`cave${index++}`);
    build(put);
    props.push(pieces);
  };
  // Stalagmites along the walls, under the roof.
  for (let k = 1; k <= cave.length; k++)
    for (const side of [-2, 2]) {
      if (next() > 0.35) continue;
      const x = mouth.x + dx * k - dz * side;
      const z = mouth.z + dz * k + dx * side;
      const y = floorAt(x, z);
      if (y === null) continue;
      const color = pick(next, [COLOR.darkRock, COLOR.darkRock, COLOR.rock]);
      add((put) => {
        if (next() < 0.4) {
          put('3062b', color, x, y, z);
          put('4589', color, x, y + 3, z);
        } else put('4589', color, x, y, z);
      });
    }
  if (!cave.chamber) return props;
  const { chamber } = cave;
  // A crystal cluster against the chamber's wall, to one side of the tunnel.
  const side = next() < 0.5 ? 1 : -1;
  const cluster = { x: chamber.x - dz * side * 2, z: chamber.z + dx * side * 2 };
  const { color } = crystalsOf(seed, cave);
  for (const [ox, oz] of [
    [0, 0],
    [dx, dz],
    [-dz * side, dx * side],
    [-dx, -dz],
  ]) {
    const x = cluster.x + ox;
    const z = cluster.z + oz;
    const y = floorAt(x, z);
    if (y === null) continue;
    add((put) => {
      if (next() < 0.5) {
        put('3062b', color, x, y, z);
        put('4589', color, x, y + 3, z);
      } else put('4589', color, x, y, z);
    });
  }
  // The chest at the chamber's far side, facing back down the tunnel.
  const far = { x: chamber.x + dx * 2, z: chamber.z + dz * 2 };
  const along = dx !== 0;
  const cx = along ? far.x : far.x - 1;
  const cz = along ? far.z - 1 : far.z;
  const y = floorAt(cx, cz);
  if (y !== null && floorAt(along ? cx : cx + 1, along ? cz + 1 : cz) === y)
    add((put) => {
      const rotation: Rotation = along ? 0 : 90;
      put('3004', COLOR.bark, cx, y, cz, rotation);
      put('3069b', 297, cx, y + 3, cz, rotation);
    });
  return props;
}
