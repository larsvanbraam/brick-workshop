import { describe, expect, it } from 'vite-plus/test';
import {
  CINEMATIC_MAX_PIXELS,
  CINEMATIC_WALK_MAX_PIXELS,
  getCinematicDpr,
} from '../src/cinematic-look';

describe('cinematic resolution', () => {
  it('keeps the screen ratio while it fits the pixel budget', () => {
    expect(getCinematicDpr(800, 500, 2)).toBe(2);
    expect(getCinematicDpr(1280, 800, 1)).toBe(1);
  });
  it('trims large retina canvases to the budget, never below 1x or above 2x', () => {
    const dpr = getCinematicDpr(2056, 1164, 2);
    expect(dpr).toBeLessThan(1.2);
    expect(2056 * dpr * 1164 * dpr).toBeLessThanOrEqual(CINEMATIC_MAX_PIXELS + 1);
    expect(getCinematicDpr(5120, 2880, 2)).toBe(1);
    expect(getCinematicDpr(400, 300, 3)).toBe(2);
  });
  it('renders fewer pixels while walking', () => {
    const dpr = getCinematicDpr(1440, 900, 2, CINEMATIC_WALK_MAX_PIXELS);
    expect(dpr).toBeLessThan(getCinematicDpr(1440, 900, 2));
    expect(1440 * dpr * 900 * dpr).toBeLessThanOrEqual(CINEMATIC_WALK_MAX_PIXELS + 1);
  });
});
