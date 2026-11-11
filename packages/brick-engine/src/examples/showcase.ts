import { BUILD_AREA } from '../core.ts';
import type { Part, Rotation } from '../core.ts';
import type { ExampleBrickAdder } from './types.ts';

/** LDraw colours by family: an earthy, building-like palette rather than primaries. */
const FAMILY_COLORS: Partial<Record<NonNullable<Part['family']>, number>> = {
  tall: 28, // Dark Tan
  slope: 320, // Dark Red, like roof tiles
  round: 379, // Sand Blue
  cone: 484, // Dark Orange
  arch: 71, // Light Bluish Grey, like stone
  baseplate: 288, // Dark Green
  door: 70, // Reddish Brown
  window: 15, // White
  detail: 72, // Dark Bluish Grey
  foliage: 288, // Dark Green
};

function showcaseColor(part: Part) {
  if (part.name.startsWith('Glass')) return 47; // Trans Clear
  if (part.id === '24866') return 191; // Bright Light Orange flower
  if (part.family && FAMILY_COLORS[part.family]) return FAMILY_COLORS[part.family]!;
  return part.kind === 'tile' ? 71 : part.kind === 'plate' ? 378 : 19; // Light Bluish Grey, Sand Green, Tan
}

export function createShowcase(parts: readonly Part[], buildArea = BUILD_AREA, gap: 0.5 | 1 = 1) {
  const placements: Parameters<ExampleBrickAdder>[] = [];
  const resolution = 1 / gap;
  const cells = buildArea * resolution;
  const occupied = Array.from({ length: cells }, () => Array<boolean>(cells).fill(false));
  const ordered = [...parts].sort(
    (first, second) =>
      second.width * second.depth - first.width * first.depth || first.id.localeCompare(second.id),
  );
  for (const part of ordered) {
    let location:
      | { x: number; z: number; rotation: Rotation; width: number; depth: number }
      | undefined;
    for (const rotation of [0, 90] as const) {
      const width = Math.ceil((rotation === 0 ? part.width : part.depth) * resolution);
      const depth = Math.ceil((rotation === 0 ? part.depth : part.width) * resolution);
      for (let z = 0; z <= cells - depth && !location; z++)
        for (let x = 0; x <= cells - width && !location; x++)
          if (
            occupied
              .slice(x, x + width)
              .every((column) => column.slice(z, z + depth).every((cell) => !cell))
          )
            location = { x, z, rotation, width, depth };
      if (location) break;
    }
    if (!location)
      throw new Error(
        `No showcase position for ${part.id} on the ${buildArea} x ${buildArea} board.`,
      );
    const { x, z, rotation, width, depth } = location;
    placements.push([part.id, showcaseColor(part), x / resolution, 0, z / resolution, rotation]);
    for (let column = Math.max(0, x - 1); column < Math.min(cells, x + width + 1); column++)
      for (let row = Math.max(0, z - 1); row < Math.min(cells, z + depth + 1); row++)
        occupied[column][row] = true;
  }
  return placements;
}
