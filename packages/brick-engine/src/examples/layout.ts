import { BUILD_AREA, FACINGS, footprint, getConnectionSites, getPart } from '../core.ts';
import type { Brick, Facing, Rotation } from '../core.ts';
import type { ExampleBrickAdder } from './types.ts';

/** Run kinds: `short` lays bricks no longer than three studs, for finer stonework. */
export type RunKind = 'plate' | 'tile' | 'brick' | 'short' | 'masonry';

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
  short: [
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

const DOOR_FRAMES = new Set(['3579', '60596']);
const DOORS = new Set(['3193a', '60616a', '60623']);

/**
 * Turns a build a half turn about the board centre, so plans can be drawn with their front at
 * high z yet face the default camera, which looks at the low-z side. Door frames keep a 90 degree
 * turn and doors stay half a stud in front of them, as the engine's insert rule expects.
 */
export function turnAround(add: ExampleBrickAdder, buildArea = BUILD_AREA): ExampleBrickAdder {
  return (partId, color, x, y, z, rotation = 0, facing, upsideDown, tilt, strung) => {
    const { width, depth } = footprint({ id: '', partId, color, x, y, z, rotation, facing });
    if (strung) {
      // Both end studs turn with the build; the cord follows them.
      add(
        partId,
        color,
        buildArea - x - 1,
        y,
        buildArea - z - 1,
        0,
        undefined,
        undefined,
        undefined,
        {
          x: buildArea - strung.x - 1,
          y: strung.y,
          z: buildArea - strung.z - 1,
        },
      );
      return;
    }
    if (tilt) {
      // The hinge line turns with the build: it leans the other way, from the other side.
      add(
        partId,
        color,
        buildArea - x - width,
        y,
        buildArea - z - depth,
        ((rotation + 180) % 360) as Rotation,
        undefined,
        undefined,
        {
          ...tilt,
          toward: FACINGS[(FACINGS.indexOf(tilt.toward) + 2) % 4],
          at: buildArea - tilt.at,
        },
      );
      return;
    }
    if (facing) {
      // Turning the build about the vertical points a mounted piece the other way; its spin
      // about that direction stays.
      const opposite = FACINGS[(FACINGS.indexOf(facing) + 2) % 4];
      const round = (value: number) => Math.round(value * 10) / 10;
      add(
        partId,
        color,
        round(buildArea - x - width),
        y,
        round(buildArea - z - depth),
        rotation,
        opposite,
      );
      return;
    }
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
      undefined,
      upsideDown,
    );
  };
}

/** Glass for each window frame; it shares the frame's position and turn. */
const WINDOW_GLASS: Readonly<Record<string, string>> = {
  '60592': '60601',
  '60593': '60602',
  '60594': '86210',
  '57894': '57895',
  '2493b': '2494',
};
const TRANS_CLEAR = 47;

/** Puts glass, trans-clear unless told otherwise, in every window frame the build adds. */
export function glazeWindows(add: ExampleBrickAdder, glassColor = TRANS_CLEAR): ExampleBrickAdder {
  return (partId, color, x, y, z, rotation = 0, facing, upsideDown, tilt, strung) => {
    add(partId, color, x, y, z, rotation, facing, upsideDown, tilt, strung);
    const glass = WINDOW_GLASS[partId];
    if (glass) add(glass, glassColor, x, y, z, rotation);
  };
}

/**
 * Lays one bonded course from a top-down character map. Long runs along the course's preferred
 * axis go down first and the preferred axis swaps every course, so stacked courses trade corners
 * and overlap their joints; short leftovers fill in along whichever axis still fits.
 */
export function addBondedMap(
  add: ExampleBrickAdder,
  rows: readonly string[],
  y: number,
  legend: Readonly<Record<string, readonly [RunKind, number]>>,
  course: number,
) {
  const width = Math.max(...rows.map((row) => row.length));
  const used = rows.map(() => new Array<boolean>(width).fill(false));
  const at = (x: number, z: number) => rows[z]?.[x] ?? ' ';
  const free = (x: number, z: number) => !used[z][x] && legend[at(x, z)] !== undefined;
  const [first, second] = course % 2 === 0 ? (['x', 'z'] as const) : (['z', 'x'] as const);
  for (const [axis, minimum] of [
    [first, 3],
    [second, 2],
    [first, 1],
    [second, 1],
  ] as const) {
    const lines = axis === 'x' ? rows.length : width;
    const span = axis === 'x' ? width : rows.length;
    for (let line = 0; line < lines; line++) {
      const cell = (offset: number): [number, number] =>
        axis === 'x' ? [offset, line] : [line, offset];
      let cursor = 0;
      while (cursor < span) {
        const [x, z] = cell(cursor);
        if (!free(x, z)) {
          cursor++;
          continue;
        }
        let end = cursor + 1;
        while (end < span && free(...cell(end)) && at(...cell(end)) === at(x, z)) end++;
        if (end - cursor >= minimum) {
          const [kind, color] = legend[at(x, z)];
          addRun(add, kind, color, axis, x, y, z, end - cursor);
          for (let offset = cursor; offset < end; offset++) {
            const [usedX, usedZ] = cell(offset);
            used[usedZ][usedX] = true;
          }
        }
        cursor = end;
      }
    }
  }
}

const AREA_PARTS: Readonly<Record<'plate' | 'tile' | 'brick', readonly string[]>> = {
  plate: [
    '91405',
    '92438',
    '3027',
    '3456',
    '41539',
    '3028',
    '3029',
    '3033',
    '3036',
    '4282',
    '3030',
    '91988',
    '3035',
    '2445',
    '3958',
    '3832',
    '3032',
    '3034',
    '60479',
    '3031',
    '4477',
    '3795',
    '3460',
    '3020',
    '11212',
    '3666',
    '3021',
    '78329',
    '3022',
    '3710',
    '3623',
    '3023b',
    '3024',
  ],
  tile: [
    '48288',
    '6320',
    '8165',
    '6934',
    '1751',
    '69729',
    '87079',
    '4162',
    '26603',
    '6636',
    '3068b',
    '2431',
    '63864',
    '3069b',
    '3070b',
  ],
  brick: [
    '4204',
    '4202',
    '6212',
    '4201',
    '2356',
    '3006',
    '3007',
    '2456',
    '2465',
    '6112',
    '3001',
    '6111',
    '3002',
    '3008',
    '3003',
    '3009',
    '3010',
    '3622',
    '3004',
    '3005',
  ],
};

const AREA_SHAPES: Partial<
  Record<
    'plate' | 'tile' | 'brick',
    readonly { partId: string; width: number; depth: number; rotation: Rotation }[]
  >
> = {};

/**
 * Covers a top-down character map with the largest rectangular plates, tiles or bricks that fit,
 * one layer high. Each piece claims only cells of one character, and when `anchored` is given it
 * prefers pieces that cover at least one anchored cell, so slabs over hollow walls stay connected.
 */
export function addAreaMap(
  add: ExampleBrickAdder,
  rows: readonly string[],
  y: number,
  legend: Readonly<Record<string, readonly ['plate' | 'tile' | 'brick', number]>>,
  anchored: (x: number, z: number) => boolean = () => true,
) {
  const width = Math.max(...rows.map((row) => row.length));
  const used = rows.map(() => new Array<boolean>(width).fill(false));
  const at = (x: number, z: number) => rows[z]?.[x] ?? ' ';
  const shapes = (kind: 'plate' | 'tile' | 'brick') =>
    (AREA_SHAPES[kind] ??= AREA_PARTS[kind]
      .flatMap((partId) => {
        const { width, depth } = getPart(partId);
        return width === depth
          ? [{ partId, width, depth, rotation: 0 as Rotation }]
          : [
              { partId, width, depth, rotation: 0 as Rotation },
              { partId, width: depth, depth: width, rotation: 90 as Rotation },
            ];
      })
      .sort((first, second) => second.width * second.depth - first.width * first.depth));
  for (let z = 0; z < rows.length; z++)
    for (let x = 0; x < width; x++) {
      const cell = at(x, z);
      const entry = legend[cell];
      if (used[z][x] || !entry) continue;
      const cells = (shape: { width: number; depth: number }) =>
        Array.from({ length: shape.width * shape.depth }, (_, index) => [
          x + (index % shape.width),
          z + Math.floor(index / shape.width),
        ]);
      const fits = shapes(entry[0]).filter((shape) =>
        cells(shape).every(([cellX, cellZ]) => at(cellX, cellZ) === cell && !used[cellZ]?.[cellX]),
      );
      const shape =
        fits.find((candidate) =>
          cells(candidate).some(([cellX, cellZ]) => anchored(cellX, cellZ)),
        ) ?? fits[0];
      add(shape.partId, entry[1], x, y, z, shape.rotation);
      for (const [cellX, cellZ] of cells(shape)) used[cellZ][cellX] = true;
    }
}

/** A piece's studs and receivers relative to its corner, optionally reflected in z, as a key. */
function siteKey(piece: Omit<Brick, 'id'>, reflectDepth?: number) {
  return (['top', 'bottom'] as const)
    .flatMap((surface) =>
      getConnectionSites({ id: '', ...piece }, surface).map(
        ({ x, z }) =>
          `${surface}:${x - piece.x}:${reflectDepth === undefined ? z - piece.z : reflectDepth - (z - piece.z)}`,
      ),
    )
    .sort()
    .join(' ');
}

/**
 * Reflects a plan drawn top-down with its front at high z and x running left to right as seen
 * from the front, so the front faces the default camera (which looks at the low-z side) the
 * right way round. `turnAround` turns a plan instead, which leaves it mirrored left to right.
 * A reflected piece is the same piece turned, except for handed ones such as corner slopes and
 * sprigs: each gets the turn that puts its studs and receivers where the reflection puts them.
 * Side-mounted pieces facing along z face the other way; check them in a render.
 */
export function reflectToFront(add: ExampleBrickAdder, buildArea = BUILD_AREA): ExampleBrickAdder {
  return (partId, color, x, y, z, rotation = 0, facing, upsideDown, tilt, strung) => {
    if (strung) {
      // Both end studs mirror across the board; the cord follows them.
      add(partId, color, x, y, buildArea - z - 1, 0, undefined, undefined, undefined, {
        ...strung,
        z: buildArea - strung.z - 1,
      });
      return;
    }
    const piece = { partId, color, x, y, z, rotation, ...(facing ? { facing } : {}) };
    const { depth } = footprint({ id: '', ...piece });
    const round = (value: number) => Math.round(value * 10) / 10;
    const reflected = round(buildArea - z - depth);
    if (facing) {
      const flipped: Facing = facing === '+z' ? '-z' : facing === '-z' ? '+z' : facing;
      add(partId, color, x, y, reflected, rotation, flipped, upsideDown);
      return;
    }
    const want = siteKey(piece, depth);
    const turns = [180, 270, 0, 90].map((turn) => ((turn - rotation + 360) % 360) as Rotation);
    const turned =
      turns.find((turn) => siteKey({ ...piece, z: reflected, rotation: turn }) === want) ??
      turns[0];
    // A hinge line across z mirrors to the other side and leans the other way; one along z
    // stays where it is.
    const mirrored = tilt && {
      ...tilt,
      ...(tilt.toward.endsWith('z')
        ? {
            toward: tilt.toward === '+z' ? ('-z' as const) : ('+z' as const),
            at: buildArea - tilt.at,
          }
        : {}),
    };
    add(partId, color, x, y, reflected, turned, undefined, upsideDown, mirrored);
  };
}

/**
 * Collects pieces and hands them on bottom-up, side-mounted pieces last, so each comes after
 * what holds it, whatever order the plan draws them in. The registry, the building
 * instructions and the disassembly tests rely on that order. Call `flush` once at the end.
 */
export function bottomUp(add: ExampleBrickAdder): { add: ExampleBrickAdder; flush: () => void } {
  const pending: Parameters<ExampleBrickAdder>[] = [];
  return {
    add: (...piece) => {
      pending.push(piece);
    },
    flush: () => {
      const order = pending.map((piece, index) => ({ piece, index }));
      // Upright pieces first, then tilted frames on their hinges, then side-mounted pieces.
      const stage = (piece: Parameters<ExampleBrickAdder>) => (piece[6] ? 2 : piece[8] ? 1 : 0);
      order.sort(
        (a, b) => stage(a.piece) - stage(b.piece) || a.piece[3] - b.piece[3] || a.index - b.index,
      );
      pending.length = 0;
      for (const { piece } of order) add(...piece);
    },
  };
}
