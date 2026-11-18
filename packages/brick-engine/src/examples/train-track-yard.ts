import { layPlateFloor } from '../board.ts';
import { addAreaMap, bottomUp, layTrack } from './layout.ts';
import { addSteamTrain } from './steam-train.ts';
import { addTree } from './trees.ts';
import type { Box } from './trees.ts';
import type { ExampleDefinition } from './types.ts';

// A small railway yard on a green board: a 9V loop of two curved ends and two straights, a switch
// on the front straight with a siding that runs off towards the front right, and inside the loop a
// platform with an open shelter, a bench and lamps. A water tower, crates and barrels stand by the
// siding and trees fill the corners. Everything is laid in world space (the front is low z),
// because curved track cannot be mirrored.
//
// The loop's centre line runs x 6..118 and z 36..116; its straights are 32 studs long and its ends
// semicircles of radius 40 studs, eight curves each. The platform runs along the back straight.

const SIZE = 128;
/** Top of the floor, where the track and everything else stands. */
const G = 2;

const GRASS = 2;
const DARK_GREEN = 288;
const BRIGHT_GREEN = 10;
const TRACK = 72;
const STONE = 71;
const DARK_STONE = 72;
const WHITE = 15;
const TIMBER = 70;
const DARK_TIMBER = 308;
const NOUGAT = 84;
const DARK_RED = 320;
const RED = 4;
const YELLOW = 14;
const BLUE = 272;

/** The loop starts at the switch, at the front left of its front straight, heading +x. */
const LOOP = { x: 46, z: 36 };
const MAIN = `r${'R'.repeat(8)}SS${'R'.repeat(8)}`;

/** The platform inside the loop, along the back straight, one plate short of the track's top. */
const PLATFORM = { x0: 48, x1: 75, z0: 104, z1: 110 };
const POST_X = [56, 61, 62, 67] as const;
const POST_Z = [106, 109] as const;
const LAMPS = [
  [49, 105],
  [73, 105],
] as const;
const BENCH = { x: 57, z: 108 };
const TOWER = { x: 14, z: 10 };

const plan = (cell: (x: number, z: number) => string) =>
  Array.from({ length: SIZE }, (_, z) =>
    Array.from({ length: SIZE }, (_, x) => cell(x, z)).join(''),
  );
const onPlatform = (x: number, z: number) =>
  x >= PLATFORM.x0 && x <= PLATFORM.x1 && z >= PLATFORM.z0 && z <= PLATFORM.z1;

export const trainTrackYard: ExampleDefinition = {
  id: 'train-track-yard',
  name: 'Train Track Yard',
  tags: ['train', 'track', 'landscape', 'curves', 'switch'],
  expectedPieceCount: 1275,
  buildArea: SIZE,
  build(emit) {
    const { add, flush } = bottomUp(emit);

    const floor = layPlateFloor({ x: 0, z: 0, width: SIZE, depth: SIZE }, GRASS);
    if (!floor) throw new Error('The floor needs whole 16 x 16 modules.');
    for (const brick of floor.bricks)
      add(brick.partId, brick.color, brick.x, brick.y, brick.z, brick.rotation);

    // ---- The railway: the loop, and the siding laid from the switch's branch.
    const loop = layTrack(add, TRACK, { x: LOOP.x, y: G, z: LOOP.z, angle: 0 }, MAIN);
    layTrack(add, TRACK, loop.branches[0]!, 'SS');

    // ---- A locomotive and its tender standing at the platform on the back straight, facing -x: the
    // straight is 32 studs long, which has room for them but not for a wagon as well.
    addSteamTrain(add, { x: 77, y: G + 3, z: LOOP.z + 80, heading: 180, wagons: 0 });

    // ---- The platform: two plate courses and a top of tiles, with a white edge on the track side
    // and open studs where posts, lamps and the bench stand.
    const posts = new Set(POST_X.flatMap((x) => POST_Z.map((z) => `${x},${z}`)));
    const studded = (x: number, z: number) =>
      posts.has(`${x},${z}`) ||
      LAMPS.some(([lx, lz]) => x >= lx && x <= lx + 1 && z >= lz && z <= lz + 1) ||
      (z === BENCH.z && (x === BENCH.x || x === BENCH.x + 3));
    for (const y of [G, G + 1])
      addAreaMap(
        add,
        plan((x, z) => (onPlatform(x, z) ? 'p' : ' ')),
        y,
        { p: ['plate', DARK_STONE] },
      );
    addAreaMap(
      add,
      plan((x, z) =>
        !onPlatform(x, z) ? ' ' : studded(x, z) ? 'P' : z === PLATFORM.z1 ? 'E' : 'T',
      ),
      G + 2,
      { T: ['tile', STONE], E: ['tile', WHITE], P: ['plate', DARK_STONE] },
    );
    const top = G + 3;

    // ---- The shelter: round posts three courses high, a roof of plates on them and dark red tiles
    // on the roof.
    for (const [x, z] of [...posts].map((key) => key.split(',').map(Number) as [number, number]))
      for (let course = 0; course < 3; course++) add('3062b', TIMBER, x, top + course * 3, z);
    const roofY = top + 9;
    for (const x of [56, 62]) add('3032', DARK_STONE, x, roofY, 106, 90);
    addAreaMap(
      add,
      plan((x, z) => (x >= 56 && x <= 67 && z >= 106 && z <= 109 ? 'r' : ' ')),
      roofY + 1,
      { r: ['tile', DARK_RED] },
    );

    // ---- A bench under the shelter: two legs and a seat of plates and a tile.
    for (const x of [BENCH.x, BENCH.x + 3]) add('3005', TIMBER, x, top, BENCH.z);
    add('3710', DARK_TIMBER, BENCH.x, top + 3, BENCH.z, 90);

    // ---- Lamps at either end of the platform.
    for (const [x, z] of LAMPS) add('2039', DARK_STONE, x, top, z);

    // ---- A water tower in the front left corner: four legs, a deck, a tank of round bricks
    // under a cone roof.
    const legs: [number, number][] = [
      [TOWER.x, TOWER.z],
      [TOWER.x + 5, TOWER.z],
      [TOWER.x, TOWER.z + 5],
      [TOWER.x + 5, TOWER.z + 5],
    ];
    const courses = 9;
    for (const [x, z] of legs)
      for (let course = 0; course < courses; course++)
        add('3005', course % 2 ? DARK_TIMBER : TIMBER, x, G + course * 3, z);
    const deckY = G + courses * 3;
    add('3958', DARK_TIMBER, TOWER.x, deckY, TOWER.z);
    for (let course = 0; course < 4; course++)
      for (const [dx, dz] of [
        [1, 1],
        [3, 1],
        [1, 3],
        [3, 3],
      ])
        add(
          '3941',
          (course + dx + dz) % 3 === 0 ? NOUGAT : TIMBER,
          TOWER.x + dx,
          deckY + 1 + course * 3,
          TOWER.z + dz,
        );
    const roofTop = deckY + 1 + 4 * 3;
    add('3031', DARK_RED, TOWER.x + 1, roofTop, TOWER.z + 1);
    add('4589', DARK_STONE, TOWER.x + 2, roofTop + 1, TOWER.z + 2);

    // ---- By the siding: crates and barrels.
    for (const [x, z, color] of [
      [84, 27, TIMBER],
      [86, 27, NOUGAT],
      [85, 29, DARK_TIMBER],
    ] as const) {
      add('3003', color, x, G, z);
      add('3003', color === NOUGAT ? TIMBER : NOUGAT, x, G + 3, z);
    }
    for (const [x, z] of [
      [90, 28],
      [92, 28],
    ] as const) {
      add('3941', DARK_TIMBER, x, G, z);
      add('3941', TIMBER, x, G + 3, z);
    }
    add('6141', YELLOW, 90, G + 6, 28);
    add('6141', RED, 92, G + 6, 28);

    // ---- Trees in the corners and inside the loop, each given room by the ones before it.
    const leaves: Box[] = [];
    for (const [x, z, trunk, seed] of [
      [8, 40, 6, 3],
      [12, 120, 7, 5],
      [116, 120, 6, 8],
      [121, 30, 6, 12],
      [46, 70, 6, 14],
      [76, 66, 5, 17],
      [20, 90, 5, 21],
    ] as const)
      addTree(add, x, z, G, [DARK_GREEN, GRASS, BRIGHT_GREEN], TIMBER, trunk, seed, leaves);
    void BLUE;

    flush();
  },
};
