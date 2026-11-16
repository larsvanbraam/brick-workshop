import {
  fillVoxelModel,
  getWorldBounds,
  smoothAssembly,
  validateAssembly,
} from '@brick-workshop/engine';
import type { Assembly, Brick } from '@brick-workshop/engine';
import { CHUNK, chunkKey } from '../chunks.ts';
import { carveChunk } from './caves.ts';
import { cellColor, waterColor } from './palette.ts';
import { plantChunk } from './plants.ts';
import type { Plant } from './plants.ts';
import { LAND_BIOMES, MAX_LAYERS, START, Terrain, WATER_LAYERS, volcanoAt } from './terrain.ts';
import type { Biome, Volcano } from './terrain.ts';

export { WATER_LAYERS };

/** The world the game shows for now: a board of 4 by 4 chunks round the start. */
export const WORLD_SIZE = 128;
/** Studs of neighbouring ground a chunk looks at while it smooths its own. */
const MARGIN = 3;
/** Where a chunk sits on the small board it is checked and smoothed on. */
const FRAME = 16;
const FRAME_SIZE = CHUNK + FRAME * 2;

export interface ChunkResult {
  key: string;
  /** The chunk's pieces, in world studs, each ID ending in `@` and the chunk's key. */
  bricks: Brick[];
  /** IDs of the pieces that form the ground, as opposed to plants. */
  terrain: string[];
}

const moved = (bricks: readonly Brick[], dx: number, dz: number) =>
  bricks.map((brick) => ({ ...brick, x: brick.x + dx, z: brick.z + dz }));

function inChunk(brick: Brick, x0: number, z0: number) {
  const bounds = getWorldBounds(brick);
  return (
    bounds.minX >= x0 - 1e-6 &&
    bounds.minZ >= z0 - 1e-6 &&
    bounds.maxX <= x0 + CHUNK + 1e-6 &&
    bounds.maxZ <= z0 + CHUNK + 1e-6
  );
}

/**
 * One chunk of the world, built on its own yet joining its neighbours: the ground of its columns
 * as brick layers with water up to its surface, its plants, and slopes, round corners and flowers
 * where the ground steps. It looks at a strip of its neighbours' ground and at their trees that
 * reach over its edges, so its slopes lean on steps across the edge and its plants keep clear of
 * theirs, but it only ever keeps pieces of its own.
 */
export function generateChunk(
  seed: number,
  cx: number,
  cz: number,
  terrain: Terrain = new Terrain(seed),
  /**
   * A board's size, when the world has one: plants that would reach past its edges are left out.
   * `Infinity` for a world without edges.
   */
  limit = WORLD_SIZE,
): ChunkResult {
  const key = chunkKey(cx, cz);
  const suffix = `@${key}`;
  const x0 = cx * CHUNK;
  const z0 = cz * CHUNK;
  const tag = (bricks: readonly Brick[]) =>
    bricks.map((brick) => ({ ...brick, id: brick.id + suffix }));

  // The ground: each column's layers, coloured by biome and depth, and water to its surface,
  // with the chunk's cave and undercut cliffs left empty.
  const carving = carveChunk(terrain, x0, z0, CHUNK);
  const cells: (number | null)[] = new Array(CHUNK * CHUNK * MAX_LAYERS).fill(null);
  for (let lz = 0; lz < CHUNK; lz++)
    for (let lx = 0; lx < CHUNK; lx++) {
      const x = x0 + lx;
      const z = z0 + lz;
      const { height, water } = terrain.column(x, z);
      const hollow = carving.hollows.get(`${x},${z}`);
      const tint = carving.tints.get(`${x},${z}`) ?? { x, z };
      for (let layer = 0; layer < height; layer++) {
        if (hollow && layer >= hollow.from && layer < hollow.to) continue;
        cells[(layer * CHUNK + lz) * CHUNK + lx] = cellColor(
          terrain,
          tint.x,
          tint.z,
          height - 1 - layer,
          layer,
        );
      }
      if (water > height) {
        const color = waterColor(seed, x, z, water - height);
        for (let layer = height; layer < water; layer++)
          cells[(layer * CHUNK + lz) * CHUNK + lx] = color;
      }
    }
  const fill = fillVoxelModel(
    { name: `Chunk ${key}`, width: CHUNK, depth: CHUNK, layers: MAX_LAYERS, cells },
    { buildArea: CHUNK, details: false },
  );
  const ground = tag(moved(fill.assembly.bricks, x0 - fill.origin.x, z0 - fill.origin.z));
  const groundIds = new Set(ground.map((brick) => brick.id));

  // The neighbours' ground round the edge, as plain stacks: only their height matters here.
  const margin: Brick[] = [];
  for (let z = z0 - MARGIN; z < z0 + CHUNK + MARGIN; z++)
    for (let x = x0 - MARGIN; x < x0 + CHUNK + MARGIN; x++) {
      if (x >= x0 && x < x0 + CHUNK && z >= z0 && z < z0 + CHUNK) continue;
      const { height, water } = terrain.column(x, z);
      for (let layer = 0; layer < Math.max(height, water); layer++)
        margin.push({
          id: `margin-${margin.length}`,
          partId: '3005',
          color: 71,
          x,
          y: layer * 3,
          z,
          rotation: 0,
        });
    }

  // Plants, checked against the ground and the neighbours' trees: any that do not fit are left
  // out, until the rest all do.
  const { plants: grown, nearby, priorities } = plantChunk(terrain, x0, z0, CHUNK, carving);
  const priorityOf = (id: string) => priorities.get(id.split('-')[0]);
  const onBoard = (pieces: Plant) =>
    !Number.isFinite(limit) ||
    pieces.every((brick) => {
      const bounds = getWorldBounds(brick);
      return (
        bounds.minX >= -1e-6 &&
        bounds.minZ >= -1e-6 &&
        bounds.maxX <= limit + 1e-6 &&
        bounds.maxZ <= limit + 1e-6
      );
    });
  let plants: Plant[] = grown.map(tag).filter((pieces) => pieces.length && onBoard(pieces));
  const local = (bricks: readonly Brick[]) => moved(bricks, FRAME - x0, FRAME - z0);

  // Buildings: the chunk builds those it owns, and keeps its plants and slopes clear of every one
  // that reaches onto the board it is checked on.
  const reach = terrain.structuresIn(
    x0 - FRAME,
    z0 - FRAME,
    x0 + CHUNK + FRAME,
    z0 + CHUNK + FRAME,
  );
  const owned = reach
    .filter(
      (structure) =>
        chunkKey(Math.floor(structure.anchor.x / CHUNK), Math.floor(structure.anchor.z / CHUNK)) ===
        key,
    )
    .flatMap((structure) => tag(structure.pieces()));
  const standing = local(reach.flatMap((structure) => structure.pieces())).filter((brick) => {
    const bounds = getWorldBounds(brick);
    return (
      bounds.minX >= 0 && bounds.minZ >= 0 && bounds.maxX <= FRAME_SIZE && bounds.maxZ <= FRAME_SIZE
    );
  });
  const context = [...local([...ground, ...nearby]), ...standing];
  for (let round = 0; round < 8 && plants.length; round++) {
    const issues = validateAssembly({
      name: 'plants',
      bricks: [...context, ...local(plants.flat())],
      buildArea: FRAME_SIZE,
    });
    const bad = new Set<string>();
    for (const issue of issues) {
      if (!/^(tree|plant|sight|cave)/.test(issue.brickId)) continue;
      // Where two crowns meet, the weaker tree gives way: every chunk that sees the pair makes
      // the same choice, so a tree is never kept on one side of an edge and lost on the other.
      if (issue.code === 'collision') {
        const other = /Overlaps piece (.+)\.$/.exec(issue.message)?.[1];
        const mine = priorityOf(issue.brickId);
        const theirs = other === undefined ? undefined : priorityOf(other);
        if (mine !== undefined && theirs !== undefined && mine > theirs) continue;
      }
      bad.add(issue.brickId.split('-')[0]);
    }
    if (!bad.size) break;
    plants = plants.filter((pieces) => !bad.has(pieces[0].id.split('-')[0]));
    if (round === 7) plants = [];
  }
  const planted = plants.flat();

  // Round the ground off: slopes against steps, round corners and flowers on green tops, with
  // studs left open to build on. The neighbours' strip counts as ground too, so steps across the
  // edge get their slopes; whatever lands outside the chunk is theirs to build and is dropped.
  let next = 0;
  const smoothed = smoothAssembly(
    {
      name: 'smoothing',
      bricks: [...local([...ground, ...margin, ...planted, ...nearby]), ...standing],
      buildArea: FRAME_SIZE,
    },
    {
      ids: new Set([...groundIds, ...margin.map((brick) => brick.id)]),
      tiles: false,
      accents: true,
      accentDensity: 0.04,
      nextId: () => `ground-${next++}${suffix}`,
    },
  );
  const result = moved(smoothed.assembly.bricks, x0 - FRAME, z0 - FRAME);
  const kept = result.filter(
    (brick) =>
      groundIds.has(brick.id) ||
      (brick.id.startsWith('ground-') && brick.id.endsWith(suffix) && inChunk(brick, x0, z0)),
  );
  const paved = paveChunk(
    terrain,
    x0,
    z0,
    carving,
    // Every structure that reaches this chunk, not just the ones it owns: a building that spills
    // over the edge has pieces here, and tiles laid under them would overlap and flicker.
    [...kept, ...planted, ...reach.flatMap((structure) => structure.pieces())],
    suffix,
  );
  const groundPieces = [...kept, ...paved];
  return {
    key,
    bricks: [...groundPieces, ...planted, ...owned],
    terrain: groundPieces.map((brick) => brick.id),
  };
}

/** Ground that gets a smooth top of tiles: roads and pavements, which wheels will run on. */
const PAVED: ReadonlySet<Biome> = new Set(['road', 'pavement']);

/**
 * Tiles over the chunk's roads and pavements, in their ground's colours (centre lines and
 * kerbs included), wherever nothing already stands on the stud: 2 x 2 where four studs of one
 * colour and height meet, else 1 x 2 or 1 x 1.
 */
function paveChunk(
  terrain: Terrain,
  x0: number,
  z0: number,
  carving: ReturnType<typeof carveChunk>,
  standing: readonly Brick[],
  suffix: string,
): Brick[] {
  const top = new Map<string, { height: number; color: number }>();
  for (let z = z0; z < z0 + CHUNK; z++)
    for (let x = x0; x < x0 + CHUNK; x++) {
      const column = terrain.column(x, z);
      if (!PAVED.has(column.biome) || column.water || carving.hollows.has(`${x},${z}`)) continue;
      top.set(`${x},${z}`, {
        height: column.height,
        color: cellColor(terrain, x, z, 0, column.height - 1),
      });
    }
  if (!top.size) return [];
  // Studs something already stands on: a slope, a plant, a building, a lamppost.
  for (const brick of standing) {
    const bounds = getWorldBounds(brick);
    for (let z = Math.floor(bounds.minZ); z < Math.ceil(bounds.maxZ); z++)
      for (let x = Math.floor(bounds.minX); x < Math.ceil(bounds.maxX); x++) {
        const cell = top.get(`${x},${z}`);
        if (cell && bounds.minY <= cell.height * 3 && bounds.maxY > cell.height * 3)
          top.delete(`${x},${z}`);
      }
  }
  const tiles: Brick[] = [];
  const add = (
    partId: string,
    x: number,
    z: number,
    rotation: 0 | 90,
    cell: { height: number; color: number },
  ) =>
    tiles.push({
      id: `ground-tile${tiles.length}${suffix}`,
      partId,
      color: cell.color,
      x,
      y: cell.height * 3,
      z,
      rotation,
    });
  const same = (
    a: { height: number; color: number } | undefined,
    b: { height: number; color: number },
  ) => a !== undefined && a.height === b.height && a.color === b.color;
  for (let z = z0; z < z0 + CHUNK; z++)
    for (let x = x0; x < x0 + CHUNK; x++) {
      const cell = top.get(`${x},${z}`);
      if (!cell) continue;
      const right = top.get(`${x + 1},${z}`);
      const below = top.get(`${x},${z + 1}`);
      const corner = top.get(`${x + 1},${z + 1}`);
      if (same(right, cell) && same(below, cell) && same(corner, cell)) {
        add('3068b', x, z, 0, cell);
        for (const key of [`${x},${z}`, `${x + 1},${z}`, `${x},${z + 1}`, `${x + 1},${z + 1}`])
          top.delete(key);
      } else if (same(right, cell)) {
        add('3069b', x, z, 90, cell);
        top.delete(`${x},${z}`);
        top.delete(`${x + 1},${z}`);
      } else if (same(below, cell)) {
        add('3069b', x, z, 0, cell);
        top.delete(`${x},${z}`);
        top.delete(`${x},${z + 1}`);
      } else {
        add('3070b', x, z, 0, cell);
        top.delete(`${x},${z}`);
      }
    }
  return tiles;
}

/** The chunks the board covers. */
export function boardChunks(): [number, number][] {
  const chunks: [number, number][] = [];
  for (let cz = 0; cz < WORLD_SIZE / CHUNK; cz++)
    for (let cx = 0; cx < WORLD_SIZE / CHUNK; cx++) chunks.push([cx, cz]);
  return chunks;
}

/**
 * The dry stud closest to the start, on open ground rather than rock, water or a volcano, and
 * clear of trees, so the walker does not begin up in a crown.
 */
export function findSpawn(terrain: Terrain): { x: number; z: number } {
  const { start } = terrain;
  const open = (x: number, z: number) => {
    const column = terrain.column(x, z);
    return (
      LAND_BIOMES.has(column.biome) &&
      !['rock', 'volcanic', 'lava'].includes(column.biome) &&
      !column.water &&
      terrain.treesIn(x - 8, z - 8, x + 9, z + 9).length === 0
    );
  };
  for (let radius = 0; radius < WORLD_SIZE / 2; radius++)
    for (let dz = -radius; dz <= radius; dz++)
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const x = start.x + dx;
        const z = start.z + dz;
        if (open(x, z)) return { x: x + 0.5, z: z + 0.5 };
      }
  return { x: start.x + 0.5, z: start.z + 0.5 };
}

export interface World {
  seed: number;
  assembly: Assembly;
  /** Where to start: a stud on dry land near the start, in world studs. */
  spawn: { x: number; z: number };
  /** IDs of the pieces that form the ground, as opposed to plants and what players add. */
  terrain: ReadonlySet<string>;
  /** The volcano near the start, if there is one, for the glow over its crater. */
  volcano: Volcano | null;
}

/** The whole board, chunk by chunk: what the tests check, and a whole world at once. */
export function generateWorld(seed: number): World {
  const terrain = new Terrain(seed);
  const bricks: Brick[] = [];
  const ids = new Set<string>();
  for (const [cx, cz] of boardChunks()) {
    const chunk = generateChunk(seed, cx, cz, terrain);
    bricks.push(...chunk.bricks);
    for (const id of chunk.terrain) ids.add(id);
  }
  return {
    seed,
    assembly: { name: `World ${seed}`, bricks, buildArea: WORLD_SIZE },
    spawn: findSpawn(terrain),
    terrain: ids,
    volcano: volcanoAt(seed, START.x, START.z),
  };
}
