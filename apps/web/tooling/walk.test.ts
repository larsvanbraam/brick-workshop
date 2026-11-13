import { describe, expect, it } from 'vite-plus/test';
import type { Brick } from '@brick-workshop/engine';
import { MINIFIG, WalkWorld, spawnWalker, stepWalker } from '../src/walk';
import type { WalkInput, Walker } from '../src/walk';

const AREA = 16;
let next = 0;
function brick(
  partId: string,
  x: number,
  y: number,
  z: number,
  rotation: Brick['rotation'] = 0,
): Brick {
  return { id: `b${next++}`, partId, color: 71, x, y, z, rotation };
}

const idle: WalkInput = { forward: 0, strafe: 0, yaw: 0, run: false, jump: false };

function walk(world: WalkWorld, walker: Walker, input: Partial<WalkInput>, seconds: number) {
  for (let time = 0; time < seconds; time += 1 / 60)
    stepWalker(world, walker, { ...idle, ...input }, 1 / 60);
  return walker;
}

/** A wall of 1 x 4 bricks across the board at grid z 4, `courses` bricks high. */
function wall(courses: number) {
  const bricks: Brick[] = [];
  for (let course = 0; course < courses; course++)
    for (let x = 0; x < AREA; x += 4) bricks.push(brick('3010', x, course * 3, 4, 90));
  return bricks;
}

describe('walking a minifigure', () => {
  it('spawns on the ground in front of an empty board and stands still', () => {
    const world = new WalkWorld([], AREA);
    const walker = spawnWalker(world, AREA);
    expect(walker.y).toBe(0);
    walk(world, walker, {}, 1);
    expect(walker.y).toBe(0);
    expect(walker.grounded).toBe(true);
  });

  it('walks forward toward -z and stops at a wall too tall to step onto', () => {
    const world = new WalkWorld(wall(3), AREA);
    const walker = spawnWalker(world, AREA);
    walk(world, walker, { forward: 1 }, 3);
    // Grid z 4..5 is scene z 3..4; the walker stops with its front against z 4.
    expect(walker.z).toBeCloseTo(4 + MINIFIG.radius, 2);
    expect(walker.y).toBe(0);
  });

  it('steps up a single brick without jumping', () => {
    const world = new WalkWorld(wall(1), AREA);
    const walker = spawnWalker(world, AREA);
    walk(world, walker, { forward: 1 }, 2);
    expect(walker.z).toBeLessThan(3);
    expect(walker.y).toBeCloseTo(0, 5);
  });

  it('jumps onto a wall two bricks high', () => {
    const world = new WalkWorld(wall(2), AREA);
    const walker = spawnWalker(world, AREA);
    walk(world, walker, { forward: 1 }, 1);
    expect(walker.y).toBe(0);
    walk(world, walker, { forward: 1, jump: true }, 1 / 60);
    walk(world, walker, { forward: 0.25 }, 0.6);
    expect(walker.y).toBeCloseTo(6 * 0.4, 5);
    expect(walker.grounded).toBe(true);
  });

  it('walks through plants and doorways', () => {
    const world = new WalkWorld([brick('6064', 7, 0, 4), brick('60596', 6, 0, 4)], AREA);
    expect(world.boxes).toHaveLength(0);
  });

  it('spawns on top of a landscape that covers the front of the board', () => {
    const bricks: Brick[] = [];
    for (let x = 0; x < AREA; x += 2)
      for (let z = 0; z < AREA; z += 2) bricks.push(brick('3003', x, 0, z));
    const world = new WalkWorld(bricks, AREA);
    // The spawn point is off the board, so it stands on the floor.
    expect(spawnWalker(world, AREA).y).toBe(0);
    expect(world.standingHeight(0, 0)).toBeCloseTo(1.2, 5);
  });

  it('flies up over a wall it cannot jump and comes down on landing', () => {
    const world = new WalkWorld(wall(5), AREA);
    const walker = spawnWalker(world, AREA);
    walker.flying = true;
    walk(world, walker, { forward: 1 }, 1.5);
    expect(walker.z).toBeCloseTo(4 + MINIFIG.radius, 2);
    walk(world, walker, { rise: 1 }, 1);
    expect(walker.y).toBeGreaterThan(6);
    walk(world, walker, { forward: 1 }, 1);
    expect(walker.z).toBeLessThan(0);
    // Hovering stays put without gravity.
    const height = walker.y;
    walk(world, walker, {}, 1);
    expect(walker.y).toBeCloseTo(height, 2);
    walker.flying = false;
    walk(world, walker, {}, 2);
    expect(walker.y).toBe(0);
    expect(walker.grounded).toBe(true);
  });

  it('still bumps into pieces while flying', () => {
    const world = new WalkWorld(wall(5), AREA);
    const walker = spawnWalker(world, AREA);
    walker.flying = true;
    walk(world, walker, { forward: 1, rise: 0 }, 3);
    // Hovering just above the ground after take-off does not land.
    expect(walker.flying).toBe(true);
    expect(walker.z).toBeCloseTo(4 + MINIFIG.radius, 2);
    // Sinking onto the floor lands, as in creative flight.
    walk(world, walker, { rise: -1 }, 1);
    expect(walker.y).toBe(0);
    expect(walker.flying).toBe(false);
  });

  it('eases into flight and drifts to a stop', () => {
    const world = new WalkWorld([], AREA);
    const walker = spawnWalker(world, AREA);
    walker.flying = true;
    walk(world, walker, { rise: 1 }, 1);
    const start = walker.z;
    walk(world, walker, { forward: 1 }, 1 / 20);
    // Barely under way after one frame of thrust, well short of full speed.
    expect(start - walker.z).toBeLessThan(MINIFIG.flySpeed / 20 / 2);
    walk(world, walker, { forward: 1 }, 1);
    const cruising = walker.z;
    walk(world, walker, {}, 0.2);
    // Keeps drifting after the key is let go, then settles.
    expect(cruising - walker.z).toBeGreaterThan(0.5);
    const drifted = walker.z;
    walk(world, walker, {}, 2);
    walk(world, walker, {}, 0.5);
    expect(Math.abs(walker.velocityZ ?? 0)).toBeLessThan(0.01);
    expect(drifted).toBeGreaterThan(walker.z - 10);
  });
});
