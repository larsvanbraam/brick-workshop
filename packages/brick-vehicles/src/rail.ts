import type { TrackPath } from '@brick-workshop/engine';
import {
  LOCOMOTIVE_LENGTH,
  TENDER_LENGTH,
  WAGON_LENGTH,
  steamTrainLength,
} from '@brick-workshop/engine/examples/steam-train';
import type { DriveInput } from './vehicle';

/**
 * A train on rails. It has no steering and no ground to find: it is a distance along a track path
 * (see `traceTrack` in the engine), a speed, and cars that hang behind the front at fixed offsets.
 * The handling is arcade like the other vehicles: throttle speeds it up, braking stops it, and the
 * buffers at the end of an open line stop it dead.
 */

/** The part of a `TrackPath` a train needs. Its points are in studs and plates. */
export type RailPath = Pick<TrackPath, 'length' | 'closed' | 'pointAt'>;

export interface RailSpec {
  /** Studs a second. */
  maxSpeed: number;
  reverseSpeed: number;
  acceleration: number;
  braking: number;
  /** How fast it coasts to a stop with nothing pressed. */
  drag: number;
  /** The wheels' radius in studs, for how fast they turn. */
  wheelRadius: number;
  /** Studs from the front of the train back to the middle of each car, front car first. */
  cars: readonly number[];
  /** How long each car is, in the same order. */
  lengths: readonly number[];
  /** What each car is, in the same order. */
  kinds: readonly ('locomotive' | 'tender' | 'wagon')[];
  /** The whole train's length in studs, from front to rear. */
  length: number;
}

/** Studs between cars, where the buffers meet (the example train's gap). */
const GAP = 1;

/**
 * The example steam train as a rail spec: a locomotive at the front, its tender and `wagons`
 * wagons behind. Each car's middle is measured from the front (see `addSteamTrain`).
 */
export function steamTrainSpec(wagons = 2): RailSpec {
  const length = steamTrainLength(wagons);
  const cars: number[] = [];
  const lengths: number[] = [];
  const kinds: ('locomotive' | 'tender' | 'wagon')[] = [
    'locomotive',
    'tender',
    ...Array.from({ length: wagons }, () => 'wagon' as const),
  ];
  let behind = 0;
  for (const car of [
    LOCOMOTIVE_LENGTH,
    TENDER_LENGTH,
    ...Array.from({ length: wagons }, () => WAGON_LENGTH),
  ]) {
    cars.push(behind + car / 2);
    lengths.push(car);
    behind += car + GAP;
  }
  return {
    maxSpeed: 14,
    reverseSpeed: 9,
    acceleration: 3.5,
    braking: 9,
    drag: 1.2,
    wheelRadius: 1.2,
    cars,
    lengths,
    kinds,
    length,
  };
}

/** The steam train: a locomotive, its tender and two wagons. */
export const STEAM_TRAIN: RailSpec = steamTrainSpec(2);

export interface RailTrain {
  /** Studs along the path to the train's front. */
  distance: number;
  /** Signed speed, studs a second: negative backs up. */
  speed: number;
  /** How far the wheels have turned, in radians. */
  wheelTurn: number;
  /** Whether someone is at the controls. */
  driven: boolean;
}

/** A train standing with its front `distance` studs along the path. */
export function parkTrain(distance: number): RailTrain {
  return { distance, speed: 0, wheelTurn: 0, driven: false };
}

const PLATE = 0.4;
const approach = (value: number, target: number, step: number) =>
  value < target ? Math.min(target, value + step) : Math.max(target, value - step);

/**
 * Advances a train by `delta` seconds of input. Returns whether it ran into the end of an open
 * line, for a bump. On a loop it goes round for ever.
 */
export function stepRail(
  path: RailPath,
  spec: RailSpec,
  train: RailTrain,
  input: DriveInput,
  delta: number,
) {
  const dt = Math.min(delta, 1 / 20);
  const given = train.driven ? input : { throttle: 0, brake: false };
  if (given.brake) train.speed = approach(train.speed, 0, spec.braking * dt);
  else if (given.throttle > 0)
    train.speed =
      train.speed < 0
        ? approach(train.speed, 0, spec.braking * dt)
        : approach(train.speed, spec.maxSpeed * given.throttle, spec.acceleration * dt);
  else if (given.throttle < 0)
    train.speed =
      train.speed > 0
        ? approach(train.speed, 0, spec.braking * dt)
        : approach(train.speed, spec.reverseSpeed * given.throttle, spec.acceleration * dt);
  else train.speed = approach(train.speed, 0, spec.drag * dt);

  train.wheelTurn += (train.speed * dt) / spec.wheelRadius;
  let distance = train.distance + train.speed * dt;
  if (path.closed) {
    train.distance = ((distance % path.length) + path.length) % path.length;
    return false;
  }
  // The whole train must stay on the rails: the front at the end, the rear at the start.
  const low = Math.min(spec.length, path.length);
  distance = Math.min(Math.max(distance, low), path.length);
  const bumped = distance !== train.distance + train.speed * dt && Math.abs(train.speed) > 0.5;
  if (distance !== train.distance + train.speed * dt) train.speed = 0;
  train.distance = distance;
  return bumped;
}

/** One car in the scene: its middle, and the heading the walker's yaw uses (0 faces -z). */
export interface CarPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/**
 * Where each car is, from the front car to the last. A car sits on the rails at its offset behind
 * the front and faces along them, so a train bends through curves car by car. Points are in
 * scene units: studs across, and 0.4 a plate up.
 */
export function carPoses(path: RailPath, spec: RailSpec, train: RailTrain): CarPose[] {
  return spec.cars.map((offset) => {
    const point = path.pointAt(train.distance - offset);
    const lead = (point.angle * Math.PI) / 180;
    return {
      x: point.x,
      y: point.y * PLATE,
      z: point.z,
      yaw: Math.atan2(-Math.cos(lead), -Math.sin(lead)),
    };
  });
}
