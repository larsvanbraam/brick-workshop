import { getLDrawTransform } from '@brick-workshop/engine';
import type { Brick } from '@brick-workshop/engine';
import {
  LOCOMOTIVE_LENGTH,
  TENDER_LENGTH,
  WAGON_LENGTH,
  addSteamTrain,
  steamTrainLength,
} from '@brick-workshop/engine/examples/steam-train';
import type { Matrix3, Placement } from './models';

/**
 * The steam train's models, taken straight from the example build: every brick of each car is
 * placed once, in the car's own frame (LDraw units, its middle at x 0, z 0, the track's top at
 * y 0, the front facing -z like the other vehicles). The example lays the train along +x, so each
 * piece is turned a quarter to face -z.
 */

/** Turns the example's +x (the way the train leads) onto -z: a quarter turn about the upright. */
const QUARTER: Matrix3 = [0, 0, 1, 0, 1, 0, -1, 0, 0];

function times(a: Matrix3, b: readonly number[]): Matrix3 {
  const out: number[] = [];
  for (let row = 0; row < 3; row++)
    for (let column = 0; column < 3; column++)
      out.push(
        a[row * 3]! * b[column]! +
          a[row * 3 + 1]! * b[3 + column]! +
          a[row * 3 + 2]! * b[6 + column]!,
      );
  return out as unknown as Matrix3;
}

export interface TrainCar {
  kind: 'locomotive' | 'tender' | 'wagon';
  /** Studs from the front of the train to this car's middle. */
  offset: number;
  body: Placement[];
}

/** The cars of the steam train, front car first, each ready to draw about its own middle. */
export function steamTrainCars(wagons = 2): TrainCar[] {
  const bricks: Brick[] = [];
  addSteamTrain(
    (partId, color, x, y, z, rotation = 0) => {
      bricks.push({ id: `train-${bricks.length}`, partId, color, x, y, z, rotation });
    },
    { x: 0, y: 0, z: 0, heading: 0, wagons },
  );
  // Rear to front: the wagons, the tender, the locomotive, each GAP studs apart.
  const rear: { kind: TrainCar['kind']; length: number }[] = [
    ...Array.from({ length: wagons }, () => ({ kind: 'wagon' as const, length: WAGON_LENGTH })),
    { kind: 'tender', length: TENDER_LENGTH },
    { kind: 'locomotive', length: LOCOMOTIVE_LENGTH },
  ];
  const spans: { kind: TrainCar['kind']; from: number; length: number }[] = [];
  let at = 0;
  for (const car of rear) {
    spans.push({ kind: car.kind, from: at, length: car.length });
    at += car.length + 1;
  }
  return spans
    .map((span, index) => {
      const middle = span.from + span.length / 2;
      const body: Placement[] = bricks
        // The example's stairs beside each car stand outside the car's own width (the cars run
        // from z -3 to 3), so they are left off: the stations bring the platform.
        .filter(
          (brick) =>
            brick.x >= span.from - 1e-6 && brick.x < span.from + span.length && brick.z >= -3,
        )
        .map((brick) => {
          const { x, y, z, matrix } = getLDrawTransform(brick);
          const turn = times(QUARTER, matrix);
          return {
            part: brick.partId,
            color: brick.color,
            // x leads along the train and z is across it: x becomes -z, z becomes x.
            at: [z, y, -(x - middle * 20)] as const,
            turn,
          };
        });
      return {
        kind: span.kind,
        offset: steamTrainLength(wagons) - middle,
        body,
        index,
      };
    })
    .reverse()
    .map(({ kind, offset, body }) => ({ kind, offset, body }));
}
