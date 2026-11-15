import { Group, Matrix4 } from 'three';
import { coloredLDrawModel } from '@brick-workshop/render/ldraw';
import { LDRAW_SCALE } from '@brick-workshop/render/scene-frame';
import { buildMinifig } from '@brick-workshop/walk/minifig';
import type { Placement, Pose, VehicleModel } from './models';
import type { Vehicle } from './vehicle';

/** A vehicle's model in the scene, with the parts that move. */
export interface VehicleRig {
  /** In scene space: placed and turned to follow the vehicle each frame. */
  root: Group;
  moving: { steer: Group; spin: Group; model: VehicleModel['moving'][number] }[];
  /** The driver, shown while someone drives. */
  driver: Driver | null;
}

interface Driver {
  body: Group;
  leftLeg: Group;
  rightLeg: Group;
  leftArm: Group;
  rightArm: Group;
  pose: Pose;
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
    figure.body.position.set(...model.seat);
    figure.body.visible = false;
    ldraw.add(figure.body);
    driver = { ...figure, pose: model.pose };
  }
  const root = new Group();
  root.add(ldraw);
  root.visible = false;
  root.traverse((object) => {
    object.castShadow = true;
  });
  return { root, moving, driver };
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
  // A negative turn about x swings a limb forward.
  if (driver.pose === 'sit') {
    driver.leftLeg.rotation.x = driver.rightLeg.rotation.x = -Math.PI / 2;
    driver.leftArm.rotation.x = driver.rightArm.rotation.x = -1.1;
    driver.body.rotation.x = 0;
  } else if (driver.pose === 'ride') {
    driver.leftLeg.rotation.x = driver.rightLeg.rotation.x = -1.25;
    driver.leftArm.rotation.x = driver.rightArm.rotation.x = -1.35;
    driver.body.rotation.x = -0.25;
  } else {
    // Pedalling: the legs go round with the wheels, half a turn apart.
    const crank = vehicle.wheelTurn * 0.7;
    driver.leftLeg.rotation.x = -1.05 + Math.sin(crank) * 0.45;
    driver.rightLeg.rotation.x = -1.05 - Math.sin(crank) * 0.45;
    driver.leftArm.rotation.x = driver.rightArm.rotation.x = -1.15;
    driver.body.rotation.x = -0.15;
  }
}
