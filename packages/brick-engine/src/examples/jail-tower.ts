import { footprint, isMatchingInsertFrame, seatOnSideStuds } from '../core.ts';
import type { Brick, Facing, Rotation } from '../core.ts';
import { addRowMap, addRun, bottomUp } from './layout.ts';
import type { ExampleBrickAdder, ExampleDefinition } from './types.ts';

// A medieval jail tower, ten studs square and nineteen bricks tall, in a small gravelled yard.
// Every face is its own: the front has a framed door in a stone portal; the right has two
// buttresses and a loophole; the back has a tan lower storey, a chimney breast and a window; the
// left has dark stone below, two barred windows at stepped heights and a climb of ivy. All four
// share string courses, a corbel table under an overhanging crenellated deck, a round turret, a
// chimney and a flag. The tower is two thirds of the pieces; the yard is the rest.
const SIZE = 32;
/** The plan is drawn from a 20-stud corner; the board puts it this far in. */
const OFF = (SIZE - 20) / 2;
/** The two-layer plate floor under the plan. */
const FLOOR = 2;

const BEDROCK = 72;
const STONE = 71;
const DARK_STONE = 72;
const LIGHT_STONE = 151;
const TAN = 19;
const DARK_TAN = 28;
const EARTH = 70;
const DARK_EARTH = 308;
const NOUGAT = 84;
const GRASS = 2;
const DARK_GRASS = 288;
const OLIVE = 330;
const RED = 4;
const BLACK = 0;
const LAMP = 46;

const hash = (a: number, b: number, c: number) => {
  let h =
    Math.imul(a + 131, 374761393) ^ Math.imul(b + 241, 668265263) ^ Math.imul(c + 337, 2147483629);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// The tower's ring of wall: x and z from T0 to T1, with cells U0 to U1 between the corners.
const T0 = 5;
const T1 = 14;
const U0 = 6;
const U1 = 13;
/** The overhanging deck runs this far out and in: from F0 to F1 on both axes. */
const F0 = T0 - 2;
const F1 = T1 + 2;

type Face = 'F' | 'B' | 'L' | 'R';
/** The turn that leans a slope's low side outwards from a face. */
const OUTWARD: Record<Face, Rotation> = { F: 0, B: 180, L: 90, R: 270 };
const FACES: Face[] = ['F', 'B', 'L', 'R'];
const FACING: Record<Face, Facing> = { F: '-z', B: '+z', L: '-x', R: '+x' };
const alongX = (face: Face) => face === 'F' || face === 'B';
/** The wall cell of a face at position `u` along it. */
const cell = (face: Face, u: number): [number, number] =>
  face === 'F' ? [u, T0] : face === 'B' ? [u, T1] : face === 'L' ? [T0, u] : [T1, u];

// The courtyard: a blob of ground round the tower, bare bedrock at the board's edge.
const onGround = (x: number, z: number) =>
  Math.hypot(x - 9.5, z - 9.5) < 11.6 - 2.4 * hash(Math.floor(x / 3), Math.floor(z / 3), 5);
const onPath = (x: number, z: number) => x >= 8 && x <= 11 && z >= -3 && z <= 3;
const inTower = (x: number, z: number) => x >= T0 - 1 && x <= T1 + 1 && z >= T0 - 1 && z <= T1 + 1;

const groundChar = (x: number, z: number) => {
  const d = Math.hypot(x - 9.5, z - 9.5);
  const roll = hash(Math.floor(x / 2), Math.floor(z / 2), 3);
  if (d < 8) return roll < 0.3 ? 'V' : roll > 0.9 ? 't' : 'v';
  if (d < 10.5) return roll < 0.35 ? 'E' : roll > 0.85 ? 'n' : 'e';
  return roll < 0.3 ? 'G' : 'g';
};

/** Rubble: Light Bluish Grey with dark patches low down and tan and light ones high up. */
const stone = (x: number, y: number, z: number) => {
  const patch = hash(Math.floor(x / 2) + 3 * y, Math.floor(z / 2), 7);
  const dark = 0.36 - y * 0.006;
  const light = 0.87 + y * 0.002;
  return patch < dark ? DARK_STONE : patch > light ? (hash(x, y, z) < 0.5 ? TAN : DARK_TAN) : STONE;
};

/** The wall colour of a cell: each face has its own lower storey. */
const wallColor = (face: Face, course: number, x: number, z: number) => {
  const patch = hash(Math.floor(x / 2) + 3 * course, Math.floor(z / 2), 11);
  if (face === 'B' && course < 6) return patch < 0.3 ? DARK_TAN : patch > 0.93 ? STONE : TAN;
  if (face === 'L' && course < 6)
    return patch < 0.28 ? STONE : patch > 0.94 ? LIGHT_STONE : DARK_STONE;
  return stone(x, course * 3, z);
};

type Piece = {
  partId: string;
  color: number;
  x: number;
  y: number;
  z: number;
  rotation: Rotation;
};

type Claim = { kind: 'open' } | { kind: 'host'; leaf: 'ivy' | 'lamp' | 'sill' } | { kind: 'quoin' };

export const jailTower: ExampleDefinition = {
  id: 'jail-tower',
  name: 'Jail Tower',
  tags: ['medieval', 'tower', 'jail', 'stone', 'barred-windows', 'courtyard', 'landscape'],
  expectedPieceCount: 813,
  buildArea: SIZE,
  brickIdPrefix: 'jail',
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
      order.add(partId, color, x + OFF, y + FLOOR - 1, z + OFF, rotation, facing, ...rest);
    };
    const tryAdd = (partId: string, color: number, x: number, y: number, z: number) => {
      const size = footprint({ id: '', partId, color, x, y, z, rotation: 0 });
      const inside =
        x >= -OFF && z >= -OFF && x + size.width <= SIZE - OFF && z + size.depth <= SIZE - OFF;
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

    // The floor under the plan: 32 x 32 in two layers of big plates, every seam of the top over
    // the middle of a plate below. It is the board's bedrock.
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

    // The courtyard, a plate high: gravel by the tower, earth round it, grass at the edge, and a
    // path of tan tiles to the door.
    const counted = add;
    const ground: string[] = [];
    for (let row = 0; row < 20; row++) {
      let line = '';
      for (let col = 0; col < 20; col++) {
        if (onPath(col, row) && row <= 1)
          line += (col + row) % 2 || hash(col, row, 9) < 0.3 ? 'p' : 'q';
        else if (!onGround(col, row) && !inTower(col, row)) line += ' ';
        else line += groundChar(col, row);
      }
      ground.push(line);
    }
    const onBoard: ExampleBrickAdder = (partId, color, x, y, z, ...rest) =>
      counted(partId, color, x, y, z, ...rest);
    addRowMap(onBoard, ground, 1, {
      v: ['plate', STONE],
      V: ['plate', DARK_STONE],
      t: ['plate', TAN],
      e: ['plate', EARTH],
      E: ['plate', DARK_EARTH],
      n: ['plate', NOUGAT],
      g: ['plate', GRASS],
      G: ['plate', DARK_GRASS],
      p: ['tile', TAN],
      q: ['tile', DARK_TAN],
    });
    const base = 2;
    /** The height of the bottom of a wall course; each string course adds a plate above it. */
    const yOf = (course: number) =>
      base + course * 3 + (course >= 6 ? 1 : 0) + (course >= 12 ? 1 : 0) + (course >= 18 ? 1 : 0);
    const COURSES = 18;
    const cap = COURSES; // the cap course under the deck

    // A plinth of dark plates one stud proud of the walls, left open at the door and the breast.
    for (const [x, z, length, axis] of [
      [T0, T0 - 1, 3, 'x'],
      [12, T0 - 1, 3, 'x'],
      [T0 - 1, T0 - 1, T1 - T0 + 3, 'z'],
      [T1 + 1, T0 - 1, T1 - T0 + 3, 'z'],
      [T0, T1 + 1, 3, 'x'],
      [10, T1 + 1, 5, 'x'],
    ] as [number, number, number, 'x' | 'z'][])
      addRun(add, 'plate', DARK_STONE, axis, x, base, z, length);

    // ---- The faces, planned: what is claimed here is left out of the plain wall and then placed
    // by hand below.
    const claims = new Map<string, Claim>();
    const key = (face: Face, u: number, course: number) => `${face}${u},${course}`;
    const claim = (face: Face, u0: number, u1: number, c0: number, c1: number, what: Claim) => {
      for (let u = u0; u <= u1; u++)
        for (let c = c0; c <= c1; c++) {
          if (claims.has(key(face, u, c))) throw new Error(`Claimed twice: ${face} ${u},${c}.`);
          claims.set(key(face, u, c), what);
        }
    };
    const host = (face: Face, u: number, course: number, leaf: 'ivy' | 'lamp' | 'sill') =>
      claim(face, u, u, course, course, { kind: 'host', leaf });

    const windows: [Face, number, number][] = [
      ['F', 8, 8],
      ['R', 8, 8],
      ['B', 10, 8],
      ['L', 6, 2],
      ['L', 10, 8],
    ];
    for (const [face, u, course] of windows) {
      claim(face, u, u + 3, course, course + 2, { kind: 'open' });
      claim(face, u, u + 3, course + 3, course + 3, { kind: 'open' });
      for (let i = 0; i < 4; i++) host(face, u + i, course - 1, 'sill');
    }
    const slits: [Face, number, number, number][] = [
      ['F', 6, 13, 14],
      ['F', 12, 13, 14],
      ['R', 9, 3, 3],
      ['R', 9, 13, 14],
      ['B', 6, 8, 8],
      ['B', 11, 13, 14],
      ['L', 9, 13, 14],
      ['L', 6, 8, 9],
    ];
    for (const [face, u, c0, c1] of slits) claim(face, u, u + 1, c0, c1, { kind: 'open' });
    // The door: a frame the width of four studs, six bricks tall, in a stone portal.
    claim('F', 8, 11, 0, 5, { kind: 'open' });
    // Lanterns beside the portal.
    host('F', 6, 3, 'lamp');
    host('F', 13, 3, 'lamp');
    host('B', 12, 4, 'lamp');
    host('L', 13, 6, 'lamp');
    // Ivy climbing the left face and the right face's lower corner.
    for (const [u, c] of [
      [10, 1],
      [11, 2],
      [10, 3],
      [11, 3],
      [11, 5],
      [12, 6],
      [13, 7],
    ] as [number, number][])
      if (!claims.has(key('L', u, c))) host('L', u, c, 'ivy');
    for (const [u, c] of [
      [8, 1],
      [11, 1],
      [8, 2],
      [11, 3],
      [11, 4],
    ] as [number, number][])
      if (!claims.has(key('R', u, c))) host('R', u, c, 'ivy');
    // Light quoin cells beside the corners on every odd course: long and short bricks alternate.
    for (const face of FACES)
      for (const u of [U0, U1])
        for (let c = 1; c <= cap; c += 2)
          if (!claims.has(key(face, u, c))) claims.set(key(face, u, c), { kind: 'quoin' });

    // ---- The plain wall: a hollow ring one brick thick, a course every three plates.
    for (let c = 0; c <= cap; c++) {
      const y = c === cap ? yOf(18) : yOf(c);
      for (const [x, z] of [
        [T0, T0],
        [T1, T0],
        [T0, T1],
        [T1, T1],
      ])
        add('3005', c % 2 ? STONE : LIGHT_STONE, x, y, z);
      for (const face of FACES) {
        const horizontal = alongX(face);
        let u = U0;
        while (u <= U1) {
          const claimed = claims.get(key(face, u, c));
          const [x, z] = cell(face, u);
          if (claimed?.kind === 'host') {
            const piece = sideStud(x, y, z, FACING[face], wallColor(face, c, x, z));
            if (claimed.leaf === 'lamp') mount(piece, '3062b', LAMP, FACING[face]);
            else if (claimed.leaf === 'sill') mount(piece, '3024', LIGHT_STONE, FACING[face]);
            else {
              const leaf = hash(x, y, z);
              mount(
                piece,
                leaf < 0.4 ? '6141' : leaf < 0.75 ? '54200' : '3024',
                c < 4 ? OLIVE : leaf < 0.5 ? DARK_GRASS : GRASS,
                FACING[face],
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
          while (u + run <= U1 && !claims.has(key(face, u + run, c))) run++;
          const max = c % 2 ? 3 : 4;
          let left = run;
          let start = u;
          while (left > 0) {
            const size = [4, 3, 2, 1].find((s) => s <= left && s <= max)!;
            const [px, pz] = cell(face, start);
            const roll = hash(start, y, px + pz);
            const plain = roll < 0.22;
            const part =
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
            add(part, wallColor(face, c, px, pz), px, y, pz, horizontal && size > 1 ? 90 : 0);
            start += size;
            left -= size;
          }
          u += run;
        }
      }
    }

    // ---- The front: a door in its frame under a stone portal.
    const frame: Piece = { partId: '60596', color: DARK_STONE, x: 8, y: base, z: T0, rotation: 90 };
    add(frame.partId, frame.color, frame.x, frame.y, frame.z, frame.rotation);
    let fitted = false;
    for (const rotation of [90, 270] as Rotation[])
      for (const dx of [0, -0.5, 0.5, -1, 1])
        for (const dz of [0, -0.5, 0.5, -1, 1]) {
          if (fitted) break;
          const candidate: Brick = {
            id: 'door',
            partId: '60616a',
            color: DARK_EARTH,
            x: frame.x + dx,
            y: frame.y,
            z: frame.z + dz,
            rotation,
          };
          if (isMatchingInsertFrame(candidate, { id: 'frame', ...frame })) {
            add('60616a', DARK_EARTH, candidate.x, candidate.y, candidate.z, rotation);
            fitted = true;
          }
        }
    if (!fitted) throw new Error('No fit for the jail door.');
    // Two steps up to the door: slopes and plates on the path.
    add('3039', STONE, 8, base, T0 - 3, 180);
    add('3039', STONE, 10, base, T0 - 3, 180);
    // Two pillars a stud out from the wall flank the frame, with a light lintel across them that
    // doubles as the front's first string course.
    for (const x of [7, 12])
      for (let level = 0; level < 6; level++)
        add('3005', stone(x, level, 3), x, base + 1 + level * 3, T0 - 1);
    add('3455', LIGHT_STONE, 7, base + 19, T0 - 1, 90);

    // ---- Windows: a four-wide frame with a pane of bars at each end, one turned upside down; a
    // light lintel above and a sill of plates on side studs below (planned above).
    for (const [face, u, course] of windows) {
      const [x, z] = cell(face, u);
      const horizontal = alongX(face);
      const rotation: Rotation = horizontal ? 90 : 0;
      const y = yOf(course);
      add('60594', DARK_STONE, x, y, z, rotation);
      add('60608', BLACK, horizontal ? x + 2 : x, y, horizontal ? z : z + 2, rotation);
      add('60608', BLACK, x, y, z, rotation, undefined, true);
      add('3010', LIGHT_STONE, x, yOf(course + 3), z, rotation);
    }
    // Loopholes: grille bricks across two cells, a stack of one or two.
    for (const [face, u, c0, c1] of slits)
      for (let c = c0; c <= c1; c++) {
        const [x, z] = cell(face, u);
        add('2877', DARK_STONE, x, yOf(c), z, alongX(face) ? 90 : 0);
      }

    // ---- Relief: buttresses on the right face, topped with cheese slopes under the string
    // course; the chimney breast on the back face, rising to a pitched cap.
    for (const z of [6, 12]) {
      for (let level = 0; level < 11; level++)
        add('3004', stone(T1 + 1, level, z), T1 + 1, base + 1 + level * 3, z);
      for (let i = 0; i < 2; i++) add('54200', LIGHT_STONE, T1 + 1, base + 34, z + i, 270);
    }
    for (let level = 0; level < 5; level++)
      add('3004', stone(T0 - 1, level, 12), T0 - 1, base + 1 + level * 3, 12);
    for (let i = 0; i < 2; i++) add('54200', LIGHT_STONE, T0 - 1, base + 16, 12 + i, 90);
    for (let level = 0; level < 14; level++)
      add('3003', hash(8, level, 16) < 0.3 ? DARK_STONE : STONE, 8, base + level * 3, T1 + 1);
    add('3022', LIGHT_STONE, 8, base + 42, T1 + 1);

    // ---- String courses: one at the foot of course 6, one at 12, one under the cap course.
    // They are flush bands on the front and back, and step a stud out on the left, the right (the
    // upper two) and, under the deck, on every face.
    const projecting = (ring: number, face: Face) =>
      ring === 3 || ((face === 'L' || face === 'B') && ring <= 2) || (face === 'R' && ring === 2);
    for (const ring of [1, 2, 3]) {
      const y = yOf(ring * 6 - 1) + 3;
      const color = ring === 2 ? STONE : LIGHT_STONE;
      const leftOut = projecting(ring, 'L');
      const rightOut = projecting(ring, 'R');
      // Corner blocks, two studs square, wherever a neighbouring face steps out.
      for (const [cx, cz, out] of [
        [T0 - 1, T0 - 1, leftOut || projecting(ring, 'F')],
        [T1, T0 - 1, rightOut || projecting(ring, 'F')],
        [T0 - 1, T1, leftOut || projecting(ring, 'B')],
        [T1, T1, rightOut || projecting(ring, 'B')],
      ] as [number, number, boolean][])
        if (out) add('3022', color, cx, y, cz);
      for (const face of FACES) {
        if (projecting(ring, face)) {
          // The back steps out round the chimney breast: a block on its left, the breast between.
          if (face === 'B' && ring < 3) {
            add('3022', color, 6, y, T1);
            addRun(add, 'plate', color, 'x', 8, y, T1, 2);
            add('3020', color, 10, y, T1, 90);
            continue;
          }
          for (const u of [6, 10]) {
            const [x, z] = cell(face, u);
            if (alongX(face)) add('3020', color, x, y, face === 'F' ? z - 1 : z, 90);
            else add('3020', color, face === 'L' ? x - 1 : x, y, z, 0);
          }
        } else if (alongX(face)) {
          const from = leftOut || projecting(ring, 'F') ? T0 + 1 : T0;
          const to = rightOut || projecting(ring, 'F') ? T1 - 1 : T1;
          // The front's portal lintel stands where the first band would, so it keeps its own.
          addRun(add, 'plate', color, 'x', from, y, face === 'F' ? T0 : T1, to - from + 1);
        } else addRun(add, 'plate', color, 'z', face === 'L' ? T0 : T1, y, U0, U1 - U0 + 1);
      }
    }

    // ---- The corbel table: inverted slopes under the overhang on every face, one per two studs.
    const yCorbel = yOf(cap);
    for (const face of FACES)
      for (const u of [6, 8, 10, 12, 13]) {
        const [x, z] = cell(face, u);
        if (face === 'F') add('3665a', STONE, x, yCorbel, z - 2, 0);
        else if (face === 'B') add('3665a', STONE, x, yCorbel, z + 1, 180);
        else if (face === 'L') add('3665a', STONE, x - 2, yCorbel, z, 90);
        else add('3665a', STONE, x + 1, yCorbel, z, 270);
      }

    // ---- The deck: two layers of one-stud plates across the hollow, the lower along x and the
    // upper along z so each crosses every run of the other; the walls and corbels carry it.
    const deck = yCorbel + 3;
    for (let z = F0; z <= F1; z++) addRun(add, 'plate', DARK_STONE, 'x', F0, deck, z, F1 - F0 + 1);
    for (let x = F0; x <= F1; x++) addRun(add, 'plate', STONE, 'z', x, deck + 1, F0, F1 - F0 + 1);
    const top = deck + 2;

    // Crenellations: merlons in two courses with tile caps, a gap every two studs.
    const merlons = (face: Face) => {
      const fixed = face === 'F' ? F0 : face === 'B' ? F1 : face === 'L' ? F0 : F1;
      const from = alongX(face) ? F0 : F0 + 1;
      const to = alongX(face) ? F1 : F1 - 1;
      let u = from;
      while (u <= to) {
        if ((u - F0) % 4 > 1) {
          u++;
          continue;
        }
        const long = u + 1 <= to && (u + 1 - F0) % 4 <= 1 && (u - F0) % 4 === 0;
        const length = long ? 2 : 1;
        const [x, z] = alongX(face) ? [u, fixed] : [fixed, u];
        for (const level of [0, 1])
          add(
            length === 2 ? '3004' : '3005',
            stone(x, level + 20, z),
            x,
            top + level * 3,
            z,
            alongX(face) && length === 2 ? 90 : 0,
          );
        // A cheese slope on each merlon cell, leaning outwards.
        for (let i = 0; i < length; i++) {
          const [sx, sz] = alongX(face) ? [x + i, z] : [x, z + i];
          add('54200', LIGHT_STONE, sx, top + 6, sz, OUTWARD[face]);
        }
        u += length;
      }
    };
    for (const face of FACES) merlons(face);

    // The roof furniture: a round turret with a cone, a chimney with a pot over the breast, a
    // flag on a pole in one corner.
    for (let level = 0; level < 4; level++)
      add('3941', level % 2 ? STONE : DARK_STONE, 9, top + level * 3, 8);
    add('3942c', DARK_STONE, 9, top + 12, 8);
    for (let level = 0; level < 3; level++)
      add('3003', level % 2 ? DARK_STONE : STONE, 8, top + level * 3, 12);
    add('3022', DARK_STONE, 8, top + 9, 12);
    add('3062b', BLACK, 8, top + 10, 12);
    add('3062b', BLACK, 9, top + 10, 13);
    add('4589', BLACK, F0 + 1, top, F0 + 1);
    add('3957a', BLACK, F0 + 1, top + 3, F0 + 1);
    add('2335', RED, F0 + 1, top + 9, F0 + 1, 90);

    // ---- The yard: a barrel and crates by the door, lampposts on the path, rocks, pines, a few
    // plants. Kept small so the tower is the build.
    counted('3941', EARTH, 13, base, 2);
    counted('3941', DARK_EARTH, 13, base + 3, 2);
    counted('4032a', EARTH, 13, base + 6, 2);
    counted('3022', EARTH, 3, base, 2);
    counted('3022', DARK_EARTH, 3, base + 1, 2);
    for (const [x, z] of [
      [6, 1],
      [12, 0],
    ])
      counted('2039', BLACK, x, base, z);
    const yard = (partId: string, color: number, x: number, z: number) =>
      tryAdd(partId, color, x, base, z);
    for (const [x, z, base1, top1] of [
      [15, 8, '3002', '15068'],
      [1, 13, '3002', '54200'],
      [15, 15, '3003', '85984'],
    ] as [number, number, string, string][]) {
      if (!onGround(x, z) || !onGround(x + 1, z + 1) || inTower(x, z)) continue;
      if (yard(base1, hash(x, z, 2) < 0.5 ? DARK_STONE : STONE, x, z))
        tryAdd(top1, LIGHT_STONE, x, base + 3, z);
    }
    // Pines plug into a stud in the middle of their five-stud base.
    for (const [x, z] of [
      [2, 6],
      [18, 6],
      [4, 18],
    ] as [number, number][])
      if (onGround(x, z)) yard('3471', DARK_GRASS, x - 2, z - 2);
    // Bushes, ferns and tall grass between the pines, each where it fits on bare ground.
    const studs: [number, number][] = [];
    for (let sz = 0; sz < 20; sz++) for (let sx = 0; sx < 20; sx++) studs.push([sx, sz]);
    studs.sort((a, b) => hash(a[0], a[1], 31) - hash(b[0], b[1], 31));
    for (const [part, color, [dx, dz], count] of [
      ['6064', DARK_GRASS, [1.5, 1.5], 3],
      ['6255', OLIVE, [2, 1.5], 3],
      ['30093', GRASS, [1.5, 0], 3],
      ['24866', RED, [0.5, 0.5], 2],
      ['24866', 14, [0.5, 0.5], 2],
      ['4727', OLIVE, [0.5, 0.5], 2],
      ['32607', GRASS, [0, 1], 2],
    ] as [string, number, [number, number], number][]) {
      let placed = 0;
      for (const [sx, sz] of studs) {
        if (placed >= count) break;
        if (onGround(sx, sz) && !inTower(sx, sz) && !onPath(sx, sz) && !onPath(sx, sz + 1))
          if (tryAdd(part, color, sx - dx, base, sz - dz)) placed++;
      }
    }

    order.flush();
  },
};
