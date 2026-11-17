import { getWorldBounds } from '@brick-workshop/engine';
import type { Rotation } from '@brick-workshop/engine';
import type { Piece } from './houses.ts';

/**
 * Harbour Town's fire station and police station, laid brick by brick facing +z like the houses:
 * two storeys of bonded walls with quoins and bands, flat roofs behind a parapet, and rooms you
 * can walk into. The fire station has two open engine bays, a fire pole and a hose tower; the
 * police station has a front desk and a jail of two barred cells at the back.
 */

const GLASS = 47;
const TRANS_RED = 36;
const TRANS_DARK_BLUE = 33;

/** Bricks and plates 1 x n by length. */
const BRICK: Record<number, string> = { 1: '3005', 2: '3004', 3: '3622', 4: '3010' };
const PLATE: Record<number, string> = {
  1: '3024',
  2: '3023b',
  3: '3623',
  4: '3710',
  6: '3666',
  8: '3460',
};
const TILE: Record<number, string> = {
  1: '3070b',
  2: '3069b',
  3: '63864',
  4: '2431',
  6: '6636',
  8: '4162',
};
/** Courses in a storey: doorways and bays six bricks tall with a course over them. */
const LOWER = 7;
const UPPER = 6;
/** Plates from the foot to the underside of the roof: two storeys, each with its band. */
const ROOF_Y = LOWER * 3 + 1 + UPPER * 3 + 1;

type Along = 'x' | 'z';

/** A hole in a wall, `length` studs along it, from course `from` up to (not including) `to`. */
interface Opening {
  x: number;
  z: number;
  along: Along;
  length: number;
  from: number;
  to: number;
  /** What fills it: a door or window frame (and its glass), or nothing for an open bay. */
  fill?: 'door' | 'window' | 'small' | 'barred';
  frame?: number;
}

class Layout {
  readonly pieces: Piece[] = [];

  add(
    partId: string,
    color: number,
    x: number,
    y: number,
    z: number,
    rotation: Rotation = 0,
    upsideDown?: true,
  ) {
    this.pieces.push({ partId, color, x, y, z, rotation, ...(upsideDown ? { upsideDown } : {}) });
  }

  /** A straight run of 1 x n pieces from a table of lengths, longest first. */
  run(
    table: Record<number, string>,
    color: (at: number) => number,
    x: number,
    y: number,
    z: number,
    along: Along,
    length: number,
  ) {
    const sizes = Object.keys(table)
      .map(Number)
      .sort((a, b) => b - a);
    let at = 0;
    while (at < length) {
      const size = sizes.find((s) => s <= length - at)!;
      this.add(
        table[size],
        color(at),
        along === 'x' ? x + at : x,
        y,
        along === 'z' ? z + at : z,
        along === 'x' ? 90 : 0,
      );
      at += size;
    }
  }

  /** A ring of plates or tiles round the top of a `w` by `d` wall. */
  ring(
    table: Record<number, string>,
    color: number,
    x: number,
    y: number,
    z: number,
    w: number,
    d: number,
  ) {
    this.run(table, () => color, x, y, z, 'x', w);
    this.run(table, () => color, x, y, z + d - 1, 'x', w);
    this.run(table, () => color, x, y, z + 1, 'z', d - 2);
    this.run(table, () => color, x + w - 1, y, z + 1, 'z', d - 2);
  }

  /**
   * Bonded walls round a `w` by `d` rectangle from course `first` (counted from the building's
   * foot, so the bond carries on between storeys), `courses` high, leaving its openings and any
   * cell `skip` claims. Courses trade corners: the front and back walls run the full width on
   * even courses, the sides the full depth on odd ones, and runs start half a brick in on odd
   * courses so the joints overlap.
   */
  walls(options: {
    x: number;
    z: number;
    y: number;
    w: number;
    d: number;
    first: number;
    courses: number;
    openings: readonly Opening[];
    color: (x: number, z: number, course: number, corner: boolean) => number;
    skip?: (x: number, z: number, course: number) => boolean;
  }) {
    const { x: ox, z: oz, y: oy, w, d, first, courses, openings, color } = options;
    const taken = (x: number, z: number, course: number) =>
      options.skip?.(x, z, course) ||
      openings.some(
        (o) =>
          course >= o.from &&
          course < o.to &&
          (o.along === 'x'
            ? z === o.z && x >= o.x && x < o.x + o.length
            : x === o.x && z >= o.z && z < o.z + o.length),
      );
    type Line = { x: number; z: number; along: Along; length: number };
    const all: Line[] = [
      { x: 0, z: 0, along: 'x', length: w },
      { x: 0, z: d - 1, along: 'x', length: w },
      { x: 0, z: 0, along: 'z', length: d },
      { x: w - 1, z: 0, along: 'z', length: d },
    ];
    for (let course = first; course < first + courses; course++) {
      const y = oy + (course - first) * 3;
      const long = course % 2 === 0;
      const lines = all.map((line): Line =>
        (line.along === 'x') === long
          ? line
          : line.along === 'x'
            ? { ...line, x: 1, length: w - 2 }
            : { ...line, z: 1, length: d - 2 },
      );
      for (const line of lines) {
        let start = 0;
        const flush = (end: number) => {
          let i = start;
          let first = course % 2 === 1;
          while (i < end) {
            let size = Math.min(4, end - i);
            if (first && size > 2) size = 2;
            first = false;
            const x = line.along === 'x' ? line.x + i : line.x;
            const z = line.along === 'z' ? line.z + i : line.z;
            const corner = (x === 0 || x === w - 1) && (z === 0 || z === d - 1);
            const length = corner && size > 1 ? (course % 2 === 0 ? 2 : 1) : size;
            this.add(
              BRICK[length],
              color(x, z, course, corner),
              ox + x,
              y,
              oz + z,
              line.along === 'x' ? 90 : 0,
            );
            i += length;
          }
        };
        for (let i = 0; i < line.length; i++) {
          const x = line.along === 'x' ? line.x + i : line.x;
          const z = line.along === 'z' ? line.z + i : line.z;
          if (taken(x, z, course)) {
            flush(i);
            start = i + 1;
          }
        }
        flush(line.length);
      }
    }
    // Frames and glass in the openings that have them.
    for (const o of openings) {
      if (!o.fill || o.from < first || o.from >= first + courses) continue;
      const rotation: Rotation = o.along === 'x' ? 90 : 0;
      const x = ox + o.x;
      const z = oz + o.z;
      const y = oy + (o.from - first) * 3;
      const frame = o.frame ?? 15;
      if (o.fill === 'door') this.add('60596', frame, x, y, z, rotation);
      if (o.fill === 'window') {
        this.add('60593', frame, x, y, z, rotation);
        this.add('60602', GLASS, x, y, z, rotation);
      }
      if (o.fill === 'small') {
        this.add('60592', frame, x, y, z, rotation);
        this.add('60601', GLASS, x, y, z, rotation);
      }
      if (o.fill === 'barred') {
        // A 1 x 4 x 3 frame with a pair of barred panes: a cell window.
        this.add('60594', frame, x, y, z, rotation);
        this.add(
          '60608',
          frame,
          o.along === 'x' ? x + 2 : x,
          y,
          o.along === 'z' ? z + 2 : z,
          rotation,
        );
        this.add('60608', frame, x, y, z, rotation, true);
      }
    }
  }

  /** A tiled floor inside the walls, round whatever already stands on the ground. */
  floor(w: number, d: number, color: (x: number, z: number) => number) {
    const standing = new Set<string>();
    for (const piece of this.pieces) {
      if (piece.y !== 0) continue;
      const { minX, maxX, minZ, maxZ } = getWorldBounds({ ...piece, id: '' });
      for (let z = Math.floor(minZ); z < Math.ceil(maxZ); z++)
        for (let x = Math.floor(minX); x < Math.ceil(maxX); x++) standing.add(`${x},${z}`);
    }
    this.cover(1, 1, w - 1, d - 1, 0, (x, z) => !standing.has(`${x},${z}`), color);
  }

  /** Tiles over every free cell of a rectangle, 2 x 2 where they fit, then 1 x 2 and 1 x 1. */
  cover(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    y: number,
    free: (x: number, z: number) => boolean,
    color: (x: number, z: number) => number,
  ) {
    const used = new Set<string>();
    const open = (x: number, z: number) =>
      x >= x0 && x < x1 && z >= z0 && z < z1 && free(x, z) && !used.has(`${x},${z}`);
    const claim = (x: number, z: number, w: number, d: number) => {
      for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) used.add(`${x + dx},${z + dz}`);
    };
    for (let z = z0; z < z1; z++)
      for (let x = x0; x < x1; x++) {
        if (!open(x, z)) continue;
        if (open(x + 1, z) && open(x, z + 1) && open(x + 1, z + 1)) {
          this.add('3068b', color(x, z), x, y, z);
          claim(x, z, 2, 2);
        } else if (open(x + 1, z)) {
          this.add('3069b', color(x, z), x, y, z, 90);
          claim(x, z, 2, 1);
        } else {
          this.add('3070b', color(x, z), x, y, z);
          claim(x, z, 1, 1);
        }
      }
  }
}

/** A seeded shade picker: the base colour, with `share` of the bricks in `other`. */
const sprinkle = (next: () => number, base: number, other: number, share: number) => () =>
  next() < share ? other : base;

/** The flat roof: plates spanning front to back, a parapet capped with tiles, tiles between. */
function flatRoof(
  layout: Layout,
  w: number,
  d: number,
  next: () => number,
  options: {
    parapet: number;
    cap: number;
    skip?: (x: number, z: number) => boolean;
  },
) {
  for (let x = 0; x < w; x += 2) layout.add('91988', 72, x, ROOF_Y, 0);
  const skip = options.skip ?? (() => false);
  const y = ROOF_Y + 1;
  layout.walls({
    x: 0,
    z: 0,
    y,
    w,
    d,
    first: 0,
    courses: 1,
    openings: [],
    color: () => options.parapet,
    skip: (x, z) => skip(x, z),
  });
  // The cap, broken where something stands on the parapet.
  const capped = (x: number, z: number) => !skip(x, z);
  for (const [along, x, z, length] of [
    ['x', 0, 0, w],
    ['x', 0, d - 1, w],
    ['z', 0, 1, d - 2],
    ['z', w - 1, 1, d - 2],
  ] as const) {
    let start = -1;
    for (let i = 0; i <= length; i++) {
      const cx = along === 'x' ? x + i : x;
      const cz = along === 'z' ? z + i : z;
      const ok = i < length && capped(cx, cz);
      if (ok && start < 0) start = i;
      if (!ok && start >= 0) {
        layout.run(
          TILE,
          () => options.cap,
          along === 'x' ? x + start : x,
          y + 3,
          along === 'z' ? z + start : z,
          along,
          i - start,
        );
        start = -1;
      }
    }
  }
  const shade = sprinkle(next, 72, 71, 0.3);
  layout.cover(1, 1, w - 1, d - 1, y, (x, z) => !skip(x, z), shade);
}

/** The fire station's size: two engine bays and an office, 26 studs wide and 14 deep. */
export const FIRE_STATION = { width: 26, depth: 14 } as const;

export function buildFireStation(next: () => number): Piece[] {
  const { width: w, depth: d } = FIRE_STATION;
  const layout = new Layout();
  const front = d - 1;
  const brick = sprinkle(next, 4, 320, 0.18);
  // White piers frame the bays, and a white sign board runs over them under the upper windows.
  // The piers are stacks of their own, so they stay white from foot to roof.
  const sign = (x: number, z: number, course: number) => z === front && x < 16 && course === LOWER;
  const pier = (x: number, z: number, course: number) =>
    z === front && (x === 7 || x === 8 || x === 15) && course !== 6 && course !== LOWER;
  const wallColor = (x: number, z: number, course: number, corner: boolean) =>
    corner || sign(x, z, course) ? 15 : course === 0 ? 72 : brick();
  const piers = (first: number, courses: number, y: number) => {
    for (let course = first; course < first + courses; course++) {
      if (!pier(7, front, course)) continue;
      const at = y + (course - first) * 3;
      layout.add('3004', 15, 7, at, front, 90);
      layout.add('3005', 15, 15, at, front);
    }
  };

  // Ground floor: two open bays, the office door and a window, windows round the sides and back.
  const lower: Opening[] = [
    { x: 1, z: front, along: 'x', length: 6, from: 0, to: 6 },
    { x: 9, z: front, along: 'x', length: 6, from: 0, to: 6 },
    { x: 18, z: front, along: 'x', length: 4, from: 0, to: 6, fill: 'door' },
    { x: 23, z: front, along: 'x', length: 2, from: 2, to: 5, fill: 'window' },
  ];
  for (const x of [9, 15, 21])
    lower.push({ x, z: 0, along: 'x', length: 2, from: 2, to: 5, fill: 'window' });
  for (const z of [4, 8])
    for (const x of [0, w - 1])
      lower.push({ x, z, along: 'z', length: 2, from: 2, to: 5, fill: 'window' });
  // The course over the bays is two long lintels, bearing on the piers either side.
  const lintels = (x: number, z: number, course: number) => course === 6 && z === front && x < 16;
  layout.walls({
    x: 0,
    z: 0,
    y: 0,
    w,
    d,
    first: 0,
    courses: LOWER,
    openings: lower,
    color: wallColor,
    skip: (x, z, course) => lintels(x, z, course) || pier(x, z, course),
  });
  piers(0, LOWER, 0);
  layout.add('3008', 15, 0, 18, front, 90);
  layout.add('3008', 15, 8, 18, front, 90);

  let y = LOWER * 3;
  layout.ring(PLATE, 15, 0, y, 0, w, d);
  y += 1;

  // Upper storey: the crew's rooms, windows all round.
  const upper: Opening[] = [];
  for (const x of [2, 5, 10, 13, 17, 22]) {
    upper.push({
      x,
      z: front,
      along: 'x',
      length: 2,
      from: LOWER + 1,
      to: LOWER + 4,
      fill: 'window',
    });
    upper.push({ x, z: 0, along: 'x', length: 2, from: LOWER + 1, to: LOWER + 4, fill: 'window' });
  }
  for (const z of [4, 8])
    for (const x of [0, w - 1])
      upper.push({ x, z, along: 'z', length: 2, from: LOWER + 1, to: LOWER + 4, fill: 'window' });
  layout.walls({
    x: 0,
    z: 0,
    y,
    w,
    d,
    first: LOWER,
    courses: UPPER,
    openings: upper,
    color: wallColor,
    skip: pier,
  });
  piers(LOWER, UPPER, y);
  y += UPPER * 3;
  layout.ring(PLATE, 15, 0, y, 0, w, d);

  // Inside: lockers with helmets on top along the back, hose reels, the fire pole and a desk.
  for (const x of [2, 4, 6]) {
    for (let k = 0; k < 4; k++) layout.add('2877', 71, x, k * 3, 1, 90);
    layout.add('3062b', 14, x, 12, 1);
    layout.add('3062b', 14, x + 1, 12, 1);
  }
  for (const x of [10, 12]) {
    layout.add('3941', 4, x, 0, 1);
    layout.add('3941', 4, x, 3, 1);
    layout.add('14769', 72, x, 6, 1);
  }
  for (let k = 0; k < 13; k++) layout.add('3062b', 297, 17, k * 3, 6);
  layout.add('6141', 297, 17, 39, 6);
  layout.add('6141', 297, 17, 40, 6);
  layout.add('3010', 70, 19, 0, 9, 90);
  layout.add('2431', 70, 19, 3, 9, 90);
  // Dark grey bays, tan under the office.
  const concrete = sprinkle(next, 72, 71, 0.15);
  layout.floor(w, d, (x) => (x >= 16 ? 19 : concrete()));

  // The roof, the hose tower at the back corner and a pair of red lights over the office.
  const tower = (x: number, z: number) => x >= w - 4 && z <= 3;
  const lights = (x: number, z: number) => z === front && (x === 18 || x === 21);
  flatRoof(layout, w, d, next, {
    parapet: 4,
    cap: 15,
    skip: (x, z) => tower(x, z) || lights(x, z),
  });
  const top = ROOF_Y + 1;
  for (const x of [18, 21]) {
    layout.add('3005', 15, x, top, front);
    layout.add('3062b', TRANS_RED, x, top + 3, front);
  }
  const tw = 4;
  const tx = w - tw;
  const courses = 10;
  // Two tiers of small windows on every face.
  const towerWindows: Opening[] = [2, 6].flatMap((from): Opening[] => [
    { x: 1, z: 0, along: 'x', length: 2, from, to: from + 2, fill: 'small' },
    { x: 1, z: 3, along: 'x', length: 2, from, to: from + 2, fill: 'small' },
    { x: 0, z: 1, along: 'z', length: 2, from, to: from + 2, fill: 'small' },
    { x: 3, z: 1, along: 'z', length: 2, from, to: from + 2, fill: 'small' },
  ]);
  layout.walls({
    x: tx,
    z: 0,
    y: top,
    w: tw,
    d: tw,
    first: 0,
    courses,
    openings: towerWindows,
    color: (_x, _z, course, corner) =>
      corner || course === 5 || course === courses - 1 ? 15 : brick(),
  });
  const cap = top + courses * 3;
  layout.add('3031', 72, tx, cap, 0);
  // A pinwheel of slopes for a pyramid roof.
  layout.add('3039', 320, tx, cap + 1, 0, 0);
  layout.add('3039', 320, tx + 2, cap + 1, 0, 270);
  layout.add('3039', 320, tx + 2, cap + 1, 2, 180);
  layout.add('3039', 320, tx, cap + 1, 2, 90);
  return layout.pieces;
}

/** The police station: a front office and a jail of two cells, 20 studs wide and 14 deep. */
export const POLICE_STATION = { width: 20, depth: 14 } as const;

export function buildPoliceStation(next: () => number): Piece[] {
  const { width: w, depth: d } = POLICE_STATION;
  const layout = new Layout();
  const front = d - 1;
  const stone = sprinkle(next, 71, 72, 0.2);
  const render = sprinkle(next, 15, 151, 0.12);
  const BLUE = 272;

  // Ground floor in grey stone: the door, windows either side, barred cell windows at the back.
  const lower: Opening[] = [
    { x: 8, z: front, along: 'x', length: 4, from: 0, to: 6, fill: 'door', frame: BLUE },
    { x: 1, z: 0, along: 'x', length: 4, from: 2, to: 5, fill: 'barred', frame: 72 },
    { x: 12, z: 0, along: 'x', length: 4, from: 2, to: 5, fill: 'barred', frame: 72 },
  ];
  for (const x of [2, 5, 13, 16])
    lower.push({ x, z: front, along: 'x', length: 2, from: 2, to: 5, fill: 'window' });
  for (const x of [0, w - 1])
    lower.push({ x, z: 9, along: 'z', length: 2, from: 2, to: 5, fill: 'window' });
  layout.walls({
    x: 0,
    z: 0,
    y: 0,
    w,
    d,
    first: 0,
    courses: LOWER,
    openings: lower,
    color: (_x, _z, course, corner) => (corner ? 151 : course === 0 ? 72 : stone()),
  });
  let y = LOWER * 3;
  layout.ring(PLATE, BLUE, 0, y, 0, w, d);
  y += 1;

  // Upper storey rendered white, with dark blue frames.
  const upper: Opening[] = [];
  for (const x of [2, 5, 9, 13, 16]) {
    upper.push({
      x,
      z: front,
      along: 'x',
      length: 2,
      from: LOWER + 1,
      to: LOWER + 4,
      fill: 'window',
      frame: BLUE,
    });
    upper.push({
      x,
      z: 0,
      along: 'x',
      length: 2,
      from: LOWER + 1,
      to: LOWER + 4,
      fill: 'window',
      frame: BLUE,
    });
  }
  for (const z of [3, 9])
    for (const x of [0, w - 1])
      upper.push({
        x,
        z,
        along: 'z',
        length: 2,
        from: LOWER + 1,
        to: LOWER + 4,
        fill: 'window',
        frame: BLUE,
      });
  layout.walls({
    x: 0,
    z: 0,
    y,
    w,
    d,
    first: LOWER,
    courses: UPPER,
    openings: upper,
    color: (_x, _z, _course, corner) => (corner ? 71 : render()),
  });
  y += UPPER * 3;
  layout.ring(PLATE, BLUE, 0, y, 0, w, d);

  // The jail: two cells along the back wall behind bars three fences high, a wall between them.
  // The left cell is shut; the right one stands open, its doorway beside the dividing wall.
  const BARS = 0;
  const bars = 6;
  const barTop = 18;
  for (let k = 0; k < 3; k++) {
    layout.add('15332', BARS, 1, k * 6, bars, 90);
    layout.add('15332', BARS, 5, k * 6, bars, 90);
    layout.add('15332', BARS, 14, k * 6, bars, 90);
  }
  for (let k = 0; k < 6; k++) {
    layout.add('3009', 71, 9, k * 3, 1);
    layout.add('3005', BARS, 18, k * 3, bars);
  }
  layout.add('3460', BARS, 1, barTop, bars, 90);
  layout.add('4477', BARS, 9, barTop, bars, 90);
  // A bench in each cell, and a toilet in the shut one.
  for (const x of [2, 14]) {
    layout.add('3010', 72, x, 0, 1, 90);
    layout.add('2431', 70, x, 3, 1, 90);
  }
  layout.add('3062b', 15, 7, 0, 1);
  layout.add('98138', 15, 7, 3, 1);

  // The front office: a counter facing the door with a monitor on it, a desk and filing cabinets.
  for (let k = 0; k < 2; k++) layout.add('3009', 15, 13, k * 3, 9, 90);
  layout.add('2431', BLUE, 13, 6, 9, 90);
  layout.add('3070b', BLUE, 17, 6, 9);
  layout.add('3005', 0, 18, 6, 9);
  layout.add('3070b', 0, 18, 9, 9);
  layout.add('3010', 70, 2, 0, 9, 90);
  layout.add('2431', 70, 2, 3, 9, 90);
  for (let k = 0; k < 3; k++) layout.add('2877', 71, 1, k * 3, 11);
  // Bare dark grey in the cells, a chequer of light and dark grey in the office.
  layout.floor(w, d, (x, z) => (z < bars ? 72 : (x + z) % 4 === 0 ? 72 : 71));

  // The roof, with a dark blue sign panel over the door and a blue light at each end of it.
  const sign = (x: number, z: number) => z === front && x >= 6 && x <= 13;
  flatRoof(layout, w, d, next, { parapet: 71, cap: BLUE, skip: sign });
  const top = ROOF_Y + 1;
  for (let k = 0; k < 3; k++) {
    const length = k % 2 === 0 ? [4, 4] : [2, 4, 2];
    let x = 6;
    for (const size of length) {
      layout.add(BRICK[size], k === 1 ? 15 : BLUE, x, top + k * 3, front, 90);
      x += size;
    }
  }
  layout.run(TILE, () => 15, 7, top + 9, front, 'x', 6);
  for (const x of [6, 13]) layout.add('3062b', TRANS_DARK_BLUE, x, top + 9, front);
  return layout.pieces;
}
