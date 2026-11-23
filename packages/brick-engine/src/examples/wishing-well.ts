import { footprint, seatOnSideStuds } from '../core.ts';
import type { Facing, Rotation } from '../core.ts';
import { addRowMap, addRun, bottomUp } from './layout.ts';
import { addTree } from './trees.ts';
import type { Box } from './trees.ts';
import type { ExampleBrickAdder, ExampleDefinition } from './types.ts';

// A village wishing well on a grassy knoll: a rubble-stone rim with round quoins, an
// overhanging plate cap, two timber posts carrying a low straw-coloured gable, ivy climbing the
// stones, a path of tan tiles, a flower bed, a rock cluster, a fence and an oak. The board is
// 24 studs square with its front at low z, the side the default camera looks at.
const SIZE = 24;
/** The plan below is drawn from the well's own corner; the board puts it this far in. */
const OFF = (SIZE - 16) / 2;
/** The two-layer plate floor under the plan. */
const FLOOR = 2;

const BEDROCK = 72;
const STONE = 71;
const DARK_STONE = 72;
const LIGHT_STONE = 151;
const TAN = 19;
const DARK_TAN = 28;
const NOUGAT = 84;
const TIMBER = 70;
const DARK_TIMBER = 308;
const GRASS = 2;
const DARK_GRASS = 288;
const BRIGHT_GRASS = 10;
const RED = 4;
const YELLOW = 14;
const WHITE = 15;
const ORANGE = 25;
const WATER = 1;
const DEEP_WATER = 272;
const GLASS_WATER = 43;
const LAMP = 46;
const BLACK = 0;

const hash = (a: number, b: number, c: number) => {
  let h =
    Math.imul(a + 101, 374761393) ^ Math.imul(b + 211, 668265263) ^ Math.imul(c + 307, 2147483629);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// The knoll's lawn: a blob with bays, the board's corners left bare as bedrock.
const onLawn = (x: number, z: number) =>
  Math.sqrt((x - 7.5) ** 2 * 0.9 + (z - 7.7) ** 2 * 1.05) <
  12.5 - 3 * hash(Math.floor(x / 3), Math.floor(z / 3), 7);
const onMound = (x: number, z: number) =>
  x >= 4 && x <= 11 && z >= 4 && z <= 11 && !((x === 4 || x === 11) && (z === 4 || z === 11));
const onPath = (x: number, z: number) => (x === 6 || x === 7) && z >= -2 && z <= 3;
const inBed = (x: number, z: number) => x >= 11 && x <= 13 && z >= 3 && z <= 4;

const lawnChar = (x: number, z: number) => {
  const patch = hash(Math.floor(x / 2), Math.floor(z / 2), 3);
  return patch < 0.28 ? 'G' : patch > 0.93 ? 'h' : 'g';
};

/** Rubble: mostly Light Bluish Grey, dark patches low down, light ones high. */
const stone = (x: number, y: number, z: number) => {
  const patch = hash(Math.floor(x / 2) + 3 * y, Math.floor(z / 2), 5);
  const dark = 0.34 - y * 0.012;
  const light = 0.86 + y * 0.004;
  return patch < dark
    ? DARK_STONE
    : patch > light
      ? hash(x, y, z) < 0.5
        ? LIGHT_STONE
        : TAN
      : STONE;
};

type Piece = { partId: string; color: number; x: number; y: number; z: number; rotation: Rotation };

export const wishingWell: ExampleDefinition = {
  id: 'wishing-well',
  name: 'Wishing Well',
  tags: ['well', 'stone', 'thatch', 'ivy', 'garden', 'landscape', 'tree', 'flowers'],
  expectedPieceCount: 571,
  buildArea: SIZE,
  brickIdPrefix: 'well',
  build(drawnAdd) {
    const order = bottomUp(drawnAdd);
    const boxes: Box[] = [];
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

    /** Adds a piece only where its whole box is free of what is already laid. */
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

    /** Mounts a piece on a side stud of a host, facing out of the wall. */
    const mount = (host: Piece, partId: string, color: number, facing: Facing) => {
      const seated = seatOnSideStuds(
        { id: 'mount', partId, color, x: host.x, y: host.y, z: host.z, rotation: 0, facing },
        { id: 'host', ...host },
      );
      if (!seated)
        throw new Error(`Nothing to mount ${partId} on at ${host.x},${host.y},${host.z}.`);
      add(partId, color, seated.x, seated.y, seated.z, seated.rotation, seated.facing);
    };
    /** A side-stud brick whose studs face `facing`, standing in the wall cell at x, z. */
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

    // Bedrock, then the lawn and its path, flower bed and mound, a plate high each.
    // A 24 x 24 floor in two layers: the top one in 16 x 16, 8 x 16 and 8 x 8 plates, over a
    // layer shifted 8 studs both ways, so every seam of the top sits over the middle of a plate.
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
    const lawn: string[] = [];
    const mound: string[] = [];
    for (let row = 0; row < SIZE; row++) {
      let lawnRow = '';
      let moundRow = '';
      for (let col = 0; col < SIZE; col++) {
        const x = col - OFF;
        const z = row - OFF;
        if (onPath(x, z)) lawnRow += (x + z) % 2 || hash(x, z, 9) < 0.3 ? 'p' : 'q';
        else if (!onLawn(x, z) && !onMound(x, z)) lawnRow += ' ';
        else if (inBed(x, z)) lawnRow += hash(x, z, 4) < 0.3 ? 'E' : 'e';
        else lawnRow += lawnChar(x, z);
        moundRow += onMound(x, z) ? lawnChar(x, z) : ' ';
      }
      lawn.push(lawnRow);
      mound.push(moundRow);
    }
    // The plan is in the well's own coordinates; the maps are drawn over the whole board.
    const onBoard: ExampleBrickAdder = (partId, color, x, y, z, ...rest) =>
      add(partId, color, x - OFF, y, z - OFF, ...rest);
    addRowMap(onBoard, lawn, 1, {
      g: ['plate', GRASS],
      G: ['plate', DARK_GRASS],
      h: ['plate', BRIGHT_GRASS],
      e: ['plate', TIMBER],
      E: ['plate', DARK_TIMBER],
      p: ['tile', TAN],
      q: ['tile', DARK_TAN],
    });
    addRowMap(onBoard, mound, 2, {
      g: ['plate', GRASS],
      G: ['plate', DARK_GRASS],
      h: ['plate', BRIGHT_GRASS],
    });
    const top = 3;

    // Water in the well: deep blue, lighter blue, and a clear tile for the shine.
    add('3031', DEEP_WATER, 6, top, 6);
    add('3031', WATER, 6, top + 1, 6);
    add('1751', GLASS_WATER, 6, top + 2, 6);

    // A plinth of dark plates one stud proud of the rim, then the rim itself.
    const plinth: [number, number, number, number][] = [
      [5, 4, 6, 1],
      [5, 11, 6, 1],
      [4, 5, 1, 6],
      [11, 5, 1, 6],
    ];
    for (const [x, z, w, d] of plinth)
      addRun(add, 'plate', DARK_STONE, w > 1 ? 'x' : 'z', x, top, z, Math.max(w, d));

    // Ivy hosts: side-stud bricks in the wall, with the way they face.
    const hosts = new Map<string, Facing>();
    // Sprigs are two studs wide, so hosts at one height stand three cells apart.
    for (const [x, y, z, facing] of [
      [6, 6, 5, '-z'],
      [9, 6, 5, '-z'],
      [8, 9, 5, '-z'],
      [5, 6, 7, '-x'],
      [5, 9, 9, '-x'],
      [5, 9, 6, '-x'],
      [10, 6, 8, '+x'],
      [10, 9, 6, '+x'],
      [10, 9, 9, '+x'],
      [7, 6, 10, '+z'],
      [9, 9, 10, '+z'],
      [7, 9, 5, '-z'],
      [6, 9, 10, '+z'],
      [10, 6, 6, '+x'],
      [5, 6, 9, '-x'],
      [8, 6, 5, '-z'],
      [10, 9, 7, '+x'],
    ] as [number, number, number, Facing][])
      hosts.set(`${x},${y},${z}`, facing);

    const courses = [top, top + 3, top + 6, top + 9];
    const walls: ['x' | 'z', number, number][] = [
      ['x', 5, 6],
      ['x', 10, 6],
      ['z', 5, 6],
      ['z', 10, 6],
    ];
    courses.forEach((y, course) => {
      for (const [x, z] of [
        [5, 5],
        [10, 5],
        [5, 10],
        [10, 10],
      ])
        add('3062b', course % 2 ? STONE : LIGHT_STONE, x, y, z);
      for (const [axis, fixed, from] of walls) {
        let cell = 0;
        while (cell < 4) {
          const at = from + cell;
          const [x, z] = axis === 'x' ? [at, fixed] : [fixed, at];
          const facing = hosts.get(`${x},${y},${z}`);
          if (facing) {
            const host = sideStud(x, y, z, facing, stone(x, y, z));
            // Ivy: a mix of small leaf pieces, darker low down and lighter high up.
            const leaf = hash(x, y, z);
            mount(
              host,
              leaf < 0.4 ? '6141' : leaf < 0.75 ? '54200' : '3024',
              y < 8 ? DARK_GRASS : leaf < 0.5 ? GRASS : BRIGHT_GRASS,
              facing,
            );
            cell++;
            continue;
          }
          let run = 1;
          while (
            cell + run < 4 &&
            !hosts.has(axis === 'x' ? `${at + run},${y},${fixed}` : `${fixed},${y},${at + run}`)
          )
            run++;
          // Even courses use long stones, odd ones short, so joints stagger.
          const max = course % 2 ? 2 : 4;
          let left = run;
          let start = at;
          while (left > 0) {
            const size = [4, 2, 1].find((s) => s <= left && s <= max)!;
            const plain = hash(start, y, fixed) < 0.25;
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
    });

    // The cap: two-stud plates round the rim, a stud wider on the outside.
    const rimTop = top + 12;
    const cap = (partId: string, x: number, z: number, rotation: Rotation) =>
      add(partId, hash(x, z, 11) < 0.7 ? DARK_STONE : STONE, x, rimTop, z, rotation);
    for (const [x, z] of [
      [4, 4],
      [10, 4],
      [4, 10],
      [10, 10],
    ])
      cap('3022', x, z, 0);
    cap('3020', 6, 4, 90);
    cap('3020', 6, 10, 90);
    cap('3020', 4, 6, 0);
    cap('3020', 10, 6, 0);
    const capTop = rimTop + 1;

    // A wooden bucket on the cap, with water in it, and moss on the corners.
    add('3941', TIMBER, 10, capTop, 4);
    add('4032a', WATER, 10, capTop + 3, 4);
    for (const [x, z] of [
      [4, 4],
      [11, 10],
      [4, 11],
    ])
      add('6141', DARK_GRASS, x, capTop, z);

    // Posts: side-stud bricks with a long post between, carrying a lantern and a sign.
    const left = sideStud(5, capTop, 7, '-z', TIMBER);
    mount(left, '54200', GRASS, '-z');
    add('14716', TIMBER, 5, capTop + 3, 7);
    const lamp = sideStud(5, capTop + 12, 7, '-z', DARK_TIMBER);
    mount(lamp, '3062b', LAMP, '-z');
    const right = sideStud(10, capTop, 7, '-z', TIMBER);
    mount(right, '6141', DARK_GRASS, '-z');
    add('3005', TIMBER, 10, capTop + 3, 7);
    const sign = sideStud(10, capTop + 6, 7, '-z', DARK_TIMBER);
    mount(sign, '3069b', WHITE, '-z');
    add('3005', TIMBER, 10, capTop + 9, 7);
    add('3005', DARK_TIMBER, 10, capTop + 12, 7);

    // Roof: a deck on the posts, a core under the ridge, two courses of 45 degree slopes in
    // straw colours with staggered lengths, and a timber ridge board.
    const deck = capTop + 15;
    add('3036', DARK_TIMBER, 4, deck, 5, 90);
    add('3007', TIMBER, 4, deck + 1, 7, 90);
    const straw = (x: number, y: number, z: number) => {
      const v = hash(x, y, z);
      return v < 0.3 ? DARK_TAN : v > 0.9 ? NOUGAT : TAN;
    };
    const slope = (length: number) => (length === 4 ? '3037' : length === 3 ? '3038' : '3039');
    const row = (z: number, y: number, rotation: Rotation, lengths: number[]) => {
      let x = 4;
      for (const length of lengths) {
        add(slope(length), straw(x, y, z), x, y, z, rotation);
        x += length;
      }
    };
    row(5, deck + 1, 0, [3, 2, 3]);
    row(9, deck + 1, 180, [2, 4, 2]);
    row(6, deck + 4, 0, [4, 4]);
    row(8, deck + 4, 180, [3, 3, 2]);
    add('3034', TIMBER, 4, deck + 7, 7, 90);

    // A robin on the ridge.
    const ridge = deck + 8;
    add('3062b', RED, 7, ridge, 7);
    add('6141', RED, 7, ridge + 3, 7);
    add('54200', ORANGE, 7, ridge + 4, 7);
    add('54200', DARK_TIMBER, 7, ridge, 8, 180);

    // Stepping stones beside the path, a barrel, a fence, rocks and plants.
    for (const [x, z] of [
      [5, 2],
      [8, 3],
      [5, 4],
    ])
      if (onLawn(x, z) && !onMound(x, z)) add('98138', DARK_TAN, x, 2, z);
    add('3941', TIMBER, 9, 2, 1);
    add('3941', DARK_TIMBER, 9, 5, 1);
    add('4032a', TIMBER, 9, 8, 1);

    // Rock cluster in the back right corner, with boulders at its foot.
    add('3002', DARK_STONE, 11, 2, 12);
    add('3003', STONE, 13, 2, 12);
    add('54200', LIGHT_STONE, 11, 5, 12);
    add('85984', STONE, 12, 5, 13, 90);
    add('15068', LIGHT_STONE, 13, 5, 12);
    add('3062b', DARK_STONE, 10, 2, 13);
    add('3024', STONE, 10, 2, 14);

    // Flowers in clumps of one colour: one tall bloom and a few low ones. Yellow in the bed, red
    // by the fence, white at the back.
    const clump = (color: number, tall: [number, number], low: [number, number][]) => {
      add('18674', GRASS, tall[0], 2, tall[1]);
      add('4727', GRASS, tall[0], 3, tall[1]);
      add('24866', color, tall[0], 6, tall[1]);
      low.forEach(([x, z], index) => add(index % 2 ? '98138' : '6141', color, x, 2, z));
    };
    clump(
      YELLOW,
      [11, 3],
      [
        [13, 3],
        [13, 4],
        [10, 3],
      ],
    );
    clump(
      RED,
      [2, 5],
      [
        [2, 7],
        [3, 7],
        [1, 5],
      ],
    );
    clump(
      WHITE,
      [1, 1],
      [
        [3, 1],
        [0, 3],
        [3, 3],
      ],
    );

    // The oak first, so everything else grows round it; then bushes, ferns and tall grass,
    // which sit between studs, each taking the first of its spots that is free.
    // A grove behind the well: an apple tree with a root flare, a short trunk and a wide crown
    // dotted with red apples, and two younger trees in lighter greens either side of it, so the
    // crowns overlap and the skyline has more than one trunk.
    const around = boxes.slice();
    addTree(add, 6, 14, 2, [DARK_GRASS, GRASS, BRIGHT_GRASS], TIMBER, 7, 3, around, {
      foot: false,
      gnarled: true,
      solid: (x, z) => onLawn(x, z) && !onMound(x, z),
      radii: [3.6, 4.2, 4.6, 4.8, 4.6, 4.2, 3.6, 2.8, 2],
      accent: { color: RED, chance: 0.5 },
    });
    addTree(add, 2, 10, 2, [GRASS, BRIGHT_GRASS, 27], DARK_TIMBER, 6, 2, around, {
      foot: false,
      gnarled: true,
      solid: (x, z) => onLawn(x, z) && !onMound(x, z),
      radii: [3, 3.5, 3.2, 2.4],
    });
    addTree(add, 14, 9, 2, [DARK_GRASS, GRASS, BRIGHT_GRASS], TIMBER, 7, 3, around, {
      foot: false,
      gnarled: true,
      solid: (x, z) => onLawn(x, z) && !onMound(x, z),
      radii: [3, 3.6, 3.3, 2.5],
    });
    // Windfalls and mushrooms round the roots, and a conifer in the far corner.
    for (const [x, z] of [
      [3, 12],
      [9, 16],
      [2, 16],
      [10, 14],
      [5, 19],
      [8, 12],
    ] as [number, number][])
      if (onLawn(x, z) && !onMound(x, z))
        tryAdd('6141', hash(x, z, 17) < 0.6 ? RED : ORANGE, x, 2, z);
    for (const [x, z] of [
      [10, 16],
      [2, 18],
    ] as [number, number][])
      if (onLawn(x, z) && tryAdd('3062b', WHITE, x, 2, z)) add('6141', RED, x, 5, z);
    for (const [x, z] of [
      [15, 13],
      [14, 15],
      [13, 16],
    ] as [number, number][])
      if (onLawn(x, z) && onLawn(x + 2, z + 2) && tryAdd('3471', DARK_GRASS, x, 2, z)) break;
    // A picket fence along the lawn's side, wherever the tree and the plants leave room.
    for (const [x, z] of [
      [1, 6],
      [1, 5],
      [1, 4],
      [13, 9],
      [14, 8],
    ] as [number, number][])
      if (onLawn(x, z) && tryAdd('33303', TIMBER, x, 2, z)) break;
    // Plants plug into one stud by a receiver off their own corner: the bush at (1.5, 1.5), the
    // fern at (2, 1.5) and tall grass at (1.5, 0). Each spot below is that stud, which needs
    // lawn under it; a plant takes the first spot whose whole box is free.
    const plants: [string, number, [number, number], [number, number][]][] = [
      [
        '6064',
        DARK_GRASS,
        [1.5, 1.5],
        [
          [14, 8],
          [14, 11],
          [17, 6],
          [-1, 7],
        ],
      ],
      [
        '6064',
        GRASS,
        [1.5, 1.5],
        [
          [2, 9],
          [3, 7],
          [10, -1],
          [13, -1],
        ],
      ],
      [
        '6255',
        GRASS,
        [2, 1.5],
        [
          [7, 12],
          [5, 15],
          [13, 12],
          [10, 12],
        ],
      ],
      [
        '6255',
        DARK_GRASS,
        [2, 1.5],
        [
          [15, 12],
          [12, 10],
          [16, 7],
        ],
      ],
      [
        '30093',
        GRASS,
        [1.5, 0],
        [
          [7, 14],
          [8, 15],
          [11, 15],
          [12, -1],
          [4, 3],
        ],
      ],
      [
        '30093',
        BRIGHT_GRASS,
        [1.5, 0],
        [
          [10, 13],
          [13, 14],
          [16, 5],
          [0, 6],
        ],
      ],
    ];
    // The listed spots first, then any lawn stud in a fixed scattered order, so each plant is
    // placed somewhere free and the build stays the same every time.
    const scattered: [number, number][] = [];
    for (let sz = -3; sz < SIZE - OFF - 1; sz++)
      for (let sx = -3; sx < SIZE - OFF - 1; sx++) scattered.push([sx, sz]);
    scattered.sort((a, b) => hash(a[0], a[1], 31) - hash(b[0], b[1], 31));
    for (const [part, color, [dx, dz], studs] of plants)
      for (const [sx, sz] of [...studs, ...scattered])
        if (
          onLawn(sx, sz) &&
          !onMound(sx, sz) &&
          !onPath(sx, sz) &&
          tryAdd(part, color, sx - dx, 2, sz - dz)
        )
          break;

    order.flush();
    void BLACK;
  },
};
