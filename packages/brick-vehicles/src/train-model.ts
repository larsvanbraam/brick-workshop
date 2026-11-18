import { getLDrawTransform } from '@brick-workshop/engine';
import type { Brick } from '@brick-workshop/engine';
import {
  BOGIE_LENGTH,
  LOCOMOTIVE_LENGTH,
  TENDER_LENGTH,
  WAGON_LENGTH,
  addSteamTrain,
  steamTrainLength,
} from '@brick-workshop/engine/examples/steam-train';
import type { Bogie, Matrix3, Placement } from './models';

/**
 * The steam train's models, taken straight from the example build: every brick of each car is
 * placed once, in the car's own frame (LDraw units, its middle at x 0, z 0, the track's top at
 * y 0, the front facing -z like the other vehicles). The example lays the train along +x, so each
 * piece is turned a quarter to face -z.
 */

/**
 * The single-axle bogie each car stands on, which LDraw builds from a holder and a wheelset 34 units
 * below the holder's origin (see `2878c01.dat`). They are drawn apart so the wheelset can spin.
 */
const BOGIE = '2878c01';
const HOLDER = '2878';
const WHEELSET = '70720c01';
const WHEELSET_DROP = 34;

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
  /** Everything but the bogies, placed about the car's middle. */
  body: Placement[];
  /**
   * The car's two bogies, rear first. Each is placed about its own pivot, which is `along` studs
   * from the car's middle (forward is positive), so it can swivel on the rails.
   */
  bogies: Bogie[];
}

/** The cars of the steam train, front car first, each ready to draw about its own middle. */
export function steamTrainCars(wagons = 2): TrainCar[] {
  const bricks: Brick[] = [];
  addSteamTrain(
    (partId, color, x, y, z, rotation = 0) => {
      bricks.push({ id: `train-${bricks.length}`, partId, color, x, y, z, rotation });
    },
    { x: 0, y: 0, z: 0, heading: 0, wagons, openBothSides: true },
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
      // The example's stairs beside each car are left off, as the stations bring the platform: they
      // are grey (71 or 72) and stand outside the car's own width (the cars run from z -3 to 3). The
      // locomotive's roof overhangs its rear by a stud, over the gap before it, so it keeps that
      // stud; the roof's side overhang is black, so the stair test leaves it.
      const reach = span.kind === 'locomotive' ? 1 : 0;
      const stairs = (brick: Brick) => brick.z < -3 && (brick.color === 71 || brick.color === 72);
      const mine = bricks.filter(
        (brick) =>
          brick.x >= span.from - reach - 1e-6 &&
          brick.x < span.from + span.length &&
          !stairs(brick),
      );
      const place = (brick: Brick, aroundZ = 0, part = brick.partId): Placement => {
        const { x, y, z, matrix } = getLDrawTransform(brick);
        return {
          part,
          color: brick.color,
          // x leads along the train and z is across it: x becomes -z, z becomes x.
          at: [z, y, -(x - middle * 20) - aroundZ] as const,
          turn: times(QUARTER, matrix),
        };
      };
      const body = mine.filter((brick) => brick.partId !== BOGIE).map((brick) => place(brick));
      const bogies = mine
        .filter((brick) => brick.partId === BOGIE)
        .map((brick): Bogie => {
          // The pivot is the middle of the stretch of train the bogie takes up.
          const along = brick.x + BOGIE_LENGTH / 2 - middle;
          const holder = place(brick, -along * 20, HOLDER);
          const turn = holder.turn ?? [1, 0, 0, 0, 1, 0, 0, 0, 1];
          // The wheelset hangs below the holder's origin, down the part's own y axis.
          const [x, y, z] = holder.at;
          const pivot = [
            x + turn[1]! * WHEELSET_DROP,
            y + turn[4]! * WHEELSET_DROP,
            z + turn[7]! * WHEELSET_DROP,
          ] as const;
          return {
            along,
            parts: [holder],
            wheels: { pivot, parts: [{ part: WHEELSET, color: 0, at: [0, 0, 0], turn }] },
          };
        })
        .sort((a, b) => a.along - b.along);
      return {
        kind: span.kind,
        offset: steamTrainLength(wagons) - middle,
        body,
        bogies,
        index,
      };
    })
    .reverse()
    .map(({ kind, offset, body, bogies }) => ({ kind, offset, body, bogies }));
}
