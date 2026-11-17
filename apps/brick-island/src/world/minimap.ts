import { COLORS } from '@brick-workshop/engine';
import type { Biome } from '@brick-workshop/game/world/terrain.ts';
import { islandColumn } from './column.ts';
import { islandStructures } from './structures.ts';

/**
 * Brick Island drawn from above for the minimap: every two studs a pixel, coloured by what the
 * ground is, shaded so hills catch the light from the north-west, with roads on top and each
 * building as a block of its roof's colour.
 */

/** The map covers this box of world studs, a little sea round the island. */
export const MAP_BOUNDS = { x0: -40, z0: -40, x1: 680, z1: 560 } as const;
/** Studs per pixel. */
export const MAP_STEP = 2;
export const MAP_WIDTH = (MAP_BOUNDS.x1 - MAP_BOUNDS.x0) / MAP_STEP;
export const MAP_HEIGHT = (MAP_BOUNDS.z1 - MAP_BOUNDS.z0) / MAP_STEP;

const GROUND: Record<Biome, number> = {
  sea: 0x3a78bd,
  river: 0x5aa2de,
  beach: 0xe6d29a,
  meadow: 0x7db458,
  forest: 0x3d7a3e,
  desert: 0xe0c27a,
  marsh: 0x6f8f4c,
  snow: 0xf4f4f0,
  rock: 0x9c9b95,
  volcanic: 0x55524e,
  lava: 0xe2582a,
  road: 0x4b4e54,
  pavement: 0xbdb9ae,
  yard: 0x8fc566,
  field: 0x9f6d3f,
};

const hexOf = new Map(COLORS.map((color) => [color.id, Number.parseInt(color.hex.slice(1), 16)]));

/** The island as RGBA pixels, `MAP_WIDTH` by `MAP_HEIGHT`. */
export function drawIslandMap(seed: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(MAP_WIDTH * MAP_HEIGHT * 4);
  const heights = new Float32Array(MAP_WIDTH * MAP_HEIGHT);
  const columns = [];
  for (let py = 0; py < MAP_HEIGHT; py++)
    for (let px = 0; px < MAP_WIDTH; px++) {
      const column = islandColumn(
        seed,
        MAP_BOUNDS.x0 + px * MAP_STEP,
        MAP_BOUNDS.z0 + py * MAP_STEP,
      );
      heights[py * MAP_WIDTH + px] = column.water ? column.water : column.height;
      columns.push(column);
    }
  for (let py = 0; py < MAP_HEIGHT; py++)
    for (let px = 0; px < MAP_WIDTH; px++) {
      const i = py * MAP_WIDTH + px;
      const column = columns[i];
      let color = GROUND[column.biome];
      let shade = 1;
      if (column.water) {
        // Deeper water darker.
        shade = 1 - Math.min(3, column.water - column.height - 1) * 0.08;
      } else {
        // Light from the north-west: a slope facing it is lit, one facing away in shadow.
        const behind = heights[Math.max(0, py - 1) * MAP_WIDTH + Math.max(0, px - 1)];
        shade = 1 + Math.max(-0.25, Math.min(0.2, (heights[i] - behind) * 0.12));
        shade *= 0.94 + Math.min(heights[i], 18) * 0.008;
      }
      if (column.paint === 15 && column.biome === 'road') color = 0xe8e8e8;
      pixels[i * 4] = Math.min(255, ((color >> 16) & 255) * shade);
      pixels[i * 4 + 1] = Math.min(255, ((color >> 8) & 255) * shade);
      pixels[i * 4 + 2] = Math.min(255, (color & 255) * shade);
      pixels[i * 4 + 3] = 255;
    }
  for (const structure of islandStructures(seed)) {
    if (structure.id.startsWith('lamp')) continue;
    const color = hexOf.get(structure.color) ?? 0x888888;
    const { x0, z0, x1, z1 } = structure.bounds;
    for (let z = z0; z < z1; z += 1)
      for (let x = x0; x < x1; x += 1) {
        const px = Math.floor((x - MAP_BOUNDS.x0) / MAP_STEP);
        const py = Math.floor((z - MAP_BOUNDS.z0) / MAP_STEP);
        if (px < 0 || py < 0 || px >= MAP_WIDTH || py >= MAP_HEIGHT) continue;
        const i = py * MAP_WIDTH + px;
        // A darker rim round each building, so neighbours stay apart.
        const rim =
          x - x0 < MAP_STEP || z - z0 < MAP_STEP || x1 - x <= MAP_STEP || z1 - z <= MAP_STEP;
        const shade = rim ? 0.7 : 1;
        pixels[i * 4] = ((color >> 16) & 255) * shade;
        pixels[i * 4 + 1] = ((color >> 8) & 255) * shade;
        pixels[i * 4 + 2] = (color & 255) * shade;
      }
  }
  return pixels;
}
