import { islandColumn, inland } from '../world/column.ts';
import { CENTRE } from '../world/map.ts';

/**
 * Brick Island's tide, which keeps the player on the island. Minifigures can't swim, so the sea
 * is solid bricks they could stroll across; instead, a few studs out the water starts pushing
 * them home, gently at first and then harder than anyone can run, fly or drive, so whoever heads
 * for the horizon ends up treading water on the spot (or moonwalking, from where the camera is).
 * Nothing stops them dead and nothing teleports: the sea just politely declines.
 */

/** Studs of sea off the shore to paddle in before the tide minds. */
export const SHALLOWS = 4;
/** Studs further out over which the push grows to a brisk walk. */
const RAMP = 6;
/** A brisk walk, studs a second: the push at the end of the ramp, and it grows as the square. */
const WALK = 6;
/** No push is ever faster than this, so a long frame never flings anyone across the beach. */
const MAX_PUSH = 40;

/** How hard the tide pushes at so many studs out from the coast, in studs a second. */
export function tideSpeed(out: number) {
  if (out <= SHALLOWS) return 0;
  return Math.min(MAX_PUSH, WALK * ((out - SHALLOWS) / RAMP) ** 2);
}

/** What the player says when the tide turns them round, one after the other. */
export const TIDE_LINES: readonly string[] = [
  "Minifigures can't swim. Our legs are one piece!",
  'The sea is pushing back. Rude.',
  "I'll wait for the ferry.",
  'These are studs, not flippers.',
  'Is this the edge of the baseplate?',
  'Nope. Not without a life jacket.',
  "The tide says I'm grounded.",
];

export class Tide {
  /** How hard the sea pushed the last time anything moved, studs a second. */
  strength = 0;
  /** Where the player's head is on screen, written by the scene each frame, for their bubble. */
  readonly anchor = { x: 0, y: 0, visible: false };

  private readonly seed: number;
  private readonly frame: number;

  /** `frame` is the world's size, which the scene centres. */
  constructor(seed: number, frame: number) {
    this.seed = seed;
    this.frame = frame;
  }

  /** Puts the player's head at a point on screen, or off it. */
  placeHead(x: number, y: number, visible: boolean) {
    Object.assign(this.anchor, { x, y, visible });
  }

  /** The push at a spot in scene units: toward the middle of the island, or null on land. */
  readonly push = (x: number, z: number): readonly [number, number] | null => {
    // Scene to world studs: the scene centres the frame and runs z the other way.
    const wx = x + this.frame / 2;
    const wz = this.frame / 2 - z;
    const out = -inland(this.seed, wx, wz);
    const speed = tideSpeed(out);
    // Only open sea pushes: a road the coast bends round keeps its land.
    if (speed === 0 || islandColumn(this.seed, wx, wz).biome !== 'sea') {
      this.strength = 0;
      return null;
    }
    this.strength = speed;
    const dx = CENTRE.x - wx;
    const dz = CENTRE.z - wz;
    const length = Math.hypot(dx, dz) || 1;
    // Back to scene axes: z flips again.
    return [(dx / length) * speed, (-dz / length) * speed];
  };
}
