import { footprint } from '../core.ts';
import type { Rotation } from '../core.ts';
import { addAreaMap, addRun } from './layout.ts';
import { random } from './trees.ts';
import type { ExampleBrickAdder } from './types.ts';

// A steam train that stands on 9V track: a locomotive with its boiler, chimney, dome and cab, a coal
// tender and open wagons, each car 6 studs wide on single-axle bogies (2878c01) that stand on the
// rails. The cars are drawn in a frame of their own, x along the train from its rear to its front
// and z across it, then turned onto the track in any of the four directions with `inFrame`, so
// the train can be dropped onto any straight run of track by `addSteamTrain`.
//
//   addSteamTrain(add, { x, y, z, heading: 0, wagons: 2 });
//
// puts the rear of the train at the world point (x, z) on the track's centre line, heading towards
// +x (0), +z (90), -x (180) or -z (270), standing on rails whose top is at plate height `y`.

export type Heading = 0 | 90 | 180 | 270;

/** Studs across a car, which is as wide as a bogie. */
export const TRAIN_WIDTH = 6;
/** Studs from end to end of each kind of car. */
export const LOCOMOTIVE_LENGTH = 14;
export const TENDER_LENGTH = 8;
export const WAGON_LENGTH = 9;
/** Studs between cars, where the buffers meet. */
const GAP = 1;

/** The length of a train with this many wagons, in studs. */
export const steamTrainLength = (wagons: number) =>
  wagons * (WAGON_LENGTH + GAP) + TENDER_LENGTH + GAP + LOCOMOTIVE_LENGTH;

const BLACK = 0;
const DARK_STONE = 72;
const STONE = 71;
const RED = 4;
const GOLD = 297;
const YELLOW = 14;
const TIMBER = 70;
const DARK_TIMBER = 308;
const NOUGAT = 84;
const COUPLING = DARK_STONE;

/**
 * Turns pieces drawn in the train's own frame (x along the train, z across it) onto the board:
 * the frame's origin lands on the world point `at`, and its +x leads off in `heading` (0 towards
 * +x, 90 towards +z, 180 towards -x, 270 towards -z). Pieces keep their handedness.
 */
export function inFrame(
  add: ExampleBrickAdder,
  at: { x: number; z: number },
  heading: Heading,
): ExampleBrickAdder {
  const turn = (x: number, z: number): [number, number] =>
    heading === 0 ? [x, z] : heading === 90 ? [-z, x] : heading === 180 ? [-x, -z] : [z, -x];
  return (partId, color, x, y, z, rotation = 0, facing, upsideDown, tilt, strung, yaw) => {
    if (facing || tilt || strung || yaw)
      throw new Error('A train frame places upright pieces only.');
    const { width, depth } = footprint({ id: '', partId, color, x, y, z, rotation });
    const [a, b] = [turn(x, z), turn(x + width, z + depth)];
    add(
      partId,
      color,
      Math.round((at.x + Math.min(a[0], b[0])) * 100) / 100,
      y,
      Math.round((at.z + Math.min(a[1], b[1])) * 100) / 100,
      ((rotation - heading + 360) % 360) as Rotation,
      undefined,
      upsideDown,
    );
  };
}

/** Moves everything a piece-adder places by whole studs. */
const shifted =
  (add: ExampleBrickAdder, dx: number, dz: number): ExampleBrickAdder =>
  (partId, color, x, y, z, rotation, ...rest) =>
    add(partId, color, x + dx, y, z + dz, rotation, ...rest);

/** A top-down character map of one course, `rows[z][x]`, built from a rectangle and what it keeps out. */
function rectMap(length: number, keep: (x: number, z: number) => string) {
  return Array.from({ length: TRAIN_WIDTH }, (_, z) =>
    Array.from({ length }, (_, x) => keep(x, z)).join(''),
  );
}

/** Which ends of a car are coupled to a neighbour: another car behind it, or one ahead of it. */
interface Links {
  behind: boolean;
  ahead: boolean;
}

/** Studs of a car's upper chassis course left out at a coupled end: the drawbar fills them. */
const HITCH_CELLS = 3;
/** Where the drawbar runs along each car, the middle of its width. */
const HITCH_Z = 2;

/**
 * Two courses of plates under every car: the lower one in runs along the train, each across a
 * bogie's studs, and the upper one over it. At a coupled end one stud of the upper course is
 * left open for the drawbar (`couple`).
 */
function chassis(add: ExampleBrickAdder, y: number, length: number, color: number, links: Links) {
  for (let z = 0; z < TRAIN_WIDTH; z++) addRun(add, 'plate', color, 'x', 0, y + 8, z, length);
  const open = (x: number, z: number) =>
    z === HITCH_Z &&
    ((links.ahead && x >= length - HITCH_CELLS) || (links.behind && x < HITCH_CELLS - 1));
  addAreaMap(
    add,
    rectMap(length, (x, z) => (open(x, z) ? ' ' : 'p')),
    y + 9,
    { p: ['plate', color] },
  );
}

/**
 * The coupling between two cars: a drawbar of dark plates in the middle of the chassis that
 * stands on the lower course of the rear car, crosses the stud of space between them and stands
 * on the lower course of the front car, so it holds both. `at` is the rear car's start and
 * `length` its length along the train.
 */
function couple(add: ExampleBrickAdder, y: number, at: number, length: number) {
  addRun(add, 'plate', COUPLING, 'x', at + length - HITCH_CELLS, y + 9, HITCH_Z, 2 * HITCH_CELLS);
}

/** Studs along the train from a car's rear to the near edge of each of its two bogies. */
export const LOCOMOTIVE_BOGIES = [1, 9] as const;
export const TENDER_BOGIES = [0, 5] as const;
export const WAGON_BOGIES = [0, 6] as const;
/** Studs along the train that a bogie takes up. */
export const BOGIE_LENGTH = 3;

/** The bogies of a car: each stands on the rails and carries the chassis on two studs. */
function bogies(add: ExampleBrickAdder, y: number, color: number, ...at: number[]) {
  for (const x of at) add('2878c01', color, x, y, 0, 90);
}

/** A perimeter wall of `courses` courses of bricks, one stud thick, with some cells left out. */
function walls(
  add: ExampleBrickAdder,
  y: number,
  length: number,
  courses: readonly number[],
  open: (course: number, x: number, z: number) => boolean = () => false,
) {
  courses.forEach((color, course) =>
    addAreaMap(
      add,
      rectMap(length, (x, z) =>
        (x === 0 || x === length - 1 || z === 0 || z === TRAIN_WIDTH - 1) && !open(course, x, z)
          ? 'w'
          : ' ',
      ),
      y + course * 3,
      { w: ['brick', color] },
    ),
  );
}

/**
 * A staircase up to a car's floor from the board, on the car's -z side, two studs wide at `x`. A
 * minifigure climbs about three plates a stride, so five treads (3, 3, 3, 2 and 2 plates) rise from
 * the ground beside the track to a landing flush with the car's floor `floor` plates up, and the
 * landing reaches over the track's edge to the car's side. Every column stands on the board's
 * studs, and the landing is plates over the tallest columns.
 */
function stairs(add: ExampleBrickAdder, x: number, floor: number, ground: number) {
  const tops = [ground + 3, ground + 6, ground + 9, floor - 2, floor - 1, floor - 1, floor - 1].map(
    (top, index) => ({
      z: -8 + index,
      height: top - ground,
    }),
  );
  for (const { z, height } of tops) {
    let y = ground;
    for (; y + 3 <= ground + height; y += 3) addRun(add, 'brick', STONE, 'x', x, y, z, 2);
    for (; y < ground + height; y++) addRun(add, 'plate', STONE, 'x', x, y, z, 2);
  }
  for (const dx of [0, 1]) addRun(add, 'plate', DARK_STONE, 'z', x + dx, floor - 1, -4, 4);
}

/** The locomotive: boiler, smokebox, chimney, dome, buffers and a cab with a roof. */
function locomotive(add: ExampleBrickAdder, y: number, links: Links) {
  const length = LOCOMOTIVE_LENGTH;
  bogies(add, y, RED, ...LOCOMOTIVE_BOGIES);
  chassis(add, y, length, RED, links);
  const deck = y + 10;

  // The cab: a minifigure (12 plates tall) stands inside on the 3 x 4 studs of the floor. Each side
  // has a two stud doorway at floor level and an open window above it between corner pillars, and
  // a band of bricks on the pillars carries a roof of plates 12 plates over the floor.
  const rear = (x: number, z: number) => x === 0 && z > 0 && z < TRAIN_WIDTH - 1;
  const sides = (x: number, z: number) => (z === 0 || z === TRAIN_WIDTH - 1) && x < 4;
  const pillar = (x: number, z: number) => (x === 0 || x === 3) && sides(x, z);
  const window = (x: number, z: number) => rear(x, z) && z % 2 === 1;
  [
    [(x: number, z: number) => rear(x, z) || pillar(x, z), BLACK],
    [(x: number, z: number) => (rear(x, z) && !window(x, z)) || pillar(x, z), BLACK],
    [(x: number, z: number) => (rear(x, z) && !window(x, z)) || pillar(x, z), BLACK],
    [(x: number, z: number) => rear(x, z) || pillar(x, z), BLACK],
  ].forEach(([keep, color], course) =>
    addAreaMap(
      add,
      rectMap(4, (x, z) => ((keep as typeof pillar)(x, z) ? 'c' : ' ')),
      deck + course * 3,
      { c: ['brick', color as number] },
    ),
  );
  stairs(add, 1, deck, y - 3);
  // A black roof that overhangs the rear and both sides by a stud, in two plate courses.
  addAreaMap(
    add,
    rectMap(4, () => 'r'),
    deck + 12,
    { r: ['plate', BLACK] },
  );
  addAreaMap(
    shifted(add, -1, -1),
    Array.from({ length: TRAIN_WIDTH + 2 }, () => 'rrrrr'),
    deck + 13,
    { r: ['plate', BLACK] },
  );

  // The boiler: three courses of black bricks four studs wide, a band of grey here and there,
  // and a roof of 45 degree slopes either side of a ridge, flat for the chimney and the dome.
  const boiler = (x: number, z: number) => x >= 4 && z >= 1 && z <= 4;
  for (const course of [0, 1, 2])
    addAreaMap(
      add,
      rectMap(length, (x, z) =>
        boiler(x, z)
          ? x === 13 && course === 0
            ? 'f'
            : x >= 12
              ? 's'
              : [6, 10].includes(x) && course === 1
                ? 'g'
                : 'b'
          : ' ',
      ),
      deck + course * 3,
      { b: ['brick', BLACK], g: ['brick', RED], s: ['brick', BLACK], f: ['brick', RED] },
    );
  const top = deck + 9;
  const flat = (x: number) => x >= 12 || (x >= 7 && x <= 9);
  addAreaMap(
    add,
    rectMap(length, (x, z) => (boiler(x, z) && flat(x) ? 't' : ' ')),
    top,
    { t: ['plate', BLACK] },
  );
  for (let x = 4; x < length; x++) {
    if (flat(x)) continue;
    add('3040b', BLACK, x, top, 1, 0);
    add('3040b', BLACK, x, top, 3, 180);
  }

  // A tall chimney of black round bricks with a red ring and a flared cap, and two black domes.
  add('3941', BLACK, 12, top + 1, 2);
  add('3941', BLACK, 12, top + 4, 2);
  add('3941', BLACK, 12, top + 7, 2);
  add('3022', RED, 12, top + 10, 2);
  add('3022', BLACK, 12, top + 11, 2);
  add('3941', BLACK, 7, top + 1, 2);
  add('3022', BLACK, 7, top + 4, 2);
  for (const z of [2, 3]) add('3062b', BLACK, 9, top + 1, z);
  add('6141', YELLOW, 13, top + 1, 1);
  add('6141', YELLOW, 13, top + 1, 4);

  // Buffers either side of the front, on the stud-bearing edge of the chassis.
  for (const z of [0, TRAIN_WIDTH - 1]) {
    add('3062b', RED, 13, deck, z);
    add('6141', GOLD, 13, deck + 3, z);
  }
  // A red footplate lip along both sides of the boiler.
  for (const z of [0, TRAIN_WIDTH - 1])
    addAreaMap(
      add,
      Array.from({ length: TRAIN_WIDTH }, (_, row) =>
        Array.from({ length }, (_, x) => (row === z && x >= 4 && x <= 11 ? 'l' : ' ')).join(''),
      ),
      deck,
      { l: ['tile', RED] },
    );
}

/** The tender: a coal bin on a chassis, with a taller wall towards the cab and coal heaped in it. */
function tender(add: ExampleBrickAdder, y: number, links: Links) {
  const length = TENDER_LENGTH;
  bogies(add, y, RED, ...TENDER_BOGIES);
  chassis(add, y, length, RED, links);
  const deck = y + 10;
  walls(add, deck, length, [BLACK, BLACK]);
  // The wall at the cab end stands one course higher.
  addAreaMap(
    add,
    rectMap(length, (x) => (x === length - 1 ? 'w' : ' ')),
    deck + 6,
    { w: ['brick', DARK_STONE] },
  );
  // Coal: a course of bricks inside the bin, then single studs of black and grey on top.
  addAreaMap(
    add,
    rectMap(length, (x, z) =>
      x > 0 && x < length - 1 && z > 0 && z < TRAIN_WIDTH - 1 ? 'k' : ' ',
    ),
    deck,
    { k: ['plate', BLACK] },
  );
  const pick = random(7);
  for (let x = 1; x < length - 1; x++)
    for (let z = 1; z < TRAIN_WIDTH - 1; z++)
      add('6141', pick() < 0.3 ? DARK_STONE : BLACK, x, deck + 1, z);
  for (const z of [0, TRAIN_WIDTH - 1]) {
    add('3062b', RED, 0, deck + 6, z);
    add('6141', STONE, 0, deck + 9, z);
  }
}

/** An open wagon of timber planks on a chassis, with stakes at its corners. */
function wagon(
  add: ExampleBrickAdder,
  y: number,
  planks: readonly [number, number],
  seed: number,
  links: Links,
  bothSides: boolean,
) {
  const length = WAGON_LENGTH;
  bogies(add, y, BLACK, ...WAGON_BOGIES);
  chassis(add, y, length, DARK_TIMBER, links);
  const deck = y + 10;
  const pick = random(seed);
  const side = (): number => (pick() < 0.35 ? planks[1] : planks[0]);
  // A doorway on the stair side, and on the far side too when there is a platform both ways.
  walls(
    add,
    deck,
    length,
    [side(), planks[0]],
    (_course, x, z) => (z === 0 || (bothSides && z === TRAIN_WIDTH - 1)) && (x === 3 || x === 4),
  );
  stairs(add, 3, deck + 1, y - 3);
  for (const x of [0, length - 1])
    for (const z of [0, TRAIN_WIDTH - 1]) add('3005', DARK_TIMBER, x, deck + 6, z);
  // A plank floor across the whole bed, with room for a minifigure (12 plates tall) to stand in
  // it: the bed is 7 x 4 studs inside and the walls are two courses, low enough to step or hop over.
  addAreaMap(
    add,
    rectMap(length, (x, z) =>
      x > 0 && x < length - 1 && z > 0 && z < TRAIN_WIDTH - 1 ? 'f' : ' ',
    ),
    deck,
    { f: ['plate', DARK_TIMBER] },
  );
}

export interface SteamTrain {
  /** Studs from the rear of the last wagon to the front of the locomotive. */
  length: number;
  /** The world point of the locomotive's front on the track's centre line. */
  front: { x: number; z: number };
}

/**
 * Puts a steam train on a straight run of 9V track: wagons first, then the tender and the locomotive
 * at the front, the rear of the train on the centre line at the world point (x, z). `y` is the
 * height in plates of the track's top, where the wheels stand, and `heading` is the way the
 * locomotive faces: 0 towards +x, 90 towards +z, 180 towards -x, 270 towards -z. Needs a straight
 * run `steamTrainLength(wagons)` studs long and clear of anything within 3 studs of the rails.
 */
export function addSteamTrain(
  add: ExampleBrickAdder,
  placement: {
    x: number;
    y: number;
    z: number;
    heading?: Heading;
    wagons?: number;
    /** Cuts a doorway in both sides of every wagon, not just the stair side. */
    openBothSides?: boolean;
  },
): SteamTrain {
  const { x, y, z, heading = 0, wagons = 2, openBothSides = false } = placement;
  const frame = shifted(inFrame(add, { x, z }, heading), 0, -TRAIN_WIDTH / 2);
  let at = 0;
  const palettes = [
    [TIMBER, NOUGAT],
    [DARK_TIMBER, TIMBER],
    [NOUGAT, TIMBER],
  ] as const;
  for (let index = 0; index < wagons; index++) {
    wagon(
      shifted(frame, at, 0),
      y,
      palettes[index % palettes.length]!,
      11 + index * 5,
      { behind: index > 0, ahead: true },
      openBothSides,
    );
    if (index > 0) couple(frame, y, at - GAP - WAGON_LENGTH, WAGON_LENGTH);
    at += WAGON_LENGTH + GAP;
  }
  if (wagons > 0) couple(frame, y, at - GAP - WAGON_LENGTH, WAGON_LENGTH);
  tender(shifted(frame, at, 0), y, { behind: wagons > 0, ahead: true });
  couple(frame, y, at, TENDER_LENGTH);
  at += TENDER_LENGTH + GAP;
  locomotive(shifted(frame, at, 0), y, { behind: true, ahead: false });
  const length = steamTrainLength(wagons);
  const lead =
    heading === 0
      ? [length, 0]
      : heading === 90
        ? [0, length]
        : heading === 180
          ? [-length, 0]
          : [0, -length];
  return { length, front: { x: x + lead[0]!, z: z + lead[1]! } };
}
