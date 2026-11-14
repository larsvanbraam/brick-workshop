import type { Held } from './build.ts';

/** The pieces a new player starts with, one per number key. */
export const STARTER_HOTBAR: readonly Held[] = Object.freeze([
  { partId: '3001', color: 4, rotation: 0 },
  { partId: '3003', color: 15, rotation: 0 },
  { partId: '3004', color: 14, rotation: 0 },
  { partId: '3005', color: 1, rotation: 0 },
  { partId: '3010', color: 70, rotation: 0 },
  { partId: '3020', color: 71, rotation: 0 },
  { partId: '3022', color: 72, rotation: 0 },
  { partId: '3068b', color: 19, rotation: 0 },
  { partId: '3039', color: 320, rotation: 0 },
]);

/** Colours Q and E step through: the build standard's palette, muted first, accents last. */
export const PALETTE: readonly number[] = Object.freeze([
  15, 71, 72, 0, 19, 28, 70, 308, 84, 320, 4, 25, 14, 2, 288, 378, 1, 272, 73, 5, 13, 43,
]);
