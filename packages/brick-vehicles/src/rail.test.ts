import { describe, expect, it } from 'vite-plus/test';
import type { Brick } from '@brick-workshop/engine';
import { traceTrack } from '@brick-workshop/engine';
import { layTrack } from '@brick-workshop/engine/examples/layout';
import { IDLE } from './vehicle';
import type { DriveInput } from './vehicle';
import { STEAM_TRAIN, carPoses, parkTrain, stepRail } from './rail';

function lay(path: string, angle = 0) {
  const bricks: Brick[] = [];
  layTrack(
    (partId, color, x, y, z, rotation = 0, _f, _fl, _t, _s, yaw) => {
      bricks.push({
        id: `t${bricks.length}`,
        partId,
        color,
        x,
        y,
        z,
        rotation,
        ...(yaw ? { yaw } : {}),
      });
    },
    72,
    { x: 40, y: 0, z: 40, angle },
    path,
  );
  return traceTrack({ bricks });
}

const go: DriveInput = { ...IDLE, throttle: 1 };
const run = (
  path: ReturnType<typeof lay>,
  train: ReturnType<typeof parkTrain>,
  input: DriveInput,
  seconds: number,
) => {
  let bumped = false;
  for (let t = 0; t < seconds * 20; t++)
    bumped ||= stepRail(path, STEAM_TRAIN, train, input, 1 / 20);
  return bumped;
};

describe('rail', () => {
  it('stands still until someone drives it', () => {
    const path = lay('SSSSSS');
    const train = parkTrain(60);
    run(path, train, go, 2);
    expect(train.distance).toBe(60);
  });

  it('speeds up to its top speed and coasts to a stop', () => {
    const path = lay('S'.repeat(40));
    const train = { ...parkTrain(60), driven: true };
    run(path, train, go, 10);
    expect(train.speed).toBeCloseTo(STEAM_TRAIN.maxSpeed, 5);
    run(path, train, IDLE, 20);
    expect(train.speed).toBe(0);
    expect(train.distance).toBeGreaterThan(60);
  });

  it('is stopped by the buffers at the end of an open line', () => {
    const path = lay('SSSSSS');
    const train = { ...parkTrain(80), driven: true };
    expect(run(path, train, go, 5)).toBe(true);
    expect(train.distance).toBe(path.length);
    expect(train.speed).toBe(0);
  });

  it('backs up until its rear reaches the start', () => {
    const path = lay('SSSSSS');
    const train = { ...parkTrain(80), driven: true };
    run(path, train, { ...IDLE, throttle: -1 }, 20);
    expect(train.distance).toBe(STEAM_TRAIN.length);
  });

  it('goes round a loop for ever', () => {
    const path = lay('R'.repeat(16));
    const train = { ...parkTrain(0), driven: true };
    run(path, train, go, 60);
    expect(train.distance).toBeGreaterThanOrEqual(0);
    expect(train.distance).toBeLessThan(path.length);
  });

  it('lays its cars along the rails, facing the way they run', () => {
    const path = lay('SSSSSS');
    const [front, , , last] = carPoses(path, STEAM_TRAIN, parkTrain(80));
    // Heading +x in the track's frame is yaw -90 degrees for the walker.
    expect(front!.yaw).toBeCloseTo(-Math.PI / 2, 5);
    expect(front!.x).toBeCloseTo(40 + 80 - STEAM_TRAIN.cars[0]!, 1);
    expect(last!.x).toBeCloseTo(40 + 80 - STEAM_TRAIN.cars[3]!, 1);
    expect(front!.z).toBeCloseTo(last!.z, 3);
  });

  it('bends through a curve car by car', () => {
    const path = lay('SRRRRSS');
    const poses = carPoses(path, STEAM_TRAIN, parkTrain(path.length - 10));
    const yaws = poses.map((pose) => pose.yaw);
    expect(new Set(yaws.map((yaw) => yaw.toFixed(2))).size).toBeGreaterThan(1);
  });

  it('stands each car on two bogies that follow the rails while the body spans them', () => {
    const straight = carPoses(lay('SSSSSS'), STEAM_TRAIN, parkTrain(80));
    for (const car of straight) {
      expect(car.bogies[0].yaw).toBeCloseTo(car.yaw, 5);
      expect(car.bogies[1].yaw).toBeCloseTo(car.yaw, 5);
    }
    // In a curve the two bogies point along the rails at their own spots, a little apart, and the
    // body faces between them.
    const bend = lay('SRRRRSS');
    const curved = carPoses(bend, STEAM_TRAIN, parkTrain(60))[0]!;
    const [rear, front] = curved.bogies;
    expect(Math.abs(rear.yaw - front.yaw)).toBeGreaterThan(0.01);
    const [low, high] = [Math.min(rear.yaw, front.yaw), Math.max(rear.yaw, front.yaw)];
    expect(curved.yaw).toBeGreaterThanOrEqual(low - 1e-6);
    expect(curved.yaw).toBeLessThanOrEqual(high + 1e-6);
    // The rear pivot is where the body puts it: behind its middle by the rear offset, along its heading.
    const behind = STEAM_TRAIN.bogies[0]![0];
    expect(rear.x).toBeCloseTo(curved.x - Math.sin(curved.yaw) * behind, 5);
    expect(rear.z).toBeCloseTo(curved.z - Math.cos(curved.yaw) * behind, 5);
  });
});
