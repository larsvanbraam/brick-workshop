import { describe, expect, it } from 'vite-plus/test';
import { WalkWorld } from '@brick-workshop/walk/walk';
import type { Brick } from '@brick-workshop/engine';
import { GREET_RANGE, createWanderer, stepWanderer, yawToward } from './wander';
import type { WanderRules } from './wander';

const SIZE = 64;
const open: WanderRules = { leash: 10, canWalk: () => true };

function seeded(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
}

function wanderer(seed = 7) {
  return createWanderer({ x: 0, y: 0, z: 0, velocityY: 0, grounded: true }, seeded(seed));
}

function run(world: WalkWorld, rules: WanderRules, seconds: number, seed = 7) {
  const npc = wanderer(seed);
  for (let t = 0; t < seconds; t += 1 / 30) stepWanderer(world, npc, rules, null, 1 / 30);
  return npc;
}

describe('wanderers', () => {
  it('stroll about on open ground', () => {
    const world = new WalkWorld([], SIZE, Infinity);
    const npc = run(world, open, 30);
    expect(npc.stride).toBeGreaterThan(0);
    expect(Math.hypot(npc.walker.x, npc.walker.z)).toBeGreaterThan(0);
  });

  it('keep within their leash of home', () => {
    const world = new WalkWorld([], SIZE, Infinity);
    for (const seed of [1, 2, 3, 4, 5]) {
      const npc = wanderer(seed);
      let furthest = 0;
      for (let t = 0; t < 120; t += 1 / 30) {
        stepWanderer(world, npc, open, null, 1 / 30);
        furthest = Math.max(furthest, Math.hypot(npc.walker.x, npc.walker.z));
      }
      expect(furthest).toBeLessThanOrEqual(open.leash + 0.5);
    }
  });

  it('never step where they may not walk', () => {
    const world = new WalkWorld([], SIZE, Infinity);
    // A stream at x > 3 they must keep out of.
    const rules: WanderRules = { leash: 20, canWalk: (_, to) => to.x < 3 };
    for (const seed of [1, 2, 3]) expect(run(world, rules, 60, seed).walker.x).toBeLessThan(3);
  });

  it('turn away from a wall rather than walk into it for good', () => {
    // A ring of tall walls round home.
    const bricks: Brick[] = [];
    for (let i = 0; i < 16; i++)
      for (const y of [0, 3, 6, 9]) {
        bricks.push({
          id: `n${i}${y}`,
          partId: '3005',
          color: 15,
          x: 24 + i,
          y,
          z: 24,
          rotation: 0,
        });
        bricks.push({
          id: `s${i}${y}`,
          partId: '3005',
          color: 15,
          x: 24 + i,
          y,
          z: 39,
          rotation: 0,
        });
        bricks.push({
          id: `w${i}${y}`,
          partId: '3005',
          color: 15,
          x: 24,
          y,
          z: 24 + i,
          rotation: 0,
        });
        bricks.push({
          id: `e${i}${y}`,
          partId: '3005',
          color: 15,
          x: 39,
          y,
          z: 24 + i,
          rotation: 0,
        });
      }
    const world = new WalkWorld(bricks, SIZE, Infinity);
    const npc = run(world, { leash: 30, canWalk: () => true }, 60);
    expect(Math.abs(npc.walker.x)).toBeLessThan(8);
    expect(Math.abs(npc.walker.z)).toBeLessThan(8);
    expect(npc.walker.y).toBe(0);
  });

  it('stop, face and greet the player when they come close', () => {
    const world = new WalkWorld([], SIZE, Infinity);
    const npc = wanderer();
    const player = { x: GREET_RANGE - 1, y: 0, z: 0 };
    for (let t = 0; t < 2; t += 1 / 30) stepWanderer(world, npc, open, player, 1 / 30);
    expect(npc.mode).toBe('greet');
    expect(npc.moved).toBe(0);
    expect(Math.abs(npc.yaw - yawToward(npc.walker, player)) % (Math.PI * 2)).toBeLessThan(0.05);
    // And walk on once they have gone.
    for (let t = 0; t < 1; t += 1 / 30) stepWanderer(world, npc, open, null, 1 / 30);
    expect(npc.mode).not.toBe('greet');
  });

  it('keep out of the way of others', () => {
    const world = new WalkWorld([], SIZE, Infinity);
    // Someone standing all round the way out, a few studs off.
    const others = Array.from({ length: 24 }, (_, i) => ({
      x: Math.sin((i / 24) * Math.PI * 2) * 3,
      z: Math.cos((i / 24) * Math.PI * 2) * 3,
    }));
    const npc = wanderer();
    for (let t = 0; t < 30; t += 1 / 30) {
      stepWanderer(world, npc, open, null, 1 / 30, others);
      for (const other of others)
        expect(Math.hypot(other.x - npc.walker.x, other.z - npc.walker.z)).toBeGreaterThan(1);
    }
  });
});
