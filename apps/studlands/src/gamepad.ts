/**
 * Studlands' own controller buttons, beside walking's (`walk-gamepad.ts`, in its `build` layout,
 * which takes the sticks and A, B, Y, View and L3). Buttons follow the standard layout, by their
 * Xbox names.
 *
 * Playing: RT places, LT takes a piece off, X copies the piece aimed at, LB and RB step through
 * the bar, d-pad left and right step through the held part's colours, d-pad up turns it, d-pad
 * down opens the brick box and Menu the menu.
 *
 * While playing the left stick only walks, so pulling it back never opens the box.
 *
 * In the brick box and the menu: the left stick or d-pad moves between buttons, A presses one, B
 * closes, LB and RB switch tabs (the menu's) or kinds of part (the box's), the right stick
 * scrolls, and in the box LT and RT pick the slot the part goes in.
 */
import { shapeStick } from '@brick-workshop/walk/walk-gamepad';
import type { PadLike } from '@brick-workshop/walk/walk-gamepad';

export const PAD_BUTTONS = {
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  lb: 4,
  rb: 5,
  lt: 6,
  rt: 7,
  view: 8,
  menu: 9,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
} as const;
export type PadButton = keyof typeof PAD_BUTTONS;

/** Triggers count as pressed past this. */
const TRIGGER_THRESHOLD = 0.3;
/** A stick pushed this far counts as a d-pad press, for moving between buttons. */
const STICK_PRESS = 0.6;

export interface PadState {
  /** Buttons held down on any pad; with `stickAsDpad`, a left stick pushed well over counts too. */
  down: Set<PadButton>;
  /** The right stick, each -1 to 1, right and down positive. */
  scroll: { x: number; y: number };
}

/**
 * Every connected pad's buttons together, or null with none connected. `stickAsDpad` lets the left
 * stick stand in for the d-pad, for moving round a panel; leave it off while playing, where the
 * stick walks.
 */
export function readPads(pads: readonly (PadLike | null)[], stickAsDpad = false): PadState | null {
  const state: PadState = { down: new Set(), scroll: { x: 0, y: 0 } };
  let any = false;
  for (const pad of pads) {
    if (!pad?.connected) continue;
    any = true;
    for (const [name, index] of Object.entries(PAD_BUTTONS) as [PadButton, number][]) {
      const entry = pad.buttons[index];
      const threshold = name === 'lt' || name === 'rt' ? TRIGGER_THRESHOLD : 0.5;
      if (entry && (entry.pressed || entry.value > threshold)) state.down.add(name);
    }
    const [lx = 0, ly = 0, rx = 0, ry = 0] = pad.axes;
    if (stickAsDpad && Math.abs(lx) > Math.abs(ly)) {
      if (lx > STICK_PRESS) state.down.add('right');
      if (lx < -STICK_PRESS) state.down.add('left');
    } else if (stickAsDpad) {
      if (ly > STICK_PRESS) state.down.add('down');
      if (ly < -STICK_PRESS) state.down.add('up');
    }
    const right = shapeStick(rx, ry);
    if (Math.abs(right.x) > Math.abs(state.scroll.x)) state.scroll.x = right.x;
    if (Math.abs(right.y) > Math.abs(state.scroll.y)) state.scroll.y = right.y;
  }
  return any ? state : null;
}

/** A stick pushed this far, or a button held, counts as the controller being used. */
const ACTIVE = 0.4;

/**
 * Whether anyone is using a controller this frame: a button down or a stick pushed well over.
 * A connected pad lying idle does not count, so the prompts can follow whichever was used last.
 */
export function isPadActive(pads: readonly (PadLike | null)[]) {
  return pads.some(
    (pad) =>
      pad?.connected &&
      (pad.buttons.some((button) => button.pressed || button.value > ACTIVE) ||
        // Only the sticks: some browsers report the triggers as axes resting at -1.
        pad.axes.slice(0, 4).some((axis) => Math.abs(axis) > ACTIVE)),
  );
}

/** How long a held button waits before repeating, and then how often it repeats, in ms. */
export const REPEAT = { delay: 400, every: 150 };

/**
 * Turns held buttons into presses: one when a button goes down, and for `repeating` buttons more
 * while it stays down, as a held key repeats.
 */
export class PadPresses {
  private readonly since = new Map<PadButton, number>();
  private readonly fired = new Map<PadButton, number>();

  /** The buttons that press this frame. */
  update(down: ReadonlySet<PadButton>, now: number, repeating: ReadonlySet<PadButton>) {
    const pressed = new Set<PadButton>();
    for (const button of [...this.since.keys()])
      if (!down.has(button)) {
        this.since.delete(button);
        this.fired.delete(button);
      }
    for (const button of down) {
      const since = this.since.get(button);
      if (since === undefined) {
        this.since.set(button, now);
        this.fired.set(button, now);
        pressed.add(button);
        continue;
      }
      if (!repeating.has(button) || now - since < REPEAT.delay) continue;
      if (now - this.fired.get(button)! >= REPEAT.every) {
        this.fired.set(button, now);
        pressed.add(button);
      }
    }
    return pressed;
  }
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export type Direction = 'up' | 'down' | 'left' | 'right';

/**
 * The box to move to from `from` in a direction, as an index into `boxes`, or -1 with none that
 * way. The nearest box whose centre lies that way wins, with sideways distance counting double so
 * a box straight ahead beats a nearer one off to the side.
 */
export function nextBox(from: Box, boxes: readonly Box[], direction: Direction) {
  const cx = (from.left + from.right) / 2;
  const cy = (from.top + from.bottom) / 2;
  let best = -1;
  let bestScore = Infinity;
  boxes.forEach((box, index) => {
    const x = (box.left + box.right) / 2 - cx;
    const y = (box.top + box.bottom) / 2 - cy;
    const ahead = { left: -x, right: x, up: -y, down: y }[direction];
    const side = direction === 'left' || direction === 'right' ? Math.abs(y) : Math.abs(x);
    // Ahead by at least a pixel and more ahead than aside by a margin, so a row's neighbour never
    // counts as the one below it.
    if (ahead < 1 || side > ahead * 4 + 80) return;
    const score = ahead + side * 2;
    if (score < bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return best;
}
