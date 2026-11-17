import { fbm, random } from './noise.ts';
import { BUILT_BIOMES, LAND_BIOMES, WATER_LAYERS } from './terrain.ts';
import type { Biome, Column, Terrain } from './terrain.ts';

/**
 * Caves and overhangs: brick layers taken out of the ground's columns, so hillsides open into
 * tunnels and cliffs lean out over their feet. The world is otherwise a height per column; a
 * hollow is a run of layers inside a column that is left empty, with ground above and below it.
 *
 * Everything carved lies wholly inside one chunk, a stud or more in from its edges. A neighbour
 * only ever looks at a column's height (its top), which a hollow never changes, so chunks still
 * agree along their edges and each can be built alone.
 */

/** Layers `[from, to)` of a column left empty. */
export interface Hollow {
  from: number;
  to: number;
}

/**
 * A tunnel into the ground: from a mouth on open ground it cuts into the hillside as a sunken
 * way, open to the sky, its floor stepping down a layer every two studs until the ground closes
 * over it; then it runs on under a roof and ends in a domed chamber when there is room.
 */
export interface Cave {
  /** The open ground in front of the mouth, where the tunnel starts. */
  mouth: { x: number; z: number };
  /** Which way the tunnel runs into the hill, one stud a step. */
  dx: number;
  dz: number;
  /** Per step from the mouth (0 is the mouth itself), brick layers up to the floor. */
  floors: number[];
  /** Steps from the mouth to the tunnel's far end. */
  length: number;
  /** The chamber's middle, if the tunnel opens into one. */
  chamber: { x: number; z: number } | null;
}

export interface Carving {
  /** Per column `x,z`, the layers left empty. */
  hollows: Map<string, Hollow>;
  /**
   * Per column `x,z` round a hollow, the column whose colours it takes. The ground's colours vary
   * from column to column, and only cells of one colour join into a brick, so a roof could not
   * reach across to the walls that carry it; coloured alike, layer by layer, it can.
   */
  tints: Map<string, { x: number; z: number }>;
  cave: Cave | null;
}

/** How often a chunk tries for a cave; often its ground has no room for one. */
const CAVE_CHANCE = 0.5;
/** Spots a chunk tries for a cave's mouth. */
const CAVE_ATTEMPTS = 40;
/** Layers of ground a stud of the tunnel needs over its floor: its hollow, and a roof. */
const COVER = 6;
/** Studs either side of a tunnel's middle that it reaches, its walls included. */
const HALF = 3;
/**
 * A tunnel's height across it, by studs from its middle: five layers over the middle three studs,
 * room for a minifigure, and three at the foot of each wall, so the roof steps in from the walls
 * and every course of it rests on the one below, the way a corbelled vault does.
 */
const TUNNEL = [5, 5, 3] as const;
/** Layers a stud across the tunnel needs over its floor, its walls included: a roof over each. */
const NEED = [...TUNNEL.map((layers) => layers + 1), 4];
/** The same as `TUNNEL` for a chamber, by studs from its middle. */
const DOME: readonly [number, number][] = [
  [2.6, 5],
  [3.5, 3],
];
const CHAMBER = 4.5;
/** Steps the tunnel runs under its roof, at most and at least. */
const MAX_TUNNEL = 11;
const MIN_TUNNEL = 4;
/** Steps the open cut may run before the ground closes over it. */
const ENTRY = 12;
/** Layers the floor may step down on the way in. */
const MAX_DESCENT = 6;

/** Ground a cave can open into: not sand by the sea, ice, lava or marsh mud. */
const CAVE_GROUND: ReadonlySet<Biome> = new Set(['meadow', 'forest', 'desert', 'rock', 'snow']);

/** The column's top: its land, or the water over it. */
const top = (column: Column) => Math.max(column.height, column.water);

const DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * The chunk's cave, if its ground takes one: a mouth on open dry ground, a cut running in and
 * down until at least seven layers of ground stand over its floor, at least four studs of tunnel
 * under that roof, and a chamber at its end if the ground is wide enough round it.
 */
function findCave(terrain: Terrain, x0: number, z0: number, size: number): Cave | null {
  const { seed } = terrain;
  if (!terrain.caves) return null;
  const next = random(seed * 131 + 7 + Math.imul(x0, 83492791) + Math.imul(z0, 2971215073));
  if (next() >= CAVE_CHANCE) return null;
  // Four studs of the chunk kept clear all round: the strip its neighbours look at while they
  // smooth their own ground, where a carved column would no longer be the height they expect.
  const inside = (x: number, z: number, margin: number) =>
    x >= x0 + margin && x < x0 + size - margin && z >= z0 + margin && z < z0 + size - margin;
  for (let attempt = 0; attempt < CAVE_ATTEMPTS; attempt++) {
    const x = x0 + 5 + Math.floor(next() * (size - 10));
    const z = z0 + 5 + Math.floor(next() * (size - 10));
    const [dx, dz] = DIRECTIONS[Math.floor(next() * 4)];
    const mouth = terrain.column(x, z);
    if (mouth.water || !CAVE_GROUND.has(mouth.biome) || mouth.height <= WATER_LAYERS) continue;
    // Across the tunnel at a step: the columns either side, or null where one is out of bounds.
    const across = (k: number) => {
      const row: Column[] = [];
      for (let a = -HALF; a <= HALF; a++) {
        const cx = x + dx * k - dz * a;
        const cz = z + dz * k + dx * a;
        if (!inside(cx, cz, 4)) return null;
        const column = terrain.column(cx, cz);
        // Roads and gardens are never cut open.
        if (BUILT_BIOMES.has(column.biome)) return null;
        row.push(column);
      }
      return row;
    };
    const roofed = (row: Column[], floor: number) =>
      row.every(
        (column, index) => !column.water && column.height >= floor + NEED[Math.abs(index - HALF)],
      );
    // The cut: dry ground no lower than the floor either side, the floor stepping down a layer
    // every second stud, until the ground stands a full roof's height over it.
    const floors = [mouth.height];
    let floor = mouth.height;
    let entry = 0;
    for (let k = 1; k <= ENTRY && !entry; k++) {
      if (k % 2 === 0 && floor > 1 && mouth.height - floor < MAX_DESCENT) floor--;
      const row = across(k);
      if (!row || row.some((column) => column.water || column.height < floor)) break;
      floors.push(floor);
      if (roofed(row, floor)) entry = k;
    }
    if (!entry) continue;
    let end = entry;
    while (end - entry < MAX_TUNNEL) {
      const row = across(end + 1);
      if (!row || !roofed(row, floor)) break;
      floors.push(floor);
      end++;
    }
    if (end - entry + 1 < MIN_TUNNEL) continue;
    // A chamber where the ground is wide and whole enough round the tunnel, as far in as it
    // fits; the tunnel then ends in it.
    const fits = (step: number) => {
      const middle = { x: x + dx * step, z: z + dz * step };
      const reach = Math.ceil(CHAMBER);
      for (let oz = -reach; oz <= reach; oz++)
        for (let ox = -reach; ox <= reach; ox++) {
          const distance = Math.hypot(ox, oz);
          if (distance > CHAMBER) continue;
          const cx = middle.x + ox;
          const cz = middle.z + oz;
          const column = terrain.column(cx, cz);
          // The dome's middle needs a full roof over it; its rim and walls a layer over their own.
          const need = distance <= DOME[0][0] ? COVER : 4;
          if (!inside(cx, cz, 4) || column.water || column.height < floor + need) return null;
          if (BUILT_BIOMES.has(column.biome)) return null;
        }
      return middle;
    };
    let chamber: Cave['chamber'] = null;
    for (let step = end - 1; step >= entry + 2 && !chamber; step--) {
      chamber = fits(step);
      if (chamber) end = Math.min(end, step + 2);
    }
    floors.length = end + 1;
    return { mouth: { x, z }, dx, dz, floors, length: end, chamber };
  }
  return null;
}

/** The layers a cave leaves empty, per column, and its walls and roof coloured as one. */
function caveHollows(cave: Cave, carving: Carving) {
  const { hollows, tints } = carving;
  const { mouth, dx, dz, floors } = cave;
  const anchor = { x: mouth.x + dx, z: mouth.z + dz };
  const carve = (x: number, z: number, floor: number, layers: number) =>
    hollows.set(`${x},${z}`, { from: floor, to: floor + layers });
  for (let k = 1; k <= cave.length; k++)
    for (let a = -HALF; a <= HALF; a++) {
      const x = mouth.x + dx * k - dz * a;
      const z = mouth.z + dz * k + dx * a;
      tints.set(`${x},${z}`, anchor);
      if (Math.abs(a) < TUNNEL.length) carve(x, z, floors[k], TUNNEL[Math.abs(a)]);
    }
  if (cave.chamber) {
    const floor = floors[cave.length];
    const reach = Math.ceil(CHAMBER);
    for (let oz = -reach; oz <= reach; oz++)
      for (let ox = -reach; ox <= reach; ox++) {
        const distance = Math.hypot(ox, oz);
        const ring = DOME.find(([radius]) => distance <= radius);
        const x = cave.chamber.x + ox;
        const z = cave.chamber.z + oz;
        if (distance <= CHAMBER) tints.set(`${x},${z}`, anchor);
        const had = hollows.get(`${x},${z}`);
        if (ring && (!had || had.to - had.from < ring[1])) carve(x, z, floor, ring[1]);
      }
  }
}

/** Ground a cliff can lean out over: everything but lava, ice-free volcanoes and the water. */
const CLIFF_GROUND: ReadonlySet<Biome> = new Set([
  'beach',
  'meadow',
  'forest',
  'desert',
  'rock',
  'snow',
  'volcanic',
]);

/**
 * Overhangs: along stretches of the taller cliffs, the outermost stud of the face is cut away
 * for two or three layers at its foot, so the face above leans out over a dark notch, the way
 * a sea cliff is undercut by the waves. The cut is a stud deep, and the column behind it carries
 * the face above, so each column still rests on the one behind.
 */
function overhangHollows(terrain: Terrain, x0: number, z0: number, size: number, carving: Carving) {
  const { hollows, tints } = carving;
  const { seed } = terrain;
  // Two studs in, so the column behind the face is in the chunk too.
  for (let z = z0 + 2; z < z0 + size - 2; z++)
    for (let x = x0 + 2; x < x0 + size - 2; x++) {
      const key = `${x},${z}`;
      if (hollows.has(key)) continue;
      const column = terrain.column(x, z);
      if (column.water || !CLIFF_GROUND.has(column.biome) || !LAND_BIOMES.has(column.biome))
        continue;
      if (fbm(seed + 307, x, z, 9, 2) < 0.55) continue;
      for (const [dx, dz] of DIRECTIONS) {
        const foot = top(terrain.column(x + dx, z + dz));
        const face = column.height - foot;
        if (face < 4) continue;
        const depth = face >= 6 ? 3 : 2;
        // The column behind holds the face up: it must stand at least a layer over the cut.
        if (terrain.column(x - dx, z - dz).height < foot + depth + 1) continue;
        // A cut a stud wide along the face would leave the next column's face bare and flat;
        // only cut where the neighbours along the face are as tall, so the notch has sides.
        const side1 = terrain.column(x + dz, z + dx).height;
        const side2 = terrain.column(x - dz, z - dx).height;
        if (side1 < foot + depth + 1 || side2 < foot + depth + 1) continue;
        hollows.set(key, { from: foot, to: foot + depth });
        // The face over the cut bonds into the column behind it.
        const behind = { x: x - dx, z: z - dz };
        if (!tints.has(key)) tints.set(key, behind);
        if (!tints.has(`${behind.x},${behind.z}`)) tints.set(`${behind.x},${behind.z}`, behind);
        break;
      }
    }
}

/** What the chunk carves: its cave and its undercut cliffs. */
export function carveChunk(terrain: Terrain, x0: number, z0: number, size: number): Carving {
  const cave = findCave(terrain, x0, z0, size);
  const carving: Carving = { hollows: new Map(), tints: new Map(), cave };
  const { hollows } = carving;
  if (cave) caveHollows(cave, carving);
  overhangHollows(terrain, x0, z0, size, carving);
  // At the mouth, where the hillside is lower than the tunnel is tall, the cut opens to the sky.
  for (const [key, hollow] of hollows) {
    const [x, z] = key.split(',').map(Number);
    const { height } = terrain.column(x, z);
    const to = Math.min(hollow.to, height);
    if (to <= hollow.from) hollows.delete(key);
    else if (to !== hollow.to) hollows.set(key, { ...hollow, to });
  }
  return carving;
}
