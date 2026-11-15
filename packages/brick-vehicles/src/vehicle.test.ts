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

  it('climbs a brick and stops at a wall two bricks high', () => {
    // Forward at yaw 0 is scene -z, which is grid +z: a step one brick high across the board at
    // grid z 40 to 50, and a wall two bricks high at grid z 70.
    const step: Brick[] = [];
    for (let x = 0; x < AREA; x += 4)
      for (let z = 40; z < 50; z += 2) step.push(brick('3001', x, 1, z));
    const wall: Brick[] = [];
    for (let x = 0; x < AREA; x += 4)
      for (let y = 1; y < 7; y += 3) wall.push(brick('3010', x, y, 70, 90));
    const ground = world([...step, ...wall]);
    const vehicle = car('car', ground, 0, sceneZ(30));
    drive(ground, vehicle, { throttle: 1 }, 1.8);
    expect(vehicle.z).toBeLessThan(sceneZ(42));
    expect(vehicle.y).toBeCloseTo(1.6);
    drive(ground, vehicle, { throttle: 1 }, 4);
    // Off the step and stopped short of the wall, which starts at scene z sceneZ(71).
    expect(vehicle.y).toBeCloseTo(0.4);
    expect(vehicle.z - VEHICLES.car.length / 2).toBeGreaterThan(sceneZ(71) - 0.6);
    expect(Math.abs(vehicle.speed)).toBeLessThan(3);
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
