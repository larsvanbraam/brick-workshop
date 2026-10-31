import { BUILD_AREA } from '../core.ts';
import type { Part, Rotation } from '../core.ts';
import type { ExampleBrickAdder } from './types.ts';

export function createShowcase(parts: readonly Part[], buildArea = BUILD_AREA) {
  const placements: Parameters<ExampleBrickAdder>[] = [];
  const occupied = Array.from({ length: buildArea }, () => Array<boolean>(buildArea).fill(false));
  const ordered = [...parts].sort(
    (first, second) =>
      second.width * second.depth - first.width * first.depth || first.id.localeCompare(second.id),
  );
  for (const part of ordered) {
    let location:
      | { x: number; z: number; rotation: Rotation; width: number; depth: number }
      | undefined;
    for (const rotation of [0, 90] as const) {
      const width = Math.ceil(rotation === 0 ? part.width : part.depth);
      const depth = Math.ceil(rotation === 0 ? part.depth : part.width);
      for (let z = 0; z <= buildArea - depth && !location; z++)
        for (let x = 0; x <= buildArea - width && !location; x++)
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
    placements.push([
      part.id,
      part.family === 'round' || part.family === 'cone'
        ? 1
        : part.kind === 'tile'
          ? 15
          : part.kind === 'plate'
            ? 2
            : 4,
      x,
      0,
      z,
      rotation,
    ]);
    for (let column = Math.max(0, x - 1); column < Math.min(buildArea, x + width + 1); column++)
      for (let row = Math.max(0, z - 1); row < Math.min(buildArea, z + depth + 1); row++)
        occupied[column][row] = true;
  }
  return placements;
}
