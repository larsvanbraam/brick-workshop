import { describe, expect, it } from 'vite-plus/test';
import { WalkWorld } from '@brick-workshop/walk/walk';
import { STEAM_TRAIN, parkTrain } from './rail';
import type { RailPath } from './rail';
import { exitPlace, parkVehicle, parkedBoxes, settleVehicle } from './vehicle';

/** A straight line of rails running west along z = -250 at the height of a track's top. */
const WEST: RailPath = {
  length: 300,
  closed: false,
  pointAt: (distance) => ({ x: 400 - distance, y: 18, z: -250, angle: 180 }),
};

function setting(platform: boolean) {
  const world = new WalkWorld([], 128, Infinity);
  // The ground (6 studs up), the track bed's rails (7.2), and a platform on the south side
  // (scene -z) 4 studs over the track, from 4 to 12 studs off the centre line.
  world.setBoxes('ground', [{ minX: -500, maxX: 500, minY: 0, maxY: 6, minZ: -500, maxZ: 500 }]);
  world.setBoxes('track', [{ minX: 100, maxX: 400, minY: 6, maxY: 7.2, minZ: -254, maxZ: -246 }]);
  if (platform)
    world.setBoxes('platform', [
      { minX: 290, maxX: 340, minY: 6, maxY: 11.2, minZ: -262, maxZ: -254 },
    ]);
  const train = parkVehicle('train', 'train', 0, 0, 0);
  train.rail = { path: WEST, spec: STEAM_TRAIN, train: parkTrain(92) };
  settleVehicle(world, train);
  train.driven = false;
  world.setBoxes('vehicle:train', parkedBoxes(train));
  return { world, train };
}

describe('getting out of a train', () => {
  it('steps onto the platform beside the locomotive, not on or in the train', () => {
    const { world, train } = setting(true);
    const place = exitPlace(world, train, false);
    expect(place.found).toBe(true);
    // Beside it, past the train's side (3 studs) and on the platform's top.
    expect(Math.abs(place.z - train.z)).toBeGreaterThan(4);
    expect(place.y).toBeCloseTo(11.2, 1);
    expect(world.blocking(place.x, place.y, place.z)).toHaveLength(0);
  });

  it('steps down to the ground beside the track where there is no platform', () => {
    const { world, train } = setting(false);
    const place = exitPlace(world, train, false);
    expect(place.found).toBe(true);
    expect(Math.abs(place.z - train.z)).toBeGreaterThan(4);
    // On the ground (or where it will drop to), never up on the train's own roof.
    expect(place.y).toBeLessThan(train.y + 1);
  });
});
