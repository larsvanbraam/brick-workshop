import { describe, expect, it } from 'vite-plus/test';
import { inland } from './world/island/column.ts';
import { CENTRE } from './world/island/map.ts';
import { SHALLOWS, TIDE_LINES, Tide, tideSpeed } from './tide.ts';

const SEED = 7;
/** The scene's frame, as the game has it (`WORLD_SIZE`). */
const FRAME = 128;
/** World studs to the scene's axes and back, as the game has them. */
const toScene = (x: number, z: number) => [x - FRAME / 2, FRAME / 2 - z] as const;
const toWorld = (x: number, z: number) => [x + FRAME / 2, FRAME / 2 - z] as const;

describe("Brick Island's tide", () => {
  it('leaves the shallows alone and then pushes harder the further out', () => {
    expect(tideSpeed(-10)).toBe(0);
    expect(tideSpeed(SHALLOWS)).toBe(0);
    expect(tideSpeed(SHALLOWS + 3)).toBeGreaterThan(0);
    expect(tideSpeed(SHALLOWS + 12)).toBeGreaterThan(tideSpeed(SHALLOWS + 6));
    expect(tideSpeed(500)).toBeLessThanOrEqual(40);
  });

  it('does not push on land or in the harbour', () => {
    const tide = new Tide(SEED, FRAME);
    expect(tide.push(...toScene(CENTRE.x, CENTRE.z))).toBeNull();
    // The harbour basin, cut into the town.
    expect(tide.push(...toScene(321, 480))).toBeNull();
    expect(tide.strength).toBe(0);
  });

  it('turns back anyone heading out to sea, however fast, in every direction', () => {
    const tide = new Tide(SEED, FRAME);
    // A walker, a runner, a flyer and a racing car.
    for (const speed of [6, 11, 18, 22])
      for (let turn = 0; turn < 16; turn++) {
        const angle = (turn / 16) * Math.PI * 2;
        const [dx, dz] = [Math.cos(angle), Math.sin(angle)];
        // From the middle out to the coast.
        let [x, z]: [number, number] = [CENTRE.x, CENTRE.z];
        while (inland(SEED, x, z) > 0) [x, z] = [x + dx, z + dz];
        let farthest = 0;
        for (let step = 0; step < 60 * 30; step++) {
          const [sx, sz] = toScene(x, z);
          const push = tide.push(sx, sz) ?? [0, 0];
          const [nx, nz] = toWorld(sx + push[0] / 60, sz + push[1] / 60);
          [x, z] = [nx + (dx * speed) / 60, nz + (dz * speed) / 60];
          farthest = Math.max(farthest, -inland(SEED, x, z));
        }
        expect(farthest, `${speed} studs a second at ${turn * 22.5}°`).toBeLessThan(30);
      }
  });

  it('has something to say about it', () => {
    expect(TIDE_LINES.length).toBeGreaterThan(3);
  });
});
