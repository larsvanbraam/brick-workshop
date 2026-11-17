import { COLORS, PLATE_HEIGHT } from '@brick-workshop/engine';
import { CHUNK, chunkKey } from '../chunks.ts';
import { cellColor, waterColor } from './palette.ts';
import type { Terrain } from './terrain.ts';

/** Studs per cell of a far chunk: two by two columns make one, a quarter of the work. */
export const FAR_STEP = 2;
const CELLS = CHUNK / FAR_STEP;
/** One brick layer in scene units: three plates. */
const LAYER = 3 * PLATE_HEIGHT;
/** Sides darken a little, so steps read against the tops. */
const SIDE_SHADE = 0.72;
/** Crown greens, a tree taking one by where it stands so a wood is not one flat colour. */
const CROWNS = [0x184632, 0x1d5237, 0x24603a, 0x2c6b3a] as const;
const TRUNK = 0x582a12;

/**
 * A chunk seen from far off, as a mesh ready to draw: no pieces, only the top of its ground in
 * cells of a few studs, a darker side wherever a cell stands above its neighbour, and a crown on
 * a trunk for each tree. Built off the main thread; the game draws it in the ring past the chunks
 * it loads in full, so the world reaches further than it is built.
 */
export interface FarChunk {
  key: string;
  cx: number;
  cz: number;
  /** Triangles in scene units for a frame of `frame` studs: positions, normals, linear colours. */
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
}

const hexOf = new Map(COLORS.map((color) => [color.id, Number.parseInt(color.hex.slice(1), 16)]));

/** An sRGB channel, 0 to 255, as a linear one, 0 to 1: what vertex colours expect. */
const linear = (channel: number) => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const rgb = (hex: number, shade = 1): [number, number, number] => [
  linear((hex >> 16) & 255) * shade,
  linear((hex >> 8) & 255) * shade,
  linear(hex & 255) * shade,
];

type Point = [number, number, number];

/** Every cell's surface from the terrain alone, the same columns the full chunk is built from. */
export function farChunk(terrain: Terrain, cx: number, cz: number, frame: number): FarChunk {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const half = frame / 2;
  // Build-grid studs to scene units: the scene centres the frame and runs z the other way.
  const sx = (x: number) => x - half;
  const sz = (z: number) => half - z;
  const quad = (a: Point, b: Point, c: Point, d: Point, _facing: Point, tint: Point) => {
    // The normal follows the winding, so faces light the way they are drawn.
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;
    for (const point of [a, b, c, a, c, d]) {
      positions.push(...point);
      normals.push(nx, ny, nz);
      colors.push(...tint);
    }
  };
  const UP: Point = [0, 1, 0];
  const box = (
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    y0: number,
    y1: number,
    hex: number,
  ) => {
    const top = rgb(hex);
    const side = rgb(hex, SIDE_SHADE);
    quad(
      [sx(x0), y1, sz(z0)],
      [sx(x0), y1, sz(z1)],
      [sx(x1), y1, sz(z1)],
      [sx(x1), y1, sz(z0)],
      UP,
      top,
    );
    quad(
      [sx(x0), y0, sz(z1)],
      [sx(x1), y0, sz(z1)],
      [sx(x1), y1, sz(z1)],
      [sx(x0), y1, sz(z1)],
      [0, 0, -1],
      side,
    );
    quad(
      [sx(x1), y0, sz(z0)],
      [sx(x0), y0, sz(z0)],
      [sx(x0), y1, sz(z0)],
      [sx(x1), y1, sz(z0)],
      [0, 0, 1],
      side,
    );
    quad(
      [sx(x0), y0, sz(z0)],
      [sx(x0), y0, sz(z1)],
      [sx(x0), y1, sz(z1)],
      [sx(x0), y1, sz(z0)],
      [-1, 0, 0],
      side,
    );
    quad(
      [sx(x1), y0, sz(z1)],
      [sx(x1), y0, sz(z0)],
      [sx(x1), y1, sz(z0)],
      [sx(x1), y1, sz(z1)],
      [1, 0, 0],
      side,
    );
  };

  const heights: number[] = [];
  const hexes: number[] = [];
  for (let z = 0; z < CELLS; z++)
    for (let x = 0; x < CELLS; x++) {
      // A cell takes its first column's look: near enough at this distance.
      const wx = cx * CHUNK + x * FAR_STEP;
      const wz = cz * CHUNK + z * FAR_STEP;
      const column = terrain.column(wx, wz);
      const color =
        column.water > column.height
          ? waterColor(terrain.seed, wx, wz, column.water - column.height)
          : cellColor(terrain, wx, wz, 0, column.height - 1);
      heights.push(Math.max(column.height, column.water));
      hexes.push(hexOf.get(color) ?? 0x808080);
    }
  const height = (x: number, z: number) =>
    x < 0 || z < 0 || x >= CELLS || z >= CELLS ? 0 : heights[z * CELLS + x];
  for (let z = 0; z < CELLS; z++)
    for (let x = 0; x < CELLS; x++) {
      const top = heights[z * CELLS + x] * LAYER;
      const tint = rgb(hexes[z * CELLS + x]);
      const side = rgb(hexes[z * CELLS + x], SIDE_SHADE);
      const x0 = cx * CHUNK + x * FAR_STEP;
      const z0 = cz * CHUNK + z * FAR_STEP;
      const x1 = x0 + FAR_STEP;
      const z1 = z0 + FAR_STEP;
      quad(
        [sx(x0), top, sz(z0)],
        [sx(x0), top, sz(z1)],
        [sx(x1), top, sz(z1)],
        [sx(x1), top, sz(z0)],
        UP,
        tint,
      );
      // A side wherever the neighbour stands lower: down to its top inside the chunk, and down
      // to the board at the chunk's edge, where the ground next door covers what is not needed.
      const sides: [number, number, number, number, number, number, Point][] = [
        [x + 1, z, x1, z1, x1, z0, [1, 0, 0]],
        [x - 1, z, x0, z0, x0, z1, [-1, 0, 0]],
        [x, z + 1, x0, z1, x1, z1, [0, 0, -1]],
        [x, z - 1, x1, z0, x0, z0, [0, 0, 1]],
      ];
      for (const [nx, nz, ax, az, bx, bz, normal] of sides) {
        const below = height(nx, nz) * LAYER;
        if (below >= top) continue;
        quad(
          [sx(ax), below, sz(az)],
          [sx(bx), below, sz(bz)],
          [sx(bx), top, sz(bz)],
          [sx(ax), top, sz(az)],
          normal,
          side,
        );
      }
    }
  for (const tree of terrain.treesIn(cx * CHUNK, cz * CHUNK, (cx + 1) * CHUNK, (cz + 1) * CHUNK)) {
    const base = tree.base * LAYER;
    box(tree.x, tree.z, tree.x + 1, tree.z + 1, base, base + 6, TRUNK);
    // A crown as three steps narrowing upward, a dome from afar instead of a block.
    const crown = CROWNS[Math.abs(Math.imul(tree.x, 73856093) ^ Math.imul(tree.z, 19349663)) % 4];
    box(tree.x - 4, tree.z - 4, tree.x + 5, tree.z + 5, base + 5, base + 7.5, crown);
    box(tree.x - 3, tree.z - 3, tree.x + 4, tree.z + 4, base + 7.5, base + 9.5, crown);
    box(tree.x - 1, tree.z - 1, tree.x + 2, tree.z + 2, base + 9.5, base + 11, crown);
  }
  // Buildings as plain blocks in their main colour, owned like their pieces by their anchor's chunk.
  for (const structure of terrain.structuresIn(
    cx * CHUNK,
    cz * CHUNK,
    (cx + 1) * CHUNK,
    (cz + 1) * CHUNK,
  )) {
    const { anchor, bounds, color } = structure;
    if (Math.floor(anchor.x / CHUNK) !== cx || Math.floor(anchor.z / CHUNK) !== cz) continue;
    const hex = hexOf.get(color) ?? 0x888888;
    box(
      bounds.x0,
      bounds.z0,
      bounds.x1,
      bounds.z1,
      bounds.bottom * PLATE_HEIGHT,
      bounds.top * PLATE_HEIGHT,
      hex,
    );
  }
  return {
    key: chunkKey(cx, cz),
    cx,
    cz,
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
  };
}
