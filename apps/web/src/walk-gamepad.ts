/**
 * Walk mode's controller input, read from the browser's Gamepad API once a frame. Buttons follow
 * the standard layout (Xbox names; a PlayStation pad's cross, circle, square and triangle sit in
 * the same places):
 *
 * - Left stick or d-pad moves; clicking the left stick in sprints until the stick is let go, and
 *   LB runs while held.
 * - Right stick looks round.
 * - A jumps, a double tap of A takes off or lands, and Y does either at once. In the air A or RT
 *   climbs and B or LT sinks.
 * - View (Back) switches between first and third person; Menu (Start) stops walking.
 *
 * A browser hides a controller from the page until one of its buttons is pressed while the page
 * is open.
 */

/** Stick travel ignored around the centre, so a resting stick does not drift. */
export const STICK_DEAD_ZONE = 0.18;
/** Triggers count as pressed past this. */
const TRIGGER_THRESHOLD = 0.3;
/** Turning speed at full right-stick deflection, radians per second. */
export const LOOK_RATE = { yaw: 2.8, pitch: 1.9 };

const BUTTON = {
  a: 0,
  b: 1,
  y: 3,
  lb: 4,
  lt: 6,
  rt: 7,
  view: 8,
  menu: 9,
  leftStick: 10,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
} as const;

/** The buttons whose presses, not just their holding, mean something. */
const EDGES = ['a', 'y', 'view', 'menu', 'leftStick'] as const;
type Edge = (typeof EDGES)[number];

export interface GamepadFrame {
  /** Movement, each -1 to 1, forward and right positive. */
  forward: number;
  strafe: number;
  /** Look rate, each -1 to 1: right and up positive. */
  lookX: number;
  lookY: number;
  run: boolean;
  /** Climbing (1) or sinking (-1) while flying. */
  rise: number;
  /** Buttons pressed since the previous frame. */
  pressed: Record<Edge, boolean>;
}

/** The subset of the browser's `Gamepad` this reads, so tests can pass plain objects. */
export interface PadLike {
  connected: boolean;
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
}

/**
 * One axis with its dead zone cut out and the rest rescaled to 0-1, so a small push starts slow
 * instead of jumping to the dead zone's edge.
 */
export function shapeAxis(value: number | undefined, deadZone = STICK_DEAD_ZONE) {
  if (value === undefined || !Number.isFinite(value)) return 0;
  const size = Math.abs(value);
  if (size <= deadZone) return 0;
  return Math.sign(value) * Math.min(1, (size - deadZone) / (1 - deadZone));
}

/**
 * A stick's two axes with a round dead zone, so pushing diagonally is as easy as straight. The
 * result's length runs 0 to 1.
 */
export function shapeStick(x: number | undefined, y: number | undefined) {
  const sx = Number.isFinite(x) ? (x as number) : 0;
  const sy = Number.isFinite(y) ? (y as number) : 0;
  const length = Math.hypot(sx, sy);
  if (length <= STICK_DEAD_ZONE) return { x: 0, y: 0 };
  const scaled = Math.min(1, (length - STICK_DEAD_ZONE) / (1 - STICK_DEAD_ZONE));
  return { x: (sx / length) * scaled, y: (sy / length) * scaled };
}

/**
 * Reads every connected pad into one frame of walk input. `held` carries which edge buttons were
 * down last frame and is updated in place; pass the same object each frame.
 */
export function readGamepads(
  pads: readonly (PadLike | null)[],
  held: Partial<Record<Edge, boolean>>,
): GamepadFrame | null {
  const frame: GamepadFrame = {
    forward: 0,
    strafe: 0,
    lookX: 0,
    lookY: 0,
    run: false,
    rise: 0,
    pressed: { a: false, y: false, view: false, menu: false, leftStick: false },
  };
  const down: Record<Edge, boolean> = {
    a: false,
    y: false,
    view: false,
    menu: false,
    leftStick: false,
  };
  let any = false;
  for (const pad of pads) {
    if (!pad?.connected) continue;
    any = true;
    const button = (index: number, threshold = 0.5) => {
      const entry = pad.buttons[index];
      return Boolean(entry && (entry.pressed || entry.value > threshold));
    };
    const move = shapeStick(pad.axes[0], pad.axes[1]);
    const look = shapeStick(pad.axes[2], pad.axes[3]);
    // Sticks report up as negative.
    const dpadForward = (button(BUTTON.up) ? 1 : 0) - (button(BUTTON.down) ? 1 : 0);
    const dpadStrafe = (button(BUTTON.right) ? 1 : 0) - (button(BUTTON.left) ? 1 : 0);
    frame.forward = strongest(frame.forward, -move.y, dpadForward);
    frame.strafe = strongest(frame.strafe, move.x, dpadStrafe);
    frame.lookX = strongest(frame.lookX, look.x);
    frame.lookY = strongest(frame.lookY, -look.y);
    if (button(BUTTON.lb)) frame.run = true;
    const climb = button(BUTTON.a) || button(BUTTON.rt, TRIGGER_THRESHOLD) ? 1 : 0;
    const sink = button(BUTTON.b) || button(BUTTON.lt, TRIGGER_THRESHOLD) ? 1 : 0;
    frame.rise = strongest(frame.rise, climb - sink);
    for (const edge of EDGES) if (button(BUTTON[edge])) down[edge] = true;
  }
  for (const edge of EDGES) {
    frame.pressed[edge] = down[edge] && !held[edge];
    held[edge] = down[edge];
  }
  return any ? frame : null;
}

/** Whichever value is furthest from zero, so two pads or stick and d-pad never cancel out. */
function strongest(...values: number[]) {
  return values.reduce((best, value) => (Math.abs(value) > Math.abs(best) ? value : best), 0);
}
