import { describe, expect, it } from 'vite-plus/test';
import { STICK_DEAD_ZONE, readGamepads, shapeAxis, shapeStick } from '../src/walk-gamepad';
import type { PadLike } from '../src/walk-gamepad';

function pad(
  axes: number[] = [0, 0, 0, 0],
  down: number[] = [],
  values: Record<number, number> = {},
): PadLike {
  return {
    connected: true,
    axes,
    buttons: Array.from({ length: 17 }, (_, index) => ({
      pressed: down.includes(index),
      value: values[index] ?? (down.includes(index) ? 1 : 0),
    })),
  };
}

describe('walk gamepad', () => {
  it('ignores a resting stick and rescales past the dead zone', () => {
    expect(shapeAxis(STICK_DEAD_ZONE * 0.9)).toBe(0);
    expect(shapeAxis(1)).toBe(1);
    expect(shapeAxis(-1)).toBe(-1);
    expect(shapeAxis(STICK_DEAD_ZONE + 0.01)).toBeLessThan(0.05);
    expect(shapeStick(0.1, 0.1)).toEqual({ x: 0, y: 0 });
    const diagonal = shapeStick(0.71, 0.71);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1, 1);
  });

  it('reads no frame without a connected pad', () => {
    expect(readGamepads([], {})).toBeNull();
    expect(readGamepads([null, { ...pad(), connected: false }], {})).toBeNull();
  });

  it('turns the left stick and d-pad into movement, up as forward', () => {
    const frame = readGamepads([pad([0.5, -1, 0, 0])], {})!;
    expect(frame.forward).toBeGreaterThan(0.8);
    expect(frame.strafe).toBeGreaterThan(0.3);
    expect(readGamepads([pad([0, -1, 0, 0])], {})!.forward).toBe(1);
    expect(readGamepads([pad([0, 0, 0, 0], [13, 14])], {})).toMatchObject({
      forward: -1,
      strafe: -1,
    });
  });

  it('turns the right stick into look rates, up as positive', () => {
    expect(readGamepads([pad([0, 0, -1, 0])], {})!.lookX).toBe(-1);
    expect(readGamepads([pad([0, 0, 0, -1])], {})!.lookY).toBe(1);
  });

  it('climbs on A or RT and sinks on B or LT', () => {
    expect(readGamepads([pad([0, 0, 0, 0], [0])], {})!.rise).toBe(1);
    expect(readGamepads([pad([0, 0, 0, 0], [], { 7: 0.8 })], {})!.rise).toBe(1);
    expect(readGamepads([pad([0, 0, 0, 0], [1])], {})!.rise).toBe(-1);
    expect(readGamepads([pad([0, 0, 0, 0], [], { 6: 0.8 })], {})!.rise).toBe(-1);
    expect(readGamepads([pad([0, 0, 0, 0], [4])], {})!.run).toBe(true);
  });

  it('reports a press once, not every frame it is held', () => {
    const held = {};
    expect(readGamepads([pad([0, 0, 0, 0], [0, 8])], held)!.pressed).toMatchObject({
      a: true,
      view: true,
    });
    expect(readGamepads([pad([0, 0, 0, 0], [0, 8])], held)!.pressed).toMatchObject({
      a: false,
      view: false,
    });
    readGamepads([pad()], held);
    expect(readGamepads([pad([0, 0, 0, 0], [0])], held)!.pressed.a).toBe(true);
  });
});
