import { footprint, seatOnSideStuds } from '../core.ts';
import type { Facing, Rotation } from '../core.ts';
import {
  addAreaMap,
  addBondedMap,
  addRun,
  bottomUp,
  glazeWindows,
  reflectToFront,
  turnAround,
} from './layout.ts';
import type { RunKind } from './layout.ts';
import { addTree } from './trees.ts';
import type { ExampleBrickAdder, ExampleDefinition } from './types.ts';

// The Academiegebouw of Utrecht University on the Domplein: a Neo-Renaissance hall in red brick
// with sandstone bands, bent into an L that opens towards the square. Two wings of the same
// length run forward from a stone corner pavilion with a tower and spire; in the corner between
// the wings a bay with a diagonal face (two facet bricks) carries a small balcony on its roof.
// Each wing has a steep slate mansard with dormers. The square in front has a statue, lamps,
// lawns and trees. Plans are drawn top-down with the front at high z, x running left to right as
// seen from the front, then turned half about the board so the inside of the bend faces the
// default camera; the build is symmetric about the diagonal through the bend.
const SIZE = 64;

const BRICK = 70;
const DARK_RED = 320;
const DARK_ORANGE = 484;
const DARK_BROWN = 308;
const STONE = 71;
const DARK_STONE = 72;
const LIGHT_STONE = 151;
const TAN = 19;
const DARK_TAN = 28;
const WHITE = 15;
const BLACK = 0;
const RED = 4;
const YELLOW = 14;
const GOLD = 297;
const GRASS = 2;
const DARK_GRASS = 288;
const BRIGHT_GREEN = 10;
const TRANS_RED = 36;
const TRANS_YELLOW = 46;
const BROWN_SEAT = 6;

const hash = (a: number, b: number, c: number) => {
  let h =
    Math.imul(a + 131, 374761393) ^ Math.imul(b + 241, 668265263) ^ Math.imul(c + 337, 2147483629);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

type Piece = {
  partId: string;
  color: number;
  x: number;
  y: number;
  z: number;
  rotation: Rotation;
};

/** The ground: two plate layers, so the building starts at plate 2. */
const BASE = 2;
/** The wall's courses are three plates high; `y(c)` is the bottom of course c. */
const y = (c: number) => BASE + c * 3;
const COURSES = 15;
const EAVES = y(COURSES);
/** The pavilion's walls run on above the wings' eaves to this course. */
const PAV_TOP = 24;
/** How far the building is set back on the board, so the wings can reach forward. */
const DZ = 12;

// The plan. Wing A runs along x, wing B along z; the corner pavilion is the square both run
// into. In the corner between the wings a bay is cut diagonally by two facet bricks, along the
// line x + z = BAY_LINE.
const inA = (x: number, z: number) => x >= 6 && x <= 33 && z >= 28 && z <= 40;
const inB = (x: number, z: number) => x >= 34 && x <= 46 && z >= 0 && z <= 27;
const inP = (x: number, z: number) => x >= 34 && x <= 46 && z >= 28 && z <= 40;
const BAY_LINE = 57;
const inBay = (x: number, z: number) =>
  x >= 30 && x <= 33 && z >= 24 && z <= 27 && x + z >= BAY_LINE;
const lowerPoly = (x: number, z: number) => inA(x, z) || inB(x, z) || inP(x, z) || inBay(x, z);
const upperPoly = (x: number, z: number) => inP(x, z);
const poly = (c: number, x: number, z: number) => (c <= 14 ? lowerPoly(x, z) : upperPoly(x, z));
/** The two facet bricks that make the diagonal face, as their corners. */
const FACETS: [number, number][] = [
  [30, 26],
  [32, 24],
];
const inFacetBox = (x: number, z: number) =>
  FACETS.some(([fx, fz]) => x >= fx && x <= fx + 1 && z >= fz && z <= fz + 1);
const NEIGHBOURS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const outsideCount = (c: number, x: number, z: number) =>
  NEIGHBOURS.filter(([dx, dz]) => !poly(c, x + dx, z + dz)).length;
const isShell = (c: number, x: number, z: number) =>
  (poly(c, x, z) && !inFacetBox(x, z) && outsideCount(c, x, z) > 0) ||
  // The pavilion is a closed room all the way up: its walls stand inside the wings, so the
  // upper walls have walls to stand on.
  (c <= 14 && upperPoly(x, z) && NEIGHBOURS.some(([dx, dz]) => !upperPoly(x + dx, z + dz))) ||
  // The bay is closed off from the wings by walls along its two inner sides.
  (c <= 14 && ((z === 28 && x >= 30 && x <= 33) || (x === 34 && z >= 24 && z <= 27)));

interface Opening {
  /** The axis the wall runs along. */
  axis: 'x' | 'z';
  /** The first cell along the wall, and the wall line across it. */
  a: number;
  line: number;
}
/** Which way each wall line looks. */
const OUTWARD: Record<string, Facing> = {
  z40: '+z',
  z28: '-z',
  z0: '-z',
  x46: '+x',
  x34: '-x',
  x6: '-x',
};
const outward = (o: Opening): Facing => OUTWARD[`${o.axis === 'x' ? 'z' : 'x'}${o.line}`];
// Windows: the two long walls of each wing, and the end walls. B's are A's turned about the
// diagonal. The inner walls, facing the square, carry the doors.
const WINDOWS: Opening[] = [
  ...[8, 12, 16, 20, 24, 28, 32, 36, 40].map((a) => ({ axis: 'x' as const, a, line: 40 })),
  ...[8, 12, 16, 20, 25].map((a) => ({ axis: 'x' as const, a, line: 28 })),
  ...[30, 34].map((a) => ({ axis: 'z' as const, a, line: 6 })),
  ...[2, 6, 10, 14, 18, 22, 26, 30, 34].map((a) => ({ axis: 'z' as const, a, line: 46 })),
  ...[2, 6, 10, 14, 19].map((a) => ({ axis: 'z' as const, a, line: 34 })),
  ...[36, 40].map((a) => ({ axis: 'x' as const, a, line: 0 })),
];
const BIG_WINDOWS: Opening[] = [];
/** The pavilion's stone upper windows, in pairs on the faces that show over the wing roofs. */
const UPPER_WINDOWS: Opening[] = [
  ...[31, 36].map((a) => ({ axis: 'z' as const, a, line: 34 })),
  ...[37, 42].map((a) => ({ axis: 'x' as const, a, line: 28 })),
];
const cellOf = (o: Opening, k: number): [number, number] =>
  o.axis === 'x' ? [o.a + k, o.line] : [o.line, o.a + k];

const key = (c: number, x: number, z: number) => `${c},${x},${z}`;
/** Cells left open in the plain wall for frames, doors, sills and arch heads, by course. */
const OPEN = new Set<string>();
const open = (courses: number[], cells: [number, number][]) => {
  for (const c of courses) for (const [x, z] of cells) OPEN.add(key(c, x, z));
};
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);
const along = (o: Opening, from: number, to: number) => range(from, to).map((k) => cellOf(o, k));
for (const w of WINDOWS) {
  open(range(3, 5), along(w, 0, 1));
  open([6], along(w, -1, 2));
  open(range(9, 12), along(w, 0, 1));
  open([13], along(w, -1, 2));
  open([2, 8], along(w, 0, 1));
}
for (const w of BIG_WINDOWS) {
  open(range(9, 11), along(w, 0, 3));
  open([12], along(w, -1, 4));
}
for (const w of UPPER_WINDOWS) {
  open(range(17, 19), along(w, 0, 1));
  open([20], along(w, -1, 2));
}

/** Pier cells that carry a shield on side studs, and the way they face. */
const SHIELDS: { x: number; z: number; c: number; facing: Facing }[] = [];
for (const w of WINDOWS) {
  const [x, z] = cellOf(w, 2);
  if (!isShell(11, x, z) || outsideCount(11, x, z) > 1 || inFacetBox(x, z)) continue;
  if (Math.abs(x - 31) <= 4 && Math.abs(z - 26) <= 4) continue;
  for (const c of [4, 11]) {
    if (OPEN.has(key(c, x, z)) || OPEN.has(key(c, ...cellOf(w, 3)))) continue;
    SHIELDS.push({ x, z, c, facing: outward(w) });
    open([c], [[x, z]]);
  }
}
/** Lanterns either side of the entrance in the bay, on side studs, as cells and facings. */
const LANTERNS: { x: number; z: number; facing: Facing }[] = [
  { x: 29, z: 28, facing: '-z' },
  { x: 34, z: 23, facing: '-x' },
];
for (const l of LANTERNS) open([3], [[l.x, l.z]]);

/** What stands in wall cell (x, z) on course c: a character for `addBondedMap`. */
function wallChar(c: number, x: number, z: number): string {
  if (OPEN.has(key(c, x, z))) return ' ';
  const stone = x >= 34 && z >= 28;
  const horizontal = z === 40 || z === 28 || z === 0;
  const run = horizontal ? x : z;
  // Colour patches run in six-stud stretches along the wall, shifted half a patch each course so
  // the seams trade places and the bricks can be long.
  const patch = hash(Math.floor((run + 3 * (c % 2)) / 6), Math.floor(c / 2), horizontal ? 3 : x);
  const cell = hash(Math.floor((run + 3 * (c % 2)) / 6), Math.floor(c / 2), 101 + c);
  if (c <= 1) return patch < 0.4 ? 'g' : 'h';
  if (stone) {
    if (c === 7 || c === 14 || c === 19) return 'W';
    return patch < 0.18 ? 'U' : patch > 0.82 ? 'W' : 'T';
  }
  if (c === 14) return Math.floor((run + (horizontal ? 0 : 1)) / 2) % 2 ? 'T' : 'r';
  // Quoins: tan stone at the outside corners.
  if (outsideCount(c, x, z) >= 2) return 'T';
  if (c <= 6)
    return patch < 0.12 ? 'd' : patch < 0.3 ? 'a' : patch < 0.55 ? 'r' : cell < 0.3 ? 'm' : 'b';
  return patch < 0.14 ? 'o' : patch < 0.3 ? 'r' : patch < 0.42 ? 'a' : cell < 0.25 ? 'm' : 'b';
}

const WALL_LEGEND: Record<string, readonly [RunKind, number]> = {
  a: ['brick', BRICK],
  b: ['brick', DARK_RED],
  o: ['brick', DARK_ORANGE],
  r: ['brick', RED],
  d: ['brick', DARK_BROWN],
  m: ['masonry', DARK_RED],
  g: ['brick', DARK_STONE],
  h: ['brick', STONE],
  T: ['brick', TAN],
  U: ['brick', DARK_TAN],
  W: ['brick', WHITE],
};

// The mansards, drawn for wing A and turned about the diagonal for wing B: ring 0 is a steep
// 75 degree course, rings 1 to RINGS are 45 degree slopes stepping in a stud a course, the deck
// closes the top. The hipped end is the far one; the near end runs into the pavilion's wall.
const RX0 = 5;
const RX1 = 33;
const RZ0 = 27;
const RZ1 = 41;
const RINGS = 4;
const ROOF0 = EAVES + 3;
/** Height of ring i's bottom. */
const ringY = (i: number) => (i === 0 ? ROOF0 : ROOF0 + 6 + i * 3);
const DECK = ringY(RINGS) + 3;

/** Turns a piece drawn for wing A about the diagonal onto wing B: (x, z) goes to (z + 6, x - 6). */
const ROTATE_B: Record<Rotation, Rotation> = { 0: 90, 90: 0, 180: 270, 270: 180 };
const ROTATE_B_CORNER: Record<Rotation, Rotation> = { 0: 180, 90: 90, 180: 0, 270: 270 };

export const academiegebouw: ExampleDefinition = {
  id: 'academiegebouw',
  name: 'Academiegebouw',
  tags: ['neo-renaissance', 'town', 'landmark', 'brick', 'sandstone', 'utrecht', 'square', 'tower'],
  expectedPieceCount: 2995,
  buildArea: SIZE,
  brickIdPrefix: 'aca',
  build(drawnAdd) {
    const order = bottomUp(drawnAdd);
    // Reflected to face the camera, then turned half about the board: the inside of the bend faces it.
    const front = reflectToFront(
      turnAround((...piece) => order.add(...piece), SIZE),
      SIZE,
    );
    const boxes: { u0: number; u1: number; v0: number; v1: number; y0: number; y1: number }[] = [];
    const track = (
      partId: string,
      color: number,
      x: number,
      py: number,
      z: number,
      rotation: Rotation,
      facing?: Facing,
    ) => {
      const size = footprint({
        id: '',
        partId,
        color,
        x,
        y: py,
        z,
        rotation,
        ...(facing ? { facing } : {}),
      });
      boxes.push({
        u0: x,
        u1: x + size.width,
        v0: z,
        v1: z + size.depth,
        y0: py,
        y1: py + size.height,
      });
    };
    // The building is drawn in its own coordinates and set DZ studs back on the board; the ground
    // and the props on it are drawn in board coordinates (`addAbs`, `tryAbs`).
    const makeAdd =
      (target: ExampleBrickAdder, dz: number): ExampleBrickAdder =>
      (partId, color, x, py, z, rotation = 0, facing, ...rest) => {
        track(partId, color, x, py, z + dz, rotation, facing);
        target(partId, color, x, py, z + dz, rotation, facing, ...rest);
      };
    const add = makeAdd(glazeWindows(front, 47), DZ);
    /** Adds with red panes in any window frame, for the dormers. */
    const addRed = makeAdd(glazeWindows(front, TRANS_RED), DZ);
    const addGlow = makeAdd(glazeWindows(front, TRANS_YELLOW), DZ);
    const addAbs = makeAdd(glazeWindows(front, 47), 0);
    const blocked = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number) =>
      boxes.some(
        (box) =>
          box.u0 < x1 && x0 < box.u1 && box.v0 < z1 && z0 < box.v1 && box.y0 < y1 && y0 < box.y1,
      );
    const tryWith =
      (adder: ExampleBrickAdder, dz: number) =>
      (partId: string, color: number, x: number, py: number, z: number, rotation: Rotation = 0) => {
        const size = footprint({ id: '', partId, color, x, y: py, z: z + dz, rotation });
        if (blocked(x, x + size.width, z + dz, z + dz + size.depth, py, py + size.height))
          return false;
        adder(partId, color, x, py, z, rotation);
        return true;
      };
    const tryAdd = tryWith(add, DZ);
    const tryAbs = tryWith(addAbs, 0);
    const mount = (host: Piece, partId: string, color: number, facing: Facing) => {
      // Seated on the board, where the plan is set back: a cell near the plan's edge would
      // otherwise lie outside the area.
      const seated = seatOnSideStuds(
        { id: 'mount', partId, color, x: host.x, y: host.y, z: host.z + DZ, rotation: 0, facing },
        { id: 'host', ...host, z: host.z + DZ },
      );
      if (!seated) throw new Error(`Nothing to mount ${partId} at ${host.x},${host.y},${host.z}.`);
      add(partId, color, seated.x, seated.y, seated.z - DZ, seated.rotation, seated.facing);
    };
    /** A side-stud brick whose studs face `facing`, standing in a wall cell. */
    const sideStud = (x: number, py: number, z: number, facing: Facing, color: number): Piece => {
      for (const rotation of [0, 90, 180, 270] as Rotation[])
        for (const [dx, dz] of [
          [0, 0],
          [-0.5, 0],
          [0, -0.5],
        ]) {
          const host: Piece = { partId: '87087', color, x: x + dx, y: py, z: z + dz, rotation };
          const size = footprint({ id: '', ...host });
          const body = facing.endsWith('x')
            ? facing === '-x'
              ? host.x === x - 0.5
              : host.x === x && size.width === 1.5
            : facing === '-z'
              ? host.z === z - 0.5
              : host.z === z && size.depth === 1.5;
          if (!body) continue;
          const probe = seatOnSideStuds(
            { id: 'p', partId: '3024', color, x: 0, y: py, z: 0, rotation: 0, facing },
            { id: 'h', ...host, z: host.z + DZ },
          );
          if (!probe) continue;
          add(host.partId, color, host.x, host.y, host.z, host.rotation);
          return host;
        }
      throw new Error(`No side stud facing ${facing}.`);
    };
    /**
     * A piece on a side stud of a wall cell facing along x. The plan's reflection and half turn
     * together flip x and leave z, so these go in on the board as they are, turned by hand.
     */
    const mountX = (
      x: number,
      py: number,
      z: number,
      facing: '+x' | '-x',
      partId: string,
      color: number,
    ) => {
      const xWorld = SIZE - 1 - x;
      const worldFacing = facing === '+x' ? '-x' : '+x';
      for (const rotation of [0, 90, 180, 270] as Rotation[])
        for (const dx of [0, -0.5]) {
          const host: Piece = {
            partId: '87087',
            color: BRICK,
            x: xWorld + dx,
            y: py,
            z: z + DZ,
            rotation,
          };
          const size = footprint({ id: '', ...host });
          const body =
            worldFacing === '-x'
              ? host.x === xWorld - 0.5
              : host.x === xWorld && size.width === 1.5;
          if (!body) continue;
          const probe = seatOnSideStuds(
            { id: 'p', partId: '3024', color, x: 0, y: py, z: 0, rotation: 0, facing: worldFacing },
            { id: 'h', ...host },
          );
          const seated = seatOnSideStuds(
            {
              id: 'm',
              partId,
              color,
              x: host.x,
              y: host.y,
              z: host.z,
              rotation: 0,
              facing: worldFacing,
            },
            { id: 'h', ...host },
          );
          if (!probe || !seated) continue;
          track(host.partId, BRICK, x, py, z + DZ, host.rotation);
          order.add(host.partId, BRICK, host.x, py, host.z, host.rotation);
          track(partId, color, x, seated.y, z + DZ, seated.rotation, facing);
          order.add(partId, color, seated.x, seated.y, seated.z, seated.rotation, seated.facing);
          return;
        }
      throw new Error(`No side stud facing ${facing} at ${x},${py},${z}.`);
    };
    /** Mounts a small piece on a pier cell, whichever way the wall looks. */
    const mountOn = (
      x: number,
      c: number,
      z: number,
      facing: Facing,
      partId: string,
      color: number,
    ) => {
      if (facing.endsWith('x')) mountX(x, y(c), z, facing as '+x' | '-x', partId, color);
      else mount(sideStud(x, y(c), z, facing, BRICK), partId, color, facing);
    };
    const plan = (cell: (x: number, z: number) => string) =>
      Array.from({ length: SIZE }, (_, z) =>
        Array.from({ length: SIZE }, (_, x) => cell(x, z)).join(''),
      );

    // ---- The ground: two layers of big plates, then the paving a plate high.
    for (let gx = 0; gx < SIZE; gx += 16)
      for (let gz = 0; gz < SIZE; gz += 16) front('91405', DARK_STONE, gx, 0, gz, 0);
    const inBuilding = (x: number, z: number) => lowerPoly(x, z) || inFacetBox(x, z);
    const lawn = (x: number, z: number) =>
      (x >= 14 && x <= 19 && z >= 33 && z <= 38) || (x >= 27 && x <= 32 && z >= 20 && z <= 25);
    addAreaMap(
      addAbs,
      plan((x, z) => {
        if (inBuilding(x, z - DZ)) return 'f';
        if (z < 8) return hash(x, z, 3) < 0.12 ? 'R' : 'r';
        if (z === 8) return 'k';
        if (z <= 10) return 's';
        if (z === 63 || x === 0 || x === 63) return 'k';
        // Tan carpets from the two doors, with grey edges.
        // A tan carpet from the entrance at the bend, with grey edges.
        if (x >= 28 && x <= 31 && z >= 26 && z <= 34) return x === 28 || x === 31 ? 'k' : 't';
        if (lawn(x, z)) return hash(x, z, 4) < 0.3 ? 'G' : 'g';
        const roll = hash(Math.floor(x / 8), Math.floor(z / 8), 9);
        return roll < 0.1 ? 'v' : roll > 0.9 ? 'w' : 'u';
      }),
      1,
      {
        f: ['plate', DARK_STONE],
        r: ['plate', DARK_STONE],
        R: ['plate', STONE],
        k: ['plate', STONE],
        s: ['plate', LIGHT_STONE],
        u: ['plate', BRICK],
        v: ['plate', DARK_BROWN],
        w: ['plate', 84],
        t: ['plate', TAN],
        g: ['plate', GRASS],
        G: ['plate', DARK_GRASS],
      },
    );

    // ---- The walls: one bonded course at a time from a character map, and two facet bricks a
    // course that make the diagonal face. The lower four courses of the face are a dark door.
    for (let c = 0; c < PAV_TOP; c++) {
      addBondedMap(
        add,
        plan((x, z) => (isShell(c, x, z) ? wallChar(c, x, z) : ' ')),
        y(c),
        WALL_LEGEND,
        c,
      );
      const color =
        c <= 1 ? STONE : c <= 5 ? DARK_BROWN : c === 7 || c === 14 || c === 19 ? WHITE : TAN;
      // Course 6 of the bay is the balcony floor instead (plates, below); the facets above it
      // stand two plates lower, on the balcony floor.
      if (c <= 14 && c !== 6)
        for (const [fx, fz] of FACETS) add('87620', color, fx, y(c) - (c > 6 ? 2 : 0), fz, 90);
    }

    // ---- Windows: a frame on the wall line, with an arched head of tan stone, and a sill header.
    const rotOf = (o: Opening): Rotation => (o.axis === 'x' ? 90 : 0);
    for (const w of WINDOWS) {
      const [x, z] = cellOf(w, 0);
      add('60593', WHITE, x, y(3), z, rotOf(w));
      add('60592', WHITE, x, y(9), z, rotOf(w));
      add('60592', WHITE, x, y(11), z, rotOf(w));
      for (const c of [6, 13]) {
        const [ax, az] = cellOf(w, -1);
        add('3659', TAN, ax, y(c), az, rotOf(w));
      }
      // Sills: 1 x 2 headers laid across the wall, a stud proud of it.
      for (const [c, color] of [
        [2, STONE],
        [8, TAN],
      ] as [number, number][])
        for (const k of [0, 1]) {
          const [sx, sz] = cellOf(w, k);
          const out = outward(w);
          if (out === '+z') add('3004', color, sx, y(c), sz, 0);
          else if (out === '-z') add('3004', color, sx, y(c), sz - 1, 0);
          else if (out === '+x') add('3004', color, sx, y(c), sz, 90);
          else add('3004', color, sx - 1, y(c), sz, 90);
        }
    }
    for (const w of BIG_WINDOWS) {
      const [x, z] = cellOf(w, 0);
      addGlow('60594', WHITE, x, y(9), z, rotOf(w));
      const [ax, az] = cellOf(w, -1);
      add('3455', TAN, ax, y(12), az, rotOf(w));
    }
    for (const w of UPPER_WINDOWS) {
      const [x, z] = cellOf(w, 0);
      add('60593', WHITE, x, y(17), z, rotOf(w));
      const [ax, az] = cellOf(w, -1);
      add('3659', TAN, ax, y(20), az, rotOf(w));
    }

    // ---- A plinth a stud out from the walls, the bay's roof terrace with its balustrade, shields,
    // lanterns and half columns on the piers.
    addAreaMap(
      add,
      plan((x, z) => {
        if (inBuilding(x, z)) return ' ';
        const next = NEIGHBOURS.some(([dx, dz]) => inBuilding(x + dx, z + dz));
        return next ? 'p' : ' ';
      }),
      BASE,
      { p: ['plate', STONE] },
    );
    const STUD_CELLS = [
      [30, 27],
      [31, 26],
      [32, 25],
      [33, 24],
    ];
    addAreaMap(
      add,
      plan((x, z) => (inBay(x, z) ? 's' : ' ')),
      EAVES - 2,
      { s: ['plate', TAN] },
      (x, z) => STUD_CELLS.some(([sx, sz]) => sx === x && sz === z),
    );
    for (const [bx, bz] of STUD_CELLS) add('3062b', LIGHT_STONE, bx, EAVES - 1, bz);
    // The balcony in the centre of the bend, over the entrance in the bay's diagonal face: two
    // plates that step along the diagonal, held only by the studs of the facet bricks below
    // (the facet course here is plates), with a balustrade of posts and handrails. No columns.
    add('3020', TAN, 28, y(6), 26, 90);
    add('3031', TAN, 29, y(6), 22, 0);
    for (const [bx, bz] of [
      [28, 26],
      [28, 27],
      [29, 22],
      [29, 23],
      [29, 24],
      [29, 25],
      [30, 22],
      [31, 22],
      [32, 22],
      [32, 23],
    ])
      add('3062b', WHITE, bx, y(6) + 1, bz);
    add('3023b', TAN, 28, y(6) + 4, 26, 0);
    add('3623', TAN, 29, y(6) + 4, 23, 0);
    add('3710', TAN, 29, y(6) + 4, 22, 90);
    add('3024', TAN, 32, y(6) + 4, 23);
    for (const { x, z, facing } of LANTERNS) mountOn(x, 3, z, facing, '3062b', TRANS_YELLOW);
    for (const { x, z, c, facing } of SHIELDS) {
      const roll = hash(x, z, 77 + c);
      mountOn(x, c, z, facing, '6141', roll < 0.4 ? RED : roll < 0.7 ? WHITE : GOLD);
    }
    const half = (cx: number, cz: number) => {
      add('43888', TAN, cx, BASE + 1, cz, 0);
      add('43888', TAN, cx, BASE + 19, cz, 0);
      add('3062b', LIGHT_STONE, cx, BASE + 37, cz, 0);
    };
    // Half columns on the pier beside each window of the long walls, outside the wall line.
    for (const w of WINDOWS) {
      if (w.line === 6 || w.line === 0) continue;
      const [px, pz] = cellOf(w, 3);
      const out = outward(w);
      const [cx, cz]: [number, number] =
        out === '+z'
          ? [px, pz + 1]
          : out === '-z'
            ? [px, pz - 1]
            : out === '+x'
              ? [px + 1, pz]
              : [px - 1, pz];
      if (
        !isShell(5, px, pz) ||
        inBuilding(cx, cz) ||
        (Math.abs(cx - 31) <= 4 && Math.abs(cz - 26) <= 4)
      )
        continue;
      half(cx, cz);
    }

    // ---- The corner pavilion's top: a slab with a railing round it carries the tower.
    addAreaMap(
      add,
      plan((x, z) => (upperPoly(x, z) ? 's' : ' ')),
      y(PAV_TOP),
      { s: ['plate', DARK_STONE] },
      (x, z) =>
        isShell(PAV_TOP - 1, x, z) ||
        [
          [44, 39],
          [43, 40],
          [46, 37],
          [45, 38],
        ].some(([fx, fz]) => fx === x && fz === z),
    );
    for (const [rx, rz, rot] of [
      [34, 40, 90],
      [38, 40, 90],
      [42, 40, 90],
      [46, 28, 0],
      [46, 32, 0],
      [46, 36, 0],
      [34, 29, 0],
      [34, 33, 0],
      [35, 28, 90],
      [39, 28, 90],
      [43, 28, 90],
    ] as [number, number, Rotation][])
      tryAdd('3633', BLACK, rx, y(PAV_TOP) + 1, rz, rot);

    // ---- The mansards: drawn for wing A and mirrored about the diagonal onto wing B.
    const roofColor = (x: number, z: number, i: number) => {
      const roll = hash(x, z, 17 + i);
      return roll < 0.26 ? STONE : roll > 0.975 ? BLACK : DARK_STONE;
    };
    type Into = (
      partId: string,
      color: number,
      x: number,
      py: number,
      z: number,
      rotation: Rotation,
    ) => unknown;
    const roofWing = (mirror: boolean) => {
      const put =
        (into: Into): Into =>
        (partId, color, x, py, z, rotation) => {
          if (!mirror) return into(partId, color, x, py, z, rotation);
          const table = partId === '3045' ? ROTATE_B_CORNER : ROTATE_B;
          return into(partId, color, z + 6, py, x - 6, table[rotation]);
        };
      const addA = put((p, c, x, py, z, r) => add(p, c, x, py, z, r));
      const addRedA = put((p, c, x, py, z, r) => addRed(p, c, x, py, z, r));
      const tryA = put((p, c, x, py, z, r) => tryAdd(p, c, x, py, z, r));
      /** Lays a straight run of two-deep slopes, longest first, staggered by a hash. */
      const slopeRun = (
        axis: 'x' | 'z',
        from: number,
        to: number,
        line: number,
        i: number,
        rot: Rotation,
      ) => {
        let at = from;
        while (at <= to) {
          const left = to - at + 1;
          const pick = hash(at, line, 29 + i);
          const max = pick < 0.35 ? 4 : pick < 0.6 ? 3 : pick < 0.85 ? 2 : 1;
          const size = [4, 3, 2, 1].find((s) => s <= left && s <= max)!;
          const part = size === 4 ? '3037' : size === 3 ? '3038' : size === 2 ? '3039' : '3040b';
          const [px, pz] = axis === 'x' ? [at, line] : [line, at];
          if (!tryA(part, roofColor(px, pz, i), px, ringY(i), pz, rot)) {
            for (let k = 0; k < size; k++) {
              const [sx, sz] = axis === 'x' ? [at + k, line] : [line, at + k];
              tryA('3040b', roofColor(sx, sz, i), sx, ringY(i), sz, rot);
            }
          }
          at += size;
        }
      };
      // The cornice: inverted slopes under the eaves a stud out from the wall, and corner blocks
      // at the hipped end.
      for (let x = RX0 + 2; x <= 33; x++) {
        tryA('3665a', TAN, x, EAVES, 40, 180);
        if (x < 30) tryA('3665a', TAN, x, EAVES, 27, 0);
      }
      for (let z = 29; z <= 39; z++) tryA('3665a', TAN, RX0, EAVES, z, 90);
      tryA('3003', TAN, RX0, EAVES, 40, 0);
      tryA('3003', TAN, RX0, EAVES, 27, 0);
      // Dormers on the front and back slopes, in the second ring: a white frame with red panes,
      // a little gable over it. The ring above stands on hidden bricks behind each.
      const dormer = (a: number, face: boolean) => {
        const dy = ringY(2);
        const zF = face ? RZ1 - 2 : RZ0 + 2;
        const zStand = face ? zF - 1 : zF;
        const zBack = face ? zF - 2 : zF + 1;
        for (const dx of [0, 1]) addA('3004', DARK_STONE, a + dx, dy, zStand, 0);
        addRedA('60592', WHITE, a, dy + 3, zF, 90);
        for (const dx of [0, 1]) addA('3004', DARK_STONE, a + dx, dy + 3, zBack, 0);
        addA('3043', DARK_STONE, a, dy + 9, zStand, 0);
      };
      for (const a of [10, 16, 22, 28]) dormer(a, true);
      for (const a of [10, 16, 22]) dormer(a, false);
      // A dormer on the hipped end too, in the same ring.
      const dormerEnd = (a: number) => {
        const dy = ringY(2);
        const xF = RX0 + 2;
        for (const dz of [0, 1]) addA('3004', DARK_STONE, xF, dy, a + dz, 90);
        addRedA('60592', WHITE, xF, dy + 3, a, 0);
        for (const dz of [0, 1]) addA('3004', DARK_STONE, xF + 1, dy + 3, a + dz, 90);
        addA('3043', DARK_STONE, xF, dy + 9, a, 90);
      };
      dormerEnd(33);
      // Where the bay's terrace and its back wall stand, hidden bricks carry ring 1.
      for (let c = 0; c < 4; c++)
        for (let x = 30; x <= 33; x++) addA('3005', DARK_STONE, x, EAVES + c * 3, 28, 0);
      // Ring 0: steep slopes, one stud wide.
      for (let x = RX0; x <= RX1; x++) {
        tryA('4460b', roofColor(x, RZ1, 0), x, ringY(0), RZ1 - 1, 180);
        tryA('4460b', roofColor(x, RZ0, 0), x, ringY(0), RZ0, 0);
      }
      for (let z = RZ0 + 2; z <= RZ1 - 2; z++)
        tryA('4460b', roofColor(RX0, z, 0), RX0, ringY(0), z, 90);
      for (let i = 1; i <= RINGS; i++) {
        const x0 = RX0 + i;
        const z0 = RZ0 + i;
        const z1 = RZ1 - i;
        addA('3045', roofColor(x0, z0, i), x0, ringY(i), z0, 90);
        addA('3045', roofColor(x0, z1, i), x0, ringY(i), z1 - 1, 180);
        slopeRun('x', x0 + 2, RX1, z0, i, 0);
        slopeRun('x', x0 + 2, RX1, z1 - 1, i, 180);
        slopeRun('z', z0 + 2, z1 - 2, x0, i, 90);
      }
      // The deck closes the top: plates two wide spanning the rows between the rings' studs.
      const deckZ0 = RZ0 + RINGS + 1;
      const deckZ1 = RZ1 - RINGS - 1;
      const deckRows = deckZ1 - deckZ0 + 1;
      for (let x = RX0 + RINGS + 1; x <= RX1; x += 2) {
        const wide = x + 1 <= RX1;
        const [spanPart, spanRot, edgePart, edgeRot]: [string, Rotation, string, Rotation] = wide
          ? ['3020', 0, '3023b', 90]
          : ['3710', 0, '3024', 0];
        // A plate of four rows from the first row, one more plate on the last row.
        addA(spanPart, DARK_STONE, x, DECK, deckZ0, spanRot);
        if (deckRows > 4) addA(edgePart, DARK_STONE, x, DECK, deckZ1, edgeRot);
      }
      // Chimneys on the deck: brick stacks with a stone cap and a pair of pots.
      for (const cx of [14, 26]) {
        for (let c = 0; c < 4; c++)
          addA('3003', hash(cx, c, 5) < 0.3 ? DARK_RED : BRICK, cx, DECK + 1 + c * 3, 33, 0);
        addA('3022', DARK_STONE, cx, DECK + 13, 33, 0);
        addA('3062b', BRICK, cx, DECK + 14, 33, 0);
        addA('3062b', BRICK, cx + 1, DECK + 14, 34, 0);
      }
    };
    roofWing(false);
    roofWing(true);

    // ---- The tower on the pavilion's slab: a six by six stone stage with a window each side, a
    // slimmer lantern, a slate spire and a flag.
    const TY = y(PAV_TOP) + 1;
    const stage = (
      x0: number,
      x1: number,
      z0: number,
      z1: number,
      base: number,
      courses: number,
      gaps: Set<string>,
    ) => {
      for (let c = 0; c <= courses; c++)
        addBondedMap(
          add,
          plan((x, z) =>
            x >= x0 &&
            x <= x1 &&
            z >= z0 &&
            z <= z1 &&
            (x === x0 || x === x1 || z === z0 || z === z1)
              ? gaps.has(key(c, x, z))
                ? ' '
                : c === 0 || c === courses
                  ? 'W'
                  : hash(x, z, c + 51) < 0.2
                    ? 'U'
                    : 'T'
              : ' ',
          ),
          base + c * 3,
          WALL_LEGEND,
          c,
        );
    };
    type Face = [number, number, Rotation];
    const cellAt = ([fx, fz, rot]: Face, k: number): [number, number] =>
      rot === 90 ? [fx + k, fz] : [fx, fz + k];
    const towerFaces: Face[] = [
      [39, 36, 90],
      [39, 31, 90],
      [37, 33, 0],
      [42, 33, 0],
    ];
    const towerGaps = new Set<string>();
    for (const face of towerFaces) {
      for (let c = 2; c <= 4; c++)
        for (const k of [0, 1]) towerGaps.add(key(c, ...cellAt(face, k)));
      for (const k of [-1, 0, 1, 2]) towerGaps.add(key(5, ...cellAt(face, k)));
    }
    stage(37, 42, 31, 36, TY, 8, towerGaps);
    for (const face of towerFaces) {
      const [fx, fz, rot] = face;
      add('60593', WHITE, fx, TY + 6, fz, rot);
      const [ax, az] = cellAt(face, -1);
      add('3659', TAN, ax, TY + 15, az, rot);
    }
    add('3032', DARK_STONE, 37, TY + 27, 31, 90);
    add('3666', DARK_STONE, 37, TY + 27, 35, 90);
    add('3666', DARK_STONE, 37, TY + 27, 36, 90);
    // The lantern is 4 x 4, inside the stage: x 38..41, z 32..35.
    const lanternBox: Face[] = [
      [39, 35, 90],
      [39, 32, 90],
      [38, 33, 0],
      [41, 33, 0],
    ];
    const lanternGaps = new Set<string>();
    for (const face of lanternBox)
      for (let c = 1; c <= 3; c++)
        for (const k of [0, 1]) lanternGaps.add(key(c, ...cellAt(face, k)));
    const LY = TY + 28;
    stage(38, 41, 32, 35, LY, 4, lanternGaps);
    for (const [fx, fz, rot] of lanternBox) add('60593', WHITE, fx, LY + 3, fz, rot);
    add('3031', DARK_STONE, 38, LY + 15, 32, 0);
    // The spire: a cone, a stack of round bricks, a cap and a gold finial with a flag.
    const SY = LY + 16;
    add('3943b', DARK_STONE, 38, SY, 32, 0);
    for (let i = 0; i < 4; i++) add('3941', i % 2 ? STONE : DARK_STONE, 39, SY + 6 + i * 3, 33, 0);
    add('3942c', DARK_STONE, 39, SY + 18, 33, 0);
    add('59900', GOLD, 39.5, SY + 24, 33.5, 0);
    add('3957a', BLACK, 39.5, SY + 27, 33.5, 0);
    add('2335', RED, 39.5, SY + 36, 33.5, 90);

    // The square and everything on it are drawn in board coordinates.
    {
      const add = addAbs;
      const tryAdd = tryAbs;
      // ---- The square: a statue in front of the bend, lamps, benches, bicycles, lawns and trees.
      const statue = (sx: number, sz: number) => {
        add('3031', STONE, sx - 1, BASE, sz - 1, 0);
        for (let c = 0; c < 4; c++)
          add('3003', c === 3 ? LIGHT_STONE : STONE, sx, BASE + 1 + c * 3, sz);
        add('3022', LIGHT_STONE, sx, BASE + 13, sz);
        const t = BASE + 14;
        for (const dx of [0, 1]) add('3062b', 378, sx + dx, t, sz);
        add('3004', 378, sx, t + 3, sz, 90);
        add('3004', 378, sx, t + 6, sz, 90);
        add('3062b', 378, sx, t + 9, sz);
        add('4589', 288, sx, t + 12, sz);
      };
      statue(14, 22);
      for (const [bx, bz] of [
        [11, 20],
        [17, 20],
        [11, 25],
        [17, 25],
      ])
        add('3062b', STONE, bx, BASE, bz);
      for (const [lx, lz] of [
        [22, 28],
        [30, 27],
      ])
        add('2039', BLACK, lx, BASE, lz);
      const bench = (bx: number, bz: number) => {
        add('3005', DARK_BROWN, bx, BASE, bz);
        add('3005', DARK_BROWN, bx + 3, BASE, bz);
        add('3710', BRICK, bx, BASE + 3, bz, 90);
      };
      bench(16, 16);
      bench(2, 38);
      const bike = (bx: number, bz: number) => {
        add('3062b', BLACK, bx, BASE, bz);
        add('3062b', BLACK, bx + 3, BASE, bz);
        add('3710', hash(bx, bz, 1) < 0.5 ? RED : DARK_STONE, bx, BASE + 3, bz, 90);
        add('3024', BLACK, bx + 3, BASE + 4, bz);
        add('3024', BROWN_SEAT, bx, BASE + 4, bz);
      };
      for (let i = 0; i < 5; i++) bike(2, 27 + i * 2);
      const clump = (color: number, fx: number, fz: number) => {
        if (blocked(fx, fx + 1, fz, fz + 1, BASE, BASE + 9)) return;
        add('18674', GRASS, fx, BASE, fz);
        add('4727', GRASS, fx, BASE + 1, fz);
        add('24866', color, fx, BASE + 4, fz);
      };
      clump(RED, 15, 34);
      clump(YELLOW, 18, 37);
      clump(WHITE, 28, 21);
      clump(RED, 31, 24);
      // Plants on the two lawn beds: a plant plugs into one stud by a receiver off its corner.
      const beds: [number, number][] = [];
      for (let sz = 0; sz < SIZE; sz++)
        for (let sx = 0; sx < SIZE; sx++) if (lawn(sx, sz)) beds.push([sx, sz]);
      beds.sort((a, b) => hash(a[0], a[1], 31) - hash(b[0], b[1], 31));
      const plants: [string, number, [number, number], number][] = [
        ['6064', DARK_GRASS, [1.5, 1.5], 5],
        ['6064', GRASS, [1.5, 1.5], 4],
        ['6255', GRASS, [2, 1.5], 3],
        ['6255', DARK_GRASS, [2, 1.5], 3],
        ['30093', BRIGHT_GREEN, [1.5, 0], 5],
      ];
      for (const [part, color, [dx, dz], count] of plants) {
        let placed = 0;
        for (const [sx, sz] of beds) {
          if (placed >= count) break;
          if (tryAdd(part, color, sx - dx, BASE, sz - dz)) placed++;
        }
      }
      // A dashed white centre line on the back road.
      for (let dx = 1; dx + 3 <= 63; dx += 8) addRun(add, 'tile', WHITE, 'x', dx, BASE, 3, 3);

      // ---- The church gate to the left: a brick block with a pointed portal of two quarter arches,
      // a stone cap and pinnacles.
      const GATE = { x0: 1, x1: 8, z0: 56, z1: 60 };
      const inGate = (x: number, z: number) =>
        x >= GATE.x0 &&
        x <= GATE.x1 &&
        z >= GATE.z0 &&
        z <= GATE.z1 &&
        (x === GATE.x0 || x === GATE.x1 || z === GATE.z0 || z === GATE.z1);
      const gateOpen = (c: number, x: number, z: number) =>
        z === GATE.z1 && ((c <= 5 && x >= 3 && x <= 6) || (c >= 6 && c <= 8 && x >= 2 && x <= 7));
      for (let c = 0; c <= 9; c++)
        addBondedMap(
          add,
          plan((x, z) => {
            if (!inGate(x, z) || gateOpen(c, x, z)) return ' ';
            if (c <= 1) return hash(x, z, 5) < 0.4 ? 'g' : 'h';
            if (c === 9 && z === GATE.z1 && x >= 2 && x <= 7) return 'W';
            const corner = (x === GATE.x0 || x === GATE.x1) && (z === GATE.z0 || z === GATE.z1);
            if (corner) return 'T';
            const roll = hash(Math.floor((x + 3 * (c % 2)) / 6), Math.floor(c / 2), z);
            return roll < 0.2 ? 'a' : roll < 0.45 ? 'r' : roll < 0.6 ? 'm' : 'b';
          }),
          y(c),
          WALL_LEGEND,
          c,
        );
      for (let c = 0; c <= 5; c++) add('3010', BLACK, 3, y(c), GATE.z1 - 1, 90);
      add('13965', TAN, 2, y(6), GATE.z1, 90);
      add('13965', TAN, 5, y(6), GATE.z1, 270);
      addAreaMap(
        add,
        plan((x, z) => (inGate(x, z) ? 'c' : ' ')),
        y(10),
        { c: ['plate', LIGHT_STONE] },
      );
      for (const [gx, gz] of [
        [GATE.x0, GATE.z1],
        [GATE.x1, GATE.z1],
      ]) {
        add('3062b', TAN, gx, y(10) + 1, gz);
        add('3062b', TAN, gx, y(11) + 1, gz);
        add('4589', GOLD, gx, y(12) + 1, gz);
      }

      // ---- Two trees at the edges of the square.
      addTree(add, 10, 31, BASE, [DARK_GRASS, GRASS, BRIGHT_GREEN], DARK_BROWN, 9, 5, boxes, {
        foot: false,
        gnarled: true,
        radii: [2.4, 3, 2.8, 2.1],
      });
      addTree(add, 52, 44, BASE, [DARK_GRASS, GRASS, BRIGHT_GREEN], DARK_BROWN, 5, 11, boxes, {
        foot: false,
        radii: [2.4, 3, 2.7, 2],
      });
    }
    order.flush();
  },
};
