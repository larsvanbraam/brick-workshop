import { BUILD_AREA, getPart } from '../core.ts';
import type { Rotation } from '../core.ts';
import type { ExampleBrickAdder } from './types.ts';

export type RunKind = 'plate' | 'tile' | 'brick' | 'masonry';

const RUN_PARTS: Readonly<Record<RunKind, readonly (readonly [number, string])[]>> = {
  plate: [
    [8, '3460'],
    [6, '3666'],
    [4, '3710'],
    [3, '3623'],
    [2, '3023b'],
    [1, '3024'],
  ],
  tile: [
    [8, '4162'],
    [6, '6636'],
    [4, '2431'],
    [3, '63864'],
    [2, '3069b'],
    [1, '3070b'],
  ],
  brick: [
    [8, '3008'],
    [6, '3009'],
    [4, '3010'],
    [3, '3622'],
    [2, '3004'],
    [1, '3005'],
  ],
  masonry: [
    [4, '15533'],
    [2, '98283'],
    [1, '3005'],
  ],
};

/** Adds one straight 1-wide run, split into the longest catalogue pieces that fit. */
export function addRun(
  add: ExampleBrickAdder,
  kind: RunKind,
  color: number,
  axis: 'x' | 'z',
  x: number,
  y: number,
  z: number,
  length: number,
) {
  let offset = 0;
  while (offset < length) {
    const [size, partId] = RUN_PARTS[kind].find(([size]) => size <= length - offset)!;
    add(
      partId,
      color,
      axis === 'x' ? x + offset : x,
      y,
      axis === 'x' ? z : z + offset,
      axis === 'x' && size > 1 ? 90 : 0,
    );
    offset += size;
  }
}

/**
 * Lays a top-down character map as one layer: each row is a z line, each character an x cell.
 * Equal neighbouring characters merge into runs along x (or z), and characters missing from the
 * legend stay empty.
 */
export function addRowMap(
  add: ExampleBrickAdder,
  rows: readonly string[],
  y: number,
  legend: Readonly<Record<string, readonly [RunKind, number]>>,
  axis: 'x' | 'z' = 'x',
) {
  const at = (x: number, z: number) => rows[z]?.[x] ?? ' ';
  const width = Math.max(...rows.map((row) => row.length));
  const lines = axis === 'x' ? rows.length : width;
  const span = axis === 'x' ? width : rows.length;
  for (let line = 0; line < lines; line++) {
    let cursor = 0;
    while (cursor < span) {
      const cell = axis === 'x' ? at(cursor, line) : at(line, cursor);
      let end = cursor + 1;
      while (end < span && (axis === 'x' ? at(end, line) : at(line, end)) === cell) end++;
      const entry = legend[cell];
      if (entry)
        addRun(
          add,
          entry[0],
          entry[1],
          axis,
          axis === 'x' ? cursor : line,
          y,
          axis === 'x' ? line : cursor,
          end - cursor,
        );
      cursor = end;
    }
  }
}

/**
 * Adds one course of a hollow rectangular wall. Courses alternate which pair of walls owns the
 * corners so stacked courses overlap their joints; `open` cells are left out for doors and windows.
 */
export function addRing(
  add: ExampleBrickAdder,
  kind: RunKind,
  color: number,
  x: number,
  z: number,
  width: number,
  depth: number,
  y: number,
  course: number,
  open: (x: number, z: number) => boolean = () => false,
) {
  const inset = course % 2 === 0 ? [0, 1] : [1, 0];
  const walls: (readonly ['x' | 'z', number, number, number])[] = [
    ['x', z, x + inset[0], x + width - inset[0]],
    ['x', z + depth - 1, x + inset[0], x + width - inset[0]],
    ['z', x, z + inset[1], z + depth - inset[1]],
    ['z', x + width - 1, z + inset[1], z + depth - inset[1]],
  ];
  for (const [axis, fixed, start, end] of walls) {
    let runStart = start;
    for (let cursor = start; cursor <= end; cursor++) {
      const blocked = cursor === end || (axis === 'x' ? open(cursor, fixed) : open(fixed, cursor));
      if (!blocked) continue;
      if (cursor > runStart)
        addRun(
          add,
          kind,
          color,
          axis,
          axis === 'x' ? runStart : fixed,
          y,
          axis === 'x' ? fixed : runStart,
          cursor - runStart,
        );
      runStart = cursor + 1;
    }
  }
}

const DOOR_FRAMES = new Set(['3579']);
const DOORS = new Set(['3193a']);

/**
 * Turns a build a half turn about the board centre, so plans can be drawn with their front at
 * high z yet face the default camera, which looks at the low-z side. Door frames keep a 90 degree
 * turn and doors stay half a stud in front of them, as the engine's insert rule expects.
 */
export function turnAround(add: ExampleBrickAdder, buildArea = BUILD_AREA): ExampleBrickAdder {
  return (partId, color, x, y, z, rotation = 0) => {
    const part = getPart(partId);
    const turned = rotation === 90 || rotation === 270;
    const width = turned ? part.depth : part.width;
    const depth = turned ? part.width : part.depth;
    if (DOOR_FRAMES.has(partId) || DOORS.has(partId)) {
      const frameZ = buildArea - (DOORS.has(partId) ? z + 0.5 : z) - 1;
      add(
        partId,
        color,
        buildArea - x - width,
        y,
        DOORS.has(partId) ? frameZ - 0.5 : frameZ,
        rotation,
      );
      return;
    }
    add(
      partId,
      color,
      buildArea - x - width,
      y,
      buildArea - z - depth,
      ((rotation + 180) % 360) as Rotation,
    );
  };
}

/** Glass for each window frame; it shares the frame's position and turn. */
const WINDOW_GLASS: Readonly<Record<string, string>> = {
  '60592': '60601',
  '60593': '60602',
  '60594': '86210',
  '2493b': '2494',
};
const TRANS_CLEAR = 47;

/** Puts trans-clear glass in every window frame the build adds. */
export function glazeWindows(add: ExampleBrickAdder): ExampleBrickAdder {
  return (partId, color, x, y, z, rotation = 0) => {
    add(partId, color, x, y, z, rotation);
    const glass = WINDOW_GLASS[partId];
    if (glass) add(glass, TRANS_CLEAR, x, y, z, rotation);
  };
}
