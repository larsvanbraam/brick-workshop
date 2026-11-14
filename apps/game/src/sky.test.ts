import { describe, expect, it } from 'vite-plus/test';
import { DAY_SECONDS, DayClock, clockTime, isDaytime, skyAt } from './sky.ts';

describe('the sky', () => {
  it('puts the sun high and bright at noon, with no stars', () => {
    const noon = skyAt(0.5);
    expect(noon.elevation).toBeGreaterThan(0.8);
    expect(noon.key.intensity).toBeGreaterThan(2);
    expect(noon.stars).toBe(0);
    expect(noon.unlit).toBe(1);
  });

  it('lights the island by a dim moon at midnight, under the stars', () => {
    const midnight = skyAt(0);
    expect(midnight.elevation).toBeLessThan(-0.8);
    expect(midnight.key.direction.y).toBeGreaterThan(0);
    expect(midnight.key.intensity).toBeGreaterThan(0);
    expect(midnight.key.intensity).toBeLessThan(1);
    expect(midnight.stars).toBe(1);
    expect(midnight.zenith.getHSL({ h: 0, s: 0, l: 0 }).l).toBeLessThan(0.1);
  });

  it('warms the light and the horizon while the sun is low', () => {
    const evening = skyAt(0.73);
    const noon = skyAt(0.5);
    expect(evening.key.color.r - evening.key.color.b).toBeGreaterThan(
      noon.key.color.r - noon.key.color.b,
    );
    expect(evening.horizon.r).toBeGreaterThan(evening.horizon.b);
  });

  it('rises in the east and sets in the west', () => {
    expect(skyAt(0.3).sun.x).toBeGreaterThan(0);
    expect(skyAt(0.7).sun.x).toBeLessThan(0);
  });
});

describe('the clock', () => {
  it('reads as a 24-hour clock', () => {
    expect(clockTime(0)).toBe('00:00');
    expect(clockTime(0.25)).toBe('06:00');
    expect(clockTime(0.5 + 1 / 48)).toBe('12:30');
    expect(isDaytime(0.5)).toBe(true);
    expect(isDaytime(0.9)).toBe(false);
  });

  it('runs a day in DAY_SECONDS, wraps at midnight and stands still when paused', () => {
    const clock = new DayClock(0.9);
    clock.advance(DAY_SECONDS * 0.2);
    expect(clock.time).toBeCloseTo(0.1);
    clock.paused = true;
    clock.advance(DAY_SECONDS);
    expect(clock.time).toBeCloseTo(0.1);
  });

  it('tells listeners when the minute shown changes', () => {
    const clock = new DayClock(0);
    let calls = 0;
    clock.subscribe(() => calls++);
    clock.advance(0.01);
    expect(calls).toBe(0);
    clock.advance(DAY_SECONDS / 24);
    expect(calls).toBe(1);
  });
});
