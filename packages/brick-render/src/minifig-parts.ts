/**
 * The LDraw parts of the minifigures: the one that walks the build in the cinematic view, and the
 * people of Studlands with their faces, hair and hats. They are not building parts, but the
 * library ships them alongside the catalogue so a static deploy can draw the figures too.
 */

/** Head with the standard grin, torso, arms, hands, hips and legs. */
export const MINIFIG_BODY = Object.freeze([
  '3626cp01',
  '973',
  '3818',
  '3819',
  '3820',
  '3815',
  '3816',
  '3817',
]);

/** Heads with other faces: a moustache, sunglasses, eyebrows, and three women's faces. */
export const MINIFIG_HEADS = Object.freeze([
  '3626bp03',
  '3626bp04',
  '3626bp05',
  '3626bp02',
  '3626bp08',
  '3626bp09',
  '3626cpd8k',
]);

/** Hair and hats. */
export const MINIFIG_HAIR = Object.freeze([
  '3901',
  '92081',
  '40233',
  '62810',
  '62696',
  '3625',
  '85974',
  '92083',
  '87990',
]);
export const MINIFIG_HATS = Object.freeze(['3624', '3878', '3833', '3629', '86035', '90541']);

/** Printed torsos: jail stripes with a prisoner number. */
export const MINIFIG_TORSOS = Object.freeze(['973p7k']);

/** Every minifigure part the library ships. */
export const MINIFIG_PARTS = Object.freeze([
  ...MINIFIG_BODY,
  ...MINIFIG_HEADS,
  ...MINIFIG_HAIR,
  ...MINIFIG_HATS,
  ...MINIFIG_TORSOS,
]);
