import { footprint, getPart, isMatchingInsertFrame, seatOnSideStuds } from '../core.ts';
import type { Brick, Facing, Rotation } from '../core.ts';
import { addAreaMap, addBondedMap, addRun, bottomUp, glazeWindows } from './layout.ts';
import type { RunKind } from './layout.ts';
import { addTree, random } from './trees.ts';
import type { Box } from './trees.ts';
import type { ExampleBrickAdder, ExampleDefinition } from './types.ts';

// Hill Valley's courthouse square as it stood in 1955, on the 128-stud board. The plan is drawn
// in board coordinates: the default camera looks in from low z, so the courthouse stands at the
// back (high z) facing it across the square, with its portico, pediment and clock. Streets run
// down both sides of the square and across its front; rows of shops line them, the Essex
// theatre with its corner turret and marquee on the left, a filling station and a three-storey
// brick block across the front. Fifties cars stand at the kerbs, drive the streets and wait at
// the pumps, and townsfolk stroll the pavements and the square. A cable runs from the top of the
// clock tower down to a lamp by the street on the left, and from there straight across the
// street to the lamp opposite.
// Nothing on the board carries lettering, so the plan needs no mirroring.
const SIZE = 128;
/** Every wall starts here: two base plates, then a plate under the pavement's tiles. */
const GROUND = 4;

const BLACK = 0;
const RED = 4;
const YELLOW = 14;
const WHITE = 15;
const TAN = 19;
const DARK_TAN = 28;
const GREEN = 2;
const BRIGHT_GREEN = 10;
const DARK_GREEN = 288;
const BROWN = 70;
const DARK_BROWN = 308;
const STONE = 71;
const DARK_STONE = 72;
const MEDIUM_BLUE = 73;
const NOUGAT = 84;
const PALE = 151;
const DARK_BLUE = 272;
const DARK_RED = 320;
const SAND_RED = 335;
const SAND_GREEN = 378;
const SAND_BLUE = 379;
const TRANS_CLEAR = 47;
const PINK = 13;

interface Rect {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
}
const within = (x: number, z: number, r: Rect) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
const onRing = (x: number, z: number, r: Rect) =>
  within(x, z, r) && (x === r.x0 || x === r.x1 || z === r.z0 || z === r.z1);
const key = (x: number, z: number) => `${x}:${z}`;

/** A repeatable 0 to 1 hash of a cell, so shades scatter the same way every time. */
function hash(x: number, z: number, salt = 0) {
  let h =
    Math.imul(x + 101, 0x27d4eb2d) ^
    Math.imul(z + 211, 0x165667b1) ^
    Math.imul(salt + 7, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h ^ (h >>> 13), 0x297a2d39);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Hands a plan drawn from its own origin on to the board, shifted by [dx, dz]. */
const shift =
  (add: ExampleBrickAdder, dx: number, dz: number): ExampleBrickAdder =>
  (partId, color, x, y, z, rotation, facing, upsideDown, tilt) =>
    add(partId, color, x + dx, y, z + dz, rotation, facing, upsideDown, tilt);

/** A character map over a rectangle, one row per z. */
const rowsOver = (r: Rect, cell: (x: number, z: number) => string) =>
  Array.from({ length: r.z1 - r.z0 + 1 }, (_, lz) =>
    Array.from({ length: r.x1 - r.x0 + 1 }, (_, lx) => cell(r.x0 + lx, r.z0 + lz)).join(''),
  );
/** Covers the cells of a rectangle the map names with the largest plates or tiles that fit. */
function paint(
  add: ExampleBrickAdder,
  r: Rect,
  y: number,
  cell: (x: number, z: number) => string,
  legend: Readonly<Record<string, readonly ['plate' | 'tile' | 'brick', number]>>,
  anchored?: (x: number, z: number) => boolean,
) {
  addAreaMap(
    shift(add, r.x0, r.z0),
    rowsOver(r, cell),
    y,
    legend,
    anchored && ((lx, lz) => anchored(r.x0 + lx, r.z0 + lz)),
  );
}
/** Lays one bonded course of the cells of a rectangle the map names. */
function course(
  add: ExampleBrickAdder,
  r: Rect,
  y: number,
  index: number,
  cell: (x: number, z: number) => string,
  legend: Readonly<Record<string, readonly [RunKind, number]>>,
) {
  addBondedMap(shift(add, r.x0, r.z0), rowsOver(r, cell), y, legend, index);
}

const TWO_WIDE: Readonly<Record<number, string>> = {
  16: '4282',
  14: '91988',
  12: '2445',
  10: '3832',
  8: '3034',
  6: '3795',
  4: '3020',
  3: '3021',
  2: '3022',
};
const ONE_WIDE: Readonly<Record<number, string>> = {
  12: '60479',
  10: '4477',
  8: '3460',
  6: '3666',
  5: '78329',
  4: '3710',
  3: '3623',
  2: '3023b',
  1: '3024',
};

/** Splits a strip into plate lengths so that every plate covers at least one held cell. */
function splitStrip(length: number, sizes: readonly number[], held: (at: number) => boolean) {
  const memo = new Map<number, number[] | null>();
  const from = (start: number): number[] | null => {
    if (start === length) return [];
    if (memo.has(start)) return memo.get(start)!;
    let found: number[] | null = null;
    for (const size of sizes) {
      if (start + size > length) continue;
      let covers = false;
      for (let at = start; at < start + size && !covers; at++) covers = held(at);
      if (!covers) continue;
      const rest = from(start + size);
      if (rest) {
        found = [size, ...rest];
        break;
      }
    }
    memo.set(start, found);
    return found;
  };
  return from(0);
}

/**
 * A plate slab over a rectangle, laid as strips two studs wide that each reach from a held row
 * (a wall, a beam) so every plate rests on something: the ceiling and cornice of a building.
 */
function addSlab(
  add: ExampleBrickAdder,
  r: Rect,
  y: number,
  color: number,
  held: (x: number, z: number) => boolean,
  along?: 'x' | 'z',
) {
  const width = r.x1 - r.x0 + 1;
  const depth = r.z1 - r.z0 + 1;
  /** The plates of one layout, or null when a strip has no plate split that rests on support. */
  const layout = (alongZ: boolean, single: number) => {
    const length = alongZ ? depth : width;
    const count = alongZ ? width : depth;
    const pieces: [string, number, number, Rotation][] = [];
    for (let p = 0; p < count;) {
      const wide = p === single ? 1 : 2;
      if (p + wide > count) return null;
      const cell = (at: number, offset: number): [number, number] =>
        alongZ ? [r.x0 + p + offset, r.z0 + at] : [r.x0 + at, r.z0 + p + offset];
      const parts = splitStrip(
        length,
        wide === 2 ? [16, 14, 12, 10, 8, 6, 4, 3, 2] : [12, 10, 8, 6, 5, 4, 3, 2, 1],
        (at) =>
          Array.from({ length: wide }, (_, offset) => held(...cell(at, offset))).some(Boolean),
      );
      if (!parts) return null;
      let at = 0;
      for (const size of parts) {
        const [x, z] = cell(at, 0);
        pieces.push([(wide === 2 ? TWO_WIDE : ONE_WIDE)[size], x, z, alongZ ? 0 : 90]);
        at += size;
      }
      p += wide;
    }
    return pieces;
  };
  const axes = along ? [along === 'z'] : depth <= width ? [true, false] : [false, true];
  for (const alongZ of axes) {
    const count = alongZ ? width : depth;
    // An odd count leaves one strip a stud wide: try it in the middle first, then outwards.
    const singles =
      count % 2
        ? Array.from({ length: (count + 1) / 2 }, (_, index) => index * 2).sort(
            (a, b) => Math.abs(a - count / 2) - Math.abs(b - count / 2),
          )
        : [-1];
    for (const single of singles) {
      const pieces = layout(alongZ, single);
      if (!pieces) continue;
      for (const [partId, x, z, rotation] of pieces) add(partId, color, x, y, z, rotation);
      return;
    }
  }
  throw new Error(`hill-valley: no slab layout for ${JSON.stringify(r)}`);
}

/** 33° slopes by their length along the roof. */
const SLOPE_33: Readonly<Record<number, string>> = { 4: '3297', 3: '4161', 2: '3298', 1: '4286' };

/**
 * A 33° gable roof with its ridge along z over x0..x1 (4n + 2 studs wide): each course a row of
 * slopes three studs deep, two studs in and a brick up from the one below, in two shades with
 * staggered lengths, closed by gable walls at both ends and capped with ridge pieces. `blocked`
 * cells (a tower through the roof) are left out; slope cells cut short there are filled with the
 * front gable's colour.
 */
function addGableRoof(
  add: ExampleBrickAdder,
  o: {
    x0: number;
    x1: number;
    z0: number;
    z1: number;
    y: number;
    colors: readonly [number, number];
    gables: readonly [number, number];
    seed: number;
    blocked?: (x: number, z: number) => boolean;
  },
) {
  const n = (o.x1 - o.x0 - 1) / 4;
  if (!Number.isInteger(n)) throw new Error('hill-valley: gable roofs are 4n + 2 studs wide.');
  const blocked = o.blocked ?? (() => false);
  const next = random(o.seed);
  for (let k = 0; k < n; k++) {
    const y = o.y + k * 3;
    for (const [px, rotation] of [
      [o.x0 + 2 * k, 90],
      [o.x1 - 2 * k - 2, 270],
    ] as const) {
      const free = (z: number) => [0, 1, 2].every((dx) => !blocked(px + dx, z));
      for (let z = o.z0; z <= o.z1;) {
        if (!free(z)) {
          // A slope cut short by the tower: fill what it leaves open.
          for (let dx = 0; dx < 3; dx++)
            if (!blocked(px + dx, z)) add('3005', o.gables[0], px + dx, y, z);
          z++;
          continue;
        }
        let end = z;
        while (end + 1 <= o.z1 && free(end + 1)) end++;
        for (let at = z; at <= end;) {
          const left = end - at + 1;
          const size = left <= 4 ? left : [4, 3, 2, 4, 3][Math.floor(next() * 5)];
          add(SLOPE_33[size], next() < 0.32 ? o.colors[1] : o.colors[0], px, y, at, rotation);
          at += size;
        }
        z = end + 1;
      }
    }
    if (k <= n - 2)
      for (const [z, color] of [
        [o.z0, o.gables[0]],
        [o.z1, o.gables[1]],
      ] as const) {
        let start = -1;
        for (let x = o.x0 + 2 * k + 3; x <= o.x1 - 2 * k - 2; x++) {
          const open = x <= o.x1 - 2 * k - 3 && !blocked(x, z);
          if (open && start < 0) start = x;
          if (!open && start >= 0) {
            addRun(add, 'brick', color, 'x', start, y, z, x - start);
            start = -1;
          }
        }
      }
  }
  const ridge = o.x0 + 2 * n;
  for (let z = o.z0; z + 1 <= o.z1; z += 2)
    if (!blocked(ridge, z) && !blocked(ridge, z + 1))
      add('3043', o.colors[0], ridge, o.y + 3 * n, z, 90);
}

/**
 * A window, door or shopfront in a wall: `width` studs from `u` along `side`, `courses` high from
 * course `course`. Its pieces repeat along the opening, each `rise` plates above the course; a
 * door hangs in the first. A sill or lintel puts trim under or over it.
 */
interface Opening {
  side: Facing;
  u: number;
  width: number;
  course: number;
  courses: number;
  pieces: readonly (readonly [partId: string, rise: number, color: number])[];
  door?: readonly [partId: string, color: number];
  sill?: boolean;
  lintel?: boolean;
}

/** A wall cell's place: the side it faces, how far along that side, and the side's length. */
type Place = readonly [side: Facing, u: number, length: number];

/**
 * The walls of one building: `courses` bonded courses round `rect`, with plate bands stepping
 * out after the courses in `bands`, the openings set in, then a slab that overhangs as a
 * cornice. Hidden sides stand against a neighbour: they get no openings and nothing sticks out.
 */
interface Shell {
  rect: Rect;
  hidden: readonly Facing[];
  courses: number;
  bands: readonly number[];
  openings: readonly Opening[];
  cell: (places: readonly Place[], course: number) => string;
  legend: Readonly<Record<string, readonly [RunKind, number]>>;
  trim: number;
  /** Striped cheese-slope awnings on the band after course `band`, from u `from` to `to`. */
  awnings?: readonly {
    side: Facing;
    from: number;
    to: number;
    band: number;
    colors: readonly [number, number];
  }[];
  /** Band cells to leave without tiles, for what stands on them. */
  bare?: (x: number, z: number) => boolean;
  slab?: Rect;
  along?: 'x' | 'z';
  held?: (x: number, z: number) => boolean;
}

const SIDES: readonly Facing[] = ['-z', '+z', '-x', '+x'];
const placesOf = (r: Rect, x: number, z: number): Place[] => {
  const width = r.x1 - r.x0 + 1;
  const depth = r.z1 - r.z0 + 1;
  const places: Place[] = [];
  if (z === r.z0) places.push(['-z', x - r.x0, width]);
  if (z === r.z1) places.push(['+z', x - r.x0, width]);
  if (x === r.x0) places.push(['-x', z - r.z0, depth]);
  if (x === r.x1) places.push(['+x', z - r.z0, depth]);
  return places;
};
/** Sides that stand on the board's edge, where nothing may stick out. */
const edgeSides = (r: Rect): Facing[] => [
  ...(r.z0 === 0 ? ['-z' as const] : []),
  ...(r.z1 === SIZE - 1 ? ['+z' as const] : []),
  ...(r.x0 === 0 ? ['-x' as const] : []),
  ...(r.x1 === SIZE - 1 ? ['+x' as const] : []),
];
/** The rectangle grown by a stud on each side that may overhang. */
const grown = (r: Rect, flush: ReadonlySet<Facing>): Rect => ({
  x0: r.x0 - (flush.has('-x') ? 0 : 1),
  z0: r.z0 - (flush.has('-z') ? 0 : 1),
  x1: r.x1 + (flush.has('+x') ? 0 : 1),
  z1: r.z1 + (flush.has('+z') ? 0 : 1),
});
/** Where an opening's piece at `u` along `side` stands, and its turn. */
const openingAt = (r: Rect, side: Facing, u: number): [number, number, Rotation] =>
  side === '-z'
    ? [r.x0 + u, r.z0, 90]
    : side === '+z'
      ? [r.x0 + u, r.z1, 90]
      : side === '-x'
        ? [r.x0, r.z0 + u, 0]
        : [r.x1, r.z0 + u, 0];

/** Adds a door frame and fits the door into it. */
function addDoor(add: ExampleBrickAdder, frame: Omit<Brick, 'id'>, door: string, color: number) {
  add(frame.partId, frame.color, frame.x, frame.y, frame.z, frame.rotation);
  for (const rotation of [0, 90, 180, 270] as Rotation[])
    for (const dx of [0, -0.5, 0.5, -1, 1])
      for (const dz of [0, -0.5, 0.5, -1, 1]) {
        const candidate: Brick = {
          id: 'door',
          partId: door,
          color,
          x: frame.x + dx,
          y: frame.y,
          z: frame.z + dz,
          rotation,
        };
        if (isMatchingInsertFrame(candidate, { id: 'frame', ...frame })) {
          add(door, color, candidate.x, candidate.y, candidate.z, rotation);
          return;
        }
      }
  throw new Error(`hill-valley: no fit for door ${door}.`);
}

/** Lays a shell's walls, openings and bands; returns its course heights and slab. */
function addShell(add: ExampleBrickAdder, s: Shell) {
  const r = s.rect;
  const flush = new Set<Facing>([...s.hidden, ...edgeSides(r)]);
  const courseY = (c: number) => GROUND + 3 * c + s.bands.filter((band) => band < c).length;
  const inside = (o: Opening, u: number) => u >= o.u && u < o.u + o.width;
  for (let c = 0; c < s.courses; c++) {
    course(
      add,
      r,
      courseY(c),
      c,
      (x, z) => {
        if (!onRing(x, z, r)) return ' ';
        const places = placesOf(r, x, z);
        const on = (o: Opening) => places.find(([side]) => side === o.side);
        if (
          s.openings.some((o) => {
            const place = on(o);
            return place && inside(o, place[1]) && c >= o.course && c < o.course + o.courses;
          })
        )
          return ' ';
        if (
          s.openings.some((o) => {
            const place = on(o);
            if (!place) return false;
            const u = place[1];
            return (
              (o.sill && c === o.course - 1 && inside(o, u)) ||
              (o.lintel && c === o.course + o.courses && u >= o.u - 1 && u <= o.u + o.width)
            );
          })
        )
          return 't';
        return s.cell(places, c);
      },
      s.legend,
    );
    for (const o of s.openings) {
      if (o.course !== c) continue;
      const y = courseY(c);
      for (const [index, [partId, rise, color]] of o.pieces.entries()) {
        const step = getPart(partId).depth;
        for (let offset = 0; offset < o.width; offset += step) {
          const [x, z, rotation] = openingAt(r, o.side, o.u + offset);
          if (index === 0 && o.door)
            addDoor(add, { partId, color, x, y: y + rise, z, rotation }, ...o.door);
          else add(partId, color, x, y + rise, z, rotation);
        }
      }
    }
    if (s.bands.includes(c)) addBand(add, s, flush, courseY(c) + 3, c);
  }
  const slab = s.slab ?? grown(r, flush);
  const slabY = courseY(s.courses);
  addSlab(
    add,
    slab,
    slabY,
    s.trim,
    (x, z) => onRing(x, z, r) || (s.held?.(x, z) ?? false),
    s.along,
  );
  return { courseY, slab, slabY, flush };
}

/**
 * A plate band round the walls, stepping a stud out on every open side, tiled on its ledge or
 * dressed with a striped awning.
 */
function addBand(
  add: ExampleBrickAdder,
  s: Shell,
  flush: ReadonlySet<Facing>,
  y: number,
  band: number,
) {
  const r = s.rect;
  const outer = grown(r, flush);
  const banded = new Set<string>();
  // Each side's band is a strip of plates: two studs wide over the wall and the ledge where the
  // side may step out, one wide where it may not. The z sides own the corners.
  for (const side of SIDES) {
    const alongX = side.endsWith('z');
    const from = alongX ? r.x0 : r.z0 + 1;
    const to = alongX ? r.x1 : r.z1 - 1;
    const length = to - from + 1;
    const out = !flush.has(side);
    const parts =
      (out && splitStrip(length, [16, 14, 12, 10, 8, 6, 4, 3, 2], () => true)) ||
      splitStrip(length, [12, 10, 8, 6, 5, 4, 3, 2, 1], () => true)!;
    const wide = out && parts.every((size) => TWO_WIDE[size]) && !parts.some((size) => size === 1);
    const lane =
      side === '-z'
        ? r.z0 - (wide ? 1 : 0)
        : side === '+z'
          ? r.z1
          : side === '-x'
            ? r.x0 - (wide ? 1 : 0)
            : r.x1;
    let at = from;
    for (const size of parts) {
      for (let offset = 0; offset < size; offset++)
        for (let across = 0; across < (wide ? 2 : 1); across++)
          banded.add(alongX ? key(at + offset, lane + across) : key(lane + across, at + offset));
      add(
        (wide ? TWO_WIDE : ONE_WIDE)[size],
        s.trim,
        alongX ? at : lane,
        y,
        alongX ? lane : at,
        alongX ? 90 : 0,
      );
      at += size;
    }
  }
  const corner = (x: number, z: number) => (x < r.x0 || x > r.x1) && (z < r.z0 || z > r.z1);
  const ledge = (x: number, z: number) =>
    within(x, z, outer) && !within(x, z, r) && !corner(x, z) && banded.has(key(x, z));
  const awned = new Map<string, number>();
  for (const awning of s.awnings ?? []) {
    if (awning.band !== band) continue;
    for (let u = awning.from; u <= awning.to; u++) {
      const [x, z] =
        awning.side === '-z'
          ? [r.x0 + u, r.z0 - 1]
          : awning.side === '+z'
            ? [r.x0 + u, r.z1 + 1]
            : awning.side === '-x'
              ? [r.x0 - 1, r.z0 + u]
              : [r.x1 + 1, r.z0 + u];
      awned.set(key(x, z), 0);
    }
    const rotation = ({ '-z': 0, '+z': 180, '-x': 90, '+x': 270 } as const)[awning.side];
    let stripe = 0;
    for (let u = awning.from; u <= awning.to; u += 2) {
      const single = u === awning.to;
      const along = awning.side.endsWith('z');
      const x = along ? r.x0 + u : awning.side === '-x' ? r.x0 - 1 : r.x1 + 1;
      const z = along ? (awning.side === '-z' ? r.z0 - 1 : r.z1 + 1) : r.z0 + u;
      add(single ? '54200' : '85984', awning.colors[stripe++ % 2], x, y + 1, z, rotation);
    }
  }
  paint(
    add,
    outer,
    y + 1,
    (x, z) => (ledge(x, z) && !awned.has(key(x, z)) && !(s.bare?.(x, z) ?? false) ? 't' : ' '),
    { t: ['tile', s.trim] },
  );
}

/**
 * A flat roof on a slab: the cornice ledge tiled, a parapet round the walls with a coping of
 * tiles (or balustrades along `balustrade` sides), and inside it tar-grey tiles in two shades
 * round a chimney stack and a vent box.
 */
function addFlatRoof(
  add: ExampleBrickAdder,
  r: Rect,
  slab: Rect,
  y: number,
  o: { wall: number; trim: number; seed: number; balustrade?: readonly Facing[]; chimney?: number },
) {
  const balustraded = (x: number, z: number) =>
    placesOf(r, x, z).length === 1 && (o.balustrade ?? []).includes(placesOf(r, x, z)[0][0]);
  paint(add, slab, y, (x, z) => (within(x, z, slab) && !within(x, z, r) ? 't' : ' '), {
    t: ['tile', o.trim],
  });
  course(add, r, y, o.seed, (x, z) => (onRing(x, z, r) && !balustraded(x, z) ? 'w' : ' '), {
    w: ['brick', o.wall],
  });
  paint(add, r, y + 3, (x, z) => (onRing(x, z, r) && !balustraded(x, z) ? 't' : ' '), {
    t: ['tile', o.trim],
  });
  for (const side of o.balustrade ?? []) {
    const along = side.endsWith('z');
    const length = along ? r.x1 - r.x0 + 1 : r.z1 - r.z0 + 1;
    for (let u = 1; u < length - 1;) {
      const [x, z] = openingAt(r, side, u);
      if (length - 1 - u >= 4) {
        add('30055', o.trim, x, y, z, along ? 90 : 0);
        u += 4;
      } else {
        add('3062b', o.trim, x, y, z);
        add('3062b', o.trim, x, y + 3, z);
        u++;
      }
    }
  }
  const inner: Rect = { x0: r.x0 + 1, z0: r.z0 + 1, x1: r.x1 - 1, z1: r.z1 - 1 };
  const reserved = new Set<string>();
  const roomy = inner.x1 - inner.x0 >= 5 && inner.z1 - inner.z0 >= 5;
  if (roomy) {
    const next = random(o.seed * 31 + 5);
    const span = (from: number, to: number) => from + Math.floor(next() * (to - from - 2));
    // A chimney stack of the wall's brick with two pots.
    const cx = span(inner.x0 + 1, inner.x1);
    const cz = next() < 0.5 ? inner.z0 + 1 : inner.z1 - 2;
    add('3003', o.chimney ?? o.wall, cx, y, cz);
    add('3003', o.chimney ?? o.wall, cx, y + 3, cz);
    add('3022', DARK_STONE, cx, y + 6, cz);
    add('3062b', NOUGAT, cx, y + 7, cz);
    add('3062b', NOUGAT, cx + 1, y + 7, cz + 1);
    // A vent box with louvres on top, across the roof from the stack.
    const vx = cx > (inner.x0 + inner.x1) / 2 ? inner.x0 + 1 : inner.x1 - 2;
    const vz = cz === inner.z0 + 1 ? inner.z1 - 2 : inner.z0 + 1;
    add('3003', PALE, vx, y, vz);
    add('2412b', DARK_STONE, vx, y + 3, vz);
    add('2412b', DARK_STONE, vx + 1, y + 3, vz);
    for (const [x, z] of [
      [cx, cz],
      [vx, vz],
    ])
      for (const [dx, dz] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ])
        reserved.add(key(x + dx, z + dz));
  }
  paint(
    add,
    inner,
    y,
    (x, z) =>
      reserved.has(key(x, z))
        ? ' '
        : hash(Math.floor(x / 3), Math.floor(z / 3), o.seed) < 0.3
          ? 'l'
          : hash(x, z, o.seed + 1) < 0.04
            ? 'p'
            : 'r',
    { r: ['tile', DARK_STONE], l: ['tile', STONE], p: ['tile', PALE] },
  );
}

/** Window styles: two studs wide with two between (offices four), and the pieces they're made of. */
type WindowStyle = 'sash' | 'arched' | 'wide';
const WINDOW_STYLES: Readonly<
  Record<
    WindowStyle,
    {
      width: number;
      gap: number;
      pieces: (frame: number, trim: number) => readonly (readonly [string, number, number])[];
    }
  >
> = {
  sash: { width: 2, gap: 2, pieces: (frame) => [['60593', 0, frame]] },
  arched: {
    width: 2,
    gap: 2,
    pieces: (frame, trim) => [
      ['3023b', 0, trim],
      ['30044', 1, frame],
    ],
  },
  wide: { width: 4, gap: 2, pieces: (frame) => [['60594', 0, frame]] },
};
/** Where windows `width` wide with `gap` between go along a side `length` long, centred. */
function windowRow(length: number, width: number, gap: number) {
  const room = length - 4;
  const count = Math.max(0, Math.floor((room + gap) / (width + gap)));
  if (!count) return [];
  const used = count * width + (count - 1) * gap;
  const start = 2 + Math.floor((room - used) / 2);
  return Array.from({ length: count }, (_, index) => start + index * (width + gap));
}
/** A shopfront along a side: windows four studs wide and a door between piers. */
function shopfront(length: number) {
  const room = length - 2;
  const windows = Math.max(0, Math.floor((room - 5) / 5));
  const extra = room - 5 - 5 * windows;
  let u = 2 + Math.floor(extra / 2);
  const items: { u: number; width: number; door: boolean }[] = [];
  const before = Math.floor(windows / 2);
  for (let index = 0; index <= windows; index++) {
    if (index === before) {
      items.push({ u, width: 3, door: true });
      u += 4;
    }
    if (index < windows) {
      items.push({ u, width: 4, door: false });
      u += 5;
    }
  }
  return items;
}

/** A shop or office on a street: a shopfront under storeys of framed windows and a flat roof. */
interface Shop {
  rect: Rect;
  face: Facing;
  uppers: number;
  wall: number;
  alt: number;
  trim: number;
  shop: number;
  frame?: number;
  door?: number;
  awning?: readonly [number, number];
  window?: WindowStyle;
  quoins?: boolean;
  kind?: RunKind;
  hidden?: readonly Facing[];
  /** Pilasters every this many studs along the façade. */
  pilasters?: number;
  balustrade?: boolean;
  seed: number;
}

/** The shell of a shop: five courses of shopfront, a band, four courses a storey, a cornice. */
function shopShell(shop: Shop): Shell {
  const r = shop.rect;
  const hidden = shop.hidden ?? [];
  const style = WINDOW_STYLES[shop.window ?? 'sash'];
  const frame = shop.frame ?? WHITE;
  const courses = 5 + 4 * shop.uppers + 1;
  const openings: Opening[] = [];
  const lengthOf = (side: Facing) => (side.endsWith('z') ? r.x1 - r.x0 + 1 : r.z1 - r.z0 + 1);
  for (const side of SIDES) {
    if (hidden.includes(side)) continue;
    const length = lengthOf(side);
    if (side === shop.face)
      for (const item of shopfront(length))
        openings.push(
          item.door
            ? {
                side,
                u: item.u,
                width: 3,
                course: 0,
                courses: 4,
                pieces: [['3579', 0, WHITE]],
                door: ['3193a', shop.door ?? shop.shop],
              }
            : {
                side,
                u: item.u,
                width: 4,
                course: 1,
                courses: 3,
                pieces: [['60594', 0, shop.shop]],
              },
        );
    else
      for (const u of windowRow(length, 2, 2))
        openings.push({
          side,
          u,
          width: 2,
          course: 1,
          courses: 3,
          pieces: [['60593', 0, frame]],
          sill: true,
          lintel: true,
        });
    for (let storey = 0; storey < shop.uppers; storey++)
      for (const u of windowRow(length, style.width, style.gap))
        openings.push({
          side,
          u,
          width: style.width,
          course: 6 + 4 * storey,
          courses: 3,
          pieces: style.pieces(frame, shop.trim),
          sill: true,
          lintel: true,
        });
  }
  const kind = shop.kind ?? 'brick';
  return {
    rect: r,
    hidden,
    courses,
    bands: [4],
    openings,
    trim: shop.trim,
    legend: {
      w: [kind, shop.wall],
      a: [kind, shop.alt],
      t: ['brick', shop.trim],
      s: ['brick', shop.shop],
    },
    cell: (places, c) => {
      const front = places.find(([side]) => side === shop.face);
      const [side, u, length] = front ?? places[0];
      if (c === courses - 1) return 't';
      if (front && c <= 4) return 's';
      const corner = places.length > 1;
      if (shop.quoins && (corner || ((u === 1 || u === length - 2) && c % 2 === 0))) return 't';
      if (shop.pilasters && side === shop.face && u % shop.pilasters === 0) return 't';
      return hash(Math.floor(u / 2) + SIDES.indexOf(side) * 50, c, shop.seed) < 0.16 ? 'a' : 'w';
    },
    awnings: shop.awning
      ? [{ side: shop.face, from: 1, to: lengthOf(shop.face) - 2, band: 4, colors: shop.awning }]
      : [],
  };
}

function addShop(add: ExampleBrickAdder, shop: Shop) {
  const shell = shopShell(shop);
  const { slab, slabY } = addShell(add, shell);
  addFlatRoof(add, shop.rect, slab, slabY + 1, {
    wall: shop.wall,
    trim: shop.trim,
    seed: shop.seed,
    balustrade: shop.balustrade ? [shop.face] : [],
  });
  return slabY;
}

// ------------------------------------------------------------------------------------------
// The town plan.

const WEST_ROAD = [24, 35] as const;
const EAST_ROAD = [92, 103] as const;
const FRONT_ROAD = [20, 31] as const;
/** The car park behind the courthouse. */
const BACK_LOT = 116;
const SQUARE: Rect = { x0: 36, z0: 32, x1: 91, z1: 115 };
const LAWN: Rect = { x0: 40, z0: 36, x1: 87, z1: 73 };
const FORECOURT: Rect = { x0: 40, z0: 74, x1: 87, z1: 83 };
/** The courthouse's steps and portico floor. */
const PORTICO: Rect = { x0: 51, z0: 75, x1: 76, z1: 83 };
const TEXACO_LOT: Rect = { x0: 38, z0: 0, x1: 53, z1: 15 };
const TEXACO: Rect = { x0: 40, z0: 0, x1: 51, z1: 7 };

const isRoad = (x: number, z: number) =>
  (x >= WEST_ROAD[0] && x <= WEST_ROAD[1]) ||
  (x >= EAST_ROAD[0] && x <= EAST_ROAD[1]) ||
  (x > WEST_ROAD[1] &&
    x < EAST_ROAD[0] &&
    ((z >= FRONT_ROAD[0] && z <= FRONT_ROAD[1]) || z >= BACK_LOT));

const WEST_SHOPS: readonly Shop[] = [
  {
    rect: { x0: 0, z0: 0, x1: 19, z1: 15 },
    face: '+x',
    uppers: 2,
    wall: BROWN,
    alt: DARK_BROWN,
    trim: TAN,
    shop: DARK_RED,
    awning: [RED, WHITE],
    seed: 1,
  },
  {
    rect: { x0: 0, z0: 46, x1: 19, z1: 57 },
    face: '+x',
    uppers: 1,
    wall: DARK_TAN,
    alt: TAN,
    trim: WHITE,
    shop: DARK_GREEN,
    awning: [DARK_GREEN, WHITE],
    window: 'arched',
    hidden: ['-z', '+z'],
    seed: 3,
  },
  {
    rect: { x0: 0, z0: 58, x1: 19, z1: 71 },
    face: '+x',
    uppers: 2,
    wall: WHITE,
    alt: PALE,
    trim: DARK_STONE,
    shop: BLACK,
    frame: DARK_STONE,
    hidden: ['-z', '+z'],
    quoins: true,
    seed: 4,
  },
  {
    rect: { x0: 0, z0: 72, x1: 19, z1: 85 },
    face: '+x',
    uppers: 1,
    wall: SAND_BLUE,
    alt: STONE,
    trim: WHITE,
    shop: WHITE,
    frame: WHITE,
    awning: [MEDIUM_BLUE, WHITE],
    hidden: ['-z', '+z'],
    seed: 5,
  },
  {
    rect: { x0: 0, z0: 86, x1: 19, z1: 99 },
    face: '+x',
    uppers: 2,
    wall: DARK_RED,
    alt: BROWN,
    trim: TAN,
    shop: DARK_STONE,
    quoins: true,
    window: 'arched',
    hidden: ['-z', '+z'],
    seed: 6,
  },
  {
    rect: { x0: 0, z0: 100, x1: 19, z1: 127 },
    face: '+x',
    uppers: 2,
    wall: PALE,
    alt: STONE,
    trim: WHITE,
    shop: DARK_STONE,
    frame: WHITE,
    kind: 'masonry',
    window: 'wide',
    pilasters: 6,
    hidden: ['-z'],
    seed: 7,
  },
];

const EAST_SHOPS: readonly Shop[] = [
  {
    rect: { x0: 108, z0: 0, x1: 127, z1: 19 },
    face: '-x',
    uppers: 2,
    wall: SAND_BLUE,
    alt: STONE,
    trim: WHITE,
    shop: WHITE,
    window: 'wide',
    pilasters: 6,
    hidden: ['+z'],
    seed: 11,
  },
  {
    rect: { x0: 108, z0: 20, x1: 127, z1: 33 },
    face: '-x',
    uppers: 1,
    wall: BROWN,
    alt: DARK_BROWN,
    trim: TAN,
    shop: TAN,
    awning: [DARK_RED, TAN],
    hidden: ['-z', '+z'],
    seed: 12,
  },
  {
    rect: { x0: 108, z0: 34, x1: 127, z1: 47 },
    face: '-x',
    uppers: 1,
    wall: WHITE,
    alt: PALE,
    trim: MEDIUM_BLUE,
    shop: MEDIUM_BLUE,
    frame: WHITE,
    hidden: ['-z', '+z'],
    seed: 13,
  },
  {
    rect: { x0: 108, z0: 48, x1: 127, z1: 63 },
    face: '-x',
    uppers: 2,
    wall: NOUGAT,
    alt: BROWN,
    trim: WHITE,
    shop: BROWN,
    window: 'arched',
    quoins: true,
    hidden: ['-z', '+z'],
    seed: 14,
  },
  {
    rect: { x0: 108, z0: 64, x1: 127, z1: 77 },
    face: '-x',
    uppers: 1,
    wall: TAN,
    alt: DARK_TAN,
    trim: WHITE,
    shop: DARK_GREEN,
    awning: [DARK_GREEN, TAN],
    hidden: ['-z', '+z'],
    seed: 15,
  },
  {
    rect: { x0: 108, z0: 78, x1: 127, z1: 93 },
    face: '-x',
    uppers: 2,
    wall: BROWN,
    alt: NOUGAT,
    trim: WHITE,
    shop: DARK_STONE,
    hidden: ['-z', '+z'],
    seed: 16,
  },
  {
    rect: { x0: 108, z0: 94, x1: 127, z1: 109 },
    face: '-x',
    uppers: 1,
    wall: STONE,
    alt: DARK_STONE,
    trim: WHITE,
    shop: DARK_RED,
    awning: [RED, WHITE],
    hidden: ['-z', '+z'],
    seed: 17,
  },
  {
    rect: { x0: 108, z0: 110, x1: 127, z1: 127 },
    face: '-x',
    uppers: 2,
    wall: WHITE,
    alt: PALE,
    trim: SAND_BLUE,
    shop: SAND_BLUE,
    frame: WHITE,
    quoins: true,
    hidden: ['-z'],
    seed: 18,
  },
];

const FRONT_SHOPS: readonly Shop[] = [
  {
    rect: { x0: 54, z0: 0, x1: 71, z1: 15 },
    face: '+z',
    uppers: 2,
    wall: BROWN,
    alt: DARK_BROWN,
    trim: TAN,
    shop: MEDIUM_BLUE,
    quoins: true,
    hidden: ['+x'],
    seed: 21,
  },
  {
    rect: { x0: 72, z0: 0, x1: 89, z1: 15 },
    face: '+z',
    uppers: 1,
    wall: DARK_RED,
    alt: SAND_RED,
    trim: WHITE,
    shop: WHITE,
    awning: [RED, WHITE],
    window: 'arched',
    hidden: ['-x'],
    seed: 22,
  },
];

/** The Essex: a tan auditorium under a brown roof behind a sand-green front with a turret. */
const AUDITORIUM: Rect = { x0: 0, z0: 18, x1: 13, z1: 45 };
const LOBBY: Shop = {
  rect: { x0: 14, z0: 18, x1: 19, z1: 41 },
  face: '+x',
  uppers: 2,
  wall: SAND_GREEN,
  alt: SAND_GREEN,
  trim: WHITE,
  shop: WHITE,
  frame: WHITE,
  door: DARK_RED,
  quoins: true,
  pilasters: 4,
  hidden: ['-x', '+z'],
  seed: 31,
};
const TURRET = [16, 42] as const;
const MARQUEE = [22, 37] as const;
const BLADE = 29;

/** The courthouse: brick wings either side of a centre block with a portico and a clock. */
const WINGS: readonly Rect[] = [
  { x0: 40, z0: 84, x1: 50, z1: 112 },
  { x0: 77, z0: 84, x1: 87, z1: 112 },
];
const CENTRE: Rect = { x0: 51, z0: 84, x1: 76, z1: 112 };
const COLUMNS = [53, 59, 67, 73];
const COLUMN_Z = 78;
const CLOCK_TOWER: Rect = { x0: 60, z0: 76, x1: 67, z1: 79 };
const COURT_COURSES = 15;
const COURT_LEGEND: Readonly<Record<string, readonly [RunKind, number]>> = {
  w: ['brick', SAND_RED],
  a: ['brick', NOUGAT],
  t: ['brick', WHITE],
  m: ['masonry', STONE],
};
/** Courthouse walls: a stone plinth, white bands at the floors and cornice, quoined corners. */
const courtCell =
  (seed: number) =>
  (places: readonly Place[], c: number): string => {
    if (c === 0) return 'm';
    if (c === 8 || c === 13 || c === 14) return 't';
    const [side, u, length] = places[0];
    if (places.length > 1 || ((u === 1 || u === length - 2) && c % 2 === 1)) return 't';
    return hash(Math.floor(u / 2) + SIDES.indexOf(side) * 40, c, seed) < 0.12 ? 'a' : 'w';
  };
/** Tall sash windows on the ground floor, round-headed ones above, on every open side. */
function courtWindows(
  r: Rect,
  sides: readonly Facing[],
  skip: (side: Facing, u: number) => boolean,
) {
  const openings: Opening[] = [];
  for (const side of sides) {
    const length = side.endsWith('z') ? r.x1 - r.x0 + 1 : r.z1 - r.z0 + 1;
    for (const u of windowRow(length, 2, 2)) {
      if (!skip(side, u))
        openings.push({
          side,
          u,
          width: 2,
          course: 2,
          courses: 6,
          pieces: [
            ['60593', 0, WHITE],
            ['60593', 9, WHITE],
          ],
          sill: true,
        });
      openings.push({
        side,
        u,
        width: 2,
        course: 10,
        courses: 3,
        pieces: WINDOW_STYLES.arched.pieces(WHITE, WHITE),
        sill: true,
      });
    }
  }
  return openings;
}

/**
 * The cable's lamps, by the corner cell each stands on: one on the square's side of the street on
 * the left, which the cord from the clock tower comes down to, and the one straight across the
 * street from it.
 */
const CABLE_LAMPS = [
  [37, 56],
  [21, 56],
] as const;

/**
 * The cell the cord's top end stud takes: on a round plate on the finial at the clock tower top's
 * front left corner.
 */
const CABLE_TOP = [59, 83, 75] as const;
/** The long cord's lower end stud, on the near lamp's bulb. */
const CABLE_FOOT = [CABLE_LAMPS[0][0] + 0.5, GROUND + 25, CABLE_LAMPS[0][1] + 0.5] as const;
/** The cells the long cord passes through, plates above and below, for the trees to grow round. */
const CABLE_CELLS: Box[] = (() => {
  const [from, to] = [CABLE_FOOT, CABLE_TOP].map(([x, y, z]) => [x + 0.5, y + 1, z + 0.5]);
  const cells = new Map<string, Box>();
  for (let step = 0; step <= 400; step++) {
    const [x, y, z] = from.map((value, axis) => value + ((to[axis] - value) * step) / 400);
    const [u, v, h] = [Math.floor(x), Math.floor(z), Math.floor(y)];
    cells.set(`${u}:${h}:${v}`, { u0: u, u1: u + 1, v0: v, v1: v + 1, y0: h - 1, y1: h + 1 });
  }
  return [...cells.values()];
})();

/** Lamps, hydrants and poles on the pavement, by the corner cell they stand on. */
const LAMPS: readonly (readonly [number, number])[] = [
  CABLE_LAMPS[1],
  ...[6, 48, 68, 90, 112].map((z) => [21, z] as const),
  ...[6, 30, 52, 76, 98, 118].map((z) => [105, z] as const),
  ...[38, 56, 92, 108].flatMap((z) => [[37, z] as const, [89, z] as const]),
  [37, 76],
  [89, 76],
  [50, 33],
  [76, 33],
  [62, 17],
  [80, 17],
];
const HYDRANTS: readonly (readonly [number, number])[] = [
  [22, 44],
  [106, 58],
  [38, 34],
  [66, 18],
];
const POLES: readonly (readonly [number, number])[] = [
  [23, 14],
  [23, 64],
  [23, 110],
  [104, 26],
  [104, 86],
  [104, 120],
];
const FIXTURES = new Set<string>([
  ...LAMPS.flatMap(([x, z]) => [key(x, z), key(x + 1, z), key(x, z + 1), key(x + 1, z + 1)]),
  ...HYDRANTS.map(([x, z]) => key(x, z)),
  ...POLES.map(([x, z]) => key(x, z)),
]);

/**
 * Street trees in the courthouse forecourt and the car park, by the cell south-east of the
 * trunk's centre: each 2 x 2 trunk stands in a 4 x 4 pit of earth.
 */
const PIT_TREES: readonly (readonly [number, number, number])[] = [
  [44, 78, 21],
  [83, 78, 22],
  [46, 121, 23],
  [81, 121, 24],
];
/** The earth in the pits. */
const PITS = new Set(
  PIT_TREES.flatMap(([x, z]) =>
    [-2, -1, 0, 1].flatMap((dx) => [-2, -1, 0, 1].map((dz) => key(x + dx, z + dz))),
  ),
);
for (const cell of PITS) FIXTURES.add(cell);
// The filling station's canopy columns, pump island and sign stand on studs too.
for (let x = 41; x <= 50; x++) for (const z of [12, 13]) FIXTURES.add(key(x, z));
FIXTURES.add(key(52, 14));
// The memorial and the flagpole at the crossing.
for (let x = 62; x <= 65; x++) for (const z of [57, 58]) FIXTURES.add(key(x, z));
for (const x of [63, 64]) for (const z of [52, 53]) FIXTURES.add(key(x, z));

const ALL_SHOPS = [...WEST_SHOPS, ...EAST_SHOPS, ...FRONT_SHOPS, LOBBY];
const BUILT: readonly Rect[] = [
  ...ALL_SHOPS.map((shop) => shop.rect),
  AUDITORIUM,
  { x0: 14, z0: 42, x1: 15, z1: 45 },
  { x0: TURRET[0], z0: TURRET[1], x1: TURRET[0] + 3, z1: TURRET[1] + 3 },
  ...WINGS,
  CENTRE,
  TEXACO,
];
const isBuilt = (x: number, z: number) => BUILT.some((r) => within(x, z, r));

/** The square's paths: an X from the lawn's corners and a walk up to the courthouse steps. */
const CENTRE_X = 63.5;
const CENTRE_Z = 54.5;
function isPath(x: number, z: number) {
  const [cx, cz] = [x + 0.5, z + 0.5];
  const dx = LAWN.x1 + 1 - LAWN.x0;
  const dz = LAWN.z1 + 1 - LAWN.z0;
  const length = Math.hypot(dx, dz);
  const first = Math.abs((cx - LAWN.x0) * dz - (cz - LAWN.z0) * dx) / length;
  const second = Math.abs((cx - LAWN.x0) * dz + (cz - LAWN.z1 - 1) * dx) / length;
  const plaza = Math.hypot(cx - CENTRE_X - 0.5, cz - CENTRE_Z - 0.5) < 5.5;
  const walk = x >= 62 && x <= 65 && z > CENTRE_Z;
  return first < 1.4 || second < 1.4 || plaza || walk;
}
const isPlaza = (x: number, z: number) =>
  Math.hypot(x + 0.5 - CENTRE_X - 0.5, z + 0.5 - CENTRE_Z - 0.5) < 5.5;
/** The famous tree near the courthouse, a second across the lawn. */
const TREES: readonly (readonly [number, number, number, number])[] = [
  [49, 64, 6, 3],
  [79, 45, 5, 8],
];
/** Benches beside the paths, each moved to the nearest stretch of lawn four studs long. */
const BENCHES: readonly (readonly [number, number])[] = [
  [56, 50],
  [70, 59],
  [55, 64],
  [71, 47],
].map(([x, z]) => {
  for (const dz of [0, 1, -1, 2, -2, 3, -3])
    for (const dx of [0, 1, -1, 2, -2]) {
      const [bx, bz] = [x + dx, z + dz];
      const cells = [0, 1, 2, 3].map((offset) => [bx + offset, bz]);
      if (cells.every(([cx, cz]) => !isPath(cx, cz) && !isPath(cx, cz - 1) && !isPath(cx, cz + 1)))
        return [bx, bz] as const;
    }
  throw new Error('hill-valley: no lawn for a bench.');
});

/** The pavement's ground: kerbs (red round the square, as in the film), slabs and open studs. */
function pavement(x: number, z: number) {
  const nextToRoad = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ].some(([dx, dz]) => isRoad(x + dx, z + dz));
  if (nextToRoad) return within(x, z, SQUARE) ? 'R' : 'k';
  const nextToBuilding = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ].some(([dx, dz]) => isBuilt(x + dx, z + dz));
  if (nextToBuilding && !within(x, z, SQUARE)) return 'n';
  return hash(x, z, 77) < 0.03 ? 'o' : 's';
}

/** Road markings: double yellow centre lines, zebra crossings, parking bays and drains. */
function road(x: number, z: number) {
  const inCrossing =
    (z >= FRONT_ROAD[0] && z <= FRONT_ROAD[1]) || (z >= 16 && z <= 18) || (z >= 33 && z <= 35);
  const sideRoad =
    (x >= WEST_ROAD[0] && x <= WEST_ROAD[1]) || (x >= EAST_ROAD[0] && x <= EAST_ROAD[1]);
  if (sideRoad) {
    if (((z >= 16 && z <= 18) || (z >= 33 && z <= 35)) && x % 2 === 0) return 'w';
    const centre = x === 29 || x === 30 || x === 97 || x === 98;
    if (centre && !inCrossing && z < BACK_LOT) return 'y';
    const bay =
      x === WEST_ROAD[1] - 1 || x === WEST_ROAD[1] || x === EAST_ROAD[0] || x === EAST_ROAD[0] + 1;
    if (bay && z > 40 && z < 110 && (z - 40) % 14 === 0) return 'w';
  } else if (z >= FRONT_ROAD[0] && z <= FRONT_ROAD[1]) {
    if ((x <= 38 || x >= 89) && z % 2 === 0) return 'w';
    if ((z === 25 || z === 26) && x > 39 && x < 88) return 'y';
  } else if (z >= BACK_LOT) {
    if (z >= 118 && z <= 124 && x > 38 && x < 89 && x % 5 === 0) return 'w';
  }
  return hash(Math.floor(x / 5), Math.floor(z / 5), 9) < 0.12 ? 'p' : 'r';
}
const DRAINS: readonly (readonly [number, number])[] = [
  [24, 40],
  [35, 60],
  [92, 46],
  [103, 96],
  [50, 31],
  [80, 20],
];
const DRAIN_CELLS = new Set(DRAINS.flatMap(([x, z]) => [key(x, z), key(x, z + 1)]));

// ------------------------------------------------------------------------------------------
// Cars and townsfolk, each drawn in its own frame and turned onto the board like a piece.

/** A piece in a local frame: part, colour, the corner it covers, plates up and its turn. */
type Local = readonly [
  partId: string,
  color: number,
  x: number,
  y: number,
  z: number,
  rotation?: Rotation,
];

/** The turn that lays `partId` `width` studs along x and `depth` along z. */
function lie(partId: string, width: number, depth: number): Rotation {
  const size = footprint({ id: '', partId, color: 0, x: 0, y: 0, z: 0, rotation: 0 });
  return size.width === width && size.depth === depth ? 0 : 90;
}

/**
 * Pieces drawn in a `width` x `depth` frame, turned a quarter turn at a time the way pieces
 * turn (rotation 90 sends the frame's front, -z, to -x) and set down with the frame's corner
 * at `x`, `z` and its floor at `y`.
 */
function turned(
  pieces: readonly Local[],
  [width, depth]: readonly [number, number],
  x: number,
  y: number,
  z: number,
  turn: Rotation,
) {
  return pieces.map(([partId, color, u, v, w, rotation = 0]) => {
    const size = footprint({ id: '', partId, color, x: 0, y: 0, z: 0, rotation });
    const [across, along] =
      turn === 0
        ? [u, w]
        : turn === 90
          ? [w, width - u - size.width]
          : turn === 180
            ? [width - u - size.width, depth - w - size.depth]
            : [depth - w - size.depth, u];
    return [
      partId,
      color,
      x + across,
      y + v,
      z + along,
      ((rotation + turn) % 360) as Rotation,
    ] as const;
  });
}

/** Where a frame's cell lands on the board. */
function landed([width, depth]: readonly [number, number], x: number, z: number, turn: Rotation) {
  return (cell: readonly [number, number]) => {
    const [[, , cx, , cz]] = turned(
      [['3024', 0, cell[0], 0, cell[1]]],
      [width, depth],
      x,
      0,
      z,
      turn,
    );
    return key(cx, cz);
  };
}

interface Car {
  x: number;
  z: number;
  /** The road's top, in plates. */
  y: number;
  /** The way the bonnet points: 0 to -z, 90 to -x, 180 to +z, 270 to +x. */
  turn: Rotation;
  body: number;
  roof: number;
  pickup?: true;
}
const CAR: readonly [number, number] = [4, 12];
/** The axles' front rows. */
const AXLES = [2, 8] as const;

const CARS: readonly Car[] = [
  // Parked at the kerbs, between the bay lines.
  { x: 32, z: 55, y: 3, turn: 0, body: MEDIUM_BLUE, roof: WHITE },
  { x: 32, z: 83, y: 3, turn: 180, body: DARK_RED, roof: DARK_RED },
  { x: 92, z: 69, y: 3, turn: 0, body: SAND_GREEN, roof: WHITE },
  // On the move.
  { x: 25, z: 40, y: 3, turn: 180, body: BLACK, roof: BLACK },
  { x: 99, z: 100, y: 3, turn: 0, body: RED, roof: WHITE },
  { x: 56, z: 27, y: 3, turn: 270, body: SAND_BLUE, roof: WHITE },
  // At the pumps, on the street side of the island, leaving the way to the door clear.
  { x: 40, z: 14, y: 4, turn: 90, body: DARK_BLUE, roof: WHITE },
  // Behind the courthouse.
  { x: 51, z: 116, y: 3, turn: 0, body: DARK_TAN, roof: WHITE },
  { x: 56, z: 116, y: 3, turn: 0, body: DARK_GREEN, roof: DARK_GREEN, pickup: true },
  { x: 71, z: 116, y: 3, turn: 0, body: BLACK, roof: WHITE },
];

/**
 * A four-wide fifties car, bonnet to -z: it stands on its wheels, which rest on the road and
 * clip onto pin plates under a raised chassis, with chrome
 * bumpers and grille, round headlamps, red tail lamps, fins, glass all round and a roof in a
 * second tone. A pickup trades the back seat and boot for a bed with a load.
 */
function carPieces({ body, roof, pickup }: Car): { pieces: Local[]; wheels: Local[] } {
  const pieces: Local[] = [];
  const wheels: Local[] = [];
  for (const z of AXLES) {
    pieces.push(['4600', BLACK, 0, 2, z]);
    wheels.push(['4624c01', BLACK, 0, 0, z], ['4624c01', BLACK, 3, 0, z, 180]);
  }
  pieces.push(
    ['2445', BLACK, 1, 3, 0, lie('2445', 2, 12)],
    ['2445', BLACK, 1, 4, 0, lie('2445', 2, 12)],
    ['3029', body, 0, 5, 0, lie('3029', 4, 12)],
    ['2431', PALE, 0, 6, 0, lie('2431', 4, 1)],
    ['2431', PALE, 0, 6, 11, lie('2431', 4, 1)],
    ['3062b', WHITE, 0, 6, 1],
    ['3062b', WHITE, 3, 6, 1],
    ['2877', PALE, 1, 6, 1, lie('2877', 2, 1)],
    ['3008', body, 0, 6, 2, lie('3008', 1, 8)],
    ['3008', body, 3, 6, 2, lie('3008', 1, 8)],
    ['3007', body, 1, 6, 2, lie('3007', 2, 8)],
    ['3062b', RED, 0, 6, 10],
    ['3062b', RED, 3, 6, 10],
    ['3004', body, 1, 6, 10, lie('3004', 2, 1)],
    ['26603', body, 0, 9, 1, lie('26603', 2, 3)],
    ['26603', body, 2, 9, 1, lie('26603', 2, 3)],
    ['3010', TRANS_CLEAR, 0, 9, 4, lie('3010', 4, 1)],
  );
  if (pickup)
    pieces.push(
      ['3005', TRANS_CLEAR, 0, 9, 5],
      ['3005', TRANS_CLEAR, 3, 9, 5],
      ['3010', body, 0, 9, 6, lie('3010', 4, 1)],
      ['26603', roof, 0, 12, 4, lie('26603', 2, 3)],
      ['26603', roof, 2, 12, 4, lie('26603', 2, 3)],
      ['3010', body, 0, 9, 7, lie('3010', 1, 4)],
      ['3010', body, 3, 9, 7, lie('3010', 1, 4)],
      ['3004', body, 1, 9, 10, lie('3004', 2, 1)],
      ['3941', BROWN, 1, 9, 7],
      ['3062b', TAN, 1, 9, 9],
      ['3005', NOUGAT, 2, 9, 9],
    );
  else
    pieces.push(
      ['3004', TRANS_CLEAR, 0, 9, 5, lie('3004', 1, 2)],
      ['3004', TRANS_CLEAR, 3, 9, 5, lie('3004', 1, 2)],
      ['3010', TRANS_CLEAR, 0, 9, 7, lie('3010', 4, 1)],
      ['1751', roof, 0, 12, 4],
      ['26603', body, 1, 9, 8, lie('26603', 2, 3)],
      ['3069b', body, 0, 9, 8, lie('3069b', 1, 2)],
      ['3069b', body, 3, 9, 8, lie('3069b', 1, 2)],
      ['54200', body, 0, 9, 10],
      ['54200', body, 3, 9, 10],
    );
  return { pieces, wheels };
}

interface Figure {
  x: number;
  z: number;
  /** The way the figure faces: 0 to -z (the camera), 90 to -x, 180 to +z, 270 to +x. */
  turn: Rotation;
  torso: number;
  legs: number;
  hair: readonly [partId: string, color: number];
}
const FIGURE: readonly [number, number] = [4, 2];
const FEET = [
  [1, 1],
  [2, 1],
] as const;
const FEDORA = (color: number) => ['13565', color] as const;
const HAIR = (color: number) => ['3901', color] as const;
const QUIFF = (color: number) => ['21268', color] as const;
const BOB = (color: number) => ['29633', color] as const;
const CAP = (color: number) => ['3624', color] as const;

const FIGURES: readonly Figure[] = [
  // Under the Essex marquee, a couple meeting.
  { x: 21, z: 24, turn: 180, torso: RED, legs: DARK_BLUE, hair: QUIFF(BROWN) },
  { x: 21, z: 31, turn: 0, torso: PINK, legs: PINK, hair: BOB(TAN) },
  // Along the pavements.
  { x: 20, z: 52, turn: 0, torso: DARK_STONE, legs: DARK_STONE, hair: FEDORA(BROWN) },
  { x: 104, z: 40, turn: 0, torso: SAND_BLUE, legs: SAND_BLUE, hair: BOB(DARK_BROWN) },
  { x: 104, z: 72, turn: 180, torso: TAN, legs: BROWN, hair: FEDORA(DARK_TAN) },
  { x: 57, z: 18, turn: 180, torso: WHITE, legs: DARK_BLUE, hair: QUIFF(BLACK) },
  { x: 84, z: 17, turn: 180, torso: DARK_RED, legs: DARK_RED, hair: BOB(BLACK) },
  // The attendant at the pumps, facing the car beyond them, a mechanic watching the street
  // from beside the station, and a policeman at the courthouse steps.
  { x: 44, z: 10, turn: 180, torso: WHITE, legs: DARK_GREEN, hair: CAP(RED) },
  { x: 38, z: 9, turn: 90, torso: DARK_BLUE, legs: DARK_BLUE, hair: HAIR(BROWN) },
  { x: 47, z: 80, turn: 0, torso: DARK_BLUE, legs: DARK_BLUE, hair: CAP(DARK_BLUE) },
  // A greaser in black by the car parked at the kerb on the left.
  { x: 36, z: 61, turn: 90, torso: BLACK, legs: DARK_BLUE, hair: QUIFF(BLACK) },
  // A waitress out on the pavement in front of the shops on the left.
  { x: 21, z: 96, turn: 270, torso: PINK, legs: WHITE, hair: BOB(DARK_BROWN) },
  // A newspaper seller by his stack of papers, at the square's front edge.
  { x: 80, z: 33, turn: 0, torso: TAN, legs: DARK_TAN, hair: FEDORA(DARK_BROWN) },
  // A crowd on the pavement by the cable's lamp, looking up the square to the clock tower.
  { x: 36, z: 47, turn: 180, torso: SAND_RED, legs: DARK_STONE, hair: FEDORA(BLACK) },
  { x: 36, z: 50, turn: 180, torso: SAND_BLUE, legs: SAND_BLUE, hair: BOB(TAN) },
  { x: 36, z: 43, turn: 270, torso: DARK_GREEN, legs: TAN, hair: HAIR(BLACK) },
  // In the square: round the flagpole and up the walk.
  { x: 59, z: 53, turn: 270, torso: SAND_GREEN, legs: TAN, hair: HAIR(DARK_BROWN) },
  { x: 67, z: 53, turn: 90, torso: MEDIUM_BLUE, legs: MEDIUM_BLUE, hair: BOB(BROWN) },
  { x: 62, z: 66, turn: 180, torso: BROWN, legs: DARK_TAN, hair: FEDORA(BLACK) },
];

/** A minifigure facing -z: legs on two studs, torso, a grinning head and hair or a hat. */
function figurePieces({ torso, legs, hair: [hair, hairColor] }: Figure): Local[] {
  return [
    ['3815c01', legs, 1, 0, 0],
    ['76382p00', torso, 0, 5, 0],
    ['3626bp01', YELLOW, 1, 9, 0.5],
    hair === '13565' ? [hair, hairColor, 0.5, 12, 0] : [hair, hairColor, 1, 12, 0.5],
  ];
}

/** Pavement and square cells that keep their studs, under the figures' feet. */
/** The newspaper seller's stack of papers, by the corner cell it stands on. */
const PAPERS = [84, 33] as const;
const STUDDED = new Set([
  ...FIGURES.flatMap((figure) => FEET.map(landed(FIGURE, figure.x, figure.z, figure.turn))),
  ...[0, 1].flatMap((dx) => [0, 1].map((dz) => key(PAPERS[0] + dx, PAPERS[1] + dz))),
]);
/** The cells each figure stands over, kept clear of tufts and flowers. */
const CROWDED = new Set(
  FIGURES.flatMap((figure) =>
    [0, 1, 2, 3].flatMap((u) =>
      [0, 1].map((w) => landed(FIGURE, figure.x, figure.z, figure.turn)([u, w])),
    ),
  ),
);
/** The plate under each tile, for slabs that keep their studs. */
const STUDDED_PLATE: Readonly<Record<string, string>> = {
  s: 'o',
  e: 'o',
  H: 'o',
  C: 'o',
  k: 'K',
  h: 'K',
  f: 'K',
  c: 'K',
  n: 'N',
  R: 'Q',
};

export const hillValley: ExampleDefinition = {
  id: 'hill-valley',
  name: 'Hill Valley (1955)',
  tags: [
    'town-square',
    'courthouse',
    'clock-tower',
    'street',
    'shops',
    'theatre',
    'filling-station',
    'trees',
    'cars',
    'minifigures',
    'cable',
  ],
  expectedPieceCount: 12043,
  buildArea: SIZE,
  build(add) {
    const order = bottomUp(add);
    const boxes: Box[] = [];
    const record: ExampleBrickAdder = (
      partId,
      color,
      x,
      y,
      z,
      rotation = 0,
      facing,
      upsideDown,
      tilt,
      strung,
    ) => {
      const size = footprint({
        id: '',
        partId,
        color,
        x,
        y,
        z,
        rotation,
        ...(facing ? { facing } : {}),
      });
      boxes.push({
        u0: x,
        u1: x + size.width,
        v0: z,
        v1: z + size.depth,
        y0: y,
        y1: y + size.height,
      });
      order.add(partId, color, x, y, z, rotation, facing, upsideDown, tilt, strung);
    };
    const put = glazeWindows(record);
    const board: Rect = { x0: 0, z0: 0, x1: SIZE - 1, z1: SIZE - 1 };

    // ----------------------------------------------------------------------------------------
    // The ground: two layers of base plates, asphalt tiles on the roads, a plate everywhere
    // else, and on that the pavement's slabs, the lawn and the building plinths.
    for (const [y, offset] of [
      [0, 8],
      [1, 0],
    ] as const)
      for (let x = -offset; x < SIZE; x += 16)
        for (let z = -offset; z < SIZE; z += 16) {
          const [x0, z0] = [Math.max(0, x), Math.max(0, z)];
          const [w, d] = [Math.min(SIZE, x + 16) - x0, Math.min(SIZE, z + 16) - z0];
          const part = w === 16 && d === 16 ? '91405' : w === 8 && d === 8 ? '41539' : '92438';
          put(part, DARK_STONE, x0, y, z0, w === 16 && d === 8 ? 90 : 0);
        }
    paint(
      put,
      board,
      2,
      (x, z) => {
        if (DRAIN_CELLS.has(key(x, z))) return ' ';
        if (isRoad(x, z) && !FIXTURES.has(key(x, z))) return road(x, z);
        return within(x, z, LAWN) ? 'g' : 'b';
      },
      {
        r: ['tile', DARK_STONE],
        p: ['tile', STONE],
        w: ['tile', WHITE],
        y: ['tile', YELLOW],
        g: ['plate', GREEN],
        b: ['plate', STONE],
      },
    );
    for (const [x, z] of DRAINS) put('2412b', DARK_STONE, x, 2, z);
    paint(
      put,
      board,
      3,
      (x, z) => {
        const cell = slab(x, z);
        return STUDDED.has(key(x, z)) ? (STUDDED_PLATE[cell] ?? cell) : cell;
      },
      {
        F: ['plate', STONE],
        M: ['plate', PALE],
        B: ['plate', DARK_STONE],
        c: ['tile', PALE],
        C: ['tile', STONE],
        h: ['tile', PALE],
        H: ['tile', STONE],
        g: ['plate', GREEN],
        G: ['plate', DARK_GREEN],
        P: ['plate', PALE],
        e: ['tile', STONE],
        f: ['tile', PALE],
        R: ['tile', RED],
        k: ['tile', PALE],
        n: ['tile', DARK_TAN],
        o: ['plate', STONE],
        s: ['tile', STONE],
        K: ['plate', PALE],
        N: ['plate', DARK_TAN],
        Q: ['plate', RED],
      },
    );
    function slab(x: number, z: number) {
      if (PITS.has(key(x, z))) return 'N';
      if (FIXTURES.has(key(x, z))) return within(x, z, LAWN) ? 'M' : 'F';
      if (isRoad(x, z)) return ' ';
      if (isBuilt(x, z)) return 'B';
      if (within(x, z, TEXACO_LOT)) return (x + z) % 9 === 0 || z % 4 === 0 ? 'C' : 'c';
      if (within(x, z, LAWN)) {
        if (isPath(x, z)) return isPlaza(x, z) && (x + z) % 3 === 0 ? 'H' : 'h';
        return hash(Math.floor(x / 4), Math.floor(z / 4), 3) < 0.22 ? 'G' : 'g';
      }
      if (within(x, z, PORTICO)) return 'P';
      if (within(x, z, FORECOURT))
        return x === FORECOURT.x0 || x === FORECOURT.x1 || z === FORECOURT.z0 ? 'e' : 'f';
      return pavement(x, z);
    }

    // ----------------------------------------------------------------------------------------
    // The courthouse.
    const wingShells = WINGS.map((rect, index): Shell => {
      const inner: Facing = index === 0 ? '+x' : '-x';
      const open = SIDES.filter((side) => side !== inner);
      return {
        rect,
        hidden: [inner],
        courses: COURT_COURSES,
        bands: [8],
        openings: courtWindows(rect, open, () => false),
        cell: courtCell(41 + index),
        legend: COURT_LEGEND,
        trim: WHITE,
      };
    });
    for (const [index, shell] of wingShells.entries()) {
      const { slab, slabY } = addShell(put, shell);
      addFlatRoof(put, shell.rect, slab, slabY + 1, {
        wall: SAND_RED,
        trim: WHITE,
        seed: 43 + index,
        balustrade: ['-z'],
      });
    }
    // The centre block: the main door behind the portico, a gable roof over both.
    const centreOpenings = [
      ...courtWindows(CENTRE, ['-z', '+z'], (side, u) => side === '-z' && u >= 9 && u <= 15),
      {
        side: '-z' as const,
        u: 11,
        width: 4,
        course: 1,
        courses: 6,
        pieces: [['60596', 0, WHITE] as const],
        door: ['60623', BROWN] as const,
        lintel: true,
      },
    ];
    const entablature = (x: number, z: number) =>
      x >= CENTRE.x0 && x <= CENTRE.x1 && (z === COLUMN_Z || z === COLUMN_Z + 1);
    const centre = addShell(put, {
      rect: CENTRE,
      hidden: ['-x', '+x'],
      courses: COURT_COURSES,
      bands: [8],
      openings: centreOpenings,
      cell: courtCell(45),
      legend: COURT_LEGEND,
      trim: WHITE,
      slab: { x0: CENTRE.x0, z0: 76, x1: CENTRE.x1, z1: CENTRE.z1 + 1 },
      along: 'z',
      held: entablature,
    });
    // Steps up to the portico floor, which is level with the door.
    for (let x = PORTICO.x0; x <= PORTICO.x1; x++) {
      put('3070b', WHITE, x, 4, PORTICO.z0);
    }
    addRun(put, 'plate', PALE, 'x', PORTICO.x0, 4, PORTICO.z0 + 1, 26);
    addRun(put, 'tile', WHITE, 'x', PORTICO.x0, 5, PORTICO.z0 + 1, 26);
    paint(
      put,
      { x0: PORTICO.x0, z0: PORTICO.z0 + 2, x1: PORTICO.x1, z1: PORTICO.z1 },
      4,
      () => 'p',
      { p: ['plate', PALE] },
    );
    const columnCell = (x: number, z: number) =>
      COLUMNS.some((cx) => x >= cx && x <= cx + 1) && (z === COLUMN_Z || z === COLUMN_Z + 1);
    const floor: Rect = { x0: PORTICO.x0, z0: PORTICO.z0 + 2, x1: PORTICO.x1, z1: PORTICO.z1 };
    paint(put, floor, 5, () => 'p', { p: ['plate', PALE] });
    paint(put, floor, 6, (x, z) => (columnCell(x, z) ? 'p' : z === floor.z0 ? 'e' : 'f'), {
      p: ['plate', PALE],
      e: ['tile', WHITE],
      f: ['tile', PALE],
    });
    // Four white columns with plate capitals carry the entablature under the pediment.
    const columnTop = centre.courseY(COURT_COURSES - 1);
    for (const x of COLUMNS) {
      let y = 7;
      for (; y + 3 <= columnTop; y += 3) put('3941', WHITE, x, y, COLUMN_Z);
      for (; y < columnTop; y++) put('3022', WHITE, x, y, COLUMN_Z);
    }
    for (const z of [COLUMN_Z, COLUMN_Z + 1])
      for (const [x, length] of [
        [51, 6],
        [57, 8],
        [65, 8],
        [73, 4],
      ] as const)
        addRun(put, 'brick', WHITE, 'x', x, columnTop, z, length);
    // The pediment and roof, and the clock tower rising from the pediment's apex.
    const roofY = centre.slabY + 1;
    addGableRoof(put, {
      x0: CENTRE.x0,
      x1: CENTRE.x1,
      z0: 76,
      z1: CENTRE.z1 + 1,
      y: roofY,
      colors: [DARK_STONE, STONE],
      gables: [WHITE, SAND_RED],
      seed: 47,
      blocked: (x, z) => within(x, z, CLOCK_TOWER),
    });
    const TOWER_COURSES = 9;
    const CLOCK_COURSE = 6;
    const clockX = 63;
    for (let c = 0; c < TOWER_COURSES; c++)
      course(
        put,
        CLOCK_TOWER,
        roofY + 3 * c,
        c,
        (x, z) =>
          !onRing(x, z, CLOCK_TOWER) || (c === CLOCK_COURSE && x === clockX && z === CLOCK_TOWER.z0)
            ? ' '
            : c === TOWER_COURSES - 1 || c === 2
              ? 't'
              : (x === CLOCK_TOWER.x0 || x === CLOCK_TOWER.x1) &&
                  c > 3 &&
                  c < 7 &&
                  z > CLOCK_TOWER.z0 &&
                  z < CLOCK_TOWER.z1
                ? 'g'
                : 'w',
        { w: ['brick', WHITE], t: ['brick', PALE], g: ['brick', DARK_STONE] },
      );
    const towerTop = roofY + 3 * TOWER_COURSES;
    const towerSlab: Rect = {
      x0: CLOCK_TOWER.x0 - 1,
      z0: CLOCK_TOWER.z0 - 1,
      x1: CLOCK_TOWER.x1 + 1,
      z1: CLOCK_TOWER.z1 + 1,
    };
    addSlab(put, towerSlab, towerTop, WHITE, (x, z) => onRing(x, z, CLOCK_TOWER));
    const corners = [
      [towerSlab.x0, towerSlab.z0],
      [towerSlab.x1, towerSlab.z0],
      [towerSlab.x0, towerSlab.z1],
      [towerSlab.x1, towerSlab.z1],
    ];
    for (const [x, z] of corners) put('4589', WHITE, x, towerTop + 1, z);
    put('6141', BLACK, CABLE_TOP[0], CABLE_TOP[1] - 1, CABLE_TOP[2]);
    const domeX = 63;
    const domeZ = 77;
    paint(
      put,
      towerSlab,
      towerTop + 1,
      (x, z) =>
        corners.some(([cx, cz]) => cx === x && cz === z) ||
        (x >= domeX && x <= domeX + 1 && z >= domeZ && z <= domeZ + 1)
          ? ' '
          : 't',
      { t: ['tile', WHITE] },
    );

    put('3942c', DARK_STONE, domeX, towerTop + 1, domeZ);
    put('3957a', DARK_STONE, domeX + 0.5, towerTop + 7, domeZ + 0.5);
    put('2335', RED, domeX + 0.5, towerTop + 13, domeZ + 0.5, 90);
    // The clock: a white dial on a black boss, on a side stud in the tower's face.
    const clockY = roofY + 3 * CLOCK_COURSE;
    const host = {
      partId: '87087',
      color: BLACK,
      x: clockX,
      y: clockY,
      z: CLOCK_TOWER.z0 - 0.5,
      rotation: 0 as Rotation,
    };
    let seatedHost: Omit<Brick, 'id'> | undefined;
    for (const rotation of [0, 90, 180, 270] as Rotation[])
      for (const [dx, dz] of [
        [0, 0],
        [0, 0.5],
        [-0.5, 0],
        [0, -0.5],
      ]) {
        if (seatedHost) break;
        const candidate = { ...host, x: clockX + dx, z: CLOCK_TOWER.z0 + dz - 0.5, rotation };
        const size = footprint({ id: '', ...candidate });
        if (candidate.z !== CLOCK_TOWER.z0 - 0.5 || size.depth !== 1.5) continue;
        const probe = seatOnSideStuds(
          {
            id: 'p',
            partId: '3024',
            color: WHITE,
            x: 0,
            y: clockY,
            z: 0,
            rotation: 0,
            facing: '-z',
          },
          { id: 'h', ...candidate },
        );
        if (probe) seatedHost = candidate;
      }
    if (!seatedHost) throw new Error('hill-valley: no side stud for the clock.');
    put(
      seatedHost.partId,
      seatedHost.color,
      seatedHost.x,
      seatedHost.y,
      seatedHost.z,
      seatedHost.rotation,
    );
    // Each piece of the clock face hangs on the studs of the one behind it.
    const mountOn = (
      host: Omit<Brick, 'id'>,
      partId: string,
      color: number,
      x: number,
      y: number,
      z: number,
      rotation: Rotation = 0,
    ) => {
      const seated = seatOnSideStuds(
        { id: 'piece', partId, color, x, y, z, rotation, facing: '-z' },
        { id: 'host', ...host },
      );
      if (!seated) throw new Error(`hill-valley: the clock's ${partId} does not seat.`);
      put(partId, color, seated.x, seated.y, seated.z, rotation, '-z');
      return seated;
    };
    // The dial hangs by its second column, so it centres on the tower's middle line.
    const dial = mountOn(seatedHost, '60474', WHITE, clockX - 1, clockY - 1, CLOCK_TOWER.z0 - 0.4);
    if (dial.x + 2 !== (CLOCK_TOWER.x0 + CLOCK_TOWER.x1 + 1) / 2)
      throw new Error('hill-valley: the clock dial is off centre.');
    // The hands turn on a black round jumper on the dial's middle four studs, its one stud at the
    // dial's centre: the long minute hand, a plate, up to twelve, and the short hour hand, a
    // tile on the plate's lower stud, across to nine.
    const boss = mountOn(dial, '18674', BLACK, dial.x + 1, dial.y + 2.5, dial.z - 0.4);
    const minute = mountOn(boss, '3023b', BLACK, dial.x + 1.5, dial.y + 3.75, boss.z - 0.4);
    mountOn(minute, '3069b', BLACK, dial.x + 0.5, dial.y + 3.75, minute.z - 0.4, 90);

    // ----------------------------------------------------------------------------------------
    // The shops round the square.
    for (const shop of [...WEST_SHOPS, ...EAST_SHOPS, ...FRONT_SHOPS]) addShop(put, shop);

    // The Essex: lobby front, marquee and blade sign, turret, and the auditorium behind.
    const lobbyShell = shopShell(LOBBY);
    const lobby = addShell(put, {
      ...lobbyShell,
      bare: (x, z) => x === LOBBY.rect.x1 + 1 && z >= MARQUEE[0] && z <= MARQUEE[1],
    });
    addFlatRoof(put, LOBBY.rect, lobby.slab, lobby.slabY + 1, {
      wall: SAND_GREEN,
      trim: WHITE,
      seed: 32,
      balustrade: ['+x'],
    });
    const marqueeY = lobby.courseY(5);
    for (let z = MARQUEE[0]; z <= MARQUEE[1]; z++) put('3623', WHITE, 20, marqueeY, z, 90);
    addRun(put, 'brick', WHITE, 'z', 22, marqueeY + 1, MARQUEE[0], MARQUEE[1] - MARQUEE[0] + 1);
    addRun(put, 'tile', RED, 'z', 22, marqueeY + 4, MARQUEE[0], MARQUEE[1] - MARQUEE[0] + 1);
    for (const x of [20, 21])
      for (const [from, to] of [
        [MARQUEE[0], BLADE - 1],
        [BLADE + 1, MARQUEE[1]],
      ])
        addRun(put, 'tile', x === 20 ? YELLOW : WHITE, 'z', x, marqueeY + 1, from, to - from + 1);
    for (let c = 0; c < 8; c++)
      put('3004', c % 4 === 3 ? RED : WHITE, 20, marqueeY + 1 + 3 * c, BLADE, 90);
    put('3069b', RED, 20, marqueeY + 25, BLADE, 90);
    // The turret: round 4 x 4 bricks with white bands, under a slate cone.
    const turretTop = lobby.slabY + 3;
    for (let y = GROUND, index = 0; y < turretTop; y += 3, index++)
      put('87081', index % 5 === 4 ? WHITE : SAND_GREEN, TURRET[0], y, TURRET[1]);
    const coneY = GROUND + 3 * Math.ceil((turretTop - GROUND) / 3);
    put('3943b', DARK_STONE, TURRET[0], coneY, TURRET[1]);
    put('3942c', DARK_STONE, TURRET[0] + 1, coneY + 6, TURRET[1] + 1);
    put('4589', DARK_STONE, TURRET[0] + 1.5, coneY + 12, TURRET[1] + 1.5);
    // A narrow stair block between the turret and the auditorium.
    for (let y = GROUND; y < GROUND + 33; y += 3) put('3001', TAN, 14, y, 42);
    put('87079', WHITE, 14, GROUND + 33, 42);
    // The auditorium: tan walls with white pilasters and film posters, a brown gable roof.
    const posters: Readonly<Record<string, number>> = { P: RED, Y: YELLOW, U: DARK_BLUE };
    const auditorium = addShell(put, {
      rect: AUDITORIUM,
      hidden: ['+x', '+z'],
      courses: 11,
      bands: [],
      openings: [],
      cell: (places, c) => {
        const [side, u] = places[0];
        if (c === 10 || places.length > 1) return 't';
        if (side === '-z') {
          const poster = [3, 8].find((start) => u >= start && u <= start + 2);
          if (poster !== undefined && c >= 3 && c <= 6)
            return c >= 5 ? (poster === 3 ? 'P' : 'U') : 'Y';
        }
        if (u % 5 === 0) return 't';
        return hash(u, c, 33) < 0.12 ? 'a' : 'w';
      },
      legend: {
        w: ['brick', TAN],
        a: ['brick', DARK_TAN],
        t: ['brick', WHITE],
        ...Object.fromEntries(
          Object.entries(posters).map(([char, color]) => [char, ['brick', color] as const]),
        ),
      },
      trim: WHITE,
      slab: AUDITORIUM,
    });
    addGableRoof(put, {
      ...AUDITORIUM,
      y: auditorium.slabY + 1,
      colors: [BROWN, NOUGAT],
      gables: [TAN, TAN],
      seed: 34,
    });

    // The filling station: a white box with a blue band, a canopy over the pumps, a sign.
    const station = addShop(put, {
      rect: TEXACO,
      face: '+z',
      uppers: 0,
      wall: WHITE,
      alt: PALE,
      trim: MEDIUM_BLUE,
      shop: WHITE,
      frame: WHITE,
      door: RED,
      seed: 23,
    });
    void station;
    for (const x of [41, 49]) for (let y = 4; y < 19; y += 3) put('3941', WHITE, x, y, 12);
    put('3028', WHITE, 40, 19, 9, 90);
    paint(
      put,
      { x0: 40, z0: 9, x1: 51, z1: 14 },
      20,
      (x, z) => (x === 40 || x === 51 || z === 9 || z === 14 ? 'e' : 'c'),
      { e: ['tile', RED], c: ['tile', WHITE] },
    );
    addRun(put, 'plate', DARK_STONE, 'x', 43, 4, 12, 6);
    addRun(put, 'plate', DARK_STONE, 'x', 43, 4, 13, 6);
    for (const x of [44, 47]) {
      put('3005', RED, x, 5, 12);
      put('3005', RED, x, 8, 12);
      put('98138', WHITE, x, 11, 12);
    }
    for (let y = 4; y < 22; y += 3) put('3062b', DARK_STONE, 52, y, 14);
    put('3941', RED, 52, 22, 14);
    put('14769', WHITE, 52, 25, 14);

    // ----------------------------------------------------------------------------------------
    // Street furniture.
    // Each lamp's lantern holds a white bulb under a black cap. On the cable's lamps the bulb
    // sits on the end studs of a short cord strung straight across the street between the two
    // lamps' tops. The long cord is made fast to the finial on the clock tower's front left
    // corner and comes down onto the near lamp's bulb, under its cap.
    const [nearEnd, farEnd] = CABLE_LAMPS.map(([x, z]) => [x + 0.5, GROUND + 21, z + 0.5] as const);
    put('75924', BLACK, ...nearEnd, 0, undefined, undefined, undefined, {
      x: farEnd[0],
      y: farEnd[1],
      z: farEnd[2],
    });
    put('71149', BLACK, ...CABLE_FOOT, 0, undefined, undefined, undefined, {
      x: CABLE_TOP[0],
      y: CABLE_TOP[1],
      z: CABLE_TOP[2],
    });
    for (const [x, z] of LAMPS) {
      const cable = CABLE_LAMPS.findIndex(([cx, cz]) => cx === x && cz === z);
      const bulb = GROUND + (cable < 0 ? 21 : 22);
      put('2039', BLACK, x, GROUND, z);
      put('3062b', WHITE, x + 0.5, bulb, z + 0.5);
      put('98138', BLACK, x + 0.5, bulb + (cable === 0 ? 4 : 3), z + 0.5);
    }
    for (const [x, z] of HYDRANTS) {
      put('3062b', RED, x, GROUND, z);
      put('6141', RED, x, GROUND + 3, z);
    }
    for (const [x, z] of POLES) {
      for (let y = GROUND; y < GROUND + 30; y += 3) put('3062b', DARK_BROWN, x, y, z);
      const alongZ = x === 23 || x === 104;
      put('3710', DARK_BROWN, alongZ ? x : x - 1, GROUND + 30, alongZ ? z - 1 : z, alongZ ? 0 : 90);
      for (const offset of [-1, 2])
        put('6141', WHITE, alongZ ? x : x + offset, GROUND + 31, alongZ ? z + offset : z);
    }

    // ----------------------------------------------------------------------------------------
    // The square: a hedge round the lawn, the flagpole and memorial at the crossing, benches,
    // flower beds round the plaza and the trees.
    course(
      put,
      LAWN,
      GROUND,
      0,
      (x, z) => (onRing(x, z, LAWN) && !isPath(x, z) ? (hash(x, z, 51) < 0.2 ? 'h' : 'd') : ' '),
      { d: ['brick', DARK_GREEN], h: ['brick', GREEN] },
    );
    paint(
      put,
      LAWN,
      GROUND + 3,
      (x, z) => (onRing(x, z, LAWN) && !isPath(x, z) ? (hash(x, z, 52) < 0.3 ? 'l' : 'd') : ' '),
      { d: ['plate', DARK_GREEN], l: ['plate', GREEN] },
    );
    // The memorial: a dark stone block with a bronze plaque, beside the flagpole.
    put('3001', DARK_STONE, 62, GROUND, 57, 90);
    put('3001', DARK_STONE, 62, GROUND + 3, 57, 90);
    put('87079', BLACK, 62, GROUND + 6, 57, 90);
    put('3941', DARK_STONE, 63, GROUND, 52);
    for (let y = GROUND + 3; y < GROUND + 27; y += 3) put('3062b', WHITE, 63, y, 52);
    put('3957a', WHITE, 63, GROUND + 27, 52);
    put('2335', RED, 63, GROUND + 33, 52, 90);
    // Flower beds round the plaza: clumps of one colour on the lawn's studs.
    for (let x = LAWN.x0 + 1; x < LAWN.x1; x++)
      for (let z = LAWN.z0 + 1; z < LAWN.z1; z++) {
        const ring = Math.hypot(x + 0.5 - CENTRE_X - 0.5, z + 0.5 - CENTRE_Z - 0.5);
        if (isPath(x, z) || ring < 5.5 || ring > 7 || CROWDED.has(key(x, z))) continue;
        if (hash(x, z, 61) < 0.55) {
          const angle = Math.atan2(z - CENTRE_Z, x - CENTRE_X);
          const clump = Math.floor(((angle + Math.PI) / (2 * Math.PI)) * 6);
          put('6141', [YELLOW, RED, WHITE][clump % 3], x, GROUND, z);
        }
      }
    for (const [x, z] of BENCHES) {
      put('3005', DARK_BROWN, x, GROUND, z);
      put('3005', DARK_BROWN, x + 3, GROUND, z);
      put('3710', BROWN, x, GROUND + 3, z, 90);
      put('2431', BROWN, x, GROUND + 4, z, 90);
    }
    // Tufts on the lawn, sparse and away from the paths.
    for (let x = LAWN.x0 + 2; x < LAWN.x1 - 1; x++)
      for (let z = LAWN.z0 + 2; z < LAWN.z1 - 1; z++) {
        if (isPath(x, z) || isPath(x + 1, z) || isPath(x, z + 1) || isPath(x - 1, z)) continue;
        if (CROWDED.has(key(x, z))) continue;
        const ring = Math.hypot(x + 0.5 - CENTRE_X - 0.5, z + 0.5 - CENTRE_Z - 0.5);
        if (ring < 8) continue;
        if (BENCHES.some(([bx, bz]) => z === bz && x >= bx - 1 && x <= bx + 4)) continue;
        if (TREES.some(([tx, tz]) => Math.hypot(x - tx, z - tz) < 5)) continue;
        if (hash(x, z, 71) < 0.025)
          put('6141', hash(x, z, 72) < 0.5 ? BRIGHT_GREEN : DARK_GREEN, x, GROUND, z);
      }
    const near = (x: number, z: number, reach: number) =>
      boxes.filter(
        (box) =>
          box.u1 > x - reach && box.u0 < x + reach && box.v1 > z - reach && box.v0 < z + reach,
      );
    for (const [x, z, trunk, seed] of TREES)
      addTree(put, x, z, GROUND, [DARK_GREEN, GREEN, BRIGHT_GREEN], BROWN, trunk, seed, [
        ...near(x, z, 12),
        ...CABLE_CELLS,
      ]);

    // ----------------------------------------------------------------------------------------
    // Cars and townsfolk. Each car stands on its wheels, and its pin plates clip onto them.
    for (const car of CARS) {
      const { pieces, wheels } = carPieces(car);
      for (const piece of turned([...wheels, ...pieces], CAR, car.x, car.y, car.z, car.turn))
        put(...piece);
    }
    for (const figure of FIGURES)
      for (const piece of turned(
        figurePieces(figure),
        FIGURE,
        figure.x,
        GROUND,
        figure.z,
        figure.turn,
      ))
        put(...piece);
    // The papers: white plates stacked on a crate, a tile on top.
    put('3022', BROWN, PAPERS[0], GROUND, PAPERS[1]);
    put('3022', BROWN, PAPERS[0], GROUND + 1, PAPERS[1]);
    for (let sheet = 2; sheet < 5; sheet++)
      put('3022', WHITE, PAPERS[0], GROUND + sheet, PAPERS[1]);
    put('3068b', WHITE, PAPERS[0], GROUND + 5, PAPERS[1]);

    // The street trees, grown last so their crowns leave room for the townsfolk and the lamps:
    // a trunk standing tall in its pit, clear of the heads below, under a small round crown,
    // and the pit's earth dotted with a few tufts.
    for (const [x, z, seed] of PIT_TREES) {
      addTree(put, x, z, GROUND, [DARK_GREEN, GREEN, BRIGHT_GREEN], BROWN, 5, seed, near(x, z, 8), {
        foot: false,
        radii: [2.9, 3.3, 3, 2.2],
      });
      for (const dx of [-2, -1, 0, 1])
        for (const dz of [-2, -1, 0, 1]) {
          if (dx >= -1 && dx <= 0 && dz >= -1 && dz <= 0) continue;
          if (CROWDED.has(key(x + dx, z + dz)) || hash(x + dx, z + dz, seed) > 0.3) continue;
          put(
            '6141',
            hash(x + dx, z + dz, seed + 1) < 0.5 ? DARK_GREEN : GREEN,
            x + dx,
            GROUND,
            z + dz,
          );
        }
    }

    order.flush();
  },
};
