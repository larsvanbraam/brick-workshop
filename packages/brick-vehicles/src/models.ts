import { steamTrainCars } from './train-model';
import type { VehicleKind } from './vehicle';

/**
 * The vehicles' LEGO models: which LDraw parts each is built from and where they sit. Positions
 * are in LDraw units (20 a stud, 8 a plate, 24 a brick) and LDraw's frame: y points down, so up is
 * negative, the front faces -z, and the ground under the wheels is y 0, with the vehicle's middle
 * (halfway between its axles) at x 0, z 0. A part's origin is the middle of its top, so a plate
 * resting on a surface at height `h` sits at `h - 8` and a brick at `h - 24`.
 */

export type Vec3 = readonly [x: number, y: number, z: number];
/** An LDraw rotation matrix, row by row (`a b c d e f g h i`). */
export type Matrix3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface Placement {
  part: string;
  /** An LDraw colour code. */
  color: number;
  at: Vec3;
  turn?: Matrix3;
}

/** Parts that move together about a pivot: a wheel, a rotor, a propeller, handlebars. */
export interface Moving {
  /** Where it turns, in the model's frame. */
  pivot: Vec3;
  /** Its parts, placed about the pivot. */
  parts: readonly Placement[];
  /** What turns it: rolling with the wheels, or the engine driving a rotor or propeller. */
  spin?: 'wheel' | 'engine';
  /** The axis it spins about. */
  axis?: 'x' | 'y' | 'z';
  /** Turns about the upright by this much, in radians, at full steering. */
  steer?: number;
}

/**
 * How the driver sits, as turns in radians about the minifigure's pivots (LDraw's frame: a
 * negative turn about x swings a limb forward; the body turns about its shoulders).
 */
export interface Rider {
  /** Where the top of the driver's torso goes. */
  seat: Vec3;
  /** The body leaning forward about the shoulders (positive) or upright (0). */
  lean: number;
  /** Both legs about the hips: about -1.57 sits with the thighs level. */
  legs: number;
  /** Both arms about the shoulders, reaching for the wheel, bars or stick. */
  arms: number;
  /** The arms turned out to the sides (positive), to reach wide handlebars. */
  armsOut?: number;
  /** The legs swing this far each way with the wheels, pedalling. */
  pedal?: number;
  /** Where the first-person camera goes when the driver's own eyes are boxed in (a train's cab). */
  eye?: Vec3;
}

/**
 * One of a train's bogies: where its pivot is, the holder placed about it, and the wheelset that
 * turns in the holder about its own axle.
 */
export interface Bogie {
  along: number;
  parts: readonly Placement[];
  wheels: { pivot: Vec3; parts: readonly Placement[] };
}

export interface VehicleModel {
  kind: VehicleKind;
  body: readonly Placement[];
  moving: readonly Moving[];
  rider: Rider;
  /**
   * A train's bogies, which swivel on the rails: each is placed about its own pivot, `along` studs
   * from the middle (forward is positive). The locomotive's are here, the cars' are in `trailers`.
   */
  bogies?: readonly Bogie[];
  /** Cars drawn behind a train, each hanging on the rails `offset` studs from its front. */
  trailers?: readonly { offset: number; body: readonly Placement[]; bogies: readonly Bogie[] }[];
}

const turnY = (degrees: number): Matrix3 => {
  const a = (degrees * Math.PI) / 180;
  const c = Math.round(Math.cos(a) * 1e6) / 1e6;
  const s = Math.round(Math.sin(a) * 1e6) / 1e6;
  return [c, 0, s, 0, 1, 0, -s, 0, c];
};
const turnX = (degrees: number): Matrix3 => {
  const a = (degrees * Math.PI) / 180;
  const c = Math.round(Math.cos(a) * 1e6) / 1e6;
  const s = Math.round(Math.sin(a) * 1e6) / 1e6;
  return [1, 0, 0, 0, c, -s, 0, s, c];
};
/** Turned a quarter: a part long along x runs along z, and a wheel's axle points across. */
const ACROSS = turnY(90);
const ACROSS_BACK = turnY(-90);

const piece = (part: string, color: number, at: Vec3, turn?: Matrix3): Placement =>
  turn ? { part, color, at, turn } : { part, color, at };

/** A wheel on each side at `x` and `-x`, each turned so its face looks outward. */
function pair(
  x: number,
  y: number,
  z: number,
  parts: (side: 1 | -1) => Placement[],
  steer?: number,
): Moving[] {
  return ([1, -1] as const).map((side) => ({
    pivot: [side * x, y, z] as const,
    parts: parts(side),
    spin: 'wheel' as const,
    axis: 'x' as const,
    ...(steer ? { steer } : {}),
  }));
}

const side = (s: 1 | -1) => (s > 0 ? ACROSS : ACROSS_BACK);

/** LDraw colours. */
const BLACK = 0;
const BLUE = 1;
const GREEN = 2;
const RED = 4;
const YELLOW = 14;
const WHITE = 15;
const ORANGE = 25;
const TRANS_RED = 36;
const TRANS_LIGHT_BLUE = 43;
const TRANS_CLEAR = 47;
const LIGHT_GREY = 71;
const DARK_GREY = 72;
const RUBBER = 256;
const DARK_BLUE = 272;

/**
 * A small open-topped town car on a 4 x 10 car base with mudguards: a short bonnet with
 * headlights and a grille, a windscreen, the driver in the well behind the steering wheel, doors
 * along the sides and a boot with tail lights.
 */
const CAR: VehicleModel = {
  kind: 'car',
  body: [
    piece('12622', BLUE, [0, -47, 0]),
    // The bonnet: headlights either side of a grille, a tile over them.
    piece('4070', WHITE, [-30, -71, -90]),
    piece('4070', WHITE, [30, -71, -90]),
    piece('2877', DARK_GREY, [0, -71, -90]),
    piece('2431', BLUE, [0, -79, -90]),
    piece('3823', TRANS_CLEAR, [0, -95, -50]),
    piece('3829c01', DARK_GREY, [0, -31, -30]),
    piece('4079', BLACK, [0, -31, 10]),
    // Doors with a white stripe along their tops.
    piece('3010', BLUE, [-30, -71, 0], ACROSS),
    piece('3010', BLUE, [30, -71, 0], ACROSS),
    piece('2431', WHITE, [-30, -79, 0], ACROSS),
    piece('2431', WHITE, [30, -79, 0], ACROSS),
    // The boot and the tail lights.
    piece('3001', BLUE, [0, -71, 60]),
    piece('87079', BLUE, [0, -79, 60]),
    piece('3005', TRANS_RED, [-30, -71, 90]),
    piece('3005', TRANS_RED, [30, -71, 90]),
    piece('3004', BLUE, [0, -71, 90]),
    piece('3069b', BLUE, [0, -79, 90]),
    piece('3070b', BLUE, [-30, -79, 90]),
    piece('3070b', BLUE, [30, -79, 90]),
  ],
  moving: [
    ...pair(44, -18, -60, (s) => [piece('30027bc01', LIGHT_GREY, [0, 0, 0], side(s))], 0.45),
    ...pair(44, -18, 60, (s) => [piece('30027bc01', LIGHT_GREY, [0, 0, 0], side(s))]),
  ],
  rider: { seat: [0, -81, 12], lean: 0, legs: -Math.PI / 2, arms: -1.1 },
};

/**
 * A single-seat race car: a long low nose with a front wing, the driver in an open cockpit behind
 * a red cowl, side pods, the engine cover and a rear wing on posts, on fat slick tyres.
 */
const RACECAR: VehicleModel = {
  kind: 'racecar',
  body: [
    piece('3030', BLACK, [0, -34, 0], ACROSS),
    // The nose and its wing.
    piece('3020', BLACK, [0, -34, -140], ACROSS),
    piece('61678', RED, [-10, -58, -140]),
    piece('61678', RED, [10, -58, -140]),
    piece('3034', BLACK, [0, -26, -170]),
    piece('3069b', RED, [-70, -34, -170]),
    piece('3069b', RED, [70, -34, -170]),
    piece('18972', RED, [0, -66, -30]),
    // Side pods, curving down at the front.
    piece('50950', RED, [-30, -58, -10]),
    piece('50950', RED, [30, -58, -10]),
    piece('3010', RED, [-30, -58, 60], ACROSS),
    piece('3010', RED, [30, -58, 60], ACROSS),
    piece('2431', WHITE, [-30, -66, 60], ACROSS),
    piece('2431', WHITE, [30, -66, 60], ACROSS),
    // The engine cover, the rear wing on its posts and the diffuser under the tail.
    piece('3001', RED, [0, -58, 80], ACROSS),
    piece('87079', WHITE, [0, -66, 80], ACROSS),
    piece('3062b', BLACK, [-20, -90, 110]),
    piece('3062b', BLACK, [20, -90, 110]),
    piece('3795', RED, [0, -98, 120]),
    piece('3020', BLACK, [0, -34, 120]),
  ],
  moving: [
    ...pair(
      56,
      -30,
      -90,
      (s) => [
        piece('18976', DARK_GREY, [0, 0, 0], side(s)),
        piece('18977', BLACK, [0, 0, 0], side(s)),
      ],
      0.35,
    ),
    ...pair(56, -30, 90, (s) => [
      piece('18976', DARK_GREY, [0, 0, 0], side(s)),
      piece('18977', BLACK, [0, 0, 0], side(s)),
    ]),
  ],
  rider: { seat: [0, -84, 22], lean: 0, legs: -Math.PI / 2, arms: -1.1 },
};

/** The racing motorcycle's frame and fairing as LEGO sells it (18895c01), stood on its tyres. */
const MOTORCYCLE_WHEEL = [
  piece('50862', DARK_GREY, [0, 0, 0], ACROSS),
  piece('50861', RUBBER, [0, 0, 0], ACROSS),
];
const MOTORCYCLE: VehicleModel = {
  kind: 'motorcycle',
  body: [piece('18896', BLACK, [0, -16.6, 10]), piece('18895', ORANGE, [0, -16.6, 10])],
  moving: [
    { pivot: [0, -26.6, -60], parts: MOTORCYCLE_WHEEL, spin: 'wheel', axis: 'x', steer: 0.35 },
    { pivot: [0, -26.6, 60], parts: MOTORCYCLE_WHEEL, spin: 'wheel', axis: 'x' },
    {
      pivot: [0, -70.6, -40],
      parts: [
        piece(
          '30031',
          DARK_GREY,
          [0, 0, 0],
          [1, 0, 0, 0, 0.945217, 0.32562, 0, -0.32562, 0.945217],
        ),
      ],
      steer: 0.35,
    },
  ],
  // Crouched over the tank, hands on the grips and legs tucked into the fairing.
  rider: { seat: [0, -98, -9], lean: 0.5, legs: -1.45, arms: -1.4 },
};

/** The minifigure bicycle (4719) with its two wheels, as in 4719c03. */
const BIKE_WHEEL = [piece('92851', LIGHT_GREY, [0, 0, 0], [0, 0, -1, 0, 1, 0, 1, 0, 0])];
const BIKE: VehicleModel = {
  kind: 'bike',
  body: [piece('4719', GREEN, [0, -51.2, 43])],
  moving: [
    { pivot: [0, -21.2, -43], parts: BIKE_WHEEL, spin: 'wheel', axis: 'x', steer: 0.4 },
    { pivot: [0, -21.2, 43], parts: BIKE_WHEEL, spin: 'wheel', axis: 'x' },
  ],
  // On the saddle, leaning to the handlebar's grips, feet down to the cranks.
  rider: { seat: [0, -88, -2], lean: 0.35, legs: -0.8, arms: -1, pedal: 0.3 },
};

/**
 * A white and red rescue helicopter on skids: the pilot behind a windscreen in a cabin with open
 * sides, a long two-bladed rotor on a mast, a tail boom with a fin and a tail rotor.
 */
const HELICOPTER: VehicleModel = {
  kind: 'helicopter',
  body: [
    piece('3460', BLACK, [-30, -8, 0], ACROSS),
    piece('3460', BLACK, [30, -8, 0], ACROSS),
    ...[-30, 30].flatMap((x) => [
      piece('3062b', BLACK, [x, -32, -50]),
      piece('3062b', BLACK, [x, -32, 50]),
    ]),
    piece('3035', WHITE, [0, -40, 0], ACROSS),
    // A low wall at the front under the windscreen, clear of the pilot's feet.
    piece('3010', RED, [0, -64, -60]),
    piece('3010', WHITE, [0, -88, -60]),
    piece('3823', TRANS_LIGHT_BLUE, [0, -136, -50]),
    piece('4079', BLACK, [0, -48, -10]),
    // The cabin's back, four bricks tall so the pilot sits upright under the roof.
    ...[20, 60].flatMap((z) => [
      piece('3001', RED, [0, -64, z]),
      piece('3001', WHITE, [0, -88, z]),
      piece('3001', WHITE, [0, -112, z]),
      piece('3001', WHITE, [0, -136, z]),
    ]),
    piece('3035', WHITE, [0, -144, 0], ACROSS),
    piece('3062b', LIGHT_GREY, [0, -168, 0]),
    piece('3001', WHITE, [0, -88, 120], ACROSS),
    piece('3001', WHITE, [0, -88, 200], ACROSS),
    piece('2340', RED, [0, -160, 220]),
  ],
  moving: [
    {
      pivot: [0, -168, 0],
      parts: [piece('30644', BLACK, [0, -24, 0]), piece('30644', BLACK, [0, -24, 0], ACROSS)],
      spin: 'engine',
      axis: 'y',
    },
    {
      pivot: [18, -140, 225],
      parts: [piece('3480', BLACK, [-44, 8, 0])],
      spin: 'engine',
      axis: 'x',
    },
  ],
  rider: { seat: [0, -98, -8], lean: 0, legs: -Math.PI / 2, arms: -0.9 },
};

/**
 * A yellow propeller plane on four small wheels: an engine with a spinning propeller, a
 * windscreen, an open cockpit, low wings with dark blue tips, and a tail with a fin.
 */
const AIRPLANE: VehicleModel = {
  kind: 'airplane',
  body: [
    piece('4600', DARK_GREY, [0, -23, -60]),
    piece('4600', DARK_GREY, [0, -23, 60]),
    piece('3030', YELLOW, [0, -31, -40], ACROSS),
    piece('3031', YELLOW, [0, -31, 100]),
    // The wings, with dark blue tips.
    piece('3030', YELLOW, [-140, -31, 60]),
    piece('3030', YELLOW, [140, -31, 60]),
    piece('41770a', DARK_BLUE, [-260, -31, 60]),
    piece('41769a', DARK_BLUE, [260, -31, 60]),
    // The engine, the windscreen and the cockpit.
    piece('3001', DARK_GREY, [0, -55, -120]),
    piece('3001', YELLOW, [0, -79, -120]),
    piece('3823', TRANS_CLEAR, [0, -79, -70]),
    piece('4079', BLACK, [0, -39, -40]),
    piece('3004', YELLOW, [-30, -55, -40], ACROSS),
    piece('3004', YELLOW, [30, -55, -40], ACROSS),
    // The fuselage back to the tail.
    piece('3001', YELLOW, [0, -55, 0]),
    piece('3001', YELLOW, [0, -55, 40]),
    piece('3001', YELLOW, [0, -55, 80]),
    piece('3001', YELLOW, [0, -55, 120]),
    piece('87079', YELLOW, [0, -63, 0]),
    piece('87079', YELLOW, [0, -63, 40]),
    piece('87079', YELLOW, [0, -63, 80]),
    piece('3034', DARK_BLUE, [0, -63, 120]),
    piece('2340', DARK_BLUE, [0, -135, 130]),
  ],
  moving: [
    ...pair(30, -18, -60, (s) => [piece('4624c01', LIGHT_GREY, [0, 0, 0], side(s))], 0.3),
    ...pair(30, -18, 60, (s) => [piece('4624c01', LIGHT_GREY, [0, 0, 0], side(s))]),
    {
      pivot: [0, -55, -140],
      parts: [
        piece('4589', DARK_GREY, [0, 0, -24], turnX(90)),
        piece('4745', BLACK, [0, 0, -14], turnX(90)),
      ],
      spin: 'engine',
      axis: 'z',
    },
  ],
  // Hands on the dashboard behind the windscreen.
  rider: { seat: [0, -87, -32], lean: 0, legs: -Math.PI / 2, arms: -0.7 },
};

/**
 * The steam train, from the example build: the locomotive is the model's body, with its driver
 * standing in the cab, and the tender and wagons trail behind. Built on first use.
 */
let train: VehicleModel | null = null;
function trainModel(): VehicleModel {
  if (train) return train;
  const [locomotive, ...cars] = steamTrainCars(2);
  train = {
    kind: 'train',
    body: locomotive!.body,
    moving: [],
    bogies: locomotive!.bogies,
    trailers: cars.map((car) => ({
      offset: car.offset - locomotive!.offset,
      body: car.body,
      bogies: car.bogies,
    })),
    // Standing in the cab's floor, at the back of the locomotive, facing the front.
    // The head just clears the cab roof, 12 plates over the floor. In first person the camera
    // rides on the front of the boiler, where the driver's view is not the back of the firebox.
    rider: { seat: [0, -146, 100], lean: 0, legs: 0, arms: -0.5, eye: [0, -190, -150] },
  };
  return train;
}

export const MODELS: Readonly<Record<VehicleKind, VehicleModel>> = Object.freeze({
  bike: BIKE,
  motorcycle: MOTORCYCLE,
  car: CAR,
  racecar: RACECAR,
  helicopter: HELICOPTER,
  airplane: AIRPLANE,
  get train() {
    return trainModel();
  },
});

/** Every part a model uses, once each. */
export function modelParts(model: VehicleModel): string[] {
  const parts = new Set(model.body.map((placement) => placement.part));
  for (const trailer of model.trailers ?? [])
    for (const placement of [
      ...trailer.body,
      ...trailer.bogies.flatMap((bogie) => [...bogie.parts, ...bogie.wheels.parts]),
    ])
      parts.add(placement.part);
  for (const bogie of model.bogies ?? [])
    for (const placement of bogie.parts) parts.add(placement.part);
  for (const moving of model.moving)
    for (const placement of moving.parts) parts.add(placement.part);
  return [...parts];
}
