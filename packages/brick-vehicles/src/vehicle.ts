import type { WalkBox, WalkWorld } from '@brick-workshop/walk/walk';

/**
 * Vehicles a minifigure can drive or fly, in scene units (a stud wide, 0.4 a plate high). They
 * move through the same world of boxes the walker collides with: wheels climb a brick's step and
 * roll off ledges, bodies stop against walls, and aircraft land on whatever they come down on.
 * The handling is arcade, not simulation: each vehicle is a few numbers (top speed, how hard it
 * turns) that make it easy to drive for a child and different enough from the next to be fun.
 */

export type VehicleKind = 'bike' | 'motorcycle' | 'car' | 'racecar' | 'helicopter' | 'airplane';

/** How a vehicle moves: on its wheels, hovering, or flying on its wings. */
export type Handling = 'ground' | 'helicopter' | 'airplane';

export interface VehicleSpec {
  kind: VehicleKind;
  /** What the game calls it: "the car". */
  name: string;
  handling: Handling;
  /** The body: nose to tail, side to side and ground to top, in studs. */
  length: number;
  width: number;
  height: number;
  /** How high the deck is, which a minifigure can stand on while it is parked. */
  deck: number;
  /** Where the wheels touch the ground: between front and rear axles, and between left and right. */
  wheelbase: number;
  /** 0 for a single track (a bike or a motorcycle), which leans into turns instead of rolling. */
  track: number;
  /** The highest ledge it drives up without stopping: two bricks for wheels. */
  step: number;
  /** Studs a second. */
  maxSpeed: number;
  reverseSpeed: number;
  acceleration: number;
  braking: number;
  /** How fast it rolls to a stop with nothing pressed. */
  drag: number;
  /** Radians a second at full lock. */
  turnRate: number;
  /** The speed below which it turns less: a car does not spin on the spot. */
  turnSpeed: number;
  /** How far a single-track vehicle leans in a turn, or an aircraft banks, in radians. */
  lean: number;
  /** A helicopter's climb and sink, studs a second. */
  climbSpeed?: number;
  /** How far behind it the follow camera hangs, in studs. */
  follow: number;
  /** Airplanes: the speed it lifts off at, and below which it can no longer stay up. */
  takeoffSpeed?: number;
  stallSpeed?: number;
}

const BRICK = 1.2;
/** What wheels drive up without stopping: two bricks, so a kerb or a low wall is no barrier. */
const CLIMB = 2 * BRICK + 0.05;

export const VEHICLES: Readonly<Record<VehicleKind, VehicleSpec>> = Object.freeze({
  bike: {
    kind: 'bike',
    name: 'bike',
    handling: 'ground',
    length: 6,
    width: 1.6,
    height: 3.2,
    deck: 2.2,
    wheelbase: 4.3,
    track: 0,
    step: CLIMB,
    maxSpeed: 10,
    reverseSpeed: 3,
    acceleration: 6,
    braking: 16,
    drag: 4,
    turnRate: 2.4,
    turnSpeed: 3,
    lean: 0.32,
    follow: 11,
  },
  motorcycle: {
    kind: 'motorcycle',
    name: 'motorcycle',
    handling: 'ground',
    length: 8,
    width: 2,
    height: 3.6,
    deck: 2.6,
    wheelbase: 6,
    track: 0,
    step: CLIMB,
    maxSpeed: 18,
    reverseSpeed: 3,
    acceleration: 10,
    braking: 20,
    drag: 5,
    turnRate: 2.3,
    turnSpeed: 4,
    lean: 0.42,
    follow: 13,
  },
  car: {
    kind: 'car',
    name: 'car',
    handling: 'ground',
    length: 10.4,
    width: 5.4,
    height: 4.8,
    deck: 3.6,
    wheelbase: 6,
    track: 4.4,
    step: CLIMB,
    maxSpeed: 15,
    reverseSpeed: 5,
    acceleration: 8,
    braking: 20,
    drag: 5,
    turnRate: 1.9,
    turnSpeed: 4,
    lean: 0.05,
    follow: 15,
  },
  racecar: {
    kind: 'racecar',
    name: 'race car',
    handling: 'ground',
    length: 15,
    width: 6.4,
    height: 3.6,
    deck: 2.4,
    wheelbase: 9,
    track: 5.6,
    step: CLIMB,
    maxSpeed: 22,
    reverseSpeed: 6,
    acceleration: 12,
    braking: 26,
    drag: 6,
    turnRate: 2,
    turnSpeed: 5,
    lean: 0.03,
    follow: 18,
  },
  helicopter: {
    kind: 'helicopter',
    name: 'helicopter',
    handling: 'helicopter',
    length: 12,
    width: 4,
    height: 6,
    deck: 4.8,
    wheelbase: 6,
    track: 3,
    step: 0.3,
    maxSpeed: 13,
    reverseSpeed: 6,
    acceleration: 10,
    braking: 10,
    drag: 0,
    turnRate: 1.7,
    turnSpeed: 0,
    lean: 0.22,
    follow: 26,
    climbSpeed: 7,
  },
  airplane: {
    kind: 'airplane',
    name: 'airplane',
    handling: 'airplane',
    length: 14,
    width: 4,
    height: 4,
    deck: 3,
    wheelbase: 6,
    track: 3,
    step: CLIMB,
    maxSpeed: 20,
    reverseSpeed: 3,
    acceleration: 5,
    braking: 10,
    drag: 3,
    turnRate: 1.1,
    turnSpeed: 4,
    lean: 0.6,
    follow: 24,
    takeoffSpeed: 12,
    stallSpeed: 9,
  },
});

/** A vehicle in the world. Positions are in scene units, with y at the bottom of its wheels. */
export interface Vehicle {
  id: string;
  kind: VehicleKind;
  x: number;
  y: number;
  z: number;
  /** Heading: 0 faces -z and positive turns left, as the walker's yaw does. */
  yaw: number;
  /** Nose up is positive; for an airplane it steers the climb, otherwise it follows the ground. */
  pitch: number;
  /** Rolling left is positive. */
  roll: number;
  /** Signed speed along the heading, studs a second. */
  speed: number;
  /** A helicopter's drift, which is free of its heading. */
  velocityX: number;
  velocityZ: number;
  velocityY: number;
  grounded: boolean;
  /** Steering as it eases toward the input, -1 (left) to 1 (right), for the front wheel. */
  steer: number;
  /** How far the wheels have turned, in radians. */
  wheelTurn: number;
  /** How fast the rotor or propeller spins, 0 to 1, and how far it has turned. */
  engine: number;
  propeller: number;
  /** Whether someone is at the controls. */
  driven: boolean;
  /**
   * Whether it has found the ground under its spawn: a vehicle waits, hidden, until the world
   * round it has loaded.
   */
  settled: boolean;
}

export interface DriveInput {
  /** Forward (1) or back (-1): the accelerator and the brake, or an airplane's throttle. */
  throttle: number;
  /** Right (1) or left (-1). */
  steer: number;
  /** Climbing (1) or sinking (-1), for aircraft; an airplane pulls up or dives. */
  rise: number;
  /** The handbrake. */
  brake: boolean;
}

export const IDLE: DriveInput = Object.freeze({ throttle: 0, steer: 0, rise: 0, brake: false });

const GRAVITY = 40;
/** The largest move checked in one piece, so a fast frame cannot pass through a thin wall. */
const SUBSTEP = 0.25;
const EPSILON = 1e-3;
/** How far under the body a wheel looks for ground before the vehicle falls instead. */
const PROBE = 0.08;

/** A vehicle parked at a spot, waiting for the ground under it to load. */
export function parkVehicle(
  id: string,
  kind: VehicleKind,
  x: number,
  z: number,
  yaw: number,
  y = Number.NaN,
): Vehicle {
  return {
    id,
    kind,
    x,
    y,
    z,
    yaw,
    pitch: 0,
    roll: 0,
    speed: 0,
    velocityX: 0,
    velocityZ: 0,
    velocityY: 0,
    grounded: true,
    steer: 0,
    wheelTurn: 0,
    engine: 0,
    propeller: 0,
    driven: false,
    settled: false,
  };
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
/** Moves `value` toward `target` by at most `step`. */
const approach = (value: number, target: number, step: number) =>
  value < target ? Math.min(target, value + step) : Math.max(target, value - step);
const ease = (value: number, target: number, rate: number, dt: number) =>
  value + (target - value) * Math.min(1, rate * dt);

/** The heading's forward direction in the scene: -z at yaw 0. */
export function forwardOf(yaw: number) {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

/** A point in the vehicle's frame (right and forward of its middle) in the scene. */
function local(x: number, z: number, yaw: number, right: number, forward: number) {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return { x: x + cos * right - sin * forward, z: z - sin * right - cos * forward };
}

/**
 * The centres of the squares the body is checked with: a row along its length, each as wide as
 * the body, so a long vehicle turned at an angle is not checked as one big box.
 */
function bodyCentres(spec: VehicleSpec, x: number, z: number, yaw: number) {
  const count = Math.max(1, Math.ceil(spec.length / spec.width));
  const span = Math.max(0, spec.length - spec.width);
  const centres: { x: number; z: number }[] = [];
  for (let i = 0; i < count; i++) {
    const forward = count === 1 ? 0 : span / 2 - (span * i) / (count - 1);
    centres.push(local(x, z, yaw, 0, forward));
  }
  return centres;
}

/** The boxes the body fills, from `bottom` to `top`, a little narrower than its sides. */
function bodyBoxes(
  spec: VehicleSpec,
  x: number,
  z: number,
  yaw: number,
  bottom: number,
  top: number,
): WalkBox[] {
  const half = spec.width * 0.42;
  return bodyCentres(spec, x, z, yaw).map((centre) => ({
    minX: centre.x - half,
    maxX: centre.x + half,
    minY: bottom,
    maxY: top,
    minZ: centre.z - half,
    maxZ: centre.z + half,
  }));
}

const NONE: ReadonlySet<WalkBox> = new Set();

/** The pieces the body would press into with its bottom at `bottom`, but those in `ignore`. */
function bodyHits(
  world: WalkWorld,
  spec: VehicleSpec,
  x: number,
  z: number,
  yaw: number,
  bottom: number,
  ignore: ReadonlySet<WalkBox> = NONE,
) {
  const hits = new Set<WalkBox>();
  for (const box of bodyBoxes(spec, x, z, yaw, bottom, bottom + spec.height))
    for (const hit of world.query(box)) if (!ignore.has(hit)) hits.add(hit);
  return hits;
}

/** Whether the body would press into a piece with its bottom at `bottom`. */
function bodyBlocked(
  world: WalkWorld,
  spec: VehicleSpec,
  x: number,
  z: number,
  yaw: number,
  bottom: number,
) {
  return bodyHits(world, spec, x, z, yaw, bottom).size > 0;
}

/** Whether every piece in the way is one the vehicle is already stuck in. */
const onlyStuckIn = (hits: Iterable<WalkBox>, stuck: ReadonlySet<WalkBox>) => {
  for (const hit of hits) if (!stuck.has(hit)) return false;
  return true;
};

/**
 * The top of the ground at a point, at or below `below`: the highest top there that does not
 * reach above it, or 0 (the bottom of the world) when nothing does. With `walls`, a piece that
 * reaches up past `below` makes it Infinity: a stacked wall is not a ledge to climb course by
 * course.
 */
export function groundAt(world: WalkWorld, x: number, z: number, below: number, walls = false) {
  if (!walls) return groundUnder(world, x, z, below, null);
  const found: WalkBox[] = [];
  const top = groundUnder(world, x, z, below, found);
  return found.length ? Infinity : top;
}

/**
 * The top of the ground at a point, at or below `below`, leaving out the pieces in `ignore`; with
 * `walls`, the pieces there that reach up past it are added to that list.
 */
function groundUnder(
  world: WalkWorld,
  x: number,
  z: number,
  below: number,
  walls: WalkBox[] | null,
  ignore: ReadonlySet<WalkBox> = NONE,
) {
  const r = 0.3;
  return groundIn(world, x - r, x + r, z - r, z + r, below, walls, ignore);
}

/** As `groundUnder`, over a patch of ground rather than round a point. */
function groundIn(
  world: WalkWorld,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  below: number,
  walls: WalkBox[] | null,
  ignore: ReadonlySet<WalkBox> = NONE,
) {
  let top = 0;
  for (const box of world.query({
    minX,
    maxX,
    minY: -1,
    maxY: below + (walls ? 0.1 : 0),
    minZ,
    maxZ,
  })) {
    if (ignore.has(box)) continue;
    if (box.maxY <= below + EPSILON) top = Math.max(top, box.maxY);
    else walls?.push(box);
  }
  return top;
}

/** Whether the world round a point has loaded: anything stands in its column. */
export function hasGround(world: WalkWorld, x: number, z: number) {
  return (
    world.query({
      minX: x - 0.5,
      maxX: x + 0.5,
      minY: -1,
      maxY: world.ceiling + 50,
      minZ: z - 0.5,
      maxZ: z + 0.5,
    }).length > 0
  );
}

/** Where the wheels touch: front and rear, left and right (one each for a single track). */
function contacts(spec: VehicleSpec, x: number, z: number, yaw: number) {
  const front = spec.wheelbase / 2;
  const side = spec.track / 2;
  if (!side) return [local(x, z, yaw, 0, front), local(x, z, yaw, 0, -front)];
  return [
    local(x, z, yaw, -side, front),
    local(x, z, yaw, side, front),
    local(x, z, yaw, -side, -front),
    local(x, z, yaw, side, -front),
  ];
}

/**
 * The ground under each wheel, no higher than `below`, in the order `contacts` gives them; with
 * `ends`, also under the nose and the tail, which ride up a ledge before the wheels reach it.
 */
function wheelGround(
  world: WalkWorld,
  spec: VehicleSpec,
  x: number,
  z: number,
  yaw: number,
  below: number,
) {
  return contacts(spec, x, z, yaw).map((point) => groundAt(world, point.x, point.z, below));
}

/**
 * The highest ground anywhere under the vehicle, no higher than `below`: under its wheels and
 * under every part of its body, so a brick it meets with a corner or between its wheels lifts it
 * like one under a wheel. With `walls`, the pieces that reach up past `below` there are added to
 * that list; the pieces in `ignore` are left out.
 */
function groundUnderBody(
  world: WalkWorld,
  spec: VehicleSpec,
  x: number,
  z: number,
  yaw: number,
  below: number,
  walls: WalkBox[] | null = null,
  ignore: ReadonlySet<WalkBox> = NONE,
) {
  let top = 0;
  for (const point of contacts(spec, x, z, yaw))
    top = Math.max(top, groundUnder(world, point.x, point.z, below, walls, ignore));
  for (const box of bodyBoxes(spec, x, z, yaw, 0, 0))
    top = Math.max(
      top,
      groundIn(world, box.minX, box.maxX, box.minZ, box.maxZ, below, walls, ignore),
    );
  return top;
}

/**
 * Settles a parked vehicle onto the ground once the world under it has loaded. Returns whether it
 * has.
 */
export function settleVehicle(world: WalkWorld, vehicle: Vehicle) {
  if (vehicle.settled) return true;
  if (!hasGround(world, vehicle.x, vehicle.z)) return false;
  const spec = VEHICLES[vehicle.kind];
  const saved = Number.isFinite(vehicle.y);
  let y = saved ? vehicle.y : world.ceiling;
  // Rests on the highest ground under its wheels, then climbs out of anything still in the way;
  // one left up in the air (a saved flight) stays there.
  const ground = groundUnderBody(world, spec, vehicle.x, vehicle.z, vehicle.yaw, y + spec.step);
  const airborne = saved && y - ground > spec.step;
  if (!airborne) y = ground;
  for (
    let tries = 0;
    tries < 64 && bodyBlocked(world, spec, vehicle.x, vehicle.z, vehicle.yaw, y + EPSILON);
    tries++
  )
    y += 0.4;
  vehicle.y = y;
  vehicle.grounded = !airborne;
  if (airborne && spec.handling === 'airplane') vehicle.speed = spec.takeoffSpeed ?? 20;
  if (airborne && spec.handling === 'helicopter') vehicle.engine = 1;
  vehicle.velocityY = 0;
  vehicle.settled = true;
  return true;
}

/**
 * The body at a spot on its wheels: the height it would stand at there, and what is in the way: a
 * wall or a ledge too high to climb under a wheel, or a piece the body presses into. The pieces in
 * `ignore` are left out, as if they were not there.
 */
function footing(
  world: WalkWorld,
  spec: VehicleSpec,
  vehicle: Vehicle,
  x: number,
  z: number,
  yaw: number,
  ignore: ReadonlySet<WalkBox> = NONE,
) {
  const blockers: WalkBox[] = [];
  const top = groundUnderBody(world, spec, x, z, yaw, vehicle.y + spec.step, blockers, ignore);
  // On the ground it follows the ground down a step; in the air it keeps its height.
  const y = vehicle.grounded && top >= vehicle.y - spec.step ? top : Math.max(top, vehicle.y);
  const bottom = y + Math.min(spec.step, 0.5) + EPSILON;
  for (const hit of bodyHits(world, spec, x, z, yaw, bottom, ignore)) blockers.push(hit);
  return { y, blockers };
}

/**
 * Tries the body at a new spot on its wheels: the height it would stand at there, or null when
 * something is in the way. A vehicle that ended up inside something (it came down on a post, or a
 * piece was built through it) passes through what it is `stuck` in, so it can always get out.
 */
function rollTo(
  world: WalkWorld,
  spec: VehicleSpec,
  vehicle: Vehicle,
  x: number,
  z: number,
  yaw: number,
  stuck = NONE,
) {
  const at = footing(world, spec, vehicle, x, z, yaw, stuck);
  return at.blockers.length ? null : at;
}

/** What the vehicle is stuck in where it stands: usually nothing. */
function stuckIn(world: WalkWorld, spec: VehicleSpec, vehicle: Vehicle): ReadonlySet<WalkBox> {
  return new Set(footing(world, spec, vehicle, vehicle.x, vehicle.z, vehicle.yaw).blockers);
}

/** Moves the vehicle by `dx`, `dz` on its wheels, sliding along walls. Returns whether it hit one. */
function drive(world: WalkWorld, spec: VehicleSpec, vehicle: Vehicle, dx: number, dz: number) {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / SUBSTEP));
  let hit = false;
  for (let i = 0; i < steps; i++) {
    const tries = [
      [dx / steps, dz / steps],
      [dx / steps, 0],
      [0, dz / steps],
    ] as const;
    let moved = false;
    // Only when no way is clear does it look at what it is stuck in, to let it out.
    let stuck: ReadonlySet<WalkBox> | null = null;
    for (let pass = 0; pass < 2 && !moved; pass++) {
      if (pass === 1) {
        stuck = stuckIn(world, spec, vehicle);
        if (!stuck.size) break;
      }
      for (const [mx, mz] of tries) {
        const x = vehicle.x + mx;
        const z = vehicle.z + mz;
        const at = rollTo(world, spec, vehicle, x, z, vehicle.yaw, stuck ?? NONE);
        if (!at) continue;
        vehicle.x = x;
        vehicle.z = z;
        if (vehicle.grounded || at.y > vehicle.y) vehicle.y = at.y;
        if (mx !== dx / steps || mz !== dz / steps) hit = true;
        moved = true;
        break;
      }
    }
    if (!moved) {
      hit = true;
      break;
    }
  }
  return hit;
}

/** Falls, or stays on, whatever is under the wheels. */
function fall(world: WalkWorld, spec: VehicleSpec, vehicle: Vehicle, dt: number) {
  const ground = groundUnderBody(
    world,
    spec,
    vehicle.x,
    vehicle.z,
    vehicle.yaw,
    vehicle.y + EPSILON,
  );
  if (vehicle.grounded && vehicle.y - ground <= PROBE) {
    vehicle.y = ground;
    vehicle.velocityY = 0;
    return;
  }
  vehicle.grounded = false;
  vehicle.velocityY -= GRAVITY * dt;
  const next = vehicle.y + vehicle.velocityY * dt;
  if (next <= ground) {
    vehicle.y = ground;
    vehicle.velocityY = 0;
    vehicle.grounded = true;
  } else vehicle.y = next;
}

/** The nose's and the left side's rise over the wheels, for how the body tilts on uneven ground. */
function groundTilt(world: WalkWorld, spec: VehicleSpec, vehicle: Vehicle) {
  const ground = wheelGround(world, spec, vehicle.x, vehicle.z, vehicle.yaw, vehicle.y + EPSILON);
  if (ground.length === 2)
    return { pitch: Math.atan2(ground[0] - ground[1], spec.wheelbase), roll: 0 };
  const [fl, fr, rl, rr] = ground;
  return {
    pitch: Math.atan2((fl + fr - rl - rr) / 2, spec.wheelbase),
    roll: Math.atan2((fl + rl - fr - rr) / 2, spec.track),
  };
}

/** A wheeled vehicle's speed after the throttle, brakes and rolling resistance. */
function accelerate(spec: VehicleSpec, vehicle: Vehicle, input: DriveInput, dt: number) {
  const { throttle } = input;
  let speed = vehicle.speed;
  if (!vehicle.grounded) return speed;
  if (throttle > 0) {
    if (speed < 0) speed = approach(speed, 0, spec.braking * dt);
    // Pulls hardest from a standstill and less toward top speed.
    else speed += spec.acceleration * throttle * (1 - 0.6 * (speed / spec.maxSpeed)) * dt;
  } else if (throttle < 0) {
    if (speed > 0) speed = approach(speed, 0, spec.braking * -throttle * dt);
    else speed -= spec.acceleration * 0.6 * -throttle * dt;
  } else speed = approach(speed, 0, spec.drag * dt);
  if (input.brake) speed = approach(speed, 0, spec.braking * 1.2 * dt);
  return clamp(speed, -spec.reverseSpeed, spec.maxSpeed);
}

/** How fast the heading turns for the steering at this speed, radians a second. */
function turning(spec: VehicleSpec, vehicle: Vehicle) {
  const grip = clamp(Math.abs(vehicle.speed) / spec.turnSpeed, 0, 1);
  const fast = 1 - 0.3 * clamp(Math.abs(vehicle.speed) / spec.maxSpeed, 0, 1);
  return -vehicle.steer * spec.turnRate * grip * fast * Math.sign(vehicle.speed);
}

function stepGround(
  world: WalkWorld,
  spec: VehicleSpec,
  vehicle: Vehicle,
  input: DriveInput,
  dt: number,
) {
  vehicle.speed = accelerate(spec, vehicle, input, dt);
  vehicle.steer = ease(vehicle.steer, input.steer, 8, dt);
  const yaw = vehicle.yaw + turning(spec, vehicle) * (vehicle.grounded ? 1 : 0.4) * dt;
  // Turning only if the body fits the new heading where it stands, or presses into nothing it was
  // not already stuck in.
  if (
    yaw !== vehicle.yaw &&
    (rollTo(world, spec, vehicle, vehicle.x, vehicle.z, yaw) ||
      rollTo(world, spec, vehicle, vehicle.x, vehicle.z, yaw, stuckIn(world, spec, vehicle)))
  )
    vehicle.yaw = yaw;
  const forward = forwardOf(vehicle.yaw);
  const hit = drive(
    world,
    spec,
    vehicle,
    forward.x * vehicle.speed * dt,
    forward.z * vehicle.speed * dt,
  );
  // A wall stops it dead; a glancing one slows it as it slides along.
  if (hit) vehicle.speed *= Math.abs(vehicle.speed) > 4 ? 0.82 : 0.5;
  fall(world, spec, vehicle, dt);
  const tilt = vehicle.grounded
    ? groundTilt(world, spec, vehicle)
    : { pitch: vehicle.pitch, roll: 0 };
  vehicle.pitch = ease(vehicle.pitch, tilt.pitch, 10, dt);
  // Single-track vehicles lean into the turn; four wheels roll with the ground.
  const lean = spec.track
    ? tilt.roll
    : -vehicle.steer * spec.lean * clamp(Math.abs(vehicle.speed) / (spec.maxSpeed * 0.5), 0, 1);
  vehicle.roll = ease(vehicle.roll, lean, 6, dt);
  return hit;
}

/**
 * Whether a flying body fits at `x`, `z` with its bottom at `bottom`, or presses only into what it
 * is already in with its bottom at `from` where it is.
 */
function clearOf(
  world: WalkWorld,
  spec: VehicleSpec,
  vehicle: Vehicle,
  x: number,
  z: number,
  bottom: number,
  from: number,
) {
  const hits = bodyHits(world, spec, x, z, vehicle.yaw, bottom);
  if (!hits.size) return true;
  return onlyStuckIn(hits, bodyHits(world, spec, vehicle.x, vehicle.z, vehicle.yaw, from));
}

/** Moves a flying body by `dx`, `dz`, stopping against walls. Returns which way it was stopped. */
function fly(
  world: WalkWorld,
  spec: VehicleSpec,
  vehicle: Vehicle,
  dx: number,
  dz: number,
  dy: number,
) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.hypot(dx, dz), Math.abs(dy)) / SUBSTEP));
  const stopped = { x: false, z: false, down: false, up: false };
  for (let i = 0; i < steps; i++) {
    for (const axis of ['x', 'z'] as const) {
      if (stopped[axis]) continue;
      const move = (axis === 'x' ? dx : dz) / steps;
      if (!move) continue;
      const x = axis === 'x' ? vehicle.x + move : vehicle.x;
      const z = axis === 'z' ? vehicle.z + move : vehicle.z;
      // Skimming along the ground, it slides up over a low lip rather than stopping.
      const bottom = vehicle.y + (vehicle.grounded ? spec.step : 0) + EPSILON;
      if (clearOf(world, spec, vehicle, x, z, bottom, bottom)) {
        vehicle.x = x;
        vehicle.z = z;
      } else stopped[axis] = true;
    }
    const move = dy / steps;
    if (move && !stopped.down && !stopped.up) {
      const y = vehicle.y + move;
      const ground = groundUnderBody(
        world,
        spec,
        vehicle.x,
        vehicle.z,
        vehicle.yaw,
        vehicle.y + EPSILON,
      );
      if (move < 0 && y <= ground) {
        vehicle.y = ground;
        stopped.down = true;
      } else if (
        move > 0 &&
        !clearOf(world, spec, vehicle, vehicle.x, vehicle.z, y + EPSILON, vehicle.y + EPSILON)
      ) {
        stopped.up = true;
      } else vehicle.y = y;
    }
  }
  if (vehicle.y >= world.ceiling) {
    vehicle.y = world.ceiling;
    stopped.up = true;
  }
  return stopped;
}

/** Whether the vehicle stands on something rather than hanging in the air. */
function onGround(world: WalkWorld, spec: VehicleSpec, vehicle: Vehicle) {
  const ground = groundUnderBody(
    world,
    spec,
    vehicle.x,
    vehicle.z,
    vehicle.yaw,
    vehicle.y + EPSILON,
  );
  return vehicle.y - ground <= PROBE;
}

/** How long a rotor or propeller takes to wind up, and to wind down again. */
const SPIN_UP = 1.6;

function stepHelicopter(
  world: WalkWorld,
  spec: VehicleSpec,
  vehicle: Vehicle,
  input: DriveInput,
  dt: number,
) {
  const airborne = !onGround(world, spec, vehicle);
  // Left alone in the air it keeps its rotor turning and settles to the ground.
  vehicle.engine = approach(vehicle.engine, vehicle.driven || airborne ? 1 : 0, dt / SPIN_UP);
  vehicle.propeller += vehicle.engine * 26 * dt;
  const lift = vehicle.engine > 0.9;
  vehicle.grounded = !airborne;
  // Off the ground it flies where it is pushed; on its skids it only turns, and only rising
  // lifts it off.
  const flying = lift && (airborne || input.rise > 0);
  const climb = spec.climbSpeed ?? 10;
  let rise: number;
  if (!vehicle.driven) rise = airborne ? (lift ? -0.25 : -2) : 0;
  else rise = lift ? input.rise : -2;
  if (rise < -1) vehicle.velocityY -= GRAVITY * dt;
  else vehicle.velocityY = ease(vehicle.velocityY, rise * climb, 3, dt);
  if (flying) vehicle.yaw += -input.steer * spec.turnRate * dt;
  const forward = forwardOf(vehicle.yaw);
  const push = flying
    ? input.throttle * (input.throttle > 0 ? spec.maxSpeed : spec.reverseSpeed)
    : 0;
  vehicle.velocityX = ease(vehicle.velocityX, forward.x * push, airborne ? 1.4 : 6, dt);
  vehicle.velocityZ = ease(vehicle.velocityZ, forward.z * push, airborne ? 1.4 : 6, dt);
  const stopped = fly(
    world,
    spec,
    vehicle,
    vehicle.velocityX * dt,
    vehicle.velocityZ * dt,
    vehicle.velocityY * dt,
  );
  if (stopped.x) vehicle.velocityX = 0;
  if (stopped.z) vehicle.velocityZ = 0;
  if (stopped.down || stopped.up) vehicle.velocityY = 0;
  if (stopped.down) vehicle.grounded = true;
  vehicle.speed = vehicle.velocityX * forward.x + vehicle.velocityZ * forward.z;
  // Dips its nose to fly forward and banks into a turn.
  const steer = flying ? input.steer : 0;
  vehicle.steer = ease(vehicle.steer, steer, 4, dt);
  vehicle.pitch = ease(vehicle.pitch, -(vehicle.speed / spec.maxSpeed) * 0.22, 3, dt);
  vehicle.roll = ease(vehicle.roll, -vehicle.steer * spec.lean, 3, dt);
  return stopped.x || stopped.z;
}

function stepAirplane(
  world: WalkWorld,
  spec: VehicleSpec,
  vehicle: Vehicle,
  input: DriveInput,
  dt: number,
) {
  const takeoff = spec.takeoffSpeed ?? 20;
  const stall = spec.stallSpeed ?? 15;
  vehicle.engine = approach(
    vehicle.engine,
    vehicle.driven ? 0.35 + 0.65 * Math.max(0, input.throttle, vehicle.speed / spec.maxSpeed) : 0,
    dt / SPIN_UP,
  );
  vehicle.propeller += vehicle.engine * 30 * dt;
  const airborne = !onGround(world, spec, vehicle);
  if (!airborne) {
    vehicle.grounded = true;
    // Rolls on its wheels like a car, then lifts off once it is fast enough: pulling up does it
    // sooner, and holding the throttle at speed does it by itself.
    const hit = stepGround(
      world,
      spec,
      vehicle,
      vehicle.driven ? input : { ...IDLE, brake: true },
      dt,
    );
    const pull = input.rise > 0 || vehicle.speed > takeoff * 1.25;
    if (vehicle.driven && vehicle.speed >= takeoff && pull && !hit) {
      vehicle.grounded = false;
      vehicle.pitch = Math.max(vehicle.pitch, 0.12);
      vehicle.y += PROBE * 2;
    }
    return hit;
  }
  vehicle.grounded = false;
  // The throttle holds its speed in the air: forward speeds up, back slows down, and climbing
  // costs speed as diving gains it.
  const throttle = vehicle.driven ? input.throttle : -0.5;
  if (throttle > 0) vehicle.speed += spec.acceleration * throttle * dt;
  else if (throttle < 0) vehicle.speed -= spec.braking * 0.5 * -throttle * dt;
  vehicle.speed -= Math.sin(vehicle.pitch) * GRAVITY * 0.25 * dt;
  vehicle.speed = clamp(vehicle.speed, 0, spec.maxSpeed);
  const lift = clamp((vehicle.speed - stall * 0.6) / (stall * 0.4), 0, 1);
  // Pulls up or dives with the input and levels out by itself; too slow, its nose drops. Near
  // the ground with the throttle open it climbs away, and coming down it flares to land gently.
  const height = vehicle.y - groundAt(world, vehicle.x, vehicle.z, vehicle.y + EPSILON);
  let target = vehicle.driven ? input.rise * 0.45 : -0.25;
  if (vehicle.driven && !input.rise && input.throttle > 0 && height < 6) target = 0.12;
  if (height < 3) target = Math.max(target, -0.08);
  target = target * lift - (1 - lift) * 0.3;
  vehicle.pitch = ease(vehicle.pitch, target, 2.2, dt);
  vehicle.steer = ease(vehicle.steer, vehicle.driven ? input.steer : 0, 3, dt);
  vehicle.roll = ease(vehicle.roll, -vehicle.steer * spec.lean, 2.5, dt);
  vehicle.yaw += -vehicle.steer * spec.turnRate * (0.5 + 0.5 * lift) * dt;
  const sink = (1 - lift) * 8;
  vehicle.velocityY = vehicle.speed * Math.sin(vehicle.pitch) - sink;
  const horizontal = vehicle.speed * Math.cos(vehicle.pitch);
  const forward = forwardOf(vehicle.yaw);
  const stopped = fly(
    world,
    spec,
    vehicle,
    forward.x * horizontal * dt,
    forward.z * horizontal * dt,
    vehicle.velocityY * dt,
  );
  if (stopped.x || stopped.z) {
    // Flew into something: it stops and drops.
    vehicle.speed = 0;
    vehicle.pitch = Math.min(vehicle.pitch, 0);
  }
  if (stopped.up) vehicle.pitch = Math.min(vehicle.pitch, 0);
  if (stopped.down) {
    // Touches down; a hard landing loses most of its speed.
    vehicle.grounded = true;
    vehicle.velocityY = 0;
    if (vehicle.pitch < -0.2) vehicle.speed *= 0.4;
    vehicle.pitch = 0;
  }
  return stopped.x || stopped.z;
}

/**
 * Advances a vehicle by `delta` seconds of input, gravity and collisions. Returns whether it hit
 * something, for a bump.
 */
export function stepVehicle(world: WalkWorld, vehicle: Vehicle, input: DriveInput, delta: number) {
  if (!settleVehicle(world, vehicle)) return false;
  const dt = Math.min(delta, 1 / 20);
  const spec = VEHICLES[vehicle.kind];
  const given = vehicle.driven ? input : IDLE;
  let hit: boolean;
  if (spec.handling === 'helicopter') hit = stepHelicopter(world, spec, vehicle, given, dt);
  else if (spec.handling === 'airplane') hit = stepAirplane(world, spec, vehicle, given, dt);
  else {
    hit = stepGround(world, spec, vehicle, given, dt);
    vehicle.engine = approach(vehicle.engine, vehicle.driven ? 1 : 0, dt / 0.6);
  }
  // The world's drift carries it too: on its wheels round anything in the way, in the air freely.
  const drift = world.drift?.(vehicle.x, vehicle.z);
  if (drift) {
    if (spec.handling === 'ground') drive(world, spec, vehicle, drift[0] * dt, drift[1] * dt);
    else {
      vehicle.x += drift[0] * dt;
      vehicle.z += drift[1] * dt;
    }
  }
  const limit = world.limit;
  vehicle.x = clamp(vehicle.x, -limit, limit);
  vehicle.z = clamp(vehicle.z, -limit, limit);
  if (spec.handling !== 'helicopter')
    vehicle.wheelTurn += (vehicle.speed * dt) / WHEEL_RADIUS[vehicle.kind];
  return hit;
}

/** The wheels' radius in studs, for how fast they turn. */
const WHEEL_RADIUS: Readonly<Record<VehicleKind, number>> = {
  bike: 1.06,
  motorcycle: 1.33,
  car: 0.9,
  racecar: 1.5,
  helicopter: 1,
  airplane: 0.9,
};

/** Whether a vehicle is standing still on the ground, so getting out leaves it where it is. */
export function isAtRest(vehicle: Vehicle) {
  return vehicle.grounded && Math.abs(vehicle.speed) < 0.2 && Math.abs(vehicle.velocityY) < 0.2;
}

/**
 * The boxes a parked vehicle fills, which the walker bumps into and can stand on: its body up to
 * its deck.
 */
export function parkedBoxes(vehicle: Vehicle): WalkBox[] {
  const spec = VEHICLES[vehicle.kind];
  return bodyBoxes(spec, vehicle.x, vehicle.z, vehicle.yaw, vehicle.y + 0.2, vehicle.y + spec.deck);
}

/**
 * How far a point is from the vehicle's body, in studs along the ground (0 inside it): how close
 * the walker is to getting in.
 */
export function distanceTo(vehicle: Vehicle, x: number, z: number) {
  const spec = VEHICLES[vehicle.kind];
  const dx = x - vehicle.x;
  const dz = z - vehicle.z;
  const forward = forwardOf(vehicle.yaw);
  const along = dx * forward.x + dz * forward.z;
  const across = dx * forward.z - dz * forward.x;
  const outAlong = Math.max(0, Math.abs(along) - spec.length / 2);
  const outAcross = Math.max(0, Math.abs(across) - spec.width / 2);
  return Math.hypot(outAlong, outAcross);
}

/**
 * Where to set the minifigure down when it gets out: beside the driver's seat if there is room,
 * else on the other side, behind, in front or on top.
 */
export function exitSpot(vehicle: Vehicle, fits: (x: number, z: number) => boolean) {
  const spec = VEHICLES[vehicle.kind];
  const side = spec.width / 2 + 1;
  const end = spec.length / 2 + 1;
  const spots = [
    [-side, 0],
    [side, 0],
    [0, -end],
    [0, end],
    [-side - 1.5, 0],
    [side + 1.5, 0],
  ] as const;
  for (const [right, forward] of spots) {
    const spot = local(vehicle.x, vehicle.z, vehicle.yaw, right, forward);
    if (fits(spot.x, spot.z)) return spot;
  }
  return null;
}
