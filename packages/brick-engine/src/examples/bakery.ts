import { footprint, isMatchingInsertFrame, seatOnSideStuds } from '../core.ts';
import type { Brick, Facing, Rotation } from '../core.ts';
import { addAreaMap, addRowMap, addRun, bottomUp, glazeWindows } from './layout.ts';
import { addTree, random } from './trees.ts';
import type { ExampleBrickAdder, ExampleDefinition } from './types.ts';

// A Tudor corner bakery on a street plot. The street runs along the low-z edge, which the default
// camera faces; an alley and a yard with a clay oven lie to the right, a kitchen garden behind.
//
// The ground floor is rubble stone on a plinth with a dark green shopfront; the upper floor is
// half-timbered, jettied a stud out over the street and the alley, with an oriel bay above the
// right shop window. A slate gable roof runs back from the street gable, with barge boards, a
// ridge strip, two chimneys on the ridge and a chimney breast on the back wall. Every face is
// its own: the front has the shopfront, door, piers and oriel; the right (alley) has a serving
// hatch with an awning and a buttress; the back has a door, a chimney breast and a render of
// warm tan; the left has three windows at stepped heights, two buttresses and climbing ivy.
const SIZE = 32;

const ROAD = 72;
const STONE = 71;
const DARK_STONE = 72;
const LIGHT_STONE = 151;
const TAN = 19;
const DARK_TAN = 28;
const BRICK = 70;
const NOUGAT = 84;
const DARK_BROWN = 308;
const WHITE = 15;
const SHOP = 288;
const DOOR_RED = 320;
const GREEN = 2;
const DARK_GREEN = 288;
const OLIVE = 330;
const YELLOW = 14;
const RED = 4;
const BLACK = 0;
const LAMP = 46;
const GOLD = 297;

const hash = (x: number, y: number, z: number, salt = 0) => {
  let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 7, 668265263) ^ Math.imul(z + 13, 2147483647);
  h = Math.imul(h ^ salt ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Floor top; the ground storey is six brick courses, then a two-plate jetty slab. */
const G = 2;
const SLAB = G + 18;
const UPPER = SLAB + 2;
const EAVES = UPPER + 16;
const yLower = (course: number) => G + course * 3;
const yUpper = (course: number) => UPPER + course * 3;

interface Ring {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}
type Storey = 'L' | 'U';
type Face = 'F' | 'B' | 'L' | 'R';
/** The ground storey's walls, and the upper storey's, which stand a stud out on the front and right. */
const RING: Record<Storey, Ring> = {
  L: { x0: 3, x1: 18, z0: 9, z1: 22 },
  U: { x0: 3, x1: 19, z0: 8, z1: 22 },
};
const FACES: Face[] = ['F', 'B', 'L', 'R'];
const FACING: Record<Face, Facing> = { F: '-z', B: '+z', L: '-x', R: '+x' };
const alongX = (face: Face) => face === 'F' || face === 'B';
const cellOf = (ring: Ring, face: Face, u: number): [number, number] =>
  face === 'F'
    ? [u, ring.z0]
    : face === 'B'
      ? [u, ring.z1]
      : face === 'L'
        ? [ring.x0, u]
        : [ring.x1, u];
const spanOf = (ring: Ring, face: Face): [number, number] =>
  alongX(face) ? [ring.x0 + 1, ring.x1 - 1] : [ring.z0 + 1, ring.z1 - 1];

type Leaf = 'ivy' | 'lamp' | 'sill' | 'loaf-top' | 'loaf-bottom';
type Claim = { kind: 'open' } | { kind: 'host'; leaf: Leaf } | { kind: 'quoin' };
type Piece = {
  partId: string;
  color: number;
  x: number;
  y: number;
  z: number;
  rotation: Rotation;
};

/** Rubble: grey with dark patches low down, tan and light ones higher up. */
const rubble = (x: number, course: number, z: number) => {
  const patch = hash(Math.floor(x / 2) + 3 * course, Math.floor(z / 2), 7);
  if (patch < 0.34 - course * 0.04) return DARK_STONE;
  if (patch > 0.86) return hash(x, course, z) < 0.5 ? TAN : DARK_TAN;
  return STONE;
};

/** The colour of a wall cell; each face has its own material. */
const wallColor = (storey: Storey, face: Face, course: number, x: number, z: number) => {
  const patch = hash(Math.floor(x / 2) + 3 * course, Math.floor(z / 2), 11);
  if (storey === 'L') {
    if (face === 'F') {
      const shop = (x >= 4 && x <= 7) || (x >= 14 && x <= 17);
      return course < 2 && shop ? SHOP : rubble(x, course, z);
    }
    if (face === 'R') return patch < 0.3 ? DARK_TAN : patch > 0.9 ? STONE : TAN;
    if (face === 'B') return course < 3 && patch < 0.5 ? DARK_TAN : patch > 0.9 ? STONE : TAN;
    return patch < 0.3 ? STONE : patch > 0.94 ? LIGHT_STONE : DARK_STONE;
  }
  // The top course of the half-timbered storey is a timber rail; the rest is plaster.
  if (course === 4) return DARK_BROWN;
  // The braced bays keep one plain plaster so the diagonal reads.
  const along = face === 'F' || face === 'B' ? x : z;
  const braced =
    (face === 'R' && along >= 12 && along <= 17) ||
    (face === 'B' && along >= 8 && along <= 13) ||
    (face === 'L' && along >= 13 && along <= 18);
  if (braced) return face === 'R' ? WHITE : TAN;
  if (face === 'F' || face === 'R') return patch > 0.82 ? TAN : WHITE;
  return patch < 0.4 ? TAN : patch > 0.88 ? WHITE : TAN;
};

export const bakery: ExampleDefinition = {
  id: 'bakery',
  name: 'Corner Bakery',
  tags: ['bakery', 'shop', 'street', 'tudor', 'half-timbered', 'jetty', 'oriel', 'interior'],
  expectedPieceCount: 1085,
  buildArea: SIZE,
  brickIdPrefix: 'bakery',
  build(drawnAdd) {
    const order = bottomUp(drawnAdd);
    const glazed = glazeWindows(order.add);
    const boxes: { u0: number; u1: number; v0: number; v1: number; y0: number; y1: number }[] = [];
    const add: ExampleBrickAdder = (partId, color, x, y, z, rotation = 0, facing, ...rest) => {
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
      glazed(partId, color, x, y, z, rotation, facing, ...rest);
    };
    const tryAdd = (partId: string, color: number, x: number, y: number, z: number) => {
      const size = footprint({ id: '', partId, color, x, y, z, rotation: 0 });
      const inside = x >= 0 && z >= 0 && x + size.width <= SIZE && z + size.depth <= SIZE;
      const free =
        inside &&
        !boxes.some(
          (box) =>
            box.u0 < x + size.width &&
            x < box.u1 &&
            box.v0 < z + size.depth &&
            z < box.v1 &&
            box.y0 < y + size.height &&
            y < box.y1,
        );
      if (free) add(partId, color, x, y, z);
      return free;
    };
    const mount = (host: Piece, partId: string, color: number, facing: Facing) => {
      const seated = seatOnSideStuds(
        { id: 'mount', partId, color, x: host.x, y: host.y, z: host.z, rotation: 0, facing },
        { id: 'host', ...host },
      );
      if (!seated) throw new Error(`Nothing to mount ${partId} at ${host.x},${host.y},${host.z}.`);
      add(partId, color, seated.x, seated.y, seated.z, seated.rotation, seated.facing);
    };
    /** A side-stud brick in the wall's plane whose studs point out of the wall. */
    const sideStud = (x: number, y: number, z: number, facing: Facing, color: number): Piece => {
      for (const rotation of [0, 90, 180, 270] as Rotation[])
        for (const [dx, dz] of [
          [0, 0],
          [-0.5, 0],
          [0, -0.5],
        ]) {
          const host: Piece = { partId: '87087', color, x: x + dx, y, z: z + dz, rotation };
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
            { id: 'p', partId: '3024', color, x: 0, y, z: 0, rotation: 0, facing },
            { id: 'h', ...host },
          );
          if (!probe) continue;
          add(host.partId, color, host.x, host.y, host.z, host.rotation);
          return host;
        }
      throw new Error(`No side stud facing ${facing} at ${x},${y},${z}.`);
    };

    // ---- The plan of the ground: baseplates, then street, plot, alley and gardens.
    const plan = (cell: (x: number, z: number) => string) =>
      Array.from({ length: SIZE }, (_, z) =>
        Array.from({ length: SIZE }, (_, x) => cell(x, z)).join(''),
      );
    const L = RING.L;
    const inFloor = (x: number, z: number) => x >= L.x0 && x <= L.x1 && z >= L.z0 && z <= L.z1;
    const inAlley = (x: number, z: number) => x >= 19 && x <= 23 && z >= 9 && z <= 22;
    addAreaMap(
      add,
      plan(() => 'b'),
      0,
      { b: ['plate', ROAD] },
    );
    addAreaMap(
      add,
      plan((x, z) => {
        if (z < 3) return ' ';
        if (z === 3) return 'k';
        if (z < L.z0) return 'p';
        if (inFloor(x, z)) return 'f';
        if (inAlley(x, z)) return 'c';
        return 'g';
      }),
      1,
      {
        k: ['plate', STONE],
        p: ['plate', STONE],
        f: ['plate', DARK_TAN],
        c: ['plate', DARK_STONE],
        g: ['plate', GREEN],
      },
    );
    // The road: dark tiles with worn patches, a dashed white line and a drain.
    addRowMap(
      add,
      plan((x, z) =>
        z > 2 || (z === 2 && (x === 21 || x === 22))
          ? ' '
          : z === 1 && x % 4 < 2
            ? 'w'
            : (x * 5 + z * 3) % 11 === 0
              ? 's'
              : 'r',
      ),
      1,
      { r: ['tile', ROAD], s: ['tile', STONE], w: ['tile', WHITE] },
    );
    add('2412b', BLACK, 21, 1, 2, 90);
    addRowMap(
      add,
      plan((_x, z) => (z === 3 ? 'k' : ' ')),
      2,
      { k: ['tile', ROAD] },
    );
    // Open studs on the pavement, where props and furniture stand.
    const open = new Set<string>();
    const reserve = (x: number, z: number, width: number, depth: number) => {
      for (let dx = 0; dx < width; dx++)
        for (let dz = 0; dz < depth; dz++) open.add(`${x + dx},${z + dz}`);
    };
    reserve(1, 4, 2, 2); // lamppost
    reserve(0, 7, 2, 2); // barrels
    reserve(5, 6, 2, 2); // crates
    reserve(15, 5, 2, 2);
    reserve(14, 7, 1, 1); // oriel columns
    reserve(17, 7, 1, 1);
    reserve(4, 8, 4, 1); // planters under the shop windows
    reserve(14, 8, 4, 1);
    reserve(8, 8, 1, 1); // piers
    reserve(13, 8, 1, 1);
    reserve(9, 7, 4, 2); // the door step
    reserve(21, 5, 3, 1); // bench
    reserve(26, 6, 1, 1); // post box
    reserve(23, 5, 4, 2); // café table and stools
    addRowMap(
      add,
      plan((x, z) => {
        if (z < 4 || z >= L.z0 || open.has(`${x},${z}`)) return ' ';
        return z === L.z0 - 1 ? 't' : hash(x, 0, z, 5) < 0.12 ? 'd' : 'p';
      }),
      2,
      { p: ['tile', STONE], t: ['tile', TAN], d: ['tile', ROAD] },
    );
    // Cobbles in the alley: round tiles in two greys, a tile in two, and the rest left as studs.
    for (let x = 19; x <= 23; x++)
      for (let z = 9; z <= 22; z++)
        if (
          !(x === 19 && z >= 17 && z <= 18) &&
          !(x === 20 && (z === 10 || z === 13)) &&
          hash(x, 0, z, 8) < 0.55
        )
          add('98138', hash(x, 1, z, 8) < 0.4 ? DARK_STONE : STONE, x, 2, z);
    // A path of tan tiles from the back door.
    addRowMap(
      add,
      plan((x, z) =>
        x >= 11 && x <= 14 && z >= 24 && z <= 29 && !(z === 26 && (x === 11 || x === 14))
          ? hash(x, 0, z, 6) < 0.3
            ? 'q'
            : 'p'
          : ' ',
      ),
      2,
      { p: ['tile', TAN], q: ['tile', DARK_TAN] },
    );

    // ---- The faces, planned: what is claimed is left out of the plain wall and placed by hand.
    const claims = new Map<string, Claim>();
    const key = (storey: Storey, face: Face, u: number, course: number) =>
      `${storey}${face}${u},${course}`;
    const claim = (
      storey: Storey,
      face: Face,
      u0: number,
      u1: number,
      c0: number,
      c1: number,
      what: Claim,
    ) => {
      for (let u = u0; u <= u1; u++)
        for (let c = c0; c <= c1; c++) {
          if (claims.has(key(storey, face, u, c)))
            throw new Error(`Claimed twice: ${storey}${face} ${u},${c}.`);
          claims.set(key(storey, face, u, c), what);
        }
    };
    const host = (storey: Storey, face: Face, u: number, course: number, leaf: Leaf) =>
      claim(storey, face, u, u, course, course, { kind: 'host', leaf });
    const windows: {
      storey: Storey;
      face: Face;
      u: number;
      course: number;
      part: string;
      color: number;
      width: number;
      height: number;
    }[] = [];
    /** An opening for a window frame, with its width in studs and height in courses. */
    const window = (
      storey: Storey,
      face: Face,
      u: number,
      course: number,
      part: string,
      color: number,
      width: number,
      height: number,
    ) => {
      claim(storey, face, u, u + width - 1, course, course + height - 1, { kind: 'open' });
      windows.push({ storey, face, u, course, part, color, width, height });
    };
    const lintels: { storey: Storey; face: Face; u: number; course: number; length: number }[] = [];
    const lintel = (storey: Storey, face: Face, u: number, course: number, length: number) => {
      claim(storey, face, u, u + length - 1, course, course, { kind: 'open' });
      lintels.push({ storey, face, u, course, length });
    };
    const sills = (storey: Storey, face: Face, u: number, length: number, course: number) => {
      for (let i = 0; i < length; i++) host(storey, face, u + i, course, 'sill');
    };
    const posts: [Face, number][] = [];
    const post = (face: Face, u: number) => {
      claim('U', face, u, u, 0, 4, { kind: 'open' });
      posts.push([face, u]);
    };
    const braces: { face: Face; u: number; course: number; rising: boolean }[] = [];
    /** A diagonal timber brace: three 1 x 2 bricks, each a stud along from the one below. */
    const brace = (face: Face, u: number, course: number, rising: boolean) => {
      for (let k = 0; k < 3; k++) {
        const at = rising ? u + k : u + 2 - k;
        claim('U', face, at, at + 1, course + k, course + k, { kind: 'open' });
      }
      braces.push({ face, u, course, rising });
    };

    // Ground storey, front: two shop windows with stall boards, the door between, piers.
    window('L', 'F', 4, 2, '60594', SHOP, 4, 3);
    lintel('L', 'F', 4, 5, 4);
    window('L', 'F', 14, 2, '60594', SHOP, 4, 3);
    lintel('L', 'F', 14, 5, 4);
    claim('L', 'F', 9, 12, 0, 5, { kind: 'open' }); // door frame
    claim('L', 'F', 8, 8, 5, 5, { kind: 'open' }); // corbels over the piers
    claim('L', 'F', 13, 13, 5, 5, { kind: 'open' });
    // Right (alley): a serving hatch under an awning, two windows, a buttress, two corbels.
    window('L', 'R', 10, 2, '60594', SHOP, 4, 3);
    lintel('L', 'R', 10, 5, 4);
    sills('L', 'R', 10, 4, 1);
    window('L', 'R', 15, 2, '60593', DARK_BROWN, 2, 3);
    lintel('L', 'R', 15, 5, 2);
    sills('L', 'R', 15, 2, 1);
    window('L', 'R', 19, 2, '60593', DARK_BROWN, 2, 3);
    lintel('L', 'R', 19, 5, 2);
    sills('L', 'R', 19, 2, 1);
    claim('L', 'R', 14, 14, 5, 5, { kind: 'open' });
    claim('L', 'R', 21, 21, 5, 5, { kind: 'open' });
    for (const [u, c] of [
      [21, 1],
      [21, 2],
      [21, 3],
    ] as const)
      host('L', 'R', u, c, 'ivy');
    // Back: a window, a pair of vents, the door, a lantern, a second window.
    window('L', 'B', 5, 2, '60593', DARK_BROWN, 2, 3);
    lintel('L', 'B', 5, 5, 2);
    sills('L', 'B', 5, 2, 1);
    claim('L', 'B', 9, 10, 3, 4, { kind: 'open' }); // vents
    claim('L', 'B', 11, 14, 0, 5, { kind: 'open' }); // door frame
    host('L', 'B', 15, 3, 'lamp');
    window('L', 'B', 16, 2, '60593', DARK_BROWN, 2, 3);
    lintel('L', 'B', 16, 5, 2);
    sills('L', 'B', 16, 2, 1);
    // Left: three windows at stepped heights, ivy.
    window('L', 'L', 11, 2, '60593', DARK_BROWN, 2, 3);
    lintel('L', 'L', 11, 5, 2);
    sills('L', 'L', 11, 2, 1);
    window('L', 'L', 15, 3, '60592', DARK_BROWN, 2, 2);
    lintel('L', 'L', 15, 5, 2);
    sills('L', 'L', 15, 2, 2);
    window('L', 'L', 19, 2, '60592', DARK_BROWN, 2, 2);
    lintel('L', 'L', 19, 4, 2);
    sills('L', 'L', 19, 2, 1);
    for (const [u, c] of [
      [10, 0],
      [10, 1],
      [10, 2],
      [10, 3],
      [10, 4],
      [21, 0],
      [21, 1],
      [21, 2],
      [21, 3],
      [21, 4],
      [21, 5],
      [12, 5],
    ] as const)
      if (!claims.has(key('L', 'L', u, c))) host('L', 'L', u, c, 'ivy');

    // Upper storey, front: casement, sign over the door, oriel behind the right window.
    for (const u of [8, 13]) post('F', u);
    window('U', 'F', 5, 1, '60593', DARK_BROWN, 2, 3);
    sills('U', 'F', 5, 2, 0);
    host('U', 'F', 10, 1, 'loaf-bottom');
    host('U', 'F', 11, 1, 'loaf-bottom');
    host('U', 'F', 10, 2, 'loaf-top');
    host('U', 'F', 11, 2, 'loaf-top');
    host('U', 'F', 9, 2, 'lamp');
    host('U', 'F', 12, 2, 'lamp');
    // Right: two casements, a braced bay between.
    for (const u of [12, 17]) post('R', u);
    window('U', 'R', 10, 1, '60593', DARK_BROWN, 2, 3);
    sills('U', 'R', 10, 2, 0);
    brace('R', 13, 1, true);
    window('U', 'R', 19, 1, '60593', DARK_BROWN, 2, 3);
    sills('U', 'R', 19, 2, 0);
    // Back: two casements, a braced bay between them.
    for (const u of [8, 13]) post('B', u);
    window('U', 'B', 5, 1, '60593', DARK_BROWN, 2, 3);
    sills('U', 'B', 5, 2, 0);
    brace('B', 9, 1, true);
    window('U', 'B', 15, 1, '60593', DARK_BROWN, 2, 3);
    sills('U', 'B', 15, 2, 0);
    // Left: two casements, a falling brace between them.
    for (const u of [13, 18]) post('L', u);
    window('U', 'L', 10, 1, '60593', DARK_BROWN, 2, 3);
    sills('U', 'L', 10, 2, 0);
    brace('L', 14, 1, false);
    window('U', 'L', 19, 1, '60593', DARK_BROWN, 2, 3);
    sills('U', 'L', 19, 2, 0);
    for (const [u, c] of [
      [12, 2],
      [12, 3],
      [11, 4],
    ] as const)
      host('U', 'L', u, c, 'ivy');
    // Light quoins beside the ground-floor corners, on the odd courses.
    for (const face of FACES) {
      const [u0, u1] = spanOf(L, face);
      for (const u of [u0, u1])
        for (let c = 1; c <= 5; c += 2)
          if (!claims.has(key('L', face, u, c)))
            claims.set(key('L', face, u, c), { kind: 'quoin' });
    }

    // ---- The plain wall: hollow rings one brick thick, a course every three plates.
    const fillCourse = (storey: Storey, face: Face, c: number) => {
      const ring = RING[storey];
      const [u0, u1] = spanOf(ring, face);
      const y = storey === 'L' ? yLower(c) : yUpper(c);
      let u = u0;
      while (u <= u1) {
        const claimed = claims.get(key(storey, face, u, c));
        const [x, z] = cellOf(ring, face, u);
        if (claimed?.kind === 'host') {
          const color = wallColor(storey, face, c, x, z);
          const piece = sideStud(x, y, z, FACING[face], color);
          const facing = FACING[face];
          if (claimed.leaf === 'lamp') mount(piece, '3062b', LAMP, facing);
          else if (claimed.leaf === 'sill')
            mount(piece, '3024', storey === 'L' ? LIGHT_STONE : TAN, facing);
          else if (claimed.leaf === 'loaf-top') mount(piece, '54200', NOUGAT, facing);
          else if (claimed.leaf === 'loaf-bottom') mount(piece, '3024', TAN, facing);
          else {
            const roll = hash(x, y, z);
            mount(
              piece,
              roll < 0.4 ? '6141' : roll < 0.75 ? '54200' : '3024',
              y < 14 ? OLIVE : roll < 0.5 ? DARK_GREEN : GREEN,
              facing,
            );
          }
          u++;
          continue;
        }
        if (claimed?.kind === 'quoin') {
          add(c % 4 === 1 ? '4070' : '3005', LIGHT_STONE, x, y, z);
          u++;
          continue;
        }
        if (claimed) {
          u++;
          continue;
        }
        let run = 1;
        while (u + run <= u1 && !claims.has(key(storey, face, u + run, c))) run++;
        const max = c % 2 ? 3 : 4;
        let left = run;
        let start = u;
        while (left > 0) {
          const size = [4, 3, 2, 1].find((s) => s <= left && s <= max)!;
          const [px, pz] = cellOf(ring, face, start);
          const roll = hash(start, y, px + pz);
          const plain = roll < 0.22;
          let part: string;
          if (storey === 'L')
            part =
              size === 4
                ? plain
                  ? '3010'
                  : '15533'
                : size === 3
                  ? '3622'
                  : size === 2
                    ? plain
                      ? '4216'
                      : roll > 0.93
                        ? '30136'
                        : '98283'
                    : '3005';
          else part = size === 4 ? '3010' : size === 3 ? '3622' : size === 2 ? '3004' : '3005';
          add(
            part,
            wallColor(storey, face, c, px, pz),
            px,
            y,
            pz,
            alongX(face) && size > 1 ? 90 : 0,
          );
          start += size;
          left -= size;
        }
        u += run;
      }
    };
    // Light corner posts, five bricks tall, with a headlight brick at the top of each.
    for (const [x, z] of [
      [L.x0, L.z0],
      [L.x1, L.z0],
      [L.x0, L.z1],
      [L.x1, L.z1],
    ]) {
      add('2453b', LIGHT_STONE, x, yLower(0), z);
      add('4070', STONE, x, yLower(5), z);
    }
    for (let c = 0; c <= 5; c++) for (const face of FACES) fillCourse('L', face, c);
    // The jetty slab: two layers over the whole upper footprint, the lower in reddish brown and
    // the upper in dark brown, its seams crossing the lower layer's. Layer two leaves a hole under
    // the oriel's floor plate.
    const U = RING.U;
    const inUpper = (x: number, z: number) => x >= U.x0 && x <= U.x1 && z >= U.z0 && z <= U.z1;
    addAreaMap(
      add,
      plan((x, z) => (inUpper(x, z) ? 'a' : ' ')),
      SLAB,
      { a: ['plate', BRICK] },
    );
    addAreaMap(
      add,
      plan((x, z) =>
        !inUpper(x, z) || (x >= 14 && x <= 17 && z <= 11)
          ? ' '
          : x < 11
            ? z < 15
              ? 'a'
              : 'b'
            : z < 15
              ? 'c'
              : 'd',
      ),
      SLAB + 1,
      {
        a: ['plate', DARK_BROWN],
        b: ['plate', DARK_BROWN],
        c: ['plate', DARK_BROWN],
        d: ['plate', DARK_BROWN],
      },
    );
    // The oriel's floor: a plate under its front, and a plate two layers bonding it to the slab.
    add('3020', BRICK, 14, SLAB, 6, 90);
    add('3032', DARK_BROWN, 14, SLAB + 1, 6, 0);
    for (let course = 0; course < 5; course++) {
      for (const [x, z] of [
        [U.x0, U.z0],
        [U.x1, U.z0],
        [U.x0, U.z1],
        [U.x1, U.z1],
      ])
        if (course === 0) add('2453b', DARK_BROWN, x, yUpper(0), z);
      for (const face of FACES) fillCourse('U', face, course);
    }

    // ---- Windows, lintels, posts and braces.
    for (const w of windows) {
      const ring = RING[w.storey];
      const [x, z] = cellOf(ring, w.face, w.u);
      const y = w.storey === 'L' ? yLower(w.course) : yUpper(w.course);
      add(w.part, w.color, x, y, z, alongX(w.face) ? 90 : 0);
    }
    for (const l of lintels) {
      const ring = RING[l.storey];
      const [x, z] = cellOf(ring, l.face, l.u);
      const y = l.storey === 'L' ? yLower(l.course) : yUpper(l.course);
      add(
        l.length === 4 ? '3010' : '3004',
        l.storey === 'L' ? LIGHT_STONE : DARK_BROWN,
        x,
        y,
        z,
        alongX(l.face) ? 90 : 0,
      );
    }
    for (const [face, u] of posts) {
      const [x, z] = cellOf(U, face, u);
      add('2453b', DARK_BROWN, x, yUpper(0), z);
    }
    for (const b of braces)
      for (let k = 0; k < 3; k++) {
        const along = b.rising ? b.u + k : b.u + 2 - k;
        const [x, z] = cellOf(U, b.face, along);
        add('3004', DARK_BROWN, x, yUpper(b.course + k), z, alongX(b.face) ? 90 : 0);
      }

    // The vents on the back wall: two grille bricks.
    for (const c of [3, 4]) add('2877', DARK_STONE, 9, yLower(c), L.z1, 90);

    // ---- Doors: the shop door, green frame and a dark red leaf; the back door, brown.
    const addDoor = (
      x: number,
      z: number,
      frameColor: number,
      leafPart: string,
      leafColor: number,
    ) => {
      const frame: Brick = {
        id: 'frame',
        partId: '60596',
        color: frameColor,
        x,
        y: G,
        z,
        rotation: 90,
      };
      add(frame.partId, frame.color, frame.x, frame.y, frame.z, frame.rotation);
      for (const rotation of [90, 270] as Rotation[])
        for (const dx of [0, -0.5, 0.5, -1, 1])
          for (const dz of [0, -0.5, 0.5, -1, 1, -1.5, 1.5]) {
            const candidate: Brick = {
              id: 'door',
              partId: leafPart,
              color: leafColor,
              x: frame.x + dx,
              y: G,
              z: frame.z + dz,
              rotation,
            };
            if (isMatchingInsertFrame(candidate, frame)) {
              add(leafPart, leafColor, candidate.x, candidate.y, candidate.z, rotation);
              return;
            }
          }
      throw new Error('No fit for a bakery door.');
    };
    addDoor(9, L.z0, SHOP, '60623', DOOR_RED);
    addDoor(11, L.z1, DARK_BROWN, '60616a', BRICK);
    // Steps: tan plates at the front door and at the back.
    addRun(add, 'plate', TAN, 'x', 9, 2, 7, 4);
    addRun(add, 'plate', DARK_TAN, 'x', 11, 2, 23, 4);

    // ---- Relief on the ground storey.
    // Piers under the jetty, a stud out from the shopfront, topped by corbels.
    for (const x of [8, 13]) {
      if (x === 8) add('2453b', STONE, x, yLower(0), 8);
      else
        for (let k = 0; k < 5; k++) {
          if (k === 3) continue;
          add('3005', rubble(x, k, 8), x, yLower(k), 8);
        }
      add('3665a', BRICK, x, yLower(5), 8, 0);
    }
    // A lantern on the right pier, on a side-stud brick.
    {
      const piece = sideStud(13, yLower(3), 8, '-z', STONE);
      mount(piece, '3062b', LAMP, '-z');
    }
    // The oriel stands on two round columns, with a corbel between them under its floor.
    for (const x of [14, 17]) add('43888', STONE, x, G, 7);
    // The alley's awning over the hatch, and two corbels and a buttress under the jetty.
    for (const [z, color] of [
      [10, RED],
      [12, WHITE],
    ] as const)
      add('3039', color, 19, yLower(5), z, 270);
    for (const z of [10, 13]) add('2453b', DARK_BROWN, 20, G, z);
    for (const z of [14, 21]) add('3665a', BRICK, 18, yLower(5), z, 270);
    for (let level = 0; level < 6; level++)
      add('3004', rubble(19, level, 17), 19, yLower(level), 17, 0);
    // The left face's buttresses, capped with cheese slopes.
    for (const z of [13, 17]) {
      for (let level = 0; level < 5; level++)
        add('3004', rubble(2, level, z), 2, yLower(level), z, 0);
      for (let i = 0; i < 2; i++) add('54200', LIGHT_STONE, 2, yLower(5), z + i, 90);
    }
    // The chimney breast on the back wall, rising past the eaves and capped under the roof.
    for (let level = 0; level < 14; level++)
      add('3003', hash(7, level, 23) < 0.3 ? DARK_STONE : STONE, 7, yLower(level), 23);
    add('3022', LIGHT_STONE, 7, yLower(14), 23);
    add('3941', BLACK, 7, yLower(14) + 1, 23);
    // A plinth of dark plates along the foot of the back wall.
    for (const [x, z, length, axis] of [
      [L.x0, L.z1 + 1, 4, 'x'],
      [9, L.z1 + 1, 2, 'x'],
    ] as [number, number, number, 'x' | 'z'][])
      addRun(add, 'plate', DARK_STONE, axis, x, G, z, length);
    // ---- The half-timbered storey's finish: the oriel, eaves plates.
    // The oriel: a base, a glazed front, two corner posts, and a lean-to roof.
    add('3010', BRICK, 14, yUpper(0), 6, 90);
    add('60594', SHOP, 14, yUpper(1), 6, 90);
    add('3010', DARK_BROWN, 14, yUpper(4), 6, 90);
    for (const x of [14, 17]) add('2453b', DARK_BROWN, x, yUpper(0), 7);
    // Eaves plates: two studs deep at the gables so the barge boards carry on, one on the sides.
    for (let x = U.x0; x <= U.x1; x++) {
      if (x >= 14 && x <= 17) add('3024', DARK_BROWN, x, EAVES - 1, U.z0);
      else add('3023b', DARK_BROWN, x, EAVES - 1, U.z0 - 1, 0);
      if (x === 7 || x === 8) add('3024', DARK_BROWN, x, EAVES - 1, U.z1);
      else add('3023b', DARK_BROWN, x, EAVES - 1, U.z1, 0);
    }
    for (const x of [U.x0, U.x1])
      addRun(add, 'plate', DARK_BROWN, 'z', x, EAVES - 1, U.z0 + 1, U.z1 - U.z0 - 1);

    // ---- The roof: eight courses of 45 degree slopes a side, staggered, with a ridge strip.
    const rand = random(41);
    const slate = (x: number, y: number, z: number) =>
      hash(x, y, z, 9) < 0.3 ? BLACK : DARK_STONE;
    const SLOPES: Record<1 | 2 | 3 | 4, string> = { 1: '3040b', 2: '3039', 3: '3038', 4: '3037' };
    const COURSES = 8;
    for (let i = 0; i < COURSES; i++) {
      const y = EAVES + i * 3;
      for (const [x, rotation] of [
        [2 + i, 90],
        [19 - i, 270],
      ] as [number, Rotation][]) {
        // The barge boards on the gables and the main slope between.
        add('3040b', DARK_BROWN, x, y, U.z0 - 1, rotation);
        add('3040b', DARK_BROWN, x, y, U.z1 + 1, rotation);
        let z = U.z0;
        while (z <= U.z1) {
          const left = U.z1 - z + 1;
          const widths = ([4, 3, 2, 1] as const).filter((w) => w <= left);
          const width =
            widths[Math.min(widths.length - 1, Math.floor(rand() * widths.length * 0.8))]!;
          add(SLOPES[width], slate(x, y, z), x, y, z, rotation);
          z += width;
        }
      }
    }
    // The oriel's roof, a lean-to against the front gable.
    add('3037', DARK_STONE, 14, EAVES - 1, 6, 0);
    // The ridge: a strip of plates over the two top courses, closing the gap between them.
    const ridge = EAVES + COURSES * 3;
    for (let z = U.z0 - 1; z <= U.z1 + 1;) {
      if (z + 1 <= U.z1 + 1) {
        add('3021', DARK_STONE, 10, ridge, z, 90);
        z += 2;
      } else {
        add('3623', DARK_STONE, 10, ridge, z, 90);
        z += 1;
      }
    }
    // The gable walls, courses of plaster between the slopes with posts and a window each.
    const gable = (zWall: number, face: 'F' | 'B') => {
      for (let i = 0; i < COURSES; i++) {
        const y = EAVES + i * 3;
        const from = 4 + i;
        const to = 18 - i;
        const blocked = new Set<number>();
        if (face === 'F') {
          if (i >= 1 && i <= 3) for (let x = 9; x <= 12; x++) blocked.add(x);
          if (i === 4) for (let x = 9; x <= 12; x++) blocked.add(x);
        } else {
          if (i >= 1 && i <= 3) for (const x of [10, 11]) blocked.add(x);
          if (i === 4) for (const x of [10, 11]) blocked.add(x);
        }
        if (i <= 4) for (const x of [8, 14]) if (x >= from && x <= to) blocked.add(x);
        let x = from;
        while (x <= to) {
          if (blocked.has(x)) {
            if (i === 0 && (x === 8 || x === 14)) add('2453b', DARK_BROWN, x, y, zWall);
            x++;
            continue;
          }
          let run = 1;
          while (x + run <= to && !blocked.has(x + run)) run++;
          let left = run;
          let start = x;
          while (left > 0) {
            const size = ([4, 3, 2, 1] as const).find((s) => s <= left)!;
            const part = size === 4 ? '3010' : size === 3 ? '3622' : size === 2 ? '3004' : '3005';
            const roll = hash(start, y, zWall, 3);
            add(part, roll > 0.8 ? TAN : WHITE, start, y, zWall, size > 1 ? 90 : 0);
            start += size;
            left -= size;
          }
          x += run;
        }
      }
      if (face === 'F') {
        add('60594', SHOP, 9, EAVES + 3, zWall, 90);
        add('3010', DARK_BROWN, 9, EAVES + 12, zWall, 90);
      } else {
        add('60593', DARK_BROWN, 10, EAVES + 3, zWall, 90);
        add('3004', DARK_BROWN, 10, EAVES + 12, zWall, 90);
      }
    };
    gable(U.z0, 'F');
    gable(U.z1, 'B');
    // On the ridge: two chimneys with pots, and cones on the gable ends.
    for (const z of [12, 19]) {
      for (let k = 0; k < 4; k++)
        add('3003', hash(k, z, 4) < 0.35 ? DARK_BROWN : BRICK, 11, ridge + 1 + k * 3, z);
      if (z === 12) {
        add('3022', DARK_STONE, 11, ridge + 13, z);
        add('3062b', BLACK, 11, ridge + 14, z);
        add('3062b', BLACK, 12, ridge + 14, z + 1);
        add('4589', DARK_BROWN, 12, ridge + 14, z);
        add('4589', DARK_BROWN, 11, ridge + 14, z + 1);
      } else {
        add('3688', DARK_STONE, 11, ridge + 13, z);
      }
    }
    add('3957a', BLACK, 11, ridge + 1, U.z0 + 2);
    add('2335', RED, 11, ridge + 10, U.z0 + 2, 90);
    for (const z of [U.z0 - 1, U.z1 + 1]) add('4589', DARK_BROWN, 11, ridge + 1, z);

    // ---- Interior, seen through the shop windows and the door: a counter with bread, a cabinet of
    // goods along the back, and a brick oven in the corner.
    addRun(add, 'brick', DARK_BROWN, 'x', 5, G, 12, 12);
    addRun(add, 'brick', BRICK, 'x', 5, G + 3, 12, 12);
    addRun(add, 'plate', WHITE, 'x', 5, G + 6, 12, 12);
    for (let x = 5; x < 17; x++) {
      if (x % 3 === 2) continue;
      add(x % 2 ? '3062b' : '3005', hash(x, 0, 0, 4) < 0.5 ? NOUGAT : TAN, x, G + 7, 12);
    }
    for (const [from, to] of [
      [4, 10],
      [15, 17],
    ] as const) {
      addRun(add, 'brick', DARK_BROWN, 'x', from, G, L.z1 - 1, to - from + 1);
      addRun(add, 'brick', BRICK, 'x', from, G + 3, L.z1 - 1, to - from + 1);
      for (let x = from; x <= to; x++)
        if (hash(x, 0, 0, 6) < 0.7)
          add(
            x % 3 ? '3005' : '3062b',
            [RED, YELLOW, TAN, NOUGAT, WHITE][x % 5]!,
            x,
            G + 6,
            L.z1 - 1,
          );
    }
    for (const k of [0, 2, 3]) addRun(add, 'brick', BLACK, 'x', 6, G + k * 3, 18, 3);
    add('3005', BLACK, 6, G + 3, 18);
    add('3005', 25, 7, G + 3, 18);
    add('3005', BLACK, 8, G + 3, 18);

    // Shelves of jars along the left wall, two small tables with stools, and upstairs a bed, a
    // wardrobe and a table, all seen through the windows.
    for (let k = 0; k < 3; k++) add('3010', k % 2 ? BRICK : DARK_BROWN, 4, G + k * 3, 14);
    for (let z = 14; z <= 17; z++) add('3062b', [RED, NOUGAT, TAN, WHITE][z % 4]!, 4, G + 9, z);
    for (const [x, z] of [
      [13, 15],
      [9, 15],
    ] as const) {
      add('3941', DARK_BROWN, x, G, z);
      add('4150', WHITE, x, G + 3, z);
      add('3062b', DOOR_RED, x - 1, G, z + 1);
      add('3062b', DOOR_RED, x + 2, G, z);
    }
    add('3020', BRICK, 4, UPPER, 17, 0);
    add('3020', RED, 4, UPPER + 1, 17, 0);
    add('3069b', WHITE, 4, UPPER + 2, 20, 90);
    add('3003', DARK_BROWN, 17, UPPER, 19);
    add('3003', BRICK, 17, UPPER + 3, 19);
    add('3941', DARK_BROWN, 9, UPPER, 14);
    add('4150', WHITE, 9, UPPER + 3, 14);
    add('3062b', GOLD, 12, UPPER, 15);

    // ---- Street life: a lamppost, barrels, crates of bread, a bench, a post box and planters.
    add('2039', BLACK, 1, G, 4);
    add('3941', BRICK, 0, G, 7);
    add('3941', DARK_BROWN, 0, G + 3, 7);
    add('4032a', NOUGAT, 0, G + 6, 7);
    for (const [x, z, fruit] of [
      [5, 6, NOUGAT],
      [15, 5, TAN],
    ] as const) {
      add('3022', DARK_BROWN, x, G, z);
      for (const [dx, dz] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        add('3005', BRICK, x + dx, G + 1, z + dz);
        add('98138', hash(x + dx, 0, z + dz, 2) < 0.3 ? NOUGAT : fruit, x + dx, G + 4, z + dz);
      }
    }
    add('3005', DARK_BROWN, 21, G, 5);
    add('3005', DARK_BROWN, 23, G, 5);
    add('3623', DARK_BROWN, 21, G + 3, 5, 90);
    add('3005', RED, 26, G, 6);
    add('3005', RED, 26, G + 3, 6);
    add('3062b', RED, 26, G + 6, 6);
    for (const x0 of [4, 14]) {
      add('3010', BRICK, x0, G, 8, 90);
      for (let dx = 0; dx < 4; dx++)
        add(
          dx % 2 ? '98138' : '6141',
          dx % 2 ? [RED, YELLOW, WHITE][(x0 + dx) % 3]! : dx ? DARK_GREEN : GREEN,
          x0 + dx,
          G + 3,
          8,
        );
    }
    // Sacks of flour by the back door.
    add('3004', TAN, 15, G, 23, 0);
    add('3004', DARK_TAN, 16, G, 23, 0);
    add('3004', TAN, 15, G + 3, 23, 0);

    // A café table and two stools on the pavement, round tiles and a stem.
    add('4032a', DARK_STONE, 24, G, 5);
    add('3062b', DARK_STONE, 24, G + 1, 5);
    add('4150', WHITE, 24, G + 4, 5);
    for (const x of [23, 26]) {
      add('3062b', DOOR_RED, x, G, x === 23 ? 6 : 5);
      add('98138', GOLD, x, G + 3, x === 23 ? 6 : 5);
    }
    // A low yard wall along the alley, a gate gap, tile caps and railings.
    for (const [z0, z1] of [[9, 14]] as const) {
      addRun(add, 'brick', STONE, 'z', 24, G, z0, z1 - z0 + 1);
      addRun(add, 'brick', DARK_STONE, 'z', 24, G + 3, z0 + 1, z1 - z0);
      addRun(add, 'tile', LIGHT_STONE, 'z', 24, G + 6, z0, z1 - z0 + 1);
    }
    for (const z of [15, 16]) add('3005', STONE, 24, G, z);
    add('4589', LIGHT_STONE, 24, G + 3, 15);
    add('4589', LIGHT_STONE, 24, G + 3, 16);
    add('3633', DARK_BROWN, 25, G, 9, 0);

    // A garden arch over the back path: two posts, an arch, ivy on top.
    for (const x of [11, 14]) add('2453b', WHITE, x, G, 26);
    add('3659', DARK_BROWN, 11, G + 15, 26, 90);
    for (const [x, part, color] of [
      [11, '6141', GREEN],
      [12, '54200', DARK_GREEN],
      [13, '6141', OLIVE],
      [14, '98138', RED],
    ] as const)
      add(part, color, x, G + 18, 26);

    // A handcart of loaves in the back garden: two wheels, a pin plate, a block and a bed.
    for (const z of [24, 27]) add('4624c01', BLACK, 22, G, z, 90);
    add('4600', DARK_BROWN, 22, G + 2, 24, 90);
    add('3003', DARK_BROWN, 22, G + 3, 25);
    add('3020', BRICK, 22, G + 6, 24, 0);
    for (let z = 24; z <= 27; z++) add('3062b', z % 2 ? TAN : NOUGAT, 22, G + 7, z);
    add('2420', TAN, 30, G, 13);

    // A tiled patio in front of the oven, in tan and dark tan, with a stone mounting block.
    for (const [x, z, color] of [
      [26, 13, TAN],
      [28, 13, DARK_TAN],
    ] as const)
      add('3068b', color, x, G, z);
    addRun(add, 'tile', TAN, 'x', 26, G, 15, 4);

    // ---- The yard: a clay oven with a chimney, a woodpile, raised herb beds, a fence and a tree.
    add('3003', STONE, 26, G, 11);
    add('3941', NOUGAT, 26, G + 3, 11);
    add('3941', BRICK, 26, G + 6, 11);
    add('4032a', NOUGAT, 26, G + 9, 11);
    add('3062b', BLACK, 26, G + 10, 11);
    add('30136', BRICK, 29, G, 10, 90);
    add('30136', DARK_BROWN, 29, G, 11, 90);
    add('30136', DARK_BROWN, 29, G + 3, 10, 90);
    for (const [x, z] of [
      [5, 26],
      [5, 28],
      [17, 26],
      [17, 28],
    ] as const) {
      add(z === 26 ? '3001' : '3010', BRICK, x, G, z, 90);
      for (let dx = 0; dx < 4; dx++)
        add(
          dx % 2 ? '98138' : '6141',
          dx % 2 ? [YELLOW, WHITE, RED][(x + dx + z) % 3]! : OLIVE,
          x + dx,
          G + 3,
          z,
        );
      if (z === 26)
        for (let dx = 0; dx < 4; dx++)
          add(
            dx % 2 ? '6141' : '98138',
            dx % 2 ? DARK_GREEN : [WHITE, YELLOW][dx % 3 ? 1 : 0]!,
            x + dx,
            G + 3,
            27,
          );
    }
    for (let x = 0; x < SIZE; x += 4) if (x !== 12) add('33303', DARK_BROWN, x, G, SIZE - 1, 90);
    addTree(
      add,
      27,
      19,
      G,
      [DARK_GREEN, GREEN, 10],
      DARK_BROWN,
      7,
      3,
      [{ u0: 2, u1: 22, v0: 7, v1: 24, y0: G, y1: EAVES + 30 }],
      {
        foot: false,
        gnarled: true,
        accent: { color: RED, chance: 0.1 },
        radii: [2.4, 3, 2.8, 2],
        solid: (x, z) => x >= 24 && z >= 9 && z <= 30,
      },
    );
    // Bushes, ferns, tall grass and flowers on the lawns, each where it fits.
    const onLawn = (x: number, z: number) =>
      z >= 9 && !inFloor(x, z) && !inAlley(x, z) && !(x >= 11 && x <= 14 && z >= 24);
    const studs: [number, number][] = [];
    for (let sz = 9; sz < SIZE - 1; sz++) for (let sx = 0; sx < SIZE; sx++) studs.push([sx, sz]);
    studs.sort((a, b) => hash(a[0], a[1], 31) - hash(b[0], b[1], 31));
    for (const [part, color, [dx, dz], count] of [
      ['6064', DARK_GREEN, [1.5, 1.5], 4],
      ['6255', OLIVE, [2, 1.5], 3],
      ['30093', GREEN, [1.5, 0], 4],
      ['24866', RED, [0.5, 0.5], 3],
      ['24866', YELLOW, [0.5, 0.5], 3],
      ['24866', WHITE, [0.5, 0.5], 2],
      ['4727', OLIVE, [0.5, 0.5], 2],
      ['32607', GREEN, [0, 1], 3],
    ] as [string, number, [number, number], number][]) {
      let placed = 0;
      for (const [sx, sz] of studs) {
        if (placed >= count) break;
        if (onLawn(sx, sz)) if (tryAdd(part, color, sx - dx, G, sz - dz)) placed++;
      }
    }

    order.flush();
  },
};
