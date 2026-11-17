import { describe, expect, it } from 'vite-plus/test';
import {
  applyPatch,
  assessPhysicalFeasibility,
  exportLDraw,
  planInstructionSteps,
  validateAssembly,
} from './index.ts';
import type { Assembly, Brick } from './index.ts';
import { layTrack } from './examples/layout.ts';

function bend(): Assembly {
  const bricks: Brick[] = [];
  layTrack(
    (partId, color, x, y, z, rotation = 0, _f, _u, _t, _s, yaw) => {
      bricks.push({
        id: `t${bricks.length}`,
        partId,
        color,
        x,
        y,
        z,
        rotation,
        ...(yaw ? { yaw } : {}),
      });
    },
    72,
    { x: 6, y: 0, z: 30, angle: 0 },
    'SSRRSS',
  );
  return { name: 'Bend', bricks, buildArea: 128 };
}

describe('yawed track through the rest of the engine', () => {
  it('validates, plans instructions for and assesses a bend', () => {
    const assembly = bend();
    expect(validateAssembly(assembly)).toEqual([]);
    expect(assembly.bricks.some((brick) => brick.yaw)).toBe(true);
    const steps = planInstructionSteps(assembly);
    expect(steps.flatMap((step) => step.brickIds)).toHaveLength(assembly.bricks.length);
    expect(() => assessPhysicalFeasibility(assembly)).not.toThrow();
  });

  it('exports a yawed section with a turned matrix', () => {
    const text = exportLDraw(bend());
    const turned = text
      .split('\n')
      .filter((line) => line.startsWith('1 ') && /0\.\d{4,}/.test(line));
    expect(turned.length).toBeGreaterThan(0);
  });

  it('adds a yawed section by patch, and clears the yaw with null', () => {
    const empty: Assembly = { name: 'E', bricks: [], buildArea: 32 };
    const brick: Brick = {
      id: 'a',
      partId: '74746',
      color: 72,
      x: 5.5,
      y: 0,
      z: 7.25,
      rotation: 90,
      yaw: 22.5,
    };
    const added = applyPatch(empty, { operations: [{ type: 'add', brick }] });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.assembly.bricks[0]!.yaw).toBe(22.5);
    const turned = applyPatch(added.assembly, {
      operations: [{ type: 'update', id: 'a', changes: { yaw: 45 } }],
    });
    expect(turned.ok && turned.assembly.bricks[0]!.yaw).toBe(45);
    const cleared = applyPatch(added.assembly, {
      operations: [{ type: 'update', id: 'a', changes: { yaw: null, x: 6, z: 7 } }],
    });
    expect(cleared.ok).toBe(true);
    if (cleared.ok) expect(cleared.assembly.bricks[0]!.yaw).toBeUndefined();
    const bad = applyPatch(added.assembly, {
      operations: [{ type: 'update', id: 'a', changes: { yaw: 30 } }],
    });
    expect(bad.ok).toBe(false);
  });
});
