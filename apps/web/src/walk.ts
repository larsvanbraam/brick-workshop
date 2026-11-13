import { PLATE_HEIGHT, getPart, getWorldBounds } from '@brick-workshop/engine';
import type { Brick } from '@brick-workshop/engine';

/**
 * A minifigure walking through the build, in scene units (a stud wide, 0.4 a plate high). Pieces
 * are solid boxes from their bounds; plants and doors are left out so the walker brushes through
 * foliage and walks in at doorways.
 */
export const MINIFIG = Object.freeze({
  /** Half the width of the box the minifigure fills: it fits through a 2-stud gap. */
  radius: 0.7,
  /** Four bricks tall. */
  height: 12 * PLATE_HEIGHT,
  /** Where its eyes sit, above its feet. */
  eye: 10.5 * PLATE_HEIGHT,
  /** Climbs a brick without jumping, so plate terraces and steps read as stairs. */
  step: 3 * PLATE_HEIGHT + 0.05,
  walkSpeed: 6,
  runSpeed: 11,
  gravity: 38,
  /** Clears about two bricks and a plate. */
  jumpSpeed: 14.5,
  flySpeed: 9,
  flyRunSpeed: 18,
  climbSpeed: 8,
  /** How quickly flight speeds up and drifts to a stop, per second. */
  flyGrip: 5,
});

export interface WalkBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface Walker {
  x: number;
  /** The minifigure's feet. */
  y: number;
  z: number;
  velocityY: number;
  grounded: boolean;
  /**
   * Floats free of gravity, still bumping into pieces, so it can go over walls. Sinking onto the
   * ground lands it.
   */
  flying?: boolean;
  /** Drift while flying: flight eases in and out rather than stopping dead. */
  velocityX?: number;
  velocityZ?: number;
}

export interface WalkInput {
  /** Forward and sideways intent, each -1 to 1, in the walker's own frame. */
  forward: number;
  strafe: number;
  /** Heading: 0 looks toward -z, positive turns left. */
  yaw: number;
  run: boolean;
  jump: boolean;
  /** Climbing (1) or sinking (-1) while flying. */
  rise?: number;
}

const EPSILON = 1e-4;
/** The largest move checked in one piece, so a fast frame cannot pass through a thin wall. */
const SUBSTEP = 0.2;

/** Whether a piece blocks the walker. */
function isSolid(brick: Brick) {
  const family = getPart(brick.partId).family;
  return family !== 'foliage' && family !== 'door';
}

/** The pieces as boxes in scene space, hashed by the stud columns they cover for quick lookup. */
export class WalkWorld {
  readonly boxes: WalkBox[] = [];
  /** How far from the board's centre the walker may roam. */
  readonly limit: number;
  /** How high the walker may fly: well over the tallest piece. */
  ceiling = 40;
  private readonly cells = new Map<string, number[]>();
  private readonly marks: number[] = [];
  private mark = 0;

  constructor(bricks: Iterable<Brick>, buildArea: number) {
    this.limit = buildArea / 2 + 12;
    const half = buildArea / 2;
    for (const brick of bricks) {
      if (!isSolid(brick)) continue;
      const bounds = getWorldBounds(brick);
      // The scene centres the board and runs z the other way (see `worldZ`).
      this.add({
        minX: bounds.minX - half,
        maxX: bounds.maxX - half,
        minY: bounds.minY * PLATE_HEIGHT,
        maxY: bounds.maxY * PLATE_HEIGHT,
        minZ: half - bounds.maxZ,
        maxZ: half - bounds.minZ,
      });
    }
  }

  private add(box: WalkBox) {
    const index = this.boxes.push(box) - 1;
    this.ceiling = Math.max(this.ceiling, box.maxY + 30);
    this.marks.push(0);
    for (let x = Math.floor(box.minX); x < Math.ceil(box.maxX); x++)
      for (let z = Math.floor(box.minZ); z < Math.ceil(box.maxZ); z++) {
        const key = `${x},${z}`;
        const cell = this.cells.get(key);
        if (cell) cell.push(index);
        else this.cells.set(key, [index]);
      }
  }

  /** The boxes overlapping the given region, each once. */
  query(region: WalkBox): WalkBox[] {
    const found: WalkBox[] = [];
    const mark = ++this.mark;
    for (let x = Math.floor(region.minX); x < Math.ceil(region.maxX); x++)
      for (let z = Math.floor(region.minZ); z < Math.ceil(region.maxZ); z++) {
        const cell = this.cells.get(`${x},${z}`);
        if (!cell) continue;
        for (const index of cell) {
          if (this.marks[index] === mark) continue;
          this.marks[index] = mark;
          const box = this.boxes[index];
          if (overlaps(box, region)) found.push(box);
        }
      }
    return found;
  }

  /** The boxes a minifigure standing at this spot would press into. */
  blocking(x: number, y: number, z: number): WalkBox[] {
    const { radius, height } = MINIFIG;
    return this.query({
      minX: x - radius,
      maxX: x + radius,
      minY: y,
      maxY: y + height,
      minZ: z - radius,
      maxZ: z + radius,
    });
  }

  /** Whether a point is inside a piece. */
  contains(x: number, y: number, z: number): boolean {
    return this.query({ minX: x, maxX: x, minY: y, maxY: y, minZ: z, maxZ: z }).length > 0;
  }

  /** The lowest spot at (x, z) where a minifigure fits, climbing out of anything in the way. */
  standingHeight(x: number, z: number, from = 0): number {
    let y = from;
    for (let tries = 0; tries < 512; tries++) {
      const blocking = this.blocking(x, y, z);
      if (!blocking.length) return y;
      y = Math.max(...blocking.map((box) => box.maxY));
    }
    return y;
  }
}

function overlaps(box: WalkBox, region: WalkBox) {
  return (
    box.minX < region.maxX - EPSILON &&
    box.maxX > region.minX + EPSILON &&
    box.minY < region.maxY - EPSILON &&
    box.maxY > region.minY + EPSILON &&
    box.minZ < region.maxZ - EPSILON &&
    box.maxZ > region.minZ + EPSILON
  );
}

/** A minifigure standing at the front of the board, facing the build. */
export function spawnWalker(world: WalkWorld, buildArea: number): Walker {
  const z = buildArea / 2 + 3;
  return { x: 0, y: world.standingHeight(0, z), z, velocityY: 0, grounded: true };
}

/** Moves the walker along one axis, stepping up onto low ledges. Returns whether it moved. */
function slide(world: WalkWorld, walker: Walker, axis: 'x' | 'z', distance: number) {
  if (!distance) return true;
  const x = axis === 'x' ? walker.x + distance : walker.x;
  const z = axis === 'z' ? walker.z + distance : walker.z;
  const blocking = world.blocking(x, walker.y, z);
  if (!blocking.length) {
    walker.x = x;
    walker.z = z;
    return true;
  }
  if (!walker.grounded) return false;
  const top = Math.max(...blocking.map((box) => box.maxY));
  if (top - walker.y > MINIFIG.step || world.blocking(x, top, z).length) return false;
  walker.x = x;
  walker.z = z;
  walker.y = top;
  return true;
}

/** Advances the walker by `delta` seconds of input, gravity and collisions. */
export function stepWalker(world: WalkWorld, walker: Walker, input: WalkInput, delta: number) {
  const dt = Math.min(delta, 1 / 20);
  const flying = walker.flying ?? false;
  const speed = flying
    ? input.run
      ? MINIFIG.flyRunSpeed
      : MINIFIG.flySpeed
    : input.run
      ? MINIFIG.runSpeed
      : MINIFIG.walkSpeed;
  // Flying never steps up onto ledges; it rises over them.
  if (flying) walker.grounded = false;
  let forward = input.forward;
  let strafe = input.strafe;
  const length = Math.hypot(forward, strafe);
  if (length > 1) {
    forward /= length;
    strafe /= length;
  }
  const sin = Math.sin(input.yaw);
  const cos = Math.cos(input.yaw);
  // Forward at yaw 0 is -z; strafing right is +x.
  let moveX = (-sin * forward + cos * strafe) * speed * dt;
  let moveZ = (-cos * forward - sin * strafe) * speed * dt;
  if (flying) {
    const ease = Math.min(1, MINIFIG.flyGrip * dt);
    walker.velocityX = (walker.velocityX ?? 0) + (moveX / dt - (walker.velocityX ?? 0)) * ease;
    walker.velocityZ = (walker.velocityZ ?? 0) + (moveZ / dt - (walker.velocityZ ?? 0)) * ease;
    moveX = walker.velocityX * dt;
    moveZ = walker.velocityZ * dt;
  } else {
    walker.velocityX = 0;
    walker.velocityZ = 0;
  }
  const steps = Math.max(1, Math.ceil(Math.hypot(moveX, moveZ) / SUBSTEP));
  for (let step = 0; step < steps; step++) {
    // A wall stops the drift along it.
    if (!slide(world, walker, 'x', moveX / steps)) walker.velocityX = 0;
    if (!slide(world, walker, 'z', moveZ / steps)) walker.velocityZ = 0;
  }
  const limit = world.limit;
  walker.x = Math.min(limit, Math.max(-limit, walker.x));
  walker.z = Math.min(limit, Math.max(-limit, walker.z));

  if (flying) {
    const climb = Math.max(-1, Math.min(1, input.rise ?? 0)) * MINIFIG.climbSpeed;
    walker.velocityY += (climb - walker.velocityY) * Math.min(1, MINIFIG.flyGrip * 1.6 * dt);
    if (walker.y >= world.ceiling) walker.velocityY = Math.min(0, walker.velocityY);
  } else {
    if (input.jump && walker.grounded) {
      walker.velocityY = MINIFIG.jumpSpeed;
      walker.grounded = false;
    }
    walker.velocityY -= MINIFIG.gravity * dt;
  }
  const fall = walker.velocityY * dt;
  const falls = Math.max(1, Math.ceil(Math.abs(fall) / SUBSTEP));
  walker.grounded = false;
  // Hovering still checks the ground below (for standing at y 0), but never bumps a head.
  for (let step = 0; step < falls && (fall !== 0 || walker.y <= 0); step++) {
    const y = walker.y + fall / falls;
    if (y <= 0) {
      walker.y = 0;
      walker.velocityY = 0;
      walker.grounded = true;
      // Only sinking onto the ground lands; hovering just above it after take-off does not.
      if (fall < 0) walker.flying = false;
      break;
    }
    const blocking = world.blocking(walker.x, y, walker.z);
    if (!blocking.length) {
      walker.y = y;
      continue;
    }
    if (fall < 0) {
      walker.y = Math.max(...blocking.map((box) => box.maxY));
      walker.grounded = true;
      walker.flying = false;
    } else {
      // Bumped its head.
      walker.y = Math.min(...blocking.map((box) => box.minY)) - MINIFIG.height;
    }
    walker.velocityY = 0;
    break;
  }
  if (!flying && !walker.grounded && walker.velocityY <= 0) {
    // Resting on a top: standing still keeps it grounded without a bounce.
    walker.grounded =
      walker.y <= EPSILON || world.blocking(walker.x, walker.y - 0.02, walker.z).length > 0;
  }
  return walker;
}
