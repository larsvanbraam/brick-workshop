import { Box3, Group, Matrix4, Vector3 } from 'three';
import type { Object3D } from 'three';
import { coloredLDrawModel } from '@brick-workshop/render/ldraw';
import { LDRAW_SCALE } from '@brick-workshop/render/scene-frame';

/**
 * A minifigure built from its LDraw parts, with the limbs on pivots so it can walk, and the
 * outfit it wears. The walker and the people of Studlands share it.
 */

/** What a minifigure wears, as LDraw colour codes and part IDs. */
export interface MinifigOutfit {
  /** The head's part: its print is the face. */
  head: string;
  skin: number;
  torso: number;
  /** A printed torso's part, in place of the plain one: a uniform or stripes. */
  torsoPart?: string;
  arms: number;
  hips: number;
  legs: number;
  /** Hair or a hat, worn on the head. */
  headgear?: { part: string; color: number };
}

/** Yellow skin, a red shirt and blue trousers: the walker's own figure. */
export const CLASSIC_OUTFIT: MinifigOutfit = Object.freeze({
  head: '3626cp01',
  skin: 14,
  torso: 4,
  arms: 4,
  hips: 1,
  legs: 1,
});

export interface MinifigRig {
  /** Which way a positive turn about x swings a limb: 1 forward, -1 back. */
  forward: number;
  root: Group | null;
  leftLeg: Group | null;
  rightLeg: Group | null;
  leftArm: Group | null;
  rightArm: Group | null;
  /** The head, which turns to look round; absent on the stand-in figure. */
  head?: Group | null;
}

/** An LDraw transform line's position and matrix (`x y z a b c d e f g h i`). */
function ldrawMatrix(values: readonly number[]) {
  const [x, y, z, a, b, c, d, e, f, g, h, i] = values;
  return new Matrix4().set(a, b, c, x, d, e, f, y, g, h, i, z, 0, 0, 0, 1);
}

function placed(object: Object3D, matrix: Matrix4) {
  matrix.decompose(object.position, object.quaternion, object.scale);
  return object;
}

/** Where the parts sit in a standard LDraw minifigure, torso at the origin. */
const RIGHT_ARM = ldrawMatrix([-15.552, 9, 0, 0.985, -0.17, 0, 0.17, 0.985, 0, 0, 0, 1]);
const LEFT_ARM = ldrawMatrix([15.552, 9, 0, 0.985, 0.17, 0, -0.17, 0.985, 0, 0, 0, 1]);
const RIGHT_HAND = ldrawMatrix([
  -23.69, 26.774, -9.898, 0.985, -0.12, 0.12, 0.17, 0.696, -0.696, 0, 0.707, 0.707,
]);
const LEFT_HAND = ldrawMatrix([
  23.69, 26.774, -9.898, 0.985, 0.12, -0.12, -0.17, 0.696, -0.696, 0, 0.707, 0.707,
]);

/**
 * The minifigure in LDraw space and units: the top of its torso at the origin, y pointing down and
 * its face toward -z, as a seated driver needs it. Each leg turns about its hip, each arm about
 * its shoulder carrying its hand along, and the head on the neck; turning a limb about x by a
 * negative angle swings it forward. A head or headgear part missing from `models` falls back to
 * the plain head and no headgear.
 */
export function buildMinifig(
  models: Record<string, Group>,
  outfit: MinifigOutfit = CLASSIC_OUTFIT,
) {
  const part = (id: string, color: number) => coloredLDrawModel(models[id], color);
  const body = new Group();
  body.add(part(models[outfit.torsoPart ?? ''] ? outfit.torsoPart! : '973', outfit.torso));
  // The head turns on the neck and carries its hair or hat along.
  const neck = new Group();
  neck.position.set(0, -24, 0);
  neck.add(part(models[outfit.head] ? outfit.head : CLASSIC_OUTFIT.head, outfit.skin));
  const { headgear } = outfit;
  if (headgear && models[headgear.part]) neck.add(part(headgear.part, headgear.color));
  body.add(neck);
  body.add(placed(part('3815', outfit.hips), new Matrix4().makeTranslation(0, 32, 0)));
  const leg = (id: string) => {
    const pivot = new Group();
    pivot.position.set(0, 44, 0);
    pivot.add(part(id, outfit.legs));
    body.add(pivot);
    return pivot;
  };
  const arm = (id: string, armMatrix: Matrix4, handMatrix: Matrix4) => {
    const shoulder = new Vector3().setFromMatrixPosition(armMatrix);
    const pivot = new Group();
    pivot.position.copy(shoulder);
    const toShoulder = new Matrix4().makeTranslation(-shoulder.x, -shoulder.y, -shoulder.z);
    pivot.add(placed(part(id, outfit.arms), toShoulder.clone().multiply(armMatrix)));
    pivot.add(placed(part('3820', outfit.skin), toShoulder.multiply(handMatrix)));
    body.add(pivot);
    return pivot;
  };
  return {
    body,
    head: neck,
    rightLeg: leg('3816'),
    leftLeg: leg('3817'),
    rightArm: arm('3818', RIGHT_ARM, RIGHT_HAND),
    leftArm: arm('3819', LEFT_ARM, LEFT_HAND),
  };
}

/**
 * The minifigure in the scene, feet at the origin and facing -z, with legs swinging from the
 * hips, arms from the shoulders and the head turning on the neck.
 */
export function assembleMinifig(
  models: Record<string, Group>,
  outfit: MinifigOutfit = CLASSIC_OUTFIT,
): MinifigRig & { root: Group } {
  const { body, ...rig } = buildMinifig(models, outfit);
  // LDraw's y points down and its front faces -z; the scene stands it upright (see LDRAW_SCALE),
  // which turns its front to +z, so it is turned round to face the way the walker looks.
  body.scale.set(...LDRAW_SCALE);
  body.rotation.y = Math.PI;
  const feet = new Box3().setFromObject(body).min.y;
  body.position.y = -feet;
  const root = new Group();
  root.visible = false;
  root.add(body);
  root.traverse((object) => {
    object.castShadow = false;
  });
  // LDraw's limbs hang down its +y and face -z, so a positive turn swings them back.
  return { forward: -1, root, ...rig };
}

/** How a minifigure moves this frame, for `poseMinifig`. */
export interface MinifigMotion {
  /** How far along its stride it is: the legs swing with its sine. */
  stride: number;
  /** How far it moved this frame, in studs: the swing grows with it. */
  moved: number;
  grounded: boolean;
  flying?: boolean;
  /** Seconds since the scene began, for idle sways. */
  time: number;
  /** Raises the right arm and waves it. */
  waving?: boolean;
  /** Turns the head, in radians, positive to the figure's left. */
  look?: number;
}

/** Swings the legs and arms for walking, flying, falling or waving. */
export function poseMinifig(rig: MinifigRig, motion: MinifigMotion) {
  // Angles swing a limb forward when positive; the rig says which way that turns it.
  const pose = (limb: Group | null, angle: number, out = 0) =>
    limb?.rotation.set(angle * rig.forward, 0, out);
  const { stride, moved, time } = motion;
  if (motion.flying) {
    // Upright, limbs swinging as if walking on air, and a slow sway while hovering.
    const swing = Math.sin(stride) * Math.min(0.5, moved * 18);
    const sway = Math.sin(time * 1.6) * 0.06;
    pose(rig.leftLeg, swing);
    pose(rig.rightLeg, -swing);
    pose(rig.leftArm, -swing * 0.8 + sway);
    pose(rig.rightArm, swing * 0.8 - sway);
  } else {
    const swing = Math.sin(stride) * Math.min(0.7, moved * 25);
    const air = motion.grounded ? 0 : 0.5;
    pose(rig.leftLeg, swing + air);
    pose(rig.rightLeg, -swing - air * 0.4);
    pose(rig.leftArm, -swing * 0.8 + air);
    if (motion.waving)
      // Up past the shoulder, rocking side to side; LDraw's arms turn about z the other way.
      pose(rig.rightArm, 2.6, Math.sin(time * 9) * 0.35 * rig.forward);
    else pose(rig.rightArm, swing * 0.8 + air);
  }
  rig.head?.rotation.set(0, (motion.look ?? 0) * -rig.forward, 0);
}
