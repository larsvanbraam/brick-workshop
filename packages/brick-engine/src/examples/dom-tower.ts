import { footprint, seatOnSideStuds } from '../core.ts';
import type { Facing, Rotation } from '../core.ts';
import { addRowMap, addRun, bottomUp } from './layout.ts';
import { addTree } from './trees.ts';
import type { ExampleBrickAdder, ExampleDefinition } from './types.ts';

// The Dom Tower of Utrecht in brick and sandstone, on a corner of the old square. Three stages
// rise from a ten-stud shaft: the lower one with recessed arched windows between round-ribbed
// piers and corner buttresses (a door and a tall window on the front, a stair turret on the
// left), the middle one slimmer with recessed tall windows, and an octagonal lantern with window
// pairs and colonnettes under a slate spire. A balustraded gallery with flags and pinnacles marks
// each change of stage. Every face has its own layout. The street runs along the front (low z):
// road, curb and pavement with lampposts, planters, a bench and a market stall, trees in pits
// and on the square, and a low wall at the back.
const SIZE = 32;
const FLOOR = 2;

const BEDROCK = 72;
const STONE = 71;
const DARK_STONE = 72;
const LIGHT_STONE = 151;
const TAN = 19;
const DARK_TAN = 28;
const BRICK = 70;
const NOUGAT = 84;
const DARK_BROWN = 308;
const GRASS = 2;
const DARK_GRASS = 288;
const RED = 4;
const YELLOW = 14;
const WHITE = 15;
const BLACK = 0;
const GOLD = 297;
const LAMP = 46;

const hash = (a: number, b: number, c: number) => {
  let h =
    Math.imul(a + 131, 374761393) ^ Math.imul(b + 241, 668265263) ^ Math.imul(c + 337, 2147483629);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

type Face = 'F' | 'B' | 'L' | 'R';
const FACES: Face[] = ['F', 'B', 'L', 'R'];
const FACING: Record<Face, Facing> = { F: '-z', B: '+z', L: '-x', R: '+x' };
/** The turn that leans a slope's low side outwards from a face. */
const OUTWARD: Record<Face, Rotation> = { F: 0, B: 180, L: 90, R: 270 };
/** Which way a face looks, as a step in x and z. */
const OUT: Record<Face, [number, number]> = { F: [0, -1], B: [0, 1], L: [-1, 0], R: [1, 0] };
const alongX = (face: Face) => face === 'F' || face === 'B';

/** A hollow ring of wall: corner cells included, so the faces run between x0 and x1, z0 and z1. */
interface Ring {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}
const R1: Ring = { x0: 11, z0: 12, x1: 20, z1: 21 };
const R2: Ring = { x0: 12, z0: 13, x1: 19, z1: 20 };
const cells = (ring: Ring, face: Face) =>
  alongX(face) ? ring.x1 - ring.x0 - 1 : ring.z1 - ring.z0 - 1;
/** The wall cell of a face at position k along it; k counts up in x on the front and back and up in z on the sides. */
const cellOf = (ring: Ring, face: Face, k: number): [number, number] =>
  face === 'F'
    ? [ring.x0 + 1 + k, ring.z0]
    : face === 'B'
      ? [ring.x0 + 1 + k, ring.z1]
      : face === 'L'
        ? [ring.x0, ring.z0 + 1 + k]
        : [ring.x1, ring.z0 + 1 + k];
/** The cell one step in from a wall cell, where recesses stand. */
const inward = (face: Face, [x, z]: [number, number]): [number, number] => [
  x - OUT[face][0],
  z - OUT[face][1],
];
const outward = (face: Face, [x, z]: [number, number], by = 1): [number, number] => [
  x + OUT[face][0] * by,
  z + OUT[face][1] * by,
];

const BASE = 2;
/** The course the passage's pointed arch springs from. */
const PASS_C = 9;
// Stage one: twenty-four courses with a string course under courses 6, 15 and 21.
const COURSES1 = 24;
const y1 = (c: number) => BASE + c * 3 + (c >= 6 ? 1 : 0) + (c >= 15 ? 1 : 0) + (c >= 21 ? 1 : 0);
const TOP1 = y1(COURSES1 - 1) + 3;
const DECK1 = TOP1 + 3;
const GALLERY1 = DECK1 + 2;
// Stage two: fifteen courses with a string course under course 2.
const COURSES2 = 15;
const y2 = (c: number) => GALLERY1 + c * 3 + (c >= 2 ? 1 : 0);
const TOP2 = y2(COURSES2 - 1) + 3;
const DECK2 = TOP2 + 3;
const GALLERY2 = DECK2 + 2;
// Stage three: the lantern, eleven courses.
const COURSES3 = 11;
const y3 = (c: number) => GALLERY2 + c * 3;
const TOP3 = y3(COURSES3 - 1) + 3;
const DECK3 = TOP3 + 3;
const CROWN = DECK3 + 2;

/** The lantern's octagon, drawn in a 6 x 6 box that starts at (13, 14). */
const LANTERN_X = 13;
const LANTERN_Z = 14;
const LANTERN = ['.XXXX.', 'XX..XX', 'X....X', 'X....X', 'XX..XX', '.XXXX.'];

const brickColor = (x: number, y: number, z: number) => {
  const patch = hash(Math.floor(x / 2) + 3 * Math.floor(y / 3), Math.floor(z / 2), 7);
  const low = y < 24 ? 0.12 : 0.04;
  if (patch < low) return DARK_BROWN;
  return patch > 0.74 ? NOUGAT : BRICK;
};

type Piece = {
  partId: string;
  color: number;
  x: number;
  y: number;
  z: number;
  rotation: Rotation;
};

type Leaf = 'ivy' | 'lamp' | 'sill' | 'shield' | 'clock';
type Claim = { kind: 'open' } | { kind: 'host'; leaf: Leaf } | { kind: 'quoin' };

export const domTower: ExampleDefinition = {
  id: 'dom-tower',
  name: 'Dom Tower',
  tags: ['gothic', 'tower', 'landmark', 'brick', 'sandstone', 'utrecht', 'street', 'spire'],
  expectedPieceCount: 2299,
  buildArea: SIZE,
  brickIdPrefix: 'dom',
  build(drawnAdd) {
    const order = bottomUp(drawnAdd);
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
      order.add(partId, color, x, y + FLOOR - 1, z, rotation, facing, ...rest);
      // The Dom has no glass: its openings are open, with stone mesh. A four-wide frame gets a pair
      // of latticed panes in the frame's own stone colour instead of glazing.
      if (partId === '60594') {
        const along = rotation === 90 || rotation === 270;
        order.add('60607', color, along ? x + 2 : x, y + FLOOR - 1, along ? z : z + 2, rotation);
        order.add('60607', color, x, y + FLOOR - 1, z, rotation, undefined, true);
      }
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
      throw new Error(`No side stud facing ${facing}.`);
    };

    // ---- The floor: 32 x 32 in two layers of big plates, every seam of the top over the middle
    // of a plate below.
    const plates: [string, number, number, number, Rotation][] = [
      ['91405', 0, 0, 0, 0],
      ['91405', 16, 0, 0, 0],
      ['91405', 0, 16, 0, 0],
      ['91405', 16, 16, 0, 0],
      ['91405', 8, 8, 1, 0],
      ['92438', 0, 8, 1, 0],
      ['92438', 24, 8, 1, 0],
      ['92438', 8, 0, 1, 90],
      ['92438', 8, 24, 1, 90],
      ['41539', 0, 0, 1, 0],
      ['41539', 24, 0, 1, 0],
      ['41539', 0, 24, 1, 0],
      ['41539', 24, 24, 1, 0],
    ];
    for (const [partId, x, z, y, rotation] of plates) order.add(partId, BEDROCK, x, y, z, rotation);

    // ---- The street and the square, a plate high. The road runs along the front, with a curb
    // and a pavement; behind the pavement the square is paved in grey and tan round the tower.
    // Grass beds for the two big trees at the back of the square.
    const bed = (x: number, z: number) =>
      z >= 23 &&
      z <= 28 &&
      ((x >= 2 && x <= 8 && Math.hypot(x - 5, z - 25.5) < 3.4) ||
        (x >= 23 && x <= 29 && Math.hypot(x - 26, z - 25.5) < 3.4));
    const ground: string[] = [];
    for (let z = 0; z < SIZE; z++) {
      let line = '';
      for (let x = 0; x < SIZE; x++) {
        const roll = hash(x, z, 3);
        if (z <= 5) line += roll < 0.12 ? 'R' : 'r';
        else if (z <= 10) line += 's';
        else if (bed(x, z)) line += roll < 0.35 ? 'G' : 'g';
        else line += roll < 0.3 ? 'v' : roll > 0.88 ? 't' : 'u';
      }
      ground.push(line);
    }
    addRowMap(add, ground, 1, {
      r: ['plate', DARK_STONE],
      R: ['plate', STONE],
      s: ['plate', STONE],
      u: ['plate', STONE],
      v: ['plate', DARK_STONE],
      t: ['plate', TAN],
      g: ['plate', GRASS],
      G: ['plate', DARK_GRASS],
    });
    // The pavement and the curb, tiles a plate above the road.
    // Open studs where street furniture stands: [x, z, width, depth].
    const gaps: [number, number, number, number][] = [
      [8, 9, 2, 2], // lamppost
      [24, 9, 2, 2], // lamppost
      [12, 9, 2, 2], // planter
      [18, 9, 2, 2], // planter
      [5, 8, 2, 2], // tree pit
      [27, 8, 2, 2], // tree pit
      [20, 9, 4, 2], // bench
      [29, 9, 1, 1], // post box
      [1, 9, 3, 2], // café table and stools
      [6, 10, 1, 1], // bin
      [2, 7, 1, 1], // bollard
      [29, 7, 1, 1], // bollard
    ];
    const inGap = (x: number, z: number) =>
      gaps.some(([gx, gz, w, d]) => x >= gx && x < gx + w && z >= gz && z < gz + d);
    const pave: string[] = [];
    for (let z = 0; z < SIZE; z++) {
      let line = '';
      for (let x = 0; x < SIZE; x++) {
        if (z < 6 || z > 10 || (z >= 8 && x >= 14 && x <= 17) || inGap(x, z)) line += ' ';
        else if (z === 6) line += 'c';
        else if (z === 10) line += x % 3 === 0 ? 'b' : 'a';
        else line += hash(Math.floor(x / 2), z, 5) < 0.3 ? 'd' : 'a';
      }
      pave.push(line);
    }
    addRowMap(add, pave, 2, {
      a: ['tile', STONE],
      b: ['tile', TAN],
      c: ['tile', LIGHT_STONE],
      d: ['tile', LIGHT_STONE],
    });
    // A dashed white centre line on the road.
    for (let x = 1; x + 3 <= SIZE; x += 6) addRun(add, 'tile', WHITE, 'x', x, 2, 2, 3);

    // ---- The plain wall: claims reserve cells for the hand-placed features.
    const claims = new Map<string, Claim>();
    const key = (stage: number, face: Face, k: number, c: number) => `${stage}${face}${k},${c}`;
    const claim = (
      stage: number,
      face: Face,
      k0: number,
      k1: number,
      c0: number,
      c1: number,
      what: Claim,
    ) => {
      for (let k = k0; k <= k1; k++)
        for (let c = c0; c <= c1; c++) {
          if (claims.has(key(stage, face, k, c)))
            throw new Error(`Claimed twice: ${stage}${face} ${k},${c}.`);
          claims.set(key(stage, face, k, c), what);
        }
    };

    // Stage one: where the openings and ribs go, by face. Each panel is two cells wide, with a
    // recess behind the outer wall line, an arch brick across its head and two window frames.
    const PANELS1: Record<Face, number[]> = { F: [], B: [], L: [1, 5], R: [] };
    for (const face of FACES)
      for (const k of PANELS1[face]) {
        claim(1, face, k, k + 1, 3, 14, { kind: 'open' });
        // The arch brick spans k - 1 to k + 2 at course 15.
        claim(1, face, k - 1, k + 2, 15, 15, { kind: 'open' });
      }
    // The passage: a pointed arch right through the base, front to back, four cells wide, springing
    // at course PASS_C. Above its crown a tall recessed window (courses 13 to 20) fills the wall
    // between the quarter arches' feet: pointed on the front, round-headed on the back.
    for (const face of ['F', 'B'] as Face[]) {
      claim(1, face, 2, 5, 0, PASS_C + 2, { kind: 'open' });
      claim(1, face, 1, 1, PASS_C, PASS_C + 2, { kind: 'open' });
      claim(1, face, 6, 6, PASS_C, PASS_C + 2, { kind: 'open' });
    }
    claim(1, 'F', 2, 5, 13, 20, { kind: 'open' });
    claim(1, 'F', 1, 1, 18, 20, { kind: 'open' });
    claim(1, 'F', 6, 6, 18, 20, { kind: 'open' });
    claim(1, 'B', 3, 4, 13, 19, { kind: 'open' });
    claim(1, 'B', 2, 5, 20, 20, { kind: 'open' });
    // A tall pointed window on the right face, between two piers.
    claim(1, 'R', 2, 5, 3, 14, { kind: 'open' });
    claim(1, 'R', 1, 1, 12, 14, { kind: 'open' });
    claim(1, 'R', 6, 6, 12, 14, { kind: 'open' });
    // Slits in the piers.
    const SLITS1: [Face, number, number, number][] = [['L', 3, 2, 4]];
    for (const [face, k, c0, c1] of SLITS1) claim(1, face, k, k, c0, c1, { kind: 'open' });

    // Stage two's windows by face: the left and right faces take one double window between
    // their corner cells, the front and back a window at each end.
    const WINDOWS2: Record<Face, number[]> = { F: [0, 4], B: [0, 4], L: [1, 3], R: [1, 3] };
    // Hosts for small things on side studs: lanterns by the door, ivy up the left face, shields
    // on the right, a clock on the front of stage two.
    const host = (stage: number, face: Face, k: number, c: number, leaf: Leaf) =>
      claim(stage, face, k, k, c, c, { kind: 'host', leaf });
    host(1, 'F', 1, 3, 'lamp');
    host(1, 'F', 6, 3, 'lamp');
    host(1, 'F', 1, 5, 'ivy');
    host(1, 'F', 6, 5, 'ivy');
    for (const [k, c] of [
      [0, 1],
      [0, 2],
      [0, 4],
      [7, 1],
      [7, 3],
      [7, 4],
      [7, 5],
    ] as [number, number][])
      host(1, 'L', k, c, 'ivy');
    for (const c of [3, 4]) {
      host(1, 'R', 0, c, 'shield');
      host(1, 'R', 7, c, 'shield');
    }
    host(1, 'B', 1, 2, 'lamp');
    host(1, 'B', 6, 2, 'lamp');
    // Shields under the corbel table, on every face but where a rib or the turret stands.
    for (const face of FACES)
      for (const k of [1, 2, 5, 6]) {
        if (claims.has(key(1, face, k, 18))) continue;
        host(1, face, k, 18, 'shield');
      }
    // A frieze one course higher: headlight bricks alternate with plain ones on every face.
    for (const face of FACES)
      for (let k = 0; k < 8; k++)
        if (!claims.has(key(1, face, k, 20))) claim(1, face, k, k, 20, 20, { kind: 'quoin' });
    // Stage two: paired tall windows with a pier between, each pair two cells wide.
    for (const face of FACES) {
      for (const k of WINDOWS2[face]) claim(2, face, k, k + 1, 2, 14, { kind: 'open' });
      // The lintels bear on the wall beside the windows: the cells they cover are theirs.
      if (WINDOWS2[face].length === 2 && WINDOWS2[face][1] > WINDOWS2[face][0] + 2) {
        claim(2, face, 2, 2, 14, 14, { kind: 'open' });
        claim(2, face, 3, 3, 14, 14, { kind: 'open' });
      } else {
        claim(2, face, 0, 0, 14, 14, { kind: 'open' });
        claim(2, face, 5, 5, 14, 14, { kind: 'open' });
      }
      // Sills under the windows, side-mounted plates on every cell below them.
      for (const k of WINDOWS2[face]) for (const j of [0, 1]) host(2, face, k + j, 1, 'sill');
    }
    for (const k of [2, 3]) for (const c of [6, 7]) host(2, 'F', k, c, 'clock');
    for (const c of [1, 4]) {
      host(1, 'F', 1, c, 'ivy');
      host(1, 'F', 6, c, 'ivy');
    }
    for (const [face, k, c] of [
      ['R', 0, 1],
      ['R', 0, 2],
      ['R', 7, 2],
      ['R', 7, 6],
      ['B', 1, 4],
      ['B', 6, 4],
      ['L', 0, 6],
      ['L', 0, 7],
      ['L', 0, 9],
      ['L', 7, 7],
      ['L', 7, 8],
      ['R', 0, 6],
      ['R', 7, 8],
      ['R', 7, 10],
    ] as [Face, number, number][])
      if (!claims.has(key(1, face, k, c))) host(1, face, k, c, c % 2 ? 'ivy' : 'shield');
    // The lantern is an open stage: on each face two slender piers stand either side of a two-stud
    // opening (courses 1 to 8) under a round arch at course 9, and the sky shows through.
    const lanternSkip = new Set<string>();
    for (const i of [1, 2, 3, 4])
      for (const [dx, dz] of [
        [i, 0],
        [i, 5],
        [0, i],
        [5, i],
      ] as [number, number][]) {
        if (i === 2 || i === 3) for (let c = 1; c <= 8; c++) lanternSkip.add(`${dx},${dz},${c}`);
        lanternSkip.add(`${dx},${dz},9`);
      }

    const wallPart = (size: number, roll: number) =>
      size === 6
        ? '3009'
        : size === 4
          ? roll < 0.22
            ? '3010'
            : roll > 0.9
              ? '30137'
              : '15533'
          : size === 3
            ? '3622'
            : size === 2
              ? roll < 0.18
                ? '4216'
                : roll < 0.3
                  ? '3004'
                  : roll > 0.93
                    ? '30136'
                    : '98283'
              : roll < 0.12
                ? '4070'
                : '3005';

    const layWall = (
      stage: number,
      ring: Ring,
      courses: number,
      yOf: (c: number) => number,
      corner: (c: number) => void,
    ) => {
      for (let c = 0; c < courses; c++) {
        const y = yOf(c);
        corner(c);
        for (const face of FACES) {
          const n = cells(ring, face);
          let k = 0;
          while (k < n) {
            const claimed = claims.get(key(stage, face, k, c));
            if (claimed?.kind === 'host') {
              const [hx, hz] = cellOf(ring, face, k);
              const piece = sideStud(hx, y, hz, FACING[face], brickColor(hx, y, hz));
              const roll = hash(hx, y, hz);
              if (claimed.leaf === 'lamp') mount(piece, '3062b', LAMP, FACING[face]);
              else if (claimed.leaf === 'sill') mount(piece, '3024', LIGHT_STONE, FACING[face]);
              else if (claimed.leaf === 'shield')
                mount(piece, '6141', (hx + hz + c) % 2 ? RED : WHITE, FACING[face]);
              else if (claimed.leaf === 'clock')
                mount(piece, '98138', (k + c) % 2 ? WHITE : GOLD, FACING[face]);
              else
                mount(
                  piece,
                  roll < 0.4 ? '6141' : roll < 0.75 ? '54200' : '3024',
                  roll < 0.5 ? DARK_GRASS : GRASS,
                  FACING[face],
                );
              k++;
              continue;
            }
            if (claimed?.kind === 'quoin') {
              const [qx, qz] = cellOf(ring, face, k);
              add(k % 2 ? '4070' : '3005', k % 2 ? BRICK : LIGHT_STONE, qx, y, qz);
              k++;
              continue;
            }
            if (claimed) {
              k++;
              continue;
            }
            let run = 1;
            while (k + run < n && !claims.has(key(stage, face, k + run, c))) run++;
            const pick = hash(k, c, face === 'F' ? 1 : face === 'B' ? 2 : face === 'L' ? 3 : 4);
            const max = c % 2 ? (pick < 0.5 ? 3 : 2) : pick < 0.5 ? 4 : 6;
            let left = run;
            let start = k;
            while (left > 0) {
              const size = [6, 4, 3, 2, 1].find((s) => s <= left && s <= max)!;
              const [px, pz] = cellOf(ring, face, start);
              const roll = hash(start, y, px + pz);
              add(
                wallPart(size, roll),
                brickColor(px, y, pz),
                px,
                y,
                pz,
                alongX(face) && size > 1 ? 90 : 0,
              );
              start += size;
              left -= size;
            }
            k += run;
          }
        }
      }
    };
    // Stage one, with a 2 x 2 buttress at each corner.
    layWall(1, R1, COURSES1, y1, (c) => {
      for (const [x, z] of [
        [R1.x0 - 1, R1.z0 - 1],
        [R1.x1, R1.z0 - 1],
        [R1.x0 - 1, R1.z1],
        [R1.x1, R1.z1],
      ])
        add('3003', hash(x, c, z) < 0.3 ? DARK_TAN : TAN, x, y1(c), z);
    });

    // String courses: a band of plates on the wall line under course 6 and 12, and a 2 x 2 plate
    // on each corner buttress.
    const band = (ring: Ring, y: number, corners: boolean, color: number, runs = true) => {
      for (const face of runs ? FACES : []) {
        const n = cells(ring, face);
        const [sx, sz] = cellOf(ring, face, 0);
        addRun(add, 'plate', color, alongX(face) ? 'x' : 'z', sx, y, sz, n);
      }
      for (const [x, z] of [
        [ring.x0, ring.z0],
        [ring.x1, ring.z0],
        [ring.x0, ring.z1],
        [ring.x1, ring.z1],
      ])
        if (corners) {
          const bx = x === ring.x0 ? x - 1 : x;
          const bz = z === ring.z0 ? z - 1 : z;
          add('3022', color, bx, y, bz);
        } else add('3024', color, x, y, z);
    };
    band(R1, y1(6) - 1, true, LIGHT_STONE, false);
    band(R1, y1(15) - 1, true, LIGHT_STONE, false);
    band(R1, y1(21) - 1, true, LIGHT_STONE, false);
    band(R2, y2(2) - 1, false, LIGHT_STONE);

    // The first gallery: corbels under a deck that overhangs the shaft by a stud.
    // The corbel table and the deck of the first gallery.
    for (const face of FACES) {
      const n = cells(R1, face);
      for (let k = 0; k < n; k++) {
        const [x, z] = cellOf(R1, face, k);
        const [ox, oz] = outward(face, [x, z]);
        if (face === 'F') add('3665a', STONE, ox, TOP1, oz, 0);
        else if (face === 'B') add('3665a', STONE, x, TOP1, z, 180);
        else if (face === 'L') add('3665a', STONE, ox, TOP1, oz, 90);
        else add('3665a', STONE, x, TOP1, z, 270);
      }
    }
    const x0 = R1.x0 - 1;
    const x1 = R1.x1 + 1;
    const z0 = R1.z0 - 1;
    const z1 = R1.z1 + 1;
    for (let z = z0; z <= z1; z++) addRun(add, 'plate', DARK_STONE, 'x', x0, DECK1, z, x1 - x0 + 1);
    for (let x = x0; x <= x1; x++) addRun(add, 'plate', STONE, 'z', x, DECK1 + 1, z0, z1 - z0 + 1);

    // Stage two.
    layWall(2, R2, COURSES2, y2, (c) => {
      for (const [x, z] of [
        [R2.x0, R2.z0],
        [R2.x1, R2.z0],
        [R2.x0, R2.z1],
        [R2.x1, R2.z1],
      ])
        add('3062b', c % 2 ? TAN : LIGHT_STONE, x, y2(c), z);
    });
    // A string course under course 2 of stage two.
    // The second gallery: corbels and a deck.
    for (const face of FACES) {
      const n = cells(R2, face);
      for (let k = 0; k < n; k++) {
        const [x, z] = cellOf(R2, face, k);
        const [ox, oz] = outward(face, [x, z]);
        if (face === 'F') add('3665a', STONE, ox, TOP2, oz, 0);
        else if (face === 'B') add('3665a', STONE, x, TOP2, z, 180);
        else if (face === 'L') add('3665a', STONE, ox, TOP2, oz, 90);
        else add('3665a', STONE, x, TOP2, z, 270);
      }
    }
    for (const [x, z] of [
      [R2.x0 - 1, R2.z0 - 1],
      [R2.x1, R2.z0 - 1],
      [R2.x0 - 1, R2.z1],
      [R2.x1, R2.z1],
    ])
      add('3003', TAN, x, TOP2, z);
    const a0 = R2.x0 - 1;
    const a1 = R2.x1 + 1;
    const b0 = R2.z0 - 1;
    const b1 = R2.z1 + 1;
    for (let z = b0; z <= b1; z++) addRun(add, 'plate', DARK_STONE, 'x', a0, DECK2, z, a1 - a0 + 1);
    for (let x = a0; x <= a1; x++) addRun(add, 'plate', STONE, 'z', x, DECK2 + 1, b0, b1 - b0 + 1);

    // Stage three: the lantern, an octagon of brick with a window pair on each face.
    for (let c = 0; c < COURSES3; c++)
      LANTERN.forEach((row, dz) =>
        [...row].forEach((ch, dx) => {
          const lanternFace: Face | null =
            dx >= 1 && dx <= 4 && dz === 0
              ? 'F'
              : dx >= 1 && dx <= 4 && dz === 5
                ? 'B'
                : dz >= 1 && dz <= 4 && dx === 0
                  ? 'L'
                  : dz >= 1 && dz <= 4 && dx === 5
                    ? 'R'
                    : null;
          const along = lanternFace === 'F' || lanternFace === 'B' ? dx : dz;
          if (ch === 'X' && c === 0 && lanternFace && along !== 1 && along !== 4) {
            const piece = sideStud(LANTERN_X + dx, y3(0), LANTERN_Z + dz, FACING[lanternFace], TAN);
            mount(piece, dx % 2 ? '3024' : '54200', LIGHT_STONE, FACING[lanternFace]);
          } else if (ch === 'X' && !lanternSkip.has(`${dx},${dz},${c}`))
            add(
              lanternFace ? '3005' : '3062b',
              c % 2 ? TAN : hash(dx, c, dz) < 0.3 ? DARK_TAN : LIGHT_STONE,
              LANTERN_X + dx,
              y3(c),
              LANTERN_Z + dz,
            );
        }),
      );
    // The lantern's corbels and deck.
    for (let k = 1; k <= 4; k++) {
      add('3665a', STONE, LANTERN_X + k, TOP3, LANTERN_Z - 1, 0);
      add('3665a', STONE, LANTERN_X + k, TOP3, LANTERN_Z + 5, 180);
      add('3665a', STONE, LANTERN_X - 1, TOP3, LANTERN_Z + k, 90);
      add('3665a', STONE, LANTERN_X + 5, TOP3, LANTERN_Z + k, 270);
    }
    const c0 = LANTERN_X - 1;
    const c1 = LANTERN_X + 6;
    const d0 = LANTERN_Z - 1;
    const d1 = LANTERN_Z + 6;
    for (let z = d0; z <= d1; z++) addRun(add, 'plate', DARK_STONE, 'x', c0, DECK3, z, c1 - c0 + 1);
    for (let x = c0; x <= c1; x++) addRun(add, 'plate', STONE, 'z', x, DECK3 + 1, d0, d1 - d0 + 1);

    // The cap: a bulb that swells from a 4 x 4 neck to a 6 x 6 belly of round bricks and draws in
    // again, a small open lantern of four posts, a cone, a gold ball, and a vane with a flag.
    const core: [number, number][] = [
      [14, 15],
      [16, 15],
      [14, 17],
      [16, 17],
    ];
    let sy = CROWN;
    for (const [x, z] of core) add('3003', STONE, x, sy, z);
    sy += 3;
    for (const x of [13, 15, 17]) for (const z of [14, 16, 18]) add('3941', DARK_STONE, x, sy, z);
    sy += 3;
    for (const [x, z] of core) add('3941', STONE, x, sy, z);
    sy += 3;
    add('3031', LIGHT_STONE, 14, sy, 15);
    sy += 1;
    for (const [x, z] of [
      [14, 15],
      [17, 15],
      [14, 18],
      [17, 18],
    ])
      for (let level = 0; level < 2; level++) add('3062b', TAN, x, sy + level * 3, z);
    sy += 6;
    add('3031', LIGHT_STONE, 14, sy, 15);
    sy += 1;
    add('3943b', DARK_STONE, 14, sy, 15);
    sy += 6;
    for (let level = 0; level < 2; level++)
      add('3941', level % 2 ? STONE : DARK_STONE, 15, sy + level * 3, 16);
    sy += 6;
    add('3942c', DARK_STONE, 15, sy, 16);
    sy += 6;
    add('59900', GOLD, 15.5, sy, 16.5);
    add('3957a', BLACK, 15.5, sy + 3, 16.5);
    add('2335', RED, 15.5, sy + 9, 16.5, 90);

    // ---- Stage one's recessed windows: a column of brick on the inner line, a band, two window
    // frames, and an arch brick across the head on the wall line.
    const alongRot = (face: Face): Rotation => (alongX(face) ? 90 : 0);
    for (const face of FACES)
      for (const k of PANELS1[face]) {
        const [ix, iz] = inward(face, cellOf(R1, face, k));
        const rot = alongRot(face);
        for (let c = 0; c <= 5; c++)
          add(
            '3004',
            c < 3 ? BRICK : hash(k, c, ix + iz) < 0.5 ? DARK_BROWN : BRICK,
            ix,
            y1(c),
            iz,
            rot,
          );
        for (const yb of [y1(6) - 1, y1(15) - 1]) add('3023b', TAN, ix, yb, iz, rot);
        for (const c of [6, 9, 12]) add('60593', DARK_STONE, ix, y1(c), iz, rot);
        add('3004', BRICK, ix, y1(15), iz, rot);
        const [ax, az] = cellOf(R1, face, k - 1);
        add('3659', TAN, ax, y1(15), az, rot);
      }
    // The cells a slit leaves are filled with a grille brick laid into the wall.
    const slit = (face: Face, k: number, c: number) => {
      const [x, z] = cellOf(R1, face, k);
      if (face === 'F') add('2877', DARK_STONE, x, y1(c), z, 0);
      else if (face === 'B') add('2877', DARK_STONE, x, y1(c), z - 1, 0);
      else if (face === 'L') add('2877', DARK_STONE, x, y1(c), z, 90);
      else add('2877', DARK_STONE, x - 1, y1(c), z, 90);
    };
    for (const [face, k, c0, c1] of SLITS1) for (let c = c0; c <= c1; c++) slit(face, k, c);

    // ---- The passage: a pointed arch right through the base, as at the Dom, where the old nave
    // once ran. Sandstone lining walls under an impost band, a tunnel vault of quarter arches (a
    // light rib at every other stud), a tiled floor, two wall lamps a side, and over each mouth a
    // tall recessed window: pointed on the front, round-headed on the back.
    const PASS_X0 = R1.x0 + 3; // 14, the first open cell
    const PASS_Z0 = R1.z0;
    const PASS_Z1 = R1.z1;
    const lampCells = new Set([`${PASS_Z0 + 3}`, `${PASS_Z0 + 6}`]);
    for (const [lx, facing] of [
      [PASS_X0 - 1, '+x'],
      [PASS_X0 + 4, '-x'],
    ] as [number, Facing][])
      for (let c = 0; c < PASS_C; c++)
        for (let z = PASS_Z0 + 1; z < PASS_Z1; z += c % 2 === 0 && c !== 3 ? 2 : 1) {
          const y = y1(c);
          const run = c % 2 === 0 && c !== 3 && z + 1 < PASS_Z1 ? 2 : 1;
          const color = hash(lx, y, z) < 0.25 ? DARK_TAN : c === 0 ? LIGHT_STONE : TAN;
          if (c === 3 && lampCells.has(`${z}`)) {
            const host = sideStud(lx, y, z, facing, color);
            mount(host, '3062b', LAMP, facing);
          } else add(run === 2 ? '3004' : '3005', color, lx, y, z, 0);
        }
    for (const lx of [PASS_X0 - 1, PASS_X0 + 4])
      addRun(add, 'plate', LIGHT_STONE, 'z', lx, y1(6) - 1, PASS_Z0 + 1, PASS_Z1 - PASS_Z0 - 1);
    for (let z = PASS_Z0; z <= PASS_Z1; z++) {
      const rib = (z - PASS_Z0) % 2 === 0;
      const color = rib ? LIGHT_STONE : TAN;
      add('13965', color, PASS_X0 - 1, y1(PASS_C), z, 90);
      add('13965', color, PASS_X0 + 2, y1(PASS_C), z, 270);
    }
    // The floor runs out under the arch: tan tiles with a dark course every third row.
    for (let z = PASS_Z0 - 3; z <= PASS_Z1 + 3; z++)
      addRun(add, 'tile', (z - PASS_Z0 + 3) % 3 === 2 ? DARK_TAN : TAN, 'x', PASS_X0, BASE, z, 4);
    // The windows above the mouths, recessed a stud behind the wall line.
    for (const face of ['F', 'B'] as Face[]) {
      const wz = face === 'F' ? R1.z0 + 1 : R1.z1 - 1;
      const edge = face === 'F' ? R1.z0 : R1.z1;
      add('3010', DARK_TAN, PASS_X0, y1(PASS_C + 3), wz, 90);
      for (const c of [13, 16]) add('60594', LIGHT_STONE, PASS_X0, y1(c), wz, 90);
      addRun(add, 'plate', TAN, 'x', PASS_X0, y1(13) + 9, wz, 4);
      for (const c of [19, 20]) add('3010', DARK_TAN, PASS_X0, y1(c), wz, 90);
      if (face === 'F') {
        add('13965', LIGHT_STONE, PASS_X0 - 1, y1(18), edge, 90);
        add('13965', LIGHT_STONE, PASS_X0 + 2, y1(18), edge, 270);
      } else add('3659', LIGHT_STONE, PASS_X0, y1(20), edge, 90);
    }
    // The tall pointed window on the right: the same construction turned to face +x.
    {
      const ix = R1.x1 - 1;
      for (let c = 0; c <= 5; c++) add('3010', BRICK, ix, y1(c), R1.z0 + 3, 0);
      addRun(add, 'plate', TAN, 'z', ix, y1(6) - 1, R1.z0 + 3, 4);
      for (const c of [6, 9]) add('60594', LIGHT_STONE, ix, y1(c), R1.z0 + 3, 0);
      for (const c of [12, 13, 14]) add('3010', BRICK, ix, y1(c), R1.z0 + 3, 0);
      add('13965', TAN, R1.x1, y1(12), R1.z0 + 2, 0);
      add('13965', TAN, R1.x1, y1(12), R1.z0 + 5, 180);
    }
    // The plinth: plates a stud out from the wall in runs, left open at the door and the turret.
    for (const face of FACES) {
      const n = cells(R1, face);
      const skip = (k: number) =>
        ((face === 'F' || face === 'B') && k >= 2 && k <= 5) ||
        (face === 'L' && (k === 3 || k === 4));
      let k = 0;
      while (k < n) {
        if (skip(k)) {
          k++;
          continue;
        }
        let run = 1;
        while (k + run < n && !skip(k + run)) run++;
        const [x, z] = outward(face, cellOf(R1, face, k));
        addRun(add, 'plate', DARK_STONE, alongX(face) ? 'x' : 'z', x, BASE, z, run);
        k += run;
      }
    }

    // ---- Stage two's windows: four frames stacked on the inner line behind the wall, a base of
    // brick under them, a band and a lintel in front.
    for (const face of FACES)
      for (const k of WINDOWS2[face]) {
        const [ix, iz] = inward(face, cellOf(R2, face, k));
        const rot = alongRot(face);
        for (let c = 0; c <= 1; c++) add('3004', BRICK, ix, y2(c), iz, rot);
        add('3023b', TAN, ix, y2(2) - 1, iz, rot);
        for (const c of [2, 5, 8, 11]) add('60593', DARK_STONE, ix, y2(c), iz, rot);
        // Lintels: a three-stud brick over each window of a pair, one six-stud brick across a
        // double window, each bearing on the wall beside the openings.
        if (WINDOWS2[face][1] > WINDOWS2[face][0] + 2) {
          const [lx, lz] = cellOf(R2, face, k === 0 ? 0 : 3);
          add('4490', LIGHT_STONE, lx, y2(14), lz, rot);
        } else if (k === WINDOWS2[face][0]) {
          const [lx, lz] = cellOf(R2, face, 0);
          add('3009', LIGHT_STONE, lx, y2(14), lz, rot);
        }
      }

    // ---- The lantern's arches: one round arch across each face, bearing on the two piers.
    for (const [dx, dz, rot] of [
      [1, 0, 90],
      [1, 5, 90],
      [0, 1, 0],
      [5, 1, 0],
    ] as [number, number, Rotation][])
      add('3659', LIGHT_STONE, LANTERN_X + dx, y3(9), LANTERN_Z + dz, rot);

    // ---- Relief on stage one: ribs, pilasters, a buttress and a round stair turret, each stacked
    // a course at a time on the plinth and capped with cheese slopes under the corbel table.
    const bands1 = [6, 15, 21];
    /** A round column from y to yTop: tall columns first, then round bricks and a round plate. */
    const column = (x: number, z: number, y: number, yTop: number, seed: number) => {
      let at = y;
      while (yTop - at >= 18) {
        add('43888', hash(x, at, seed) < 0.3 ? DARK_TAN : TAN, x, at, z);
        at += 18;
      }
      while (yTop - at >= 3) {
        add('3062b', hash(x, at, seed) < 0.3 ? LIGHT_STONE : TAN, x, at, z);
        at += 3;
      }
      while (yTop - at >= 1) {
        add('6141', LIGHT_STONE, x, at, z);
        at += 1;
      }
    };
    /** A stack of bricks `width` cells wide at the wall's outer cell + 1, from course c0 to c1. */
    const pilaster = (face: Face, k: number, width: 1 | 2, c0: number, c1: number, deep = 1) => {
      const rot = alongRot(face);
      const [bx, bz] = outward(face, cellOf(R1, face, k));
      if (width === 1 && deep === 1) {
        column(bx, bz, y1(c0) + 1, y1(c1) + 4, 5);
        add('54200', LIGHT_STONE, bx, y1(c1) + 4, bz, OUTWARD[face]);
        return;
      }
      // A stack standing `deep` cells out: pieces laid along the face for 1, into it for 2.
      for (let c = c0; c <= c1; c++) {
        const y = y1(c) + 1;
        const color = hash(k, c, bx + bz) < 0.3 ? DARK_TAN : TAN;
        if (bands1.includes(c) && c > c0)
          for (let j = 0; j < width; j++) {
            const [px, pz] = alongX(face) ? [bx + j, bz] : [bx, bz + j];
            add('3024', LIGHT_STONE, px, y - 1, pz);
          }
        if (deep === 1) add(width === 2 ? '3004' : '3005', color, bx, y, bz, width === 2 ? rot : 0);
        else
          for (let j = 0; j < width; j++) {
            const [px, pz] = alongX(face) ? [bx + j, bz] : [bx, bz + j];
            const [qx, qz] = face === 'L' ? [px - 1, pz] : face === 'F' ? [px, pz - 1] : [px, pz];
            add('3004', color, qx, y, qz, alongX(face) ? 0 : 90);
          }
      }
      const cy = y1(c1) + 4;
      for (let j = 0; j < width; j++) {
        const [px, pz] = alongX(face) ? [bx + j, bz] : [bx, bz + j];
        if (deep === 1) add('54200', LIGHT_STONE, px, cy, pz, OUTWARD[face]);
        else {
          const [qx, qz] = face === 'L' ? [px - 1, pz] : face === 'F' ? [px, pz - 1] : [px, pz];
          add('54200', LIGHT_STONE, qx, cy, qz, OUTWARD[face]);
        }
      }
    };
    // The front: slim ribs at both ends. The back: ribs and a two-wide pilaster with a clock.
    pilaster('F', 0, 1, 0, 22);
    pilaster('F', 7, 1, 0, 22);
    pilaster('B', 0, 1, 0, 22);
    pilaster('B', 7, 1, 0, 22);
    // The right: a pilaster in the middle two cells, stepped out two studs.

    // The left: a round stair turret of 2 x 2 bricks, standing out two studs from the wall and
    // rising almost to the corbels under its own cone.
    const turretX = R1.x0 - 2;
    const turretZ = cellOf(R1, 'L', 3)[1];
    for (let j = 0; j < 21; j++)
      add('3941', hash(j, 3, 9) < 0.3 ? DARK_TAN : TAN, turretX, BASE + j * 3, turretZ);
    add('3942c', DARK_STONE, turretX, BASE + 63, turretZ);

    // Projecting string courses on stage one: plates a stud out from the wall, broken where a
    // rib, pilaster or the turret stands.
    const standsOut = (face: Face, k: number) =>
      (face === 'F' && (k === 0 || k === 7)) ||
      (face === 'B' && (k === 0 || k === 7)) ||
      (face === 'L' && (k === 3 || k === 4));
    for (const c of [6, 15, 21])
      for (const face of FACES) {
        // On the front and back the passage and its window leave only the piers at both ends.
        if ((face === 'F' || face === 'B') && c !== 21) {
          for (const k0 of [0, 6]) {
            const [wx, wz] = cellOf(R1, face, k0);
            addRun(add, 'plate', c === 15 ? TAN : LIGHT_STONE, 'x', wx, y1(c) - 1, wz, 2);
          }
          // The back's jambs beside its slim window carry the course above on a plate each.
          if (face === 'B' && c === 15)
            for (const k of [2, 5]) {
              const [wx, wz] = cellOf(R1, face, k);
              add('3024', TAN, wx, y1(c) - 1, wz);
            }
          continue;
        }
        for (const k0 of [0, 4]) {
          const color = c === 15 ? TAN : LIGHT_STONE;
          const [wx, wz] = cellOf(R1, face, k0);
          const blocked = [0, 1, 2, 3].some((j) => standsOut(face, k0 + j));
          if (blocked) addRun(add, 'plate', color, alongX(face) ? 'x' : 'z', wx, y1(c) - 1, wz, 4);
          // A 2 x 4 plate across the wall line and the cell outside it, borne by the piers at
          // both ends of its run.
          else if (face === 'B') add('3020', color, wx, y1(c) - 1, wz, 90);
          else if (face === 'F') add('3020', color, wx, y1(c) - 1, wz - 1, 90);
          else if (face === 'L') add('3020', color, wx - 1, y1(c) - 1, wz, 0);
          else add('3020', color, wx, y1(c) - 1, wz, 0);
        }
      }
    // Stage two: a two-wide pilaster at the middle of the back, ribs beside the windows of the
    // left and right faces, and a cap of cheese slopes under the corbels.
    const stack2 = (face: Face, k: number, width: 1 | 2) => {
      const [bx, bz] = outward(face, cellOf(R2, face, k));
      if (width === 1) {
        column(bx, bz, y2(0), y2(14), 7);
        add('54200', LIGHT_STONE, bx, y2(14), bz, OUTWARD[face]);
        return;
      }
      for (let c = 0; c <= 13; c++) {
        const y = y2(c);
        if (c === 2)
          for (let j = 0; j < width; j++) {
            const [px, pz] = alongX(face) ? [bx + j, bz] : [bx, bz + j];
            add('3024', LIGHT_STONE, px, y - 1, pz);
          }
        add(
          width === 2 ? '3004' : '3005',
          hash(k, c, bx + bz) < 0.3 ? DARK_TAN : TAN,
          bx,
          y,
          bz,
          width === 2 ? alongRot(face) : 0,
        );
      }
      for (let j = 0; j < width; j++) {
        const [px, pz] = alongX(face) ? [bx + j, bz] : [bx, bz + j];
        add('54200', LIGHT_STONE, px, y2(14), pz, OUTWARD[face]);
      }
    };
    stack2('B', 2, 2);
    for (const face of ['L', 'R'] as Face[]) {
      stack2(face, 0, 1);
      stack2(face, 5, 1);
    }

    // ---- The galleries: balustrades, corner pinnacles with cones, and flags.
    const post = (x: number, y: number, z: number, high: number) => {
      if (high === 6) {
        add('43888', LIGHT_STONE, x, y, z);
        add('3062b', TAN, x, y + 18, z);
        add('59900', GOLD, x, y + 21, z);
        return;
      }
      for (let j = 0; j < high; j++) add('3062b', j % 2 ? TAN : LIGHT_STONE, x, y + j * 3, z);
      const flagged = [`${x0},${z0}`, `${x1},${z1}`, `${a1},${b0}`, `${a0},${b1}`].includes(
        `${x},${z}`,
      );
      add(flagged || hash(x, z, 8) < 0.5 ? '4589' : '22388', LIGHT_STONE, x, y + high * 3, z);
    };
    const flag = (x: number, y: number, z: number, color: number) => {
      add('3957a', BLACK, x, y, z);
      add('2335', color, x, y + 6, z, 90);
    };
    // Gallery one: a ring on the deck's edge, 12 x 12. Fences of four with two posts between.
    const g1 = (x: number, z: number, along: 'x' | 'z') => {
      const fence = ['33303', '30055', '3185'][Math.floor(hash(x, z, 4) * 3)]!;
      add(fence, LIGHT_STONE, x, GALLERY1, z, along === 'x' ? 90 : 0);
    };
    for (const x of [x0 + 1, x0 + 7]) {
      g1(x, z0, 'x');
      g1(x, z1, 'x');
    }
    for (const z of [z0 + 1, z0 + 7]) {
      g1(x0, z, 'z');
      g1(x1, z, 'z');
    }
    for (const [x, z] of [
      [x0, z0],
      [x1, z0],
      [x0, z1],
      [x1, z1],
    ])
      post(x, GALLERY1, z, 3);
    for (const [x, z] of [
      [x0 + 5, z0],
      [x0 + 6, z0],
      [x0 + 5, z1],
      [x0 + 6, z1],
      [x0, z0 + 5],
      [x0, z0 + 6],
      [x1, z0 + 5],
      [x1, z0 + 6],
    ])
      post(x, GALLERY1, z, 1);
    flag(x0, GALLERY1 + 12, z0, RED);
    flag(x1, GALLERY1 + 12, z1, WHITE);
    // Gallery two: the ring on a 10 x 10 deck, two fences a side and a post at every corner.
    const e0 = a0 + 1;
    for (const x of [e0, e0 + 4]) {
      add('30055', LIGHT_STONE, x, GALLERY2, b0, 90);
      add('3185', LIGHT_STONE, x, GALLERY2, b1, 90);
    }
    for (const z of [b0 + 1, b0 + 5]) {
      add('3185', LIGHT_STONE, a0, GALLERY2, z, 0);
      add('30055', LIGHT_STONE, a1, GALLERY2, z, 0);
    }
    for (const [x, z] of [
      [a0, b0],
      [a1, b0],
      [a0, b1],
      [a1, b1],
    ])
      post(x, GALLERY2, z, 2);
    flag(a1, GALLERY2 + 9, b0, RED);
    flag(a0, GALLERY2 + 9, b1, WHITE);
    // Corner pinnacles round the lantern: slender columns on the deck beside its diagonals.
    for (const [x, z] of [
      [LANTERN_X, LANTERN_Z],
      [LANTERN_X + 5, LANTERN_Z],
      [LANTERN_X, LANTERN_Z + 5],
      [LANTERN_X + 5, LANTERN_Z + 5],
    ])
      post(x, GALLERY2, z, 6);
    // Slender colonnettes flank each pair of lantern windows, a stud out from the wall, each
    // a column with round bricks above it and a cone under the corbels.
    for (const [x, z] of [
      [LANTERN_X + 1, LANTERN_Z - 1],
      [LANTERN_X + 4, LANTERN_Z - 1],
      [LANTERN_X + 1, LANTERN_Z + 6],
      [LANTERN_X + 4, LANTERN_Z + 6],
      [LANTERN_X - 1, LANTERN_Z + 1],
      [LANTERN_X - 1, LANTERN_Z + 4],
      [LANTERN_X + 6, LANTERN_Z + 1],
      [LANTERN_X + 6, LANTERN_Z + 4],
    ]) {
      add('43888', TAN, x, GALLERY2, z);
      for (let level = 0; level < 3; level++)
        add('3062b', level % 2 ? LIGHT_STONE : TAN, x, GALLERY2 + 18 + level * 3, z);
      add('4589', LIGHT_STONE, x, GALLERY2 + 27, z);
    }
    // And on the lantern's deck.
    for (const [x, z] of [
      [c0, d0],
      [c1, d0],
      [c0, d1],
      [c1, d1],
    ])
      post(x, CROWN, z, 2);

    // ---- The street: lampposts, planters, a bench, a post box, bollards, a café table, a market
    // stall, trees in pits and on the square, a low wall at the back, plants.
    const lamp = (x: number, z: number) => add('2039', BLACK, x, BASE, z);
    lamp(8, 9);
    lamp(24, 9);
    // Planters: a round brick tub with soil and flowers.
    for (const [x, z, flower] of [
      [12, 9, YELLOW],
      [18, 9, RED],
    ] as [number, number, number][]) {
      add('3941', BRICK, x, BASE, z);
      add('3022', DARK_BROWN, x, BASE + 3, z);
      add('24866', flower, x - 0.5, BASE + 4, z - 0.5);
    }
    // A bench: two plates on end blocks, a back of tiles.
    add('3005', DARK_BROWN, 20, BASE, 9);
    add('3005', DARK_BROWN, 23, BASE, 9);
    for (const x of [20, 23]) {
      add('3005', DARK_BROWN, x, BASE, 10);
      add('3005', DARK_BROWN, x, BASE + 3, 10);
    }
    addRun(add, 'plate', BRICK, 'x', 20, BASE + 3, 9, 4);
    addRun(add, 'tile', DARK_BROWN, 'x', 20, BASE + 6, 10, 4);
    // A post box, bollards, a bin.
    add('3005', RED, 29, BASE, 9);
    add('3062b', RED, 29, BASE + 3, 9);
    add('4589', BLACK, 29, BASE + 6, 9);
    for (const [x, z] of [
      [2, 7],
      [29, 7],
    ] as [number, number][]) {
      add('3062b', DARK_STONE, x, BASE, z);
      add('6141', WHITE, x, BASE + 3, z);
    }
    add('3062b', DARK_GRASS, 6, BASE, 10);
    add('6141', DARK_STONE, 6, BASE + 3, 10);
    // A café table with a round top and two stools.
    add('4032a', DARK_STONE, 1, BASE, 9);
    add('3062b', DARK_STONE, 1, BASE + 1, 9);
    add('4150', WHITE, 1, BASE + 4, 9);
    for (const [x, z] of [
      [3, 9],
      [3, 10],
    ] as [number, number][]) {
      add('3062b', RED, x, BASE, z);
      add('98138', GOLD, x, BASE + 3, z);
    }
    // A market stall on the square: four posts, a counter with goods and a striped awning.
    const SX = 24;
    const SZ = 14;
    for (const [x, z] of [
      [SX, SZ],
      [SX + 3, SZ],
      [SX, SZ + 3],
      [SX + 3, SZ + 3],
    ])
      for (let level = 0; level < 3; level++) add('3005', DARK_BROWN, x, BASE + level * 3, z);
    addRun(add, 'brick', BRICK, 'x', SX + 1, BASE, SZ + 3, 2);
    addRun(add, 'plate', TAN, 'x', SX + 1, BASE + 3, SZ + 3, 2);
    for (let i = 1; i < 3; i++)
      add(i % 2 ? '6141' : '98138', [RED, YELLOW, GRASS, WHITE][i]!, SX + i, BASE + 4, SZ + 3);
    addRun(add, 'plate', DARK_BROWN, 'x', SX, BASE + 9, SZ, 4);
    for (let i = 0; i < 4; i++) add('3623', i % 2 ? WHITE : RED, SX + i, BASE + 10, SZ, 0);
    // Crates by the stall.
    add('3003', DARK_BROWN, SX + 1, BASE, SZ + 1);
    add('3003', BRICK, SX + 4, BASE, SZ + 4);

    // A low wall along the back of the square, with piers and a tile cap.
    for (let level = 0; level < 2; level++)
      addRun(add, 'brick', level ? STONE : DARK_STONE, 'x', 0, BASE + level * 3, SIZE - 1, SIZE);
    addRun(add, 'plate', LIGHT_STONE, 'x', 0, BASE + 6, SIZE - 1, SIZE);
    for (let x = 0; x < SIZE; x += 8) {
      add('3005', LIGHT_STONE, x, BASE + 7, SIZE - 1);
      add('4589', LIGHT_STONE, x, BASE + 10, SIZE - 1);
    }

    // Trees: a pair in pits on the pavement and a pair on the square's grass beds.
    // The tower and the edge of the board are solid ground to the crowns.
    const around = [
      { u0: 9, u1: 23, v0: 9, v1: 24, y0: BASE, y1: 300 },
      { u0: -30, u1: 0, v0: -30, v1: 60, y0: 0, y1: 300 },
      { u0: SIZE, u1: 60, v0: -30, v1: 60, y0: 0, y1: 300 },
      { u0: -30, u1: 60, v0: -30, v1: 0, y0: 0, y1: 300 },
      { u0: -30, u1: 60, v0: SIZE, v1: 60, y0: 0, y1: 300 },
    ];
    for (const [x, z] of [
      [5, 8],
      [27, 8],
    ] as [number, number][]) {
      add('3022', DARK_GRASS, x, BASE, z);
      addTree(add, x, z, BASE + 1, [DARK_GRASS, GRASS, 10], DARK_BROWN, 5, x, around, {
        foot: false,
        radii: [1.4, 1.9, 1.7, 1.3],
      });
    }
    for (const [x, z] of [
      [4, 25],
      [25, 25],
    ] as [number, number][])
      addTree(add, x, z, BASE, [DARK_GRASS, GRASS, 10], DARK_BROWN, 9, x + z, around, {
        foot: false,
        gnarled: true,
        accent: { color: RED, chance: 0.1 },
        radii: [2, 2.6, 2.4, 1.8],
        solid: (x2, z2) => bed(x2, z2),
      });
    // Drains and a manhole in the road, and paving of mixed shapes on the square.
    for (const x of [7, 25]) add('2412b', BLACK, x, 2, 5, 90);
    add('14769', STONE, 17, 2, 3);
    for (const [part, color, x, z] of [
      ['87079', TAN, 3, 14],
      ['3068b', DARK_TAN, 7, 14],
      ['66857', LIGHT_STONE, 3, 17],
      ['5520', TAN, 7, 17],
      ['1126', DARK_TAN, 3, 19],
      ['27925', LIGHT_STONE, 5, 19],
      ['67095', TAN, 7, 19],
      ['24246', DARK_TAN, 3, 21],
      ['25269', LIGHT_STONE, 4, 21],
      ['6636', TAN, 22, 24],
      ['3068b', LIGHT_STONE, 22, 20],
      ['87079', DARK_TAN, 26, 20],
      ['1126', TAN, 22, 22],
      ['98138', DARK_TAN, 25, 22],
      ['14769', TAN, 27, 22],
      ['2431', LIGHT_STONE, 28, 12],
      ['63864', DARK_TAN, 28, 14],
    ] as [string, number, number, number][])
      tryAdd(part, color, x, 1 + 1, z);

    // Bushes, ferns, grass and flowers on the beds, each where it fits.
    const studs: [number, number][] = [];
    for (let sz = 22; sz < 30; sz++) for (let sx = 0; sx < SIZE; sx++) studs.push([sx, sz]);
    studs.sort((a, b) => hash(a[0], a[1], 31) - hash(b[0], b[1], 31));
    for (const [part, color, [dx, dz], count] of [
      ['6064', DARK_GRASS, [1.5, 1.5], 2],
      ['6255', 330, [2, 1.5], 2],
      ['30093', GRASS, [1.5, 0], 3],
      ['24866', RED, [0.5, 0.5], 3],
      ['24866', YELLOW, [0.5, 0.5], 3],
      ['24866', WHITE, [0.5, 0.5], 2],
      ['32607', GRASS, [0, 1], 2],
    ] as [string, number, [number, number], number][]) {
      let placed = 0;
      for (const [sx, sz] of studs) {
        if (placed >= count) break;
        if (bed(sx, sz) && tryAdd(part, color, sx - dx, BASE, sz - dz)) placed++;
      }
    }

    order.flush();
  },
};
