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

/** Heads with other faces: a moustache, sunglasses, eyebrows, a woman's face. */
export const MINIFIG_HEADS = Object.freeze(['3626bp03', '3626bp04', '3626bp05', '3626bp02']);

/** Hair and hats. */
export const MINIFIG_HAIR = Object.freeze(['3901', '62696', '92081', '40233', '3625', '62810']);
export const MINIFIG_HATS = Object.freeze(['3624', '3878', '3833', '3629', '86035']);

/** Every minifigure part the library ships. */
export const MINIFIG_PARTS = Object.freeze([
  ...MINIFIG_BODY,
  ...MINIFIG_HEADS,
  ...MINIFIG_HAIR,
  ...MINIFIG_HATS,
]);
