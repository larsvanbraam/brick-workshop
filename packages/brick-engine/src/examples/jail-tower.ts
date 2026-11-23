import { footprint, isMatchingInsertFrame, seatOnSideStuds } from '../core.ts';
import type { Brick, Facing, Rotation } from '../core.ts';
import { addRowMap, addRun, bottomUp } from './layout.ts';
import type { ExampleBrickAdder, ExampleDefinition } from './types.ts';

// A squat medieval jail tower in a gravelled courtyard: rubble stone with light quoins on a
// battered plinth, a heavy door in its frame, barred windows on three storeys, an overhanging
// parapet with merlons and a small round turret on the roof, ivy and a lantern on side studs,
// pines, rocks and a fence round the edge. The board is 24 studs square, front at low z.
const SIZE = 24;
/** The plan is drawn from a 16-stud corner; the board puts it this far in. */
const OFF = (SIZE - 16) / 2;
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

// The courtyard: a blob of ground with bays, bare bedrock at the board's edge.
const onGround = (x: number, z: number) =>
  Math.sqrt((x - 7.5) ** 2 * 0.9 + (z - 7.5) ** 2 * 1) <
  12.2 - 3 * hash(Math.floor(x / 3), Math.floor(z / 3), 5);
const onPath = (x: number, z: number) => (x === 7 || x === 8) && z >= -3 && z <= 3;
const inTower = (x: number, z: number) => x >= 4 && x <= 11 && z >= 4 && z <= 11;

const groundChar = (x: number, z: number) => {
  const d = Math.hypot(x - 7.5, z - 7.5);
  const roll = hash(Math.floor(x / 2), Math.floor(z / 2), 3);
  if (d < 6.5) return roll < 0.3 ? 'V' : roll > 0.9 ? 't' : 'v';
  if (d < 9.5) return roll < 0.35 ? 'E' : roll > 0.85 ? 'n' : 'e';
  return roll < 0.3 ? 'G' : 'g';
};

/** Rubble: Light Bluish Grey with dark patches low down and tan and light ones high up. */
const stone = (x: number, y: number, z: number) => {
  const patch = hash(Math.floor(x / 2) + 3 * y, Math.floor(z / 2), 7);
  const dark = 0.36 - y * 0.008;
  const light = 0.87 + y * 0.003;
  return patch < dark ? DARK_STONE : patch > light ? (hash(x, y, z) < 0.5 ? TAN : DARK_TAN) : STONE;
};

type Piece = {
  partId: string;
  color: number;
  x: number;
  y: number;
  z: number;
  rotation: Rotation;
};

export const jailTower: ExampleDefinition = {
  id: 'jail-tower',
  name: 'Jail Tower',
  tags: ['medieval', 'tower', 'jail', 'stone', 'barred-windows', 'courtyard', 'landscape'],
  expectedPieceCount: 486,
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

    // A 24 x 24 floor in two layers, every seam of the top over the middle of a plate below.
    const plates: [string, number, number, number, Rotation][] = [
      ['41539', 0, 0, 0, 0],
      ['92438', 8, 0, 0, 90],
      ['92438', 0, 8, 0, 0],
      ['91405', 8, 8, 0, 0],
      ['91405', 0, 0, 1, 0],
      ['92438', 16, 0, 1, 0],
      ['92438', 0, 16, 1, 90],
      ['41539', 16, 16, 1, 0],
    ];
    for (const [partId, x, z, y, rotation] of plates) order.add(partId, BEDROCK, x, y, z, rotation);

    // The courtyard, a plate high: gravel by the tower, earth round it, grass at the edge, and a
    // path of tan tiles to the door.
    const ground: string[] = [];
    for (let row = 0; row < SIZE; row++) {
      let line = '';
      for (let col = 0; col < SIZE; col++) {
        const x = col - OFF;
        const z = row - OFF;
        if (onPath(x, z)) line += (x + z) % 2 || hash(x, z, 9) < 0.3 ? 'p' : 'q';
        else if (!onGround(x, z) && !inTower(x, z)) line += ' ';
        else line += groundChar(x, z);
      }
      ground.push(line);
    }
    const onBoard: ExampleBrickAdder = (partId, color, x, y, z, ...rest) =>
      add(partId, color, x - OFF, y, z - OFF, ...rest);
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

    // A plinth of dark plates one stud proud of the walls.
    for (const [x, z, length, axis] of [
      [5, 4, 1, 'x'],
      [10, 4, 1, 'x'],
      [5, 11, 6, 'x'],
      [4, 5, 6, 'z'],
      [11, 5, 6, 'z'],
    ] as [number, number, number, 'x' | 'z'][])
      addRun(add, 'plate', DARK_STONE, axis, x, base, z, length);

    // Ivy hosts: side-stud bricks in the wall, one cell each, and lantern hosts by the door.
    const hosts = new Map<string, Facing>();
    for (const [x, y, z, facing] of [
      [5, 11, 6, '-x'],
      [5, 5, 9, '-x'],
      [10, 8, 6, '+x'],
      [10, 11, 9, '+x'],

      [5, 8, 5, '-x'],
      [10, 5, 5, '+x'],
      [5, 11, 5, '-x'],
      [10, 11, 5, '+x'],
      [5, 14, 5, '-x'],
      [6, 8, 10, '+z'],
      [9, 11, 10, '+z'],
      [6, 14, 10, '+z'],
      [9, 5, 10, '+z'],
      [5, 14, 9, '-x'],
      [5, 8, 6, '-x'],
      [10, 14, 6, '+x'],
      [10, 5, 9, '+x'],
      [5, 17, 9, '-x'],
      [5, 20, 6, '-x'],
      [10, 17, 6, '+x'],
      [10, 20, 9, '+x'],
      [6, 17, 10, '+z'],
      [9, 20, 10, '+z'],

      [10, 14, 5, '+x'],
    ] as [number, number, number, Facing][])
      hosts.set(`${x},${y},${z}`, facing);

    // The walls: a hollow ring 6 studs square, a course every three plates, light quoins at the
    // corners, a door in the front, barred windows, loopholes of grille bricks.
    const DOOR_COURSES = 6;
    const WINDOW_COURSES = [7, 8, 9];
    const windowAt = (x: number, z: number, course: number) =>
      WINDOW_COURSES.includes(course) &&
      (((z === 5 || z === 10) && x >= 6 && x <= 9) || ((x === 5 || x === 10) && z >= 6 && z <= 9));
    const slitAt = (x: number, z: number, course: number) =>
      course === 3 && ((x === 5 && z === 6) || (x === 10 && z === 7) || (z === 10 && x === 6));
    const courses = 14;
    for (let course = 0; course < courses; course++) {
      // The stringcourse plates sit between course 9 and 10, so the courses above rise a plate.
      const y = base + course * 3 + (course >= 10 ? 1 : 0);
      for (const [x, z] of [
        [5, 5],
        [10, 5],
        [5, 10],
        [10, 10],
      ]) {
        const facing = hosts.get(`${x},${y},${z}`);
        if (facing) {
          const host = sideStud(x, y, z, facing, course % 2 ? STONE : LIGHT_STONE);
          // The two corners by the door carry lanterns; the rest, ivy.
          if (y === 14) mount(host, '3062b', LAMP, facing);
          else mount(host, '6141', y < 10 ? OLIVE : DARK_GRASS, facing);
        } else add('3005', course % 2 ? STONE : LIGHT_STONE, x, y, z);
      }
      const walls: ['x' | 'z', number][] = [
        ['x', 5],
        ['x', 10],
        ['z', 5],
        ['z', 10],
      ];
      for (const [axis, fixed] of walls) {
        let cell = 0;
        const blocked = (at: number) => {
          const [x, z] = axis === 'x' ? [at, fixed] : [fixed, at];
          return (
            (axis === 'x' && fixed === 5 && course < DOOR_COURSES) ||
            windowAt(x, z, course) ||
            slitAt(x, z, course) ||
            hosts.has(`${x},${y},${z}`)
          );
        };
        while (cell < 4) {
          const at = 6 + cell;
          const [x, z] = axis === 'x' ? [at, fixed] : [fixed, at];
          const facing = hosts.get(`${x},${y},${z}`);
          if (facing) {
            const host = sideStud(x, y, z, facing, stone(x, y, z));
            const leaf = hash(x, y, z);
            mount(
              host,
              leaf < 0.4 ? '6141' : leaf < 0.75 ? '54200' : '3024',
              y < 10 ? OLIVE : leaf < 0.5 ? DARK_GRASS : GRASS,
              facing,
            );
            cell++;
            continue;
          }
          if (slitAt(x, z, course)) {
            // A loophole: a grille brick across two cells, in the wall's colour.
            add('2877', DARK_STONE, x, y, z, axis === 'x' ? 90 : 0);
            cell += 2;
            continue;
          }
          if (blocked(at)) {
            cell++;
            continue;
          }
          let run = 1;
          while (cell + run < 4 && !blocked(at + run)) run++;
          const max = course % 2 ? 2 : 4;
          let left = run;
          let start = at;
          while (left > 0) {
            const size = [4, 2, 1].find((s) => s <= left && s <= max)!;
            const plain = hash(start, y, fixed) < 0.22;
            const part =
              size === 4
                ? plain
                  ? '3010'
                  : '15533'
                : size === 2
                  ? plain
                    ? '4216'
                    : '98283'
                  : '3005';
            const [px, pz] = axis === 'x' ? [start, fixed] : [fixed, start];
            add(part, stone(px, y, pz), px, y, pz, axis === 'x' && size > 1 ? 90 : 0);
            start += size;
            left -= size;
          }
          cell += run;
        }
      }
    }

    // The door: a frame the width of the front wall and a heavy leaf in dark timber.
    const frame: Piece = {
      partId: '60596',
      color: DARK_STONE,
      x: 6,
      y: base,
      z: 5,
      rotation: 90,
    };
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

    // Barred windows above the door on every side: a four-wide frame with a pane of two bars at
    // each end, one of them turned upside down so the two mirror each other.
    {
      const y = base + WINDOW_COURSES[0]! * 3;
      for (const [x, z, rotation, along] of [
        [6, 5, 90, 'x'],
        [6, 10, 90, 'x'],
        [5, 6, 0, 'z'],
        [10, 6, 0, 'z'],
      ] as [number, number, Rotation, 'x' | 'z'][]) {
        add('60594', DARK_STONE, x, y, z, rotation);
        add('60608', BLACK, along === 'x' ? x + 2 : x, y, along === 'x' ? z : z + 2, rotation);
        add('60608', BLACK, x, y, z, rotation, undefined, true);
      }
    }

    // A stone portal round the door: two pillars a stud out from the front corners and a long
    // lintel over them, clear of the door leaf that stands half a stud proud.
    for (const x of [5, 10]) {
      for (let level = 0; level < 6; level++)
        add('3005', stone(x, level, 3), x, base + 1 + level * 3, 4);
    }
    add('3009', LIGHT_STONE, 5, base + 19, 4, 90);

    // Buttresses on the side and back walls: tall stacks of bricks and a sloped cap, a stud proud.
    for (const [x, z, rotation, along] of [
      [4, 7, 90, 'z'],
      [11, 7, 270, 'z'],
      [7, 11, 180, 'x'],
    ] as [number, number, Rotation, 'x' | 'z'][]) {
      for (let level = 0; level < 7; level++)
        add('3004', stone(x, level + 1, z), x, base + 1 + level * 3, z, along === 'x' ? 90 : 0);
      // A cheese slope on each of its two studs, leaning outwards.
      for (let i = 0; i < 2; i++)
        add(
          '54200',
          LIGHT_STONE,
          along === 'x' ? x + i : x,
          base + 22,
          along === 'x' ? z : z + i,
          rotation,
        );
    }

    // A stringcourse: a ring of plates two studs wide round the wall above the windows, standing
    // a stud proud of the face.
    const string = base + 30;
    for (const [x, z] of [
      [4, 4],
      [10, 4],
      [4, 10],
      [10, 10],
    ])
      add('3022', LIGHT_STONE, x, string, z);
    for (const [x, z, rotation] of [
      [6, 4, 90],
      [6, 10, 90],
      [4, 6, 0],
      [10, 6, 0],
    ] as [number, number, Rotation][])
      add('3020', hash(x, z, 4) < 0.7 ? STONE : TAN, x, string, z, rotation);

    // The top: a floor plate over the walls, an overhanging ring of plates, merlons in two
    // courses with tile caps, and a small round turret with a cone roof and a flagpole.
    const top = base + courses * 3 + 1;
    add('41539', DARK_STONE, 4, top, 4);
    const merlon = (x: number, z: number, along: 'x' | 'z', out: Rotation) => {
      for (const level of [0, 1])
        add('3004', stone(x, level + 20, z), x, top + 1 + level * 3, z, along === 'x' ? 90 : 0);
      // A sloped cap leaning outwards, so each merlon has a pitched top.
      add('3040b', LIGHT_STONE, x, top + 7, z, out);
    };
    for (const start of [4, 8]) {
      merlon(start, 4, 'x', 0);
      merlon(start, 11, 'x', 180);
    }
    for (const start of [6, 9]) {
      merlon(4, start, 'z', 90);
      merlon(11, start, 'z', 270);
    }
    for (let level = 0; level < 4; level++)
      add('3941', level % 2 ? STONE : DARK_STONE, 7, top + 1 + level * 3, 7);
    add('3942c', DARK_STONE, 7, top + 13, 7);
    add('4589', BLACK, 5, top + 1, 5);
    add('3957a', BLACK, 5, top + 4, 5);
    add('2335', RED, 5, top + 10, 5, 90);

    // A barrel and crates by the door, lampposts on the path.
    add('3941', EARTH, 12, base, 2);
    add('3941', DARK_EARTH, 12, base + 3, 2);
    add('4032a', EARTH, 12, base + 6, 2);
    add('3022', EARTH, 3, base, 2);
    add('3022', DARK_EARTH, 3, base + 1, 2);
    for (const [x, z] of [
      [5, 1],
      [10, 1],
    ])
      if (onGround(x, z)) add('2039', BLACK, x, base, z);

    // Rocks round the courtyard and in the back corners: a heavy base block, a lighter block on
    // top and boulders at the foot, each only where there is ground and room.
    for (const [x, z, base1, top1] of [
      [12, 7, '3002', '15068'],
      [1, 11, '3002', '54200'],
      [13, 12, '3003', '85984'],
      [9, 13, '3003', '54200'],
    ] as [number, number, string, string][]) {
      if (!onGround(x, z) || !onGround(x + 1, z + 1) || inTower(x, z)) continue;
      if (tryAdd(base1, hash(x, z, 2) < 0.5 ? DARK_STONE : STONE, x, base, z))
        tryAdd(top1, LIGHT_STONE, x, base + 3, z);
    }
    for (const [x, z] of [
      [11, 12],
      [3, 12],
      [14, 6],
      [0, 9],
    ] as [number, number][])
      if (onGround(x, z) && !inTower(x, z)) tryAdd('3062b', DARK_STONE, x, base, z);

    // Pines at the back, bushes, ferns and tall grass between studs, and a fence.
    for (const [x, z, color] of [
      [14, 3, DARK_GRASS],
      [0, 7, DARK_GRASS],
      [3, 14, DARK_GRASS],
      [10, 14, DARK_GRASS],
    ] as [number, number, number][])
      if (onGround(x, z)) tryAdd('3471', color, x, base, z);
    const plants: [string, number, [number, number], [number, number][]][] = [
      [
        '6064',
        DARK_GRASS,
        [1.5, 1.5],
        [
          [1, 3],
          [14, 12],
          [13, 5],
          [-2, 10],
        ],
      ],
      [
        '6064',
        GRASS,
        [1.5, 1.5],
        [
          [3, 9],
          [15, 8],
          [-1, 4],
          [12, 14],
        ],
      ],
      [
        '6255',
        OLIVE,
        [2, 1.5],
        [
          [2, 6],
          [12, 3],
          [8, 14],
          [5, 13],
        ],
      ],
      [
        '6255',
        DARK_GRASS,
        [2, 1.5],
        [
          [0, 13],
          [14, 9],
          [9, 2],
        ],
      ],
      [
        '30093',
        OLIVE,
        [1.5, 0],
        [
          [3, 2],
          [13, 2],
          [7, 15],
          [1, 10],
        ],
      ],
      [
        '30093',
        GRASS,
        [1.5, 0],
        [
          [15, 5],
          [2, 12],
          [10, 13],
        ],
      ],
    ];
    const scattered: [number, number][] = [];
    for (let sz = -3; sz < SIZE - OFF - 1; sz++)
      for (let sx = -3; sx < SIZE - OFF - 1; sx++) scattered.push([sx, sz]);
    scattered.sort((a, b) => hash(a[0], a[1], 31) - hash(b[0], b[1], 31));
    const bare = (x: number, z: number) =>
      onGround(x, z) &&
      !inTower(x, z) &&
      !onPath(x, z) &&
      ['g', 'G', 'e', 'E', 'n'].includes(groundChar(x, z));
    for (const [part, color, [dx, dz], studs] of plants)
      for (const [sx, sz] of [...studs, ...scattered])
        if (bare(sx, sz) && tryAdd(part, color, sx - dx, base, sz - dz)) break;
    for (const [x, z] of [
      [1, 6],
      [1, 5],
      [14, 8],
      [13, 9],
    ] as [number, number][])
      if (onGround(x, z) && tryAdd('33303', EARTH, x, base, z)) break;

    order.flush();
  },
};
