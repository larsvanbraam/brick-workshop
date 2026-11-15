import { describe, expect, it } from 'vite-plus/test';
import type { Brick } from '@brick-workshop/engine';
import { WalkWorld } from '@brick-workshop/walk/walk';
import {
  IDLE,
  VEHICLES,
  distanceTo,
  exitSpot,
  isAtRest,
  parkVehicle,
  parkedBoxes,
  settleVehicle,
  stepVehicle,
} from './vehicle';
import type { DriveInput, Vehicle, VehicleKind } from './vehicle';

const AREA = 128;
let next = 0;
function brick(
  partId: string,
  x: number,
  y: number,
  z: number,
  rotation: Brick['rotation'] = 0,
): Brick {
  return { id: `b${next++}`, partId, color: 71, x, y, z, rotation };
}

/** A floor of 8 x 8 plates over the board, a plate thick, with extra pieces on top. */
function world(extra: Brick[] = []) {
  const floor: Brick[] = [];
  for (let x = 0; x < AREA; x += 8)
    for (let z = 0; z < AREA; z += 8) floor.push(brick('41539', x, 0, z));
  return new WalkWorld([...floor, ...extra], AREA, Infinity);
}

/** Scene z of a grid z on this board (the scene runs z the other way). */
const sceneZ = (z: number) => AREA / 2 - z;

function drive(on: WalkWorld, vehicle: Vehicle, input: Partial<DriveInput>, seconds: number) {
  for (let time = 0; time < seconds; time += 1 / 60)
    stepVehicle(on, vehicle, { ...IDLE, ...input }, 1 / 60);
  return vehicle;
}

function car(kind: VehicleKind = 'car', on = world(), x = 0, z = 0, yaw = 0) {
  const vehicle = parkVehicle('v', kind, x, z, yaw);
  settleVehicle(on, vehicle);
  vehicle.driven = true;
  return vehicle;
}

describe('vehicles', () => {
  it('waits for the ground before it settles on it', () => {
    const empty = new WalkWorld([], AREA, Infinity);
    const vehicle = parkVehicle('v', 'car', 0, 0, 0);
    expect(settleVehicle(empty, vehicle)).toBe(false);
    expect(vehicle.settled).toBe(false);
    const floor = world();
    expect(settleVehicle(floor, vehicle)).toBe(true);
    expect(vehicle.y).toBeCloseTo(0.4);
  });

  it('drives forward along its heading and rolls to a stop', () => {
    const floor = world();
    const vehicle = car('car', floor);
    drive(floor, vehicle, { throttle: 1 }, 2);
    expect(vehicle.z).toBeLessThan(-10);
    expect(Math.abs(vehicle.x)).toBeLessThan(0.01);
    expect(vehicle.speed).toBeGreaterThan(10);
    drive(floor, vehicle, {}, 8);
    expect(vehicle.speed).toBe(0);
    expect(isAtRest(vehicle)).toBe(true);
  });

  it('turns right when steered right, and only while moving', () => {
    const floor = world();
    const still = car('car', floor);
    drive(floor, still, { steer: 1 }, 1);
    expect(still.yaw).toBe(0);
    const moving = car('car', floor);
    drive(floor, moving, { throttle: 1, steer: 1 }, 1);
    // Positive yaw turns left, so a right turn lowers it and heads toward +x.
    expect(moving.yaw).toBeLessThan(-0.5);
    expect(moving.x).toBeGreaterThan(1);
  });

  it('is faster on its own: the race car outruns the car, the car the bike', () => {
    const floor = world();
    const top = (kind: VehicleKind) => drive(floor, car(kind, floor), { throttle: 1 }, 2.5).speed;
    expect(top('racecar')).toBeGreaterThan(top('car'));
    expect(top('car')).toBeGreaterThan(top('bike'));
    expect(top('bike')).toBeLessThanOrEqual(VEHICLES.bike.maxSpeed);
  });

  it('climbs two bricks and stops at a wall three bricks high', () => {
    // Forward at yaw 0 is scene -z, which is grid +z: a step two bricks high across the board at
    // grid z 40 to 50, and a wall three bricks high at grid z 70.
    const step: Brick[] = [];
    for (let x = 0; x < AREA; x += 4)
      for (let z = 40; z < 50; z += 2) for (const y of [1, 4]) step.push(brick('3001', x, y, z));
    const wall: Brick[] = [];
    for (let x = 0; x < AREA; x += 4)
      for (let y = 1; y < 10; y += 3) wall.push(brick('3010', x, y, 70, 90));
    const ground = world([...step, ...wall]);
    const vehicle = car('car', ground, 0, sceneZ(30));
    drive(ground, vehicle, { throttle: 1 }, 2.4);
    expect(vehicle.z).toBeLessThan(sceneZ(42));
    expect(vehicle.y).toBeCloseTo(0.4 + 2 * 1.2);
    drive(ground, vehicle, { throttle: 1 }, 5);
    // Off the step and stopped short of the wall, which starts at scene z sceneZ(71).
    expect(vehicle.y).toBeCloseTo(0.4);
    expect(vehicle.z - VEHICLES.car.length / 2).toBeGreaterThan(sceneZ(71) - 0.6);
    expect(Math.abs(vehicle.speed)).toBeLessThan(3);
  });

  it('climbs a brick it meets at an angle or between its wheels', () => {
    // A platform a brick high from grid z 72 on, met by the body's corner before any wheel.
    const platform: Brick[] = [];
    for (let x = 0; x < AREA; x += 4)
      for (let z = 72; z < 120; z += 2) platform.push(brick('3001', x, 1, z));
    const ground = world(platform);
    for (const kind of ['bike', 'motorcycle', 'car', 'racecar'] as const)
      for (const yaw of [0, 0.6, 0.9]) {
        const vehicle = drive(ground, car(kind, ground, 0, 0, yaw), { throttle: 1 }, 4);
        expect(vehicle.y, `${kind} at ${yaw}`).toBeCloseTo(0.4 + 1.2);
      }
  });

  it('drops off a ledge and lands', () => {
    const ledge: Brick[] = [];
    for (let x = 0; x < AREA; x += 4)
      for (let z = 64; z < 128; z += 2)
        for (let y = 1; y < 12; y += 3) ledge.push(brick('3001', x, y, z));
    const ground = world(ledge);
    // Facing grid -z, toward the ledge's edge at grid z 64.
    const vehicle = car('motorcycle', ground, 0, sceneZ(76), Math.PI);
    expect(vehicle.y).toBeCloseTo(0.4 + 4 * 1.2);
    drive(ground, vehicle, { throttle: 1 }, 3);
    expect(vehicle.z).toBeGreaterThan(sceneZ(60));
    expect(vehicle.y).toBeCloseTo(0.4);
    expect(vehicle.grounded).toBe(true);
  });

  it('lifts a helicopter once its rotor has wound up, and sets it down when left', () => {
    const floor = world();
    const heli = car('helicopter', floor);
    drive(floor, heli, { rise: 1 }, 0.5);
    expect(heli.y).toBeCloseTo(0.4);
    drive(floor, heli, { rise: 1 }, 3);
    expect(heli.y).toBeGreaterThan(10);
    drive(floor, heli, { throttle: 1 }, 2);
    expect(heli.z).toBeLessThan(-10);
    heli.driven = false;
    drive(floor, heli, {}, 20);
    expect(heli.grounded).toBe(true);
    expect(heli.y).toBeCloseTo(0.4);
  });

  it('takes off in an airplane once it is fast enough, and climbs', () => {
    const floor = world();
    const plane = car('airplane', floor, 0, 60);
    drive(floor, plane, { throttle: 1 }, 1);
    expect(plane.grounded).toBe(true);
    drive(floor, plane, { throttle: 1, rise: 1 }, 4);
    expect(plane.grounded).toBe(false);
    expect(plane.y).toBeGreaterThan(5);
    // Left alone it glides down and lands.
    plane.driven = false;
    drive(floor, plane, {}, 30);
    expect(plane.grounded).toBe(true);
  });

  it('drives out of a post it ended up stuck in, but not back into it', () => {
    // A post six bricks high right through the middle of the car, as if built through it.
    const post: Brick[] = [];
    for (let y = 1; y < 19; y += 3) post.push(brick('3005', 64, y, 64));
    const ground = world(post);
    const vehicle = parkVehicle('v', 'car', 0.5, -0.5, 0, 0.4);
    vehicle.settled = true;
    vehicle.driven = true;
    drive(ground, vehicle, { throttle: 1 }, 2);
    expect(vehicle.z).toBeLessThan(-10);
    expect(vehicle.y).toBeCloseTo(0.4);
    // Free of it now, reversing stops at the post instead of driving through it again.
    drive(ground, vehicle, { throttle: -1 }, 6);
    expect(vehicle.z + VEHICLES.car.length / 2).toBeLessThan(-0.5);
  });

  it('comes down on top of a post, and lifts out of one built through it', () => {
    const post: Brick[] = [];
    for (let y = 1; y < 7; y += 3) post.push(brick('3005', 64, y, 64));
    const ground = world(post);
    const landing = car('helicopter', ground, 0.5, -0.5);
    landing.y = 10;
    landing.grounded = false;
    landing.engine = 1;
    drive(ground, landing, { rise: -1 }, 3);
    expect(landing.y).toBeCloseTo(0.4 + 2 * 1.2);
    const heli = parkVehicle('v', 'helicopter', 0.5, -0.5, 0, 0.4);
    heli.settled = true;
    heli.driven = true;
    drive(ground, heli, { rise: 1 }, 3);
    expect(heli.y).toBeGreaterThan(8);
    drive(ground, heli, { throttle: 1 }, 2);
    expect(heli.z).toBeLessThan(-10);
  });

  it('backs an airplane away from a wall it ran into', () => {
    const wall: Brick[] = [];
    for (let x = 0; x < AREA; x += 4)
      for (let y = 1; y < 10; y += 3) wall.push(brick('3010', x, y, 80, 90));
    const ground = world(wall);
    const plane = car('airplane', ground, 0, sceneZ(64));
    drive(ground, plane, { throttle: 1 }, 4);
    expect(Math.abs(plane.speed)).toBeLessThan(1);
    const against = { z: plane.z, yaw: plane.yaw };
    drive(ground, plane, { throttle: -1, steer: 1 }, 3);
    expect(plane.z).toBeGreaterThan(against.z + 2);
    expect(plane.yaw).not.toBe(against.yaw);
  });

  it('fills boxes the walker stands on while parked, and finds room beside it to get out', () => {
    const floor = world();
    const vehicle = car('car', floor);
    const boxes = parkedBoxes(vehicle);
    expect(boxes.length).toBeGreaterThan(1);
    expect(Math.max(...boxes.map((box) => box.maxY))).toBeCloseTo(0.4 + VEHICLES.car.deck);
    expect(distanceTo(vehicle, 0, 0)).toBe(0);
    expect(distanceTo(vehicle, 5.7, 0)).toBeCloseTo(3);
    const spot = exitSpot(vehicle, (x) => x > 0);
    expect(spot?.x).toBeGreaterThan(VEHICLES.car.width / 2);
  });
});
