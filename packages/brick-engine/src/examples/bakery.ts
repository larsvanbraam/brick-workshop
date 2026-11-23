import { isMatchingInsertFrame } from '../core.ts';
import type { Brick, Rotation } from '../core.ts';
import { addAreaMap, addRing, addRowMap, addRun, bottomUp, glazeWindows } from './layout.ts';
import { addTree, random } from './trees.ts';
import type { ExampleBrickAdder, ExampleDefinition } from './types.ts';

// Plan, in world studs: the street runs along the low-z edge, which the default camera faces,
// then the pavement and the bakery plot, then a back garden. Floors are plates at y 0 and 1.
const SIZE = 32;
const ROAD = 72;
const STONE = 71;
const TAN = 19;
const DARK_TAN = 28;
const BRICK = 70;
const NOUGAT = 84;
const DARK_BROWN = 308;
const WHITE = 15;
const RED = 4;
const ROOF = 320;
const GREEN = 2;
const DARK_GREEN = 288;
const YELLOW = 14;
const BLACK = 0;
const BLUE = 272;

// The bakery's walls, inclusive cells.
const X0 = 3;
const X1 = 18;
const Z0 = 7;
const Z1 = 17;
/** Floor top, and the ground storey of six brick courses with its band above. */
const G = 2;
const BAND = G + 18;
const UPPER = BAND + 1;
const EAVES = UPPER + 15;

const hash = (x: number, y: number, z: number, salt = 0) => {
  let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 7, 668265263) ^ Math.imul(z + 13, 2147483647);
  h = Math.imul(h ^ salt ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Front openings on the ground storey: shop windows and the door, as x ranges. */
const WINDOW_A = 4;
const DOOR = 9;
const WINDOW_B = 14;
const SIDE_WINDOW_Z = [9, 14];
const UPPER_WINDOWS = [5, 15];

export const bakery: ExampleDefinition = {
  id: 'bakery',
  name: 'Corner Bakery',
  tags: ['bakery', 'shop', 'street', 'town-house', 'awning', 'interior'],
  expectedPieceCount: 582,
  buildArea: SIZE,
  brickIdPrefix: 'bakery',
  build(drawnAdd) {
    const order = bottomUp(drawnAdd);
    const add: ExampleBrickAdder = glazeWindows(order.add);
    const tinted =
      (color: (x: number, y: number, z: number) => number): ExampleBrickAdder =>
      (partId, _color, x, y, z, ...rest) =>
        add(partId, color(x, y, z), x, y, z, ...rest);

    // ---- Ground: baseplates, then the street layers.
    const plan = (cell: (x: number, z: number) => string) =>
      Array.from({ length: SIZE }, (_, z) =>
        Array.from({ length: SIZE }, (_, x) => cell(x, z)).join(''),
      );
    const inside = (x: number, z: number) => x >= X0 && x <= X1 && z >= Z0 && z <= Z1;
    addAreaMap(
      add,
      plan(() => 'b'),
      0,
      { b: ['plate', ROAD] },
    );
    // Plates one up: curb, pavement, the bakery's floor and the lawns.
    addAreaMap(
      add,
      plan((x, z) => {
        if (z < 3) return ' ';
        if (z === 3) return 'k';
        if (z < Z0) return 'p';
        if (inside(x, z)) return 'f';
        return z > Z1 + 1 || x > X1 + 1 ? 'g' : x < X0 ? 'g' : 'p';
      }),
      1,
      { k: ['plate', STONE], p: ['plate', STONE], f: ['plate', DARK_TAN], g: ['plate', GREEN] },
    );
    // Road: dark tiles with worn patches, a dashed white line and a drain.
    addRowMap(
      add,
      plan((x, z) =>
        z > 2 || (z === 2 && (x === 17 || x === 18))
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
    add('2412b', BLACK, 17, 1, 2, 90);
    // Curb: a row of tiles. Pavement: light tiles, a tan border along the bakery, open studs
    // where posts and furniture stand.
    const open = new Set([
      '0,4',
      '1,4',
      '0,5',
      '1,5',
      '3,6',
      '8,6',
      '13,6',
      '18,6',
      '7,6',
      '14,6',
      '9,6',
      '10,6',
      '11,6',
      '12,6',
      '9,5',
      '10,5',
      '11,5',
      '12,5',
      '20,5',
      '22,5',
    ]);
    for (const [x, z] of [
      [5, 4],
      [15, 4],
      [17, 4],
    ] as const)
      for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) open.add(`${x + dx},${z + dz}`);
    addRowMap(
      add,
      plan((_x, z) => (z === 3 ? 'k' : ' ')),
      2,
      { k: ['tile', ROAD] },
    );
    addRowMap(
      add,
      plan((x, z) => {
        if (z < 4 || z >= Z0 || open.has(`${x},${z}`)) return ' ';
        return z === Z0 - 1 ? 't' : hash(x, 0, z, 5) < 0.12 ? 'd' : 'p';
      }),
      2,
      { p: ['tile', STONE], t: ['tile', TAN], d: ['tile', ROAD] },
    );
    // Side pavement, left and right of the plot, with a few stepping tiles into the lawn.
    for (const z of [8, 11, 14]) add('3069b', STONE, 20, 2, z, 90);

    // ---- Walls. Courses alternate which walls own the corners; pieces are tinted by position.
    const lower = tinted((x, y, z) => {
      const h = hash(x, y, z, 1);
      return h < 0.18 ? NOUGAT : h < 0.23 ? DARK_BROWN : BRICK;
    });
    const upper = tinted((x, y, z) =>
      (x === X0 || x === X1) && (z === Z0 || z === Z1)
        ? DARK_BROWN
        : hash(x, y, z, 2) < 0.28
          ? TAN
          : WHITE,
    );
    const lowerOpen = (k: number) => (x: number, z: number) => {
      if (z === Z0) {
        if (x >= DOOR && x < DOOR + 4) return true;
        if (k === 5 && x >= 13) return true;
        if (
          k >= 2 &&
          k <= 4 &&
          ((x >= WINDOW_A && x < WINDOW_A + 4) || (x >= WINDOW_B && x < WINDOW_B + 4))
        )
          return true;
      }
      if (
        (x === X0 || x === X1) &&
        k >= 2 &&
        k <= 4 &&
        SIDE_WINDOW_Z.some((w) => z >= w && z < w + 2)
      )
        return true;
      if (z === Z1 && k >= 2 && k <= 4 && ((x >= 6 && x < 8) || (x >= 13 && x < 15))) return true;
      return false;
    };
    for (let k = 0; k < 6; k++)
      addRing(lower, 'brick', BRICK, X0, Z0, X1 - X0 + 1, Z1 - Z0 + 1, G + k * 3, k, lowerOpen(k));
    // The band: tan plates, then tiles, with the cornice stepping out on inverted slopes.
    addRing(add, 'plate', TAN, X0, Z0, X1 - X0 + 1, Z1 - Z0 + 1, BAND, 0);
    const upperOpen = (k: number) => (x: number, z: number) => {
      if (k < 1 || k > 3) return false;
      if (z === Z0 && UPPER_WINDOWS.some((w) => x >= w && x < w + 2)) return true;
      if (z === Z1 && [6, 11, 15].some((w) => x >= w && x < w + 2)) return true;
      if ((x === X0 || x === X1) && [9, 14].some((w) => z >= w && z < w + 2)) return true;
      return false;
    };
    for (let k = 0; k < 5; k++)
      addRing(
        upper,
        'brick',
        WHITE,
        X0,
        Z0,
        X1 - X0 + 1,
        Z1 - Z0 + 1,
        UPPER + k * 3,
        k,
        upperOpen(k),
      );
    // The right window's lintel, laid by hand so a 1 x 4 brick spans its two centre studs.
    add('3005', BRICK, 13, G + 15, Z0);
    add('3010', BRICK, 14, G + 15, Z0, 90);
    // ---- Windows and the door.
    for (const x of [WINDOW_A, WINDOW_B]) add('60594', WHITE, x, G + 6, Z0, 90);
    for (const z of SIDE_WINDOW_Z)
      for (const x of [X0, X1]) {
        add('60593', WHITE, x, G + 6, z, 0);
      }
    for (const x of [6, 13]) {
      add('60593', WHITE, x, G + 6, Z1, 90);
    }
    for (const x of UPPER_WINDOWS) add('60593', WHITE, x, UPPER + 3, Z0, 90);
    for (const x of [6, 11, 15]) add('60593', WHITE, x, UPPER + 3, Z1, 90);
    for (const z of [9, 14]) for (const x of [X0, X1]) add('60593', WHITE, x, UPPER + 3, z, 0);
    // The door: frame, then a leaf found where the engine wants it.
    {
      const frame: Brick = {
        id: 'frame',
        partId: '60596',
        color: DARK_BROWN,
        x: DOOR,
        y: G,
        z: Z0,
        rotation: 90,
      };
      add(frame.partId, frame.color, frame.x, frame.y, frame.z, frame.rotation);
      let leaf: Brick | undefined;
      for (const rotation of [90, 270] as Rotation[])
        for (const dx of [0, -0.5, 0.5, -1, 1])
          for (const dz of [0, -0.5, 0.5, -1, 1, -1.5, 1.5]) {
            const candidate: Brick = {
              id: 'door',
              partId: '60623',
              color: BLUE,
              x: frame.x + dx,
              y: frame.y,
              z: frame.z + dz,
              rotation,
            };
            if (!leaf && isMatchingInsertFrame(candidate, frame)) leaf = candidate;
          }
      if (!leaf) throw new Error('No fit for the bakery door.');
      add(leaf.partId, leaf.color, leaf.x, leaf.y, leaf.z, leaf.rotation);
    }
    // Step up to the door: two tan plates, and a mat.
    add('3710', TAN, DOOR, 2, Z0 - 2, 90);
    // A wall lantern bracket is skipped; flower pots stand beside the door instead.
    for (const [x, bloom] of [
      [7, RED],
      [14, YELLOW],
    ] as const) {
      add('3062b', ROOF, x, G, Z0 - 1);
      add('6141', GREEN, x, G + 3, Z0 - 1);
      add('98138', bloom, x, G + 4, Z0 - 1);
    }

    // ---- Roof: two faces of 45 degree slopes in staggered lengths, gables, ridge, chimney.
    const rand = random(41);
    const slopeRun = (
      x0: number,
      x1: number,
      y: number,
      z: number,
      rotation: Rotation,
      i: number,
    ) => {
      let x = x0;
      while (x <= x1) {
        const left = x1 - x + 1;
        const widths = [4, 3, 2, 1].filter((w) => w <= left);
        const width = widths[Math.min(widths.length - 1, Math.floor(rand() * widths.length * 0.8))];
        const partId = { 4: '3037', 3: '3038', 2: '3039', 1: '3040b' }[width as 1 | 2 | 3 | 4]!;
        add(partId, hash(x, y, z, 9) < 0.3 ? RED : ROOF, x, y, z, rotation);
        x += width;
      }
      void i;
    };
    // The wall plate under the roof is the top storey's last course (see EAVES). Courses:
    for (let i = 0; i < 5; i++) {
      const y = EAVES + i * 3;
      slopeRun(X0, X1, y, Z0 - 1 + i, 0, i);
      slopeRun(X0, X1, y, Z1 - i, 180, i);
    }
    // Gable walls, one brick course each level, filling between the two faces.
    for (let i = 0; i < 4; i++)
      for (const x of [X0, X1]) {
        const from = Z0 + 1 + i;
        const to = Z1 - 1 - i;
        if (to >= from) addRun(upper, 'brick', WHITE, 'z', x, EAVES + i * 3, from, to - from + 1);
      }
    // The ridge: a dark red course over the middle cell.
    const mid = Z0 + 5;
    addRun(add, 'brick', ROOF, 'x', X0, EAVES + 12, mid, X1 - X0 + 1);
    // Chimney: stacked 2 x 2 bricks beside the right gable, up past the ridge, with a pot.
    for (let k = 0; k < 14; k++)
      add('3003', hash(k, 0, 0, 3) < 0.3 ? DARK_BROWN : BRICK, X1 + 1, G + k * 3, Z0 + 5);
    add('3941', DARK_BROWN, X1 + 1, G + 42, Z0 + 5);
    add('3062b', BLACK, X1 + 1, G + 45, Z0 + 5);
    add('3062b', BLACK, X1 + 2, G + 45, Z0 + 6);

    // ---- Awning and sign over the shopfront.
    for (const x of [X0, 8, 13, X1]) {
      add('2453b', DARK_BROWN, x, G, Z0 - 1);
      add('3005', DARK_BROWN, x, G + 15, Z0 - 1);
    }
    addRun(add, 'plate', DARK_BROWN, 'x', X0, BAND, Z0 - 1, X1 - X0 + 1);
    for (let x = X0; x <= X1; x++) add('3040b', (x - X0) % 2 ? WHITE : RED, x, BAND + 1, Z0 - 2, 0);
    // Shop sign standing on the awning: a dark red board with loaves on top.
    for (let k = 0; k < 2; k++) addRun(add, 'brick', ROOF, 'x', 8, BAND + 4 + k * 3, Z0 - 1, 6);
    for (const x of [8, 10, 12]) addRun(add, 'plate', DARK_BROWN, 'x', x, BAND + 10, Z0 - 1, 2);
    for (const [x, color] of [
      [8, NOUGAT],
      [10, TAN],
      [12, NOUGAT],
    ] as const) {
      add('3004', color, x, BAND + 11, Z0 - 1, 90);
    }

    // ---- Interior seen through the windows: counter, shelves, trays of bread, an oven.
    addRun(add, 'brick', DARK_BROWN, 'x', 5, G, Z0 + 3, 12);
    addRun(add, 'brick', BRICK, 'x', 5, G + 3, Z0 + 3, 12);
    addRun(add, 'plate', WHITE, 'x', 5, G + 6, Z0 + 3, 12);
    for (let x = 5; x < 17; x++) {
      if (x % 3 === 2) continue;
      add(x % 2 ? '3062b' : '3005', hash(x, 0, 0, 4) < 0.5 ? NOUGAT : TAN, x, G + 7, Z0 + 3);
    }
    // Back cabinet with goods on top.
    addRun(add, 'brick', DARK_BROWN, 'x', 4, G, Z1 - 1, 14);
    addRun(add, 'brick', BRICK, 'x', 4, G + 3, Z1 - 1, 14);
    for (let x = 4; x <= 17; x++)
      if (hash(x, 0, 0, 6) < 0.7)
        add(x % 3 ? '3005' : '3062b', [RED, YELLOW, TAN, NOUGAT, WHITE][x % 5], x, G + 6, Z1 - 1);
    // Oven in the back corner: dark brick block with a glowing mouth.
    for (const k of [0, 2, 3]) addRun(add, 'brick', BLACK, 'x', 14, G + k * 3, Z1 - 3, 3);
    add('3005', BLACK, 14, G + 3, Z1 - 3);
    add('3005', 25, 15, G + 3, Z1 - 3);
    add('3005', BLACK, 16, G + 3, Z1 - 3);

    // ---- Street life.
    // Lamppost at the kerb, a bench, a bin, a menu board and crates of bread.
    for (const y of [2, 17]) add('2453b', BLACK, 0, y, 4);
    add('3062b', 46, 0, 32, 4);
    add('4589', BLACK, 0, 35, 4);
    for (const x of [20, 22]) add('3005', DARK_BROWN, x, 2, 5);
    add('3623', DARK_BROWN, 20, 5, 5, 90);
    add('3678b', BLACK, 5, 2, 4, 0);
    for (const [x, fruit] of [
      [15, NOUGAT],
      [17, TAN],
    ] as const) {
      add('3022', DARK_BROWN, x, 2, 4);
      for (const [dx, dz] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        add('3005', BRICK, x + dx, 3, 4 + dz);
        add('98138', fruit, x + dx, 6, 4 + dz);
      }
    }
    // A fence and lawn border along the back; a hedge and flowers on the left lawn.
    for (let x = 0; x < 16; x += 4) add('33303', DARK_BROWN, x, G, SIZE - 1, 90);
    for (const [x, z, color] of [
      [0, 10, RED],
      [1, 11, RED],
      [0, 14, YELLOW],
      [1, 15, YELLOW],
      [22, 11, WHITE],
      [23, 14, WHITE],
    ] as const) {
      add('6141', DARK_GREEN, x, G, z);
      add('98138', color, x, G + 1, z);
    }
    // Lawn dressing: tufts and bushes in clumps, a flower bed along the wall and tall grass.
    const lawn = random(5);
    const used = new Set(['22,11', '23,14', '22,8', '25,8', '28,8']);
    for (let i = 0; i < 70; i++) {
      const x = 19 + Math.floor(lawn() * 13);
      const z = 8 + Math.floor(lawn() * 23);
      const onPath = x === 20 && [8, 9, 11, 12, 14, 15].includes(z);
      const nearTree = Math.abs(x - 23) < 3 && Math.abs(z - 23) < 3;
      const nearChimney = x <= 21 && z >= 11 && z <= 14;
      if (onPath || nearTree || nearChimney || used.has(`${x},${z}`)) continue;
      used.add(`${x},${z}`);
      if (lawn() < 0.5) add('6141', DARK_GREEN, x, G, z);
      else if (lawn() < 0.6) {
        add('6141', GREEN, x, G, z);
        add('98138', [YELLOW, WHITE, RED][(x + z) % 3], x, G + 1, z);
      }
    }
    for (let x = 22; x < 30; x += 3) add('3062b', DARK_GREEN, x, G, 8);
    for (let x = 22; x < 30; x += 3) add('3062b', GREEN, x, G + 3, 8);

    // A shade tree in the back garden.
    addTree(
      add,
      23,
      23,
      G,
      [DARK_GREEN, GREEN, 10],
      DARK_BROWN,
      4,
      7,
      [{ u0: X0, u1: X1 + 3, v0: Z0, v1: Z1 + 1, y0: G, y1: EAVES + 20 }],
      { foot: false, radii: [2.4, 3, 2.8, 2] },
    );

    order.flush();
  },
};
