import { describe, expect, it } from 'vite-plus/test';
import { footprint, validateAssembly } from '@brick-workshop/engine';
import { CHUNK } from '../chunks.ts';
import { carveChunk } from './caves.ts';
import { generateChunk } from './generate.ts';
import { glowsNear } from './glows.ts';
import { chunkSight } from './plants.ts';
import { Terrain } from './terrain.ts';

/** The chunks of a square of the world round the origin, `radius` chunks out each way. */
function chunks(radius: number) {
  const found: [number, number][] = [];
  for (let cz = -radius; cz < radius; cz++)
    for (let cx = -radius; cx < radius; cx++) found.push([cx, cz]);
  return found;
}

/** Every stud-and-plate cell the pieces fill, keyed `x,y,z`. */
function filledCells(bricks: Parameters<typeof footprint>[0][]) {
  const filled = new Set<string>();
  for (const brick of bricks) {
    const { width, depth, height } = footprint(brick);
    for (let x = 0; x < width; x++)
      for (let z = 0; z < depth; z++)
        for (let y = 0; y < height; y++)
          filled.add(`${Math.floor(brick.x) + x},${brick.y + y},${Math.floor(brick.z) + z}`);
  }
  return filled;
}

describe('caves and overhangs', () => {
  const seed = 1234;
  const terrain = new Terrain(seed);
  const carvings = chunks(4).map(([cx, cz]) => ({
    cx,
    cz,
    carving: carveChunk(terrain, cx * CHUNK, cz * CHUNK, CHUNK),
  }));

  it('finds caves, some with chambers, and undercut cliffs', () => {
    const caves = carvings.filter(({ carving }) => carving.cave);
    expect(caves.length).toBeGreaterThanOrEqual(3);
    expect(caves.some(({ carving }) => carving.cave?.chamber)).toBe(true);
    // An overhang's cut takes the colours of the column behind it; a cave's, of its mouth.
    const overhangs = carvings.filter(({ carving }) =>
      [...carving.hollows.keys()].some((key) => {
        const tint = carving.tints.get(key)!;
        const { cave } = carving;
        return !cave || tint.x !== cave.mouth.x + cave.dx || tint.z !== cave.mouth.z + cave.dz;
      }),
    );
    expect(overhangs.length).toBeGreaterThan(0);
  });

  it('carves only inside its chunk, clear of the strip its neighbours look at', () => {
    for (const { cx, cz, carving } of carvings) {
      for (const key of carving.hollows.keys()) {
        const [x, z] = key.split(',').map(Number);
        expect(x).toBeGreaterThanOrEqual(cx * CHUNK + 2);
        expect(x).toBeLessThan((cx + 1) * CHUNK - 2);
        expect(z).toBeGreaterThanOrEqual(cz * CHUNK + 2);
        expect(z).toBeLessThan((cz + 1) * CHUNK - 2);
      }
      // A cave, which can open a column to the sky, stays four studs in.
      const { cave } = carving;
      if (!cave) continue;
      for (const [key, hollow] of carving.hollows) {
        if (hollow.from > cave.floors[0]) continue;
        const [x, z] = key.split(',').map(Number);
        expect(Math.min(x - cx * CHUNK, (cx + 1) * CHUNK - 1 - x)).toBeGreaterThanOrEqual(4);
        expect(Math.min(z - cz * CHUNK, (cz + 1) * CHUNK - 1 - z)).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('leaves a minifigure room to walk the tunnel, down steps it can climb', () => {
    for (const { carving } of carvings) {
      const { cave } = carving;
      if (!cave) continue;
      for (let k = 1; k <= cave.length; k++) {
        const x = cave.mouth.x + cave.dx * k;
        const z = cave.mouth.z + cave.dz * k;
        const { height } = terrain.column(x, z);
        const hollow = carving.hollows.get(`${x},${z}`);
        // Ground already level with the floor needs no cut.
        if (!hollow) {
          expect(height).toBe(cave.floors[k]);
          continue;
        }
        expect(hollow.from).toBe(cave.floors[k]);
        // Under a roof, five layers over the middle of the floor: a minifigure is four bricks tall.
        if (hollow.to < height) expect(hollow.to - hollow.from).toBeGreaterThanOrEqual(5);
        // A brick at a time at most: the walker steps up one without jumping.
        expect(Math.abs(cave.floors[k] - cave.floors[k - 1])).toBeLessThanOrEqual(1);
      }
    }
  });

  it('roofs its caves: the ground over the hollows still stands', { timeout: 60_000 }, () => {
    let roofs = 0;
    let missing = 0;
    for (const { cx, cz, carving } of carvings) {
      if (!carving.cave) continue;
      const chunk = generateChunk(seed, cx, cz, terrain, Infinity);
      const filled = filledCells(chunk.bricks);
      for (const [key, hollow] of carving.hollows) {
        const [x, z] = key.split(',').map(Number);
        const { height } = terrain.column(x, z);
        if (hollow.to >= height) continue;
        // The top of the column over the hollow, where the walker would fall through.
        roofs++;
        if (!filled.has(`${x},${(height - 1) * 3},${z}`)) missing++;
      }
    }
    expect(roofs).toBeGreaterThan(100);
    expect(missing / roofs).toBeLessThan(0.1);
  });

  it('builds a chunk with a cave and its props into a valid assembly', { timeout: 60_000 }, () => {
    const { cx, cz } = carvings.find(({ carving }) => carving.cave?.chamber)!;
    const chunk = generateChunk(seed, cx, cz, terrain, Infinity);
    const local = chunk.bricks.map((brick) => ({
      ...brick,
      x: brick.x - cx * CHUNK + 8,
      z: brick.z - cz * CHUNK + 8,
    }));
    expect(validateAssembly({ name: 'cave', bricks: local, buildArea: CHUNK + 16 })).toEqual([]);
    const props = new Set(
      chunk.bricks.filter((brick) => brick.id.startsWith('cave')).map((brick) => brick.partId),
    );
    expect(props.has('4589')).toBe(true);
  });
});

describe('sights', () => {
  const seed = 1234;
  const terrain = new Terrain(seed);

  it('puts sights of several kinds in the world, each inside its chunk', () => {
    const kinds = new Set<string>();
    for (const [cx, cz] of chunks(4)) {
      const x0 = cx * CHUNK;
      const z0 = cz * CHUNK;
      const sight = chunkSight(terrain, carveChunk(terrain, x0, z0, CHUNK), x0, z0, CHUNK);
      if (!sight) continue;
      kinds.add(sight.kind);
      for (const brick of sight.pieces) {
        expect(brick.x).toBeGreaterThanOrEqual(x0);
        expect(brick.x).toBeLessThan(x0 + CHUNK);
        expect(brick.z).toBeGreaterThanOrEqual(z0);
        expect(brick.z).toBeLessThan(z0 + CHUNK);
      }
    }
    expect(kinds.size).toBeGreaterThanOrEqual(4);
  });

  it('lights the nearest campfire and cave crystals where the chunks place them', () => {
    let fires = 0;
    let crystals = 0;
    for (const [cx, cz] of chunks(3)) {
      const { fire, crystal } = glowsNear(terrain, cx, cz);
      if (fire) fires++;
      if (crystal) {
        crystals++;
        // Over a chamber: the crystals' light is under the ground's top there.
        const column = terrain.column(Math.floor(crystal.x), Math.floor(crystal.z));
        expect(crystal.y).toBeLessThan(column.height * 3);
      }
    }
    expect(fires).toBeGreaterThan(0);
    expect(crystals).toBeGreaterThan(0);
  });
});
