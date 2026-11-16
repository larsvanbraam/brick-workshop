import { stepWalker } from '@brick-workshop/walk/walk';
import type { WalkWorld, Walker } from '@brick-workshop/walk/walk';

/**
 * A minifigure or an animal that walks about on its own: it strolls a while, stands a while,
 * turns back at ground it should not cross (water, a cliff, the edge of what is loaded), hops up
 * a step it bumps into and keeps near its home. When the player comes close it does what its
 * temper says: a friendly one stops to wave, a shy one runs off, a calm one carries on. It moves
 * with the walker's own physics, so it climbs, falls and collides like the player does.
 */

/**
 * What it does when the player comes close: `friendly` stops, faces them and waves, `shy` runs
 * away, `calm` takes no notice beyond keeping out of their way.
 */
export type Temper = 'friendly' | 'shy' | 'calm';

/** How a wanderer goes about: its temper and how fast it strolls. */
export interface WanderTraits {
  temper?: Temper;
  /** Strolling pace, a fraction of the walker's walking speed. */
  pace?: number;
}

export interface Wanderer {
  walker: Walker;
  /** Where it lives, in scene x and z: it strays at most `leash` from here. */
  home: { x: number; z: number };
  /** Which way it faces (the walker's yaw: 0 looks toward -z), and which way it means to go. */
  yaw: number;
  heading: number;
  mode: 'walk' | 'idle' | 'greet' | 'flee';
  temper: Temper;
  pace: number;
  /** Seconds left in this stroll or rest. */
  timer: number;
  /** How far along its stride it is, and how far it moved last step: for the legs' swing. */
  stride: number;
  moved: number;
  /** Seconds it has pushed on without getting anywhere. */
  stuck: number;
  /** Where it turns its head, toward the player while greeting. */
  look: number;
  /** Seconds since it began greeting: it waves for the first few. */
  greeting: number;
  /**
   * Seconds left talking to the player: it stands, faces them and leaves its temper aside.
   * Whoever holds the conversation keeps topping it up.
   */
  talking: number;
  /** Seconds left running from the player whatever its temper: it did not like being touched. */
  startled: number;
  /** A seeded 0 to 1 generator: its choices are its own. */
  next: () => number;
}

export interface WanderRules {
  /** How far from home it may stray, in studs. */
  leash: number;
  /** Whether it may walk from one spot to the next, in scene x and z: dry, level, loaded. */
  canWalk: (from: { x: number; z: number }, to: { x: number; z: number }) => boolean;
}

/** Strolling pace, a fraction of the walker's walking speed. */
export const WANDER_PACE = 0.4;
/** How close the player comes before a shy one runs, and how far it gets before it calms down. */
export const FLEE_RANGE = 7;
const FLEE_LEAVE = 12;
/** How much faster than its stroll a shy one runs. */
const FLEE_SPEEDUP = 3;
/** How close the player comes before it stops to wave, and how far before it walks on. */
export const GREET_RANGE = 5;
const GREET_LEAVE = 7;
/** How long it waves when the player comes up, in seconds. */
export const WAVE_TIME = 2;
/** How fast it turns to face where it is going, in radians a second. */
const TURN_RATE = 5;
/** How far ahead it checks the ground before stepping on. */
const LOOK_AHEAD = 1.5;
/** How close it walks up to someone else before turning aside, in studs. */
const PERSONAL_SPACE = 2;

/** A wanderer standing at `walker`, at home there, facing a random way. */
export function createWanderer(
  walker: Walker,
  next: () => number,
  traits: WanderTraits = {},
): Wanderer {
  const yaw = next() * Math.PI * 2;
  return {
    walker,
    temper: traits.temper ?? 'friendly',
    pace: traits.pace ?? WANDER_PACE,
    home: { x: walker.x, z: walker.z },
    yaw,
    heading: yaw,
    mode: 'idle',
    timer: 0.5 + next() * 3,
    stride: 0,
    moved: 0,
    stuck: 0,
    look: 0,
    greeting: 0,
    talking: 0,
    startled: 0,
    next,
  };
}

/** The yaw that faces from one spot toward another. */
export function yawToward(from: { x: number; z: number }, to: { x: number; z: number }) {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

/** The shortest turn from one angle to another, -π to π. */
function turn(from: number, to: number) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/** The spot `distance` ahead along a yaw. */
function ahead(walker: Walker, yaw: number, distance: number) {
  return { x: walker.x - Math.sin(yaw) * distance, z: walker.z - Math.cos(yaw) * distance };
}

/** A new way to stroll: anywhere, but back toward home once it has strayed far. */
function chooseHeading(npc: Wanderer, rules: WanderRules) {
  const { walker, home } = npc;
  const away = Math.hypot(walker.x - home.x, walker.z - home.z);
  const back = yawToward(walker, home);
  if (away > rules.leash * 0.6) return back + (npc.next() - 0.5) * 1.2;
  return npc.next() * Math.PI * 2;
}

/**
 * Advances the wanderer by `delta` seconds: decides where to go and moves it there through the
 * world. `player` is where the player's minifigure stands, if anywhere; it keeps out of their way
 * and out of the way of `others` (the other wanderers).
 */
export function stepWanderer(
  world: WalkWorld,
  npc: Wanderer,
  rules: WanderRules,
  player: { x: number; y: number; z: number } | null,
  delta: number,
  others: readonly { x: number; z: number }[] = [],
) {
  const { walker } = npc;
  const talking = npc.talking > 0 && player !== null;
  npc.talking = Math.max(0, npc.talking - delta);
  const startled = npc.startled > 0 && player !== null;
  npc.startled = Math.max(0, npc.startled - delta);
  // What the player's coming near sets off, if its temper reacts at all.
  const reaction = npc.temper === 'friendly' ? 'greet' : npc.temper === 'shy' ? 'flee' : null;
  if (startled) {
    npc.mode = 'flee';
  } else if (!reaction && npc.mode === 'flee') {
    npc.mode = 'idle';
    npc.timer = 1 + npc.next() * 2;
  } else if (talking) {
    // Stands and listens; a friendly one carries on facing the player afterwards, without
    // waving again, and the rest go back to strolling a moment after.
    npc.mode = npc.temper === 'friendly' ? 'greet' : 'idle';
    npc.greeting = Math.max(npc.greeting, WAVE_TIME);
    npc.timer = Math.max(npc.timer, 1.5);
  } else if (reaction) {
    const reacting = npc.mode === reaction;
    const range =
      reaction === 'greet'
        ? reacting
          ? GREET_LEAVE
          : GREET_RANGE
        : reacting
          ? FLEE_LEAVE
          : FLEE_RANGE;
    const near =
      player &&
      Math.abs(player.y - walker.y) < 3 &&
      Math.hypot(player.x - walker.x, player.z - walker.z) < range;
    if (near && !reacting) {
      npc.mode = reaction;
      npc.greeting = 0;
    } else if (!near && reacting) {
      npc.mode = 'idle';
      npc.timer = 1 + npc.next() * 2;
    }
  }

  let forward = 0;
  let jump = false;
  if (talking) {
    npc.heading = yawToward(walker, player!);
  } else if (npc.mode === 'greet') {
    npc.heading = yawToward(walker, player!);
    npc.greeting += delta;
  } else if (npc.mode === 'flee') {
    // Straight away from the player, swerving round what it may not cross.
    const away = yawToward(player!, walker);
    if (Math.abs(turn(npc.heading, away)) > 1.2) npc.heading = away;
    const target = ahead(walker, npc.heading, LOOK_AHEAD);
    if (!rules.canWalk(walker, target)) npc.heading += (npc.next() < 0.5 ? -1 : 1) * 0.9;
    else if (Math.abs(turn(npc.yaw, npc.heading)) < 0.9) {
      forward = Math.min(1, npc.pace * FLEE_SPEEDUP);
      jump = npc.stuck > 0.35;
    }
  } else {
    npc.timer -= delta;
    if (npc.timer <= 0) {
      if (npc.mode === 'idle') {
        npc.mode = 'walk';
        npc.heading = chooseHeading(npc, rules);
        npc.timer = 2 + npc.next() * 5;
      } else {
        npc.mode = 'idle';
        npc.timer = 1.5 + npc.next() * 4;
      }
      npc.stuck = 0;
    }
    if (npc.mode === 'walk') {
      const home = npc.home;
      const target = ahead(walker, npc.heading, LOOK_AHEAD);
      const strayed = Math.hypot(target.x - home.x, target.z - home.z) > rules.leash;
      // Someone in the way: closer to where it is heading than it is itself.
      const crowded = [...others, ...(player ? [player] : [])].some(
        (other) =>
          other !== walker &&
          Math.hypot(other.x - target.x, other.z - target.z) < PERSONAL_SPACE &&
          Math.hypot(other.x - target.x, other.z - target.z) <
            Math.hypot(walker.x - target.x, walker.z - target.z),
      );
      if (strayed || crowded || !rules.canWalk(walker, target)) {
        // Turns away from what is ahead, toward home if it has strayed, and stands a moment.
        npc.heading = strayed
          ? yawToward(walker, home)
          : npc.heading + Math.PI * (0.5 + npc.next());
        npc.stuck = 0;
      } else if (Math.abs(turn(npc.yaw, npc.heading)) < 0.6) {
        // Sets off once it roughly faces the way it means to go.
        forward = npc.pace;
        jump = npc.stuck > 0.35;
      }
    }
  }

  // Turns smoothly toward its heading.
  const difference = turn(npc.yaw, npc.heading);
  const step = TURN_RATE * (npc.mode === 'flee' ? 2 : 1) * delta;
  npc.yaw += Math.abs(difference) < step ? difference : Math.sign(difference) * step;
  // Looks at the player while greeting, as far as its neck turns.
  const lookTarget =
    npc.mode === 'greet' || talking ? Math.max(-0.7, Math.min(0.7, turn(npc.yaw, npc.heading))) : 0;
  npc.look += (lookTarget - npc.look) * Math.min(1, delta * 6);

  const fromX = walker.x;
  const fromZ = walker.z;
  stepWalker(world, walker, { forward, strafe: 0, yaw: npc.yaw, run: false, jump }, delta);
  const moved = Math.hypot(walker.x - fromX, walker.z - fromZ);
  npc.moved = moved;
  npc.stride = moved > 0.001 ? npc.stride + moved * 1.6 : npc.stride * 0.8;
  if (forward > 0) {
    // Hops up once when blocked; still blocked after that, it gives up on this way.
    const expected = forward * 6 * Math.min(delta, 1 / 20);
    npc.stuck = moved < expected * 0.3 ? npc.stuck + delta : 0;
    if (npc.stuck > 1) {
      npc.heading += Math.PI * (0.5 + npc.next());
      npc.stuck = 0;
    }
  }
  return npc;
}
