import { Group, Matrix4 } from 'three';
import { coloredLDrawModel } from '@brick-workshop/render/ldraw';
import { LDRAW_SCALE } from '@brick-workshop/render/scene-frame';
import { buildMinifig } from '@brick-workshop/walk/minifig';
import type { Bogie, Placement, Rider, VehicleModel } from './models';
import { carPoses } from './rail';
import type { CarPose } from './rail';
import type { Vehicle } from './vehicle';

/** A vehicle's model in the scene, with the parts that move. */
export interface VehicleRig {
  /** In scene space: placed and turned to follow the vehicle each frame. */
  root: Group;
  moving: { steer: Group; spin: Group; model: VehicleModel['moving'][number] }[];
  /** The driver, shown while someone drives. */
  driver: Driver | null;
  /** A train's cars behind the locomotive, each in the scene's own frame (see `poseVehicle`). */
  trailers: Group[];
  /** The locomotive's two bogies, rear first, each swivelling on its pivot under the body. */
  bogies: Group[];
}

interface Driver {
  body: Group;
  leftLeg: Group;
  rightLeg: Group;
  leftArm: Group;
  rightArm: Group;
  rider: Rider;
}

function place(models: Record<string, Group>, placement: Placement) {
  const object = coloredLDrawModel(models[placement.part], placement.color);
  const [x, y, z] = placement.at;
  const [a, b, c, d, e, f, g, h, i] = placement.turn ?? [1, 0, 0, 0, 1, 0, 0, 0, 1];
  new Matrix4()
    .set(a, b, c, x, d, e, f, y, g, h, i, z, 0, 0, 0, 1)
    .decompose(object.position, object.quaternion, object.scale);
  return object;
}

/** A bogie's parts about its own pivot, which the caller places and turns on the rails. */
function buildBogie(models: Record<string, Group>, bogie: Bogie) {
  const pivot = new Group();
  const inner = new Group();
  inner.scale.set(...LDRAW_SCALE);
  inner.rotation.y = Math.PI;
  for (const placement of bogie.parts) inner.add(place(models, placement));
  pivot.add(inner);
  return pivot;
}

/**
 * Builds a vehicle's model from its loaded LDraw parts. The model is drawn in LDraw's frame inside
 * the root, turned upright (see `LDRAW_SCALE`) and round, so its front faces the scene's -z like
 * the walker's yaw 0.
 */
export function buildVehicle(model: VehicleModel, models: Record<string, Group>): VehicleRig {
  const ldraw = new Group();
  ldraw.scale.set(...LDRAW_SCALE);
  ldraw.rotation.y = Math.PI;
  for (const placement of model.body) ldraw.add(place(models, placement));
  const moving = model.moving.map((entry) => {
    const steer = new Group();
    steer.position.set(...entry.pivot);
    const spin = new Group();
    steer.add(spin);
    for (const placement of entry.parts) spin.add(place(models, placement));
    ldraw.add(steer);
    return { steer, spin, model: entry };
  });
  let driver: Driver | null = null;
  if (models['973']) {
    const figure = buildMinifig(models);
    figure.body.position.set(...model.rider.seat);
    figure.body.visible = false;
    ldraw.add(figure.body);
    driver = { ...figure, rider: model.rider };
  }
  const root = new Group();
  root.add(ldraw);
  root.visible = false;
  const bogies = (model.bogies ?? []).map((bogie) => buildBogie(models, bogie));
  for (const pivot of bogies) root.add(pivot);
  const trailers = (model.trailers ?? []).map((trailer) => {
    const car = new Group();
    const inner = new Group();
    inner.scale.set(...LDRAW_SCALE);
    inner.rotation.y = Math.PI;
    for (const placement of trailer.body) inner.add(place(models, placement));
    car.add(inner);
    // Each bogie hangs under the car on its own pivot (see `poseBogies`).
    const pivots = trailer.bogies.map((bogie) => buildBogie(models, bogie));
    for (const pivot of pivots) car.add(pivot);
    car.userData.bogies = pivots;
    car.visible = false;
    return car;
  });
  for (const group of [root, ...trailers])
    group.traverse((object) => {
      object.castShadow = true;
    });
  return { root, moving, driver, trailers, bogies };
}

/**
 * Sets a car's bogies on the rails under it: each at its own point of the track, turned to follow
 * it, as the car's body carries on between them.
 */
function poseBogies(pivots: readonly Group[], car: CarPose) {
  const [cos, sin] = [Math.cos(car.yaw), Math.sin(car.yaw)];
  car.bogies.forEach((bogie, index) => {
    const pivot = pivots[index];
    if (!pivot) return;
    const [dx, dz] = [bogie.x - car.x, bogie.z - car.z];
    // The car's own frame: the world turned back by the car's heading.
    pivot.position.set(dx * cos - dz * sin, bogie.y - car.y, dx * sin + dz * cos);
    const turn = bogie.yaw - car.yaw;
    pivot.rotation.set(0, Math.atan2(Math.sin(turn), Math.cos(turn)), 0);
  });
}

/**
 * Puts the model where the vehicle is, at `y` (the eased height the view shows), turns its
 * wheels, rotor and propeller, and poses the driver. `time` drives the pedalling.
 */
export function poseVehicle(rig: VehicleRig, vehicle: Vehicle, y: number, showDriver: boolean) {
  const { root } = rig;
  root.visible = vehicle.settled;
  root.position.set(vehicle.x, y, vehicle.z);
  root.rotation.set(vehicle.pitch, vehicle.yaw, vehicle.roll, 'YXZ');
  if (vehicle.rail && rig.trailers.length) {
    // The cars behind follow the rails, each at its own heading, level with the locomotive.
    const poses = carPoses(vehicle.rail.path, vehicle.rail.spec, vehicle.rail.train);
    rig.trailers.forEach((car, index) => {
      const pose = poses[index + 1];
      car.visible = vehicle.settled && Boolean(pose);
      if (!pose) return;
      car.position.set(pose.x, pose.y - vehicle.y + y, pose.z);
      car.rotation.set(0, pose.yaw, 0);
      poseBogies(car.userData.bogies as Group[], pose);
    });
    const [front] = poses;
    if (front) poseBogies(rig.bogies, front);
  }
  for (const { steer, spin, model } of rig.moving) {
    // LDraw's y points down, so a positive turn about it turns the front to the right.
    steer.rotation.y = model.steer ? vehicle.steer * model.steer : 0;
    const angle =
      model.spin === 'wheel' ? vehicle.wheelTurn : model.spin === 'engine' ? vehicle.propeller : 0;
    spin.rotation.set(
      model.axis === 'x' ? angle : 0,
      model.axis === 'y' ? angle : 0,
      model.axis === 'z' ? angle : 0,
    );
  }
  const driver = rig.driver;
  if (!driver) return;
  driver.body.visible = showDriver;
  if (!showDriver) return;
  // A negative turn about x swings a limb forward; LDraw's left arm is at +x.
  const { lean, legs, arms, armsOut = 0, pedal = 0 } = driver.rider;
  // Pedalling: the legs go round with the wheels, half a turn apart.
  const crank = Math.sin(vehicle.wheelTurn * 0.7) * pedal;
  driver.body.rotation.x = lean;
  driver.leftLeg.rotation.x = legs + crank;
  driver.rightLeg.rotation.x = legs - crank;
  driver.leftArm.rotation.set(arms, 0, -armsOut);
  driver.rightArm.rotation.set(arms, 0, armsOut);
}
