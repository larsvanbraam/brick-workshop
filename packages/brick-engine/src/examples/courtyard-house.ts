import { BUILD_AREA, footprint, getConnectionSites } from '../core.ts';
import type { Facing, Rotation } from '../core.ts';
import { addAreaMap, addRing, addRun, glazeWindows, turnAround } from './layout.ts';
import type { ExampleBrickAdder, ExampleDefinition } from './types.ts';

// The plan is drawn with the front at high z and x running left to right as seen from the
// front; `turnAround` swings it round to face the default camera.
//
// Ground floor: stone, x 4..11, z 3..10. Jettied upper storey: x 3..12, z 2..11. Roof: x 2..13,
// z 1..12, ridge along z over x 7..8. Chimney: x 13..14, z 1..2. Porch: x 12..15, z 5..12.

const GRASS = 2;
const DARK_GRASS = 288;
const LIME = 27;
const BRIGHT_GREEN = 10;
const STONE = 71;
const DARK_STONE = 72;
const TIMBER = 70;
const DARK_TIMBER = 308;
const PLASTER = 19;
const ROOF = 320;
const ROOF_LIGHT = 4;
const RED = 4;
const WHITE = 15;
const BLACK = 0;
const YELLOW = 14;
const GLOW = 46;
const ORANGE = 25;
const PINK = 13;

/** Small deterministic hash in [0, 1), so mottled colours stay the same every build. */
const hash = (...values: number[]) => {
  let seed = 17;
  for (const value of values) seed = Math.imul(seed ^ (value + 0x9e37), 0x85ebca6b) >>> 0;
  seed ^= seed >>> 13;
  seed = Math.imul(seed, 0xc2b2ae35) >>> 0;
  return ((seed ^ (seed >>> 16)) >>> 0) / 4294967296;
};

const stone = (...at: number[]) => (hash(...at) < 0.4 ? DARK_STONE : STONE);
const roofColor = (...at: number[]) => (hash(...at) < 0.15 ? ROOF_LIGHT : ROOF);

/** A 45 degree slope falling towards `facing`, `length` studs along the eave, two deep. */
const SLOPES = [
  [4, '3037'],
  [3, '3038'],
  [2, '3039'],
  [1, '3040b'],
] as const;
const SLOPE_TURN: Readonly<Record<Facing, Rotation>> = { '-z': 0, '-x': 90, '+z': 180, '+x': 270 };

function addSlopes(
  add: ExampleBrickAdder,
  color: number,
  facing: Facing,
  x: number,
  y: number,
  z: number,
  length: number,
) {
  const alongX = facing.endsWith('z');
  let offset = 0;
  while (offset < length) {
    const [size, partId] = SLOPES.find(([size]) => size <= length - offset)!;
    add(partId, color, alongX ? x + offset : x, y, alongX ? z : z + offset, SLOPE_TURN[facing]);
    offset += size;
  }
}

/** A 1 x 4 x 3 frame with latticed casements, set in a wall running along x. */
function addLatticeWindow(open: ExampleBrickAdder, x: number, y: number, z: number) {
  open('60594', TIMBER, x, y, z, 90);
  open('60607', YELLOW, x + 2, y, z, 90);
  open('60607', YELLOW, x, y, z, 90, undefined, true);
}

/** A round barrel: two round bricks capped with a dark lid. */
function addBarrel(add: ExampleBrickAdder, x: number, z: number) {
  add('3941', TIMBER, x, 1, z);
  add('3941', TIMBER, x, 4, z);
  add('14769', DARK_TIMBER, x, 7, z);
}

interface Box {
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
  readonly y0: number;
  readonly y1: number;
}

const overlaps = (a: Box, b: Box) =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Mirrors a plan left to right, so it can be drawn with x running left to right as seen from
 * the front once `turnAround` has swung it to face the camera.
 */
function mirrored(add: ExampleBrickAdder): ExampleBrickAdder {
  return (partId, color, x, y, z, rotation = 0, facing, upsideDown) => {
    const { width } = footprint({ id: '', partId, color, x, y, z, rotation, facing });
    const flipped = facing === '+x' ? '-x' : facing === '-x' ? '+x' : facing;
    add(
      partId,
      color,
      BUILD_AREA - x - width,
      y,
      z,
      ((360 - rotation) % 360) as Rotation,
      flipped,
      upsideDown,
    );
  };
}

/** Green bricks the crown is filled with, largest first: [width, depth, part, turn]. */
const CROWN_BRICKS = [
  [2, 4, '3001', 0],
  [4, 2, '3001', 90],
  [2, 3, '3002', 0],
  [3, 2, '3002', 90],
  [2, 2, '3003', 0],
  [1, 3, '3622', 0],
  [3, 1, '3622', 90],
  [1, 2, '3004', 0],
  [2, 1, '3004', 90],
  [1, 1, '3062b', 0],
] as const;

/**
 * A broadleaf tree beside the house's left wall: a short trunk under a lumpy, egg-shaped crown
 * of green bricks that fills the space under the eaves and peeks over them higher up. Each
 * course of the crown is laid with the largest bricks that fit, every one resting on the course
 * below, and the top is dotted with leaf sprays and light green buds.
 */
function addCrown(add: ExampleBrickAdder, boxes: Box[]) {
  const [cx, cz] = [1.6, 5.5];
  add('14716', TIMBER, 1, 1, 5);
  const fits = (box: Box) =>
    box.x0 >= 0 &&
    box.x1 <= BUILD_AREA &&
    box.z0 >= 0 &&
    box.z1 <= BUILD_AREA &&
    !boxes.some((other) => overlaps(other, box));
  // Crown radii (x, z) per course, from the bottom up.
  const courses = [
    [1.4, 1.9],
    [2.3, 2.9],
    [2.6, 3.4],
    [2.5, 3.3],
    [2.3, 3],
    [1.9, 2.4],
  ] as const;
  let below = new Set(['1:5']);
  let y = 10;
  for (const [index, [rx, rz]] of courses.entries()) {
    const crown = new Set<string>();
    for (let x = 0; x < 6; x++)
      for (let z = 0; z < 12; z++) {
        const reach = ((x + 0.5 - cx) / rx) ** 2 + ((z + 0.5 - cz) / rz) ** 2;
        if (
          reach <= 0.85 + 0.3 * hash(x, z, y) &&
          fits({ x0: x, x1: x + 1, z0: z, z1: z + 1, y0: y, y1: y + 3 })
        )
          crown.add(`${x}:${z}`);
      }
    // Inner cells take the largest bricks; the outline is round bricks, so the crown is lumpy.
    const edge = (cell: string) => {
      const [x, z] = cell.split(':').map(Number);
      return [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dz]) => !crown.has(`${x + dx}:${z + dz}`));
    };
    const laid = new Set<string>();
    const color = (x: number, z: number) => {
      const roll = hash(x, z, y, 5) + index * 0.1;
      return roll < 0.4 ? DARK_GRASS : roll < 0.92 ? GRASS : BRIGHT_GREEN;
    };
    for (const outline of [false, true])
      for (const cell of [...crown].sort()) {
        if (laid.has(cell) || edge(cell) !== outline) continue;
        const [x, z] = cell.split(':').map(Number);
        for (const [width, depth, partId, rotation] of CROWN_BRICKS) {
          if (outline && width * depth > 2) continue;
          const cells: string[] = [];
          for (let dx = 0; dx < width; dx++)
            for (let dz = 0; dz < depth; dz++) cells.push(`${x + dx}:${z + dz}`);
          if (
            !cells.every((other) => crown.has(other) && !laid.has(other) && edge(other) === outline)
          )
            continue;
          if (!cells.some((other) => below.has(other))) continue;
          add(partId, color(x, z), x, y, z, rotation);
          for (const other of cells) laid.add(other);
          break;
        }
      }
    // Leaf sprays on the ledges where the crown draws in, so its sides look leafy, not stepped.
    if (index > 0)
      for (const cell of [...below].sort()) {
        if (laid.has(cell) || hash(...cell.split(':').map(Number), y) < 0.5) continue;
        const [x, z] = cell.split(':').map(Number);
        if (fits({ x0: x, x1: x + 1, z0: z, z1: z + 1, y0: y, y1: y + 1 }))
          add('6141', LIME, x, y, z);
      }
    below = laid;
    y += 3;
  }
  // The top: leaf sprays over the crown and light green buds on the studs left bare.
  const covered = new Set<string>();
  for (let spray = 0; spray < 3; spray++) {
    let best: { gain: number; x: number; z: number; rotation: Rotation } | undefined;
    for (const cell of [...below].sort())
      for (const rotation of [0, 90, 180, 270] as const) {
        const [sx, sz] = cell.split(':').map(Number);
        const probe = { id: '', partId: '2423', color: 0, x: 0, y: 0, z: 0, rotation };
        const { width, depth } = footprint(probe);
        const [receiver] = getConnectionSites(probe, 'bottom');
        const [x, z] = [sx - Math.floor(receiver.x), sz - Math.floor(receiver.z)];
        let gain = hash(x, z, rotation) * 0.5;
        for (let dx = 0; dx < width; dx++)
          for (let dz = 0; dz < depth; dz++) {
            const at = `${x + dx}:${z + dz}`;
            gain += covered.has(at) ? -1 : below.has(at) ? 1 : 0.3;
          }
        if (best && gain <= best.gain) continue;
        if (!fits({ x0: x, x1: x + width, z0: z, z1: z + depth, y0: y, y1: y + 1 })) continue;
        best = { gain, x, z, rotation };
      }
    if (!best || best.gain < 3) break;
    const { width, depth } = footprint({
      id: '',
      partId: '2423',
      color: 0,
      x: 0,
      y: 0,
      z: 0,
      rotation: best.rotation,
    });
    add('2423', spray === 1 ? BRIGHT_GREEN : GRASS, best.x, y, best.z, best.rotation);
    for (let dx = 0; dx < width; dx++)
      for (let dz = 0; dz < depth; dz++) covered.add(`${best.x + dx}:${best.z + dz}`);
  }
  for (const cell of [...below].sort()) {
    const [x, z] = cell.split(':').map(Number);
    if (covered.has(cell) || hash(x, z, 11) > 0.6) continue;
    if (fits({ x0: x, x1: x + 1, z0: z, z1: z + 1, y0: y, y1: y + 1 }))
      add('6141', hash(x, z) < 0.5 ? LIME : BRIGHT_GREEN, x, y, z);
  }
}

export const courtyardHouse: ExampleDefinition = {
  id: 'courtyard-house',
  name: 'Courtyard House',
  tags: [
    'demo',
    'medieval',
    'cottage',
    'half-timbered',
    'jettied',
    'chimney',
    'striped-awning',
    'tree',
    'sloped-roof',
  ],
  expectedPieceCount: 410,
  brickIdPrefix: 'demo',
  build(drawnAdd) {
    const turned = mirrored(turnAround(drawnAdd));
    const glazed = mirrored(glazeWindows(turnAround(drawnAdd), GLOW));
    // Everything laid so far, so the tree's crown and the grass dressing grow round it.
    const boxes: Box[] = [];
    const track =
      (inner: ExampleBrickAdder): ExampleBrickAdder =>
      (partId, color, x, y, z, rotation = 0, facing, upsideDown) => {
        const size = footprint({ id: '', partId, color, x, y, z, rotation, facing });
        boxes.push({
          x0: x,
          x1: x + size.width,
          z0: z,
          z1: z + size.depth,
          y0: y,
          y1: y + size.height,
        });
        inner(partId, color, x, y, z, rotation, facing, upsideDown);
      };
    const add = track(glazed);
    const open = track(turned);

    add('91405', GRASS, 0, 0, 0);

    // Stone ground floor: five masonry courses of mixed greys. The front holds a tall plank
    // door under a round-headed stone arch, with lanterns on corbels either side; each other
    // wall has a small glowing window. The top course swaps corner stones for timber brackets
    // that carry the jettied upper floor.
    const lanterns = [5, 10];
    const brackets = new Map<string, [number, number, number]>([
      // [x, z] of the wall cell -> [x, z, rotation] of the bracket overhanging the jetty.
      ['4:10', [4, 10, 180]],
      ['11:10', [11, 10, 180]],
      ['4:3', [4, 2, 0]],
      ['11:3', [11, 2, 0]],
      ['4:6', [3, 6, 90]],
      ['11:4', [11, 4, 270]],
    ]);
    for (let course = 0; course < 5; course++) {
      const y = 1 + course * 3;
      const window = course >= 1 && course <= 2;
      addRing(add, 'masonry', course % 2 ? STONE : DARK_STONE, 4, 3, 8, 8, y, course, (x, z) =>
        z === 10
          ? (x >= 6 && x <= 9) ||
            (course >= 3 && x >= 5 && x <= 10) ||
            (course === 2 && lanterns.includes(x)) ||
            (course === 4 && brackets.has(`${x}:${z}`))
          : (window && z === 3 && x >= 7 && x <= 8) ||
            (window && (x === 4 || x === 11) && z >= 6 && z <= 7) ||
            (course === 4 && brackets.has(`${x}:${z}`)),
      );
      if (course === 1) {
        add('60592', TIMBER, 7, y, 3, 90);
        for (const x of [4, 11]) add('60592', TIMBER, x, y, 6);
      }
    }
    for (const [x, z, rotation] of brackets.values())
      add('3665a', TIMBER, x, 13, z, rotation as Rotation);

    // Wall lanterns: a black corbel in the wall carries a glowing lamp with a black cap.
    for (const x of lanterns) {
      add('3665a', BLACK, x, 7, 10, 180);
      add('3062b', GLOW, x, 10, 11);
      add('6141', BLACK, x, 13, 11);
      add('98138', BLACK, x, 14, 11);
    }

    // The door: planks of grooved bricks with an iron ring, a half-round fanlight in the same
    // timber, and the stone arch over both.
    for (let course = 0; course < 3; course++) {
      const y = 1 + course * 3;
      if (course === 1) {
        add('4216', TIMBER, 6, y, 10, 90);
        add('4070', BLACK, 8, y, 10, 180);
        add('3005', TIMBER, 9, y, 10);
      } else for (const x of [6, 8]) add('4216', TIMBER, x, y, 10, 90);
    }
    open('20309', TIMBER, 6, 10, 10, 90);
    add('15254', DARK_STONE, 5, 10, 10, 90);

    // Jetty: a timber floor plate overhanging the stonework by a stud all round.
    addAreaMap(
      (partId, color, x, y, z, rotation) => add(partId, color, x + 3, y, z + 2, rotation),
      Array(10).fill('t'.repeat(10)),
      16,
      { t: ['plate', TIMBER] },
    );

    // Upper storey: one course of tan plaster between timber posts all round.
    const posts = new Set(['3:2', '12:2', '3:11', '12:11', '5:11', '10:11', '5:2', '10:2']);
    for (const z of [5, 8]) {
      posts.add(`3:${z}`);
      posts.add(`12:${z}`);
    }
    addRing(add, 'brick', PLASTER, 3, 2, 10, 10, 17, 0, (x, z) => posts.has(`${x}:${z}`));
    for (const post of posts) {
      const [x, z] = post.split(':').map(Number);
      add('3005', TIMBER, x, 17, z);
    }

    // Gables front and back: a latticed window between dark shutters, timber under the eaves
    // and a king post under the ridge. Course k spans x 4+k..11-k under the roof's steps.
    for (const z of [2, 11]) {
      add('3005', TIMBER, 4, 20, z);
      add('3005', TIMBER, 11, 20, z);
      for (const y of [20, 23]) for (const x of [5, 10]) add('3005', DARK_TIMBER, x, y, z);
      addLatticeWindow(open, 6, 20, z);
      add('3004', TIMBER, 7, 29, z, 90);
    }
    // A warm light inside, behind each latticed window.
    for (const z of [3, 10]) {
      addRun(add, 'brick', DARK_TIMBER, 'x', 6, 17, z, 4);
      for (const y of [20, 23, 26]) addRun(add, 'brick', GLOW, 'x', 6, y, z, 4);
    }

    // Dormer on the right slope: a small gabled bay with a glowing window, its walls standing
    // on the jetty floor before the main roof steps over them.
    for (const z of [5, 8]) addRun(add, 'brick', PLASTER, 'x', 9, 17, z, 3);
    for (const y of [20, 23, 26])
      for (const z of [5, 8]) addRun(add, 'brick', PLASTER, 'x', 9, y, z, 3);
    for (const y of [20, 23]) for (const z of [5, 8]) add('3005', TIMBER, 12, y, z);
    add('60592', TIMBER, 12, 20, 6);
    add('3010', TIMBER, 12, 26, 5);
    add('3004', PLASTER, 12, 29, 6);
    add('3004', DARK_TIMBER, 11, 17, 6);
    for (const y of [20, 23, 26]) add('3004', GLOW, 11, y, 6);
    add('3004', PLASTER, 11, 29, 6);

    // Roof: steep dark red slopes stepping in a stud a course, mottled with brighter red, and a
    // ridge on top. The right side is cut away for the chimney at the eave and for the dormer.
    const segments = [
      [1, 2],
      [3, 4],
      [5, 8],
      [9, 10],
      [11, 12],
    ] as const;
    for (let k = 0; k < 5; k++) {
      const y = 20 + k * 3;
      for (const [from, to] of segments) {
        const color = (side: number) => roofColor(k, from, side);
        addSlopes(add, color(0), '-x', 2 + k, y, from, to - from + 1);
        if (k === 0 && from === 1) {
          // Beside the chimney the eave gives way to a flat course under the next step.
          add('3004', TIMBER, 12, y, 1);
          continue;
        }
        if (k <= 2 && from === 5) continue;
        addSlopes(add, color(1), '+x', 12 - k, y, from, to - from + 1);
      }
    }
    for (let z = 1; z <= 11; z += 2) add('3043', ROOF, 7, 35, z, 90);
    // The dormer's own little roof, its ridge running out to the eave.
    addSlopes(add, ROOF, '-z', 11, 29, 4, 3);
    addSlopes(add, ROOF, '+z', 11, 29, 8, 3);
    for (const x of [10, 12]) add('3043', ROOF, x, 32, 6);

    // Chimney: a bonded stack of masonry bricks rising past the ridge, a dark cap and smoke.
    for (let course = 0; course < 13; course++) {
      const y = 1 + course * 3;
      if (course % 2) for (const x of [13, 14]) add('98283', stone(x, course), x, y, 1);
      else for (const z of [1, 2]) add('98283', stone(z, course), 13, y, z, 90);
    }
    add('3022', DARK_STONE, 13, 40, 1);
    add('3941', WHITE, 13, 41, 1);
    add('3062b', WHITE, 14, 44, 2);
    add('4032a', WHITE, 13, 47, 1);

    // Porch on the right: timber posts, a plate roof and a red and white striped awning
    // falling to the front, sheltering a barrel and a crate of apples behind a fence.
    for (const [x, z] of [
      [12, 5],
      [15, 5],
      [12, 12],
      [15, 12],
    ] as const) {
      add('14716', TIMBER, x, 1, z);
      add('3005', TIMBER, x, 10, z);
    }
    add('3035', TIMBER, 12, 13, 5);
    for (let x = 13; x <= 15; x++) {
      const stripe = x % 2 ? RED : WHITE;
      add('3004', stripe, x, 14, 5);
      add('3622', stripe, x, 14, 7);
      add('4286', stripe, x, 14, 10, 180);
      add('3004', stripe, x, 17, 5);
      add('4286', stripe, x, 17, 7, 180);
      add('3069b', stripe, x, 20, 5);
    }
    addBarrel(add, 13, 6);
    add('3022', TIMBER, 13, 1, 9);
    for (const [dx, dz] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ] as const) {
      add('3005', dx === dz ? DARK_TIMBER : TIMBER, 13 + dx, 2, 9 + dz);
      add('98138', (dx + dz) % 2 ? RED : BRIGHT_GREEN, 13 + dx, 5, 9 + dz);
    }
    add('30055', TIMBER, 12, 1, 13, 90);

    // Ivy climbing the chimney and the front corners of the stonework.
    const ivy = (x: number, z: number, from: number, to: number) => {
      for (let y = from; y < to; y += 3)
        add('3062b', hash(x, y, z) < 0.45 ? DARK_GRASS : GRASS, x, y, z);
    };
    ivy(14, 3, 1, 28);
    add('6141', LIME, 14, 28, 3);
    ivy(15, 2, 1, 22);
    add('6141', LIME, 15, 22, 2);
    ivy(3, 10, 1, 16);
    ivy(12, 10, 1, 13);

    // A slim broadleaf tree on the left, its crown filling the space under the eaves and
    // spreading out over the roof higher up.
    addCrown(add, boxes);

    // Garden: a barrel and flowers by the door, a fence along the front and a woodpile behind.
    addBarrel(add, 1, 10);
    add('30055', TIMBER, 0, 1, 13, 90);
    for (const [x, z, bloom] of [
      [4, 11, ORANGE],
      [10, 13, PINK],
    ] as const) {
      add('18674', GRASS, x, 1, z);
      add('4727', GRASS, x, 2, z);
      add('24866', bloom, x, 5, z);
    }
    for (const z of [0, 1]) {
      add('30137', z ? TIMBER : DARK_TIMBER, 4, 1, z, 90);
      add('30137', z ? DARK_TIMBER : TIMBER, 5, 4, z, 90);
    }
    add('30136', TIMBER, 6, 7, 0, 90);
    addBarrel(add, 10, 0);

    // Ground: a cobbled path to the door and grass dotted with tiles, buds and sprigs.
    const path = (x: number, z: number) =>
      (z === 11 && x >= 5 && x <= 10) || (z >= 12 && x >= 6 && x <= 9);
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        const cell = { x0: x, x1: x + 1, z0: z, z1: z + 1, y0: 1, y1: 2 };
        if (boxes.some((box) => overlaps(box, cell))) continue;
        const roll = hash(x, z, 3);
        if (path(x, z)) add('3070b', roll < 0.35 ? DARK_STONE : STONE, x, 1, z);
        else if (roll < 0.12) add('3070b', BRIGHT_GREEN, x, 1, z);
        else if (roll < 0.22) add('3070b', DARK_GRASS, x, 1, z);
        else if (roll < 0.26) add('3070b', LIME, x, 1, z);
        else if (roll < 0.31) add('98138', hash(x, z) < 0.5 ? YELLOW : PINK, x, 1, z);
      }
  },
};
