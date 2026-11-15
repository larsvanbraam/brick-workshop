import { Box3, Group, Matrix4 } from 'three';
import { coloredLDrawModel } from '@brick-workshop/render/ldraw';
import { LDRAW_SCALE } from '@brick-workshop/render/scene-frame';

/** One LDraw part of an animal, in its colour, offset in LDraw units (a cow's head on its body). */
export interface AnimalPart {
  part: string;
  color: number;
  at?: readonly [number, number, number];
}

/**
 * How an animal moves: `walk` bobs and rocks gently, `hop` bounds along (rabbits, frogs),
 * `waddle` rolls from side to side (ducks, chickens, penguins).
 */
export type Gait = 'walk' | 'hop' | 'waddle';

export interface AnimalRig {
  root: Group;
  /** Carries the bob, hop and roll, under the root's heading. */
  body: Group;
  gait: Gait;
}

/**
 * The animal from its LDraw parts, feet at the origin and facing -z like the minifigure (LDraw's
 * animals face its -z, as the minifigure does). Returns null if a part has not loaded.
 */
export function assembleAnimal(
  models: Record<string, Group>,
  parts: readonly AnimalPart[],
  gait: Gait,
): AnimalRig | null {
  if (!parts.every(({ part }) => models[part])) return null;
  const model = new Group();
  for (const { part, color, at } of parts) {
    const piece = coloredLDrawModel(models[part], color);
    if (at) piece.applyMatrix4(new Matrix4().makeTranslation(...at));
    model.add(piece);
  }
  model.scale.set(...LDRAW_SCALE);
  model.rotation.y = Math.PI;
  const feet = new Box3().setFromObject(model).min.y;
  model.position.y = -feet;
  const body = new Group();
  body.add(model);
  const root = new Group();
  root.add(body);
  root.traverse((object) => {
    object.castShadow = false;
  });
  return { root, body, gait };
}

/** Bobs, hops or waddles the animal for how it moved this frame (see `MinifigMotion`). */
export function poseAnimal(
  rig: AnimalRig,
  motion: { stride: number; moved: number; grounded: boolean; time: number },
) {
  const { body, gait } = rig;
  const going = Math.min(1, motion.moved * 25);
  const phase = Math.sin(motion.stride * 1.5);
  // Breathes a little while standing.
  const idle = Math.sin(motion.time * 2) * 0.01;
  if (gait === 'hop') {
    body.position.y = Math.abs(Math.sin(motion.stride * 0.8)) * 0.6 * going;
    body.rotation.set(-Math.cos(motion.stride * 0.8) * 0.25 * going, 0, 0);
  } else if (gait === 'waddle') {
    body.position.y = Math.abs(phase) * 0.06 * going;
    body.rotation.set(0, 0, phase * 0.2 * going);
  } else {
    body.position.y = Math.abs(phase) * 0.08 * going + idle;
    body.rotation.set(phase * 0.05 * going, 0, 0);
  }
}
