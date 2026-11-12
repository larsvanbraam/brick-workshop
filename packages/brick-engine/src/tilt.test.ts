import { describe, expect, it } from 'vite-plus/test';
import {
  type Assembly,
  type Brick,
  getHingeTilt,
  getLDrawTransform,
  getMountHosts,
  getWorldBounds,
  resizeBuildArea,
  validateAssembly,
} from './core.ts';
import { applyPatch, previewPatch } from './edits.ts';
import { planInstructionSteps } from './instructions.ts';
import { assessPhysicalFeasibility } from './physics.ts';

const piece = (
  id: string,
  partId: string,
  x: number,
  y: number,
  z: number,
  extra: Partial<Brick> = {},
): Brick => ({
  id,
  partId,
  color: 4,
  x,
  y,
  z,
  rotation: 0,
  ...extra,
});
const assembly = (...bricks: Brick[]): Assembly => ({ name: 'tilt', bricks, buildArea: 16 });

/**
 * A hinge on a wall top at the eaves, its top tilted 45 degrees so the low side faces the front,
 * carrying a 2 x 4 plate that rises back over the wall, and a tile on the plate.
 */
function panel() {
  const base = piece('base', '3937', 4, 3, 7);
  const tilt = getHingeTilt(base, '+z', 45)!;
  return {
    base,
    tilt,
    bricks: [
      piece('wall', '3001', 4, 0, 5),
      base,
      piece('top', '3938', 4, 4, 7, { tilt }),
      piece('plate', '3020', 4, 6, 4, { tilt }),
      piece('tile', '3069b', 4, 7, 5, { tilt, rotation: 90 }),
    ],
  };
}

describe('tilted frames', () => {
  it('derives the hinge line from the base', () => {
    const { tilt } = panel();
    expect(tilt).toEqual({ toward: '+z', angle: 45, y: 4.75, at: 7.5 });
  });

  it('holds a hinged panel and the tiles on it', () => {
    const { bricks } = panel();
    expect(validateAssembly(assembly(...bricks))).toEqual([]);
    const hosts = getMountHosts(bricks);
    expect(hosts.get('top')).toEqual(['base']);
    expect(hosts.get('plate')).toEqual(['top']);
    expect(hosts.get('tile')).toEqual(['plate']);
  });

  it('refuses a top whose tilt is off its hinge line, and tiles in another frame', () => {
    const { bricks, tilt } = panel();
    const off = bricks.map((brick) =>
      brick.id === 'top' ? { ...brick, tilt: { ...tilt, at: 5 } } : brick,
    );
    expect(validateAssembly(assembly(...off)).map((issue) => issue.code)).toContain('unsupported');
    const other = bricks.map((brick) =>
      brick.id === 'tile' ? { ...brick, tilt: { ...tilt, angle: 22.5 } } : brick,
    );
    expect(
      validateAssembly(assembly(...other)).find((issue) => issue.brickId === 'tile')?.code,
    ).toBe('unsupported');
  });

  it('turns the panel in the world and collides it with upright pieces', () => {
    const { bricks } = panel();
    const bounds = getWorldBounds(bricks[3]);
    // The 2 x 4 plate rises back from the hinge: over two studs up, and under four deep.
    expect(bounds.maxY).toBeGreaterThan(12);
    expect(bounds.minZ).toBeGreaterThan(5);
    const transform = getLDrawTransform(bricks[3]);
    expect(Math.abs(transform.matrix[4])).toBeCloseTo(Math.SQRT1_2);
    // A brick standing where the panel rises collides with it; one behind it doesn't.
    const tower = (z: number) => [
      piece(`low${z}`, '3001', 4, 0, z),
      piece(`mid${z}`, '3001', 4, 3, z),
      piece(`blocker`, '3001', 4, 6, z),
    ];
    expect(validateAssembly(assembly(...bricks, ...tower(0)))).toEqual([]);
    // Two 2 x 2 bricks on the wall behind the hinge: the upper one stands in the panel.
    const issues = validateAssembly(
      assembly(...bricks, piece('under', '3003', 4, 3, 5), piece('blocker', '3003', 4, 6, 5)),
    );
    expect(issues.some((issue) => issue.brickId === 'blocker' && issue.code === 'collision')).toBe(
      true,
    );
  });

  it('stands an untilted hinge top on its base like a plate', () => {
    const base = piece('base', '3937', 0, 0, 0);
    expect(
      validateAssembly(
        assembly(
          base,
          piece('top', '3938', 0, 1, 0),
          piece('plate', '3023b', 0, 3, 0, { rotation: 90 }),
        ),
      ),
    ).toEqual([]);
  });
});

describe('tilted frames elsewhere in the engine', () => {
  it('carries a hinged panel on its base in physics and orders it after the base', () => {
    const { bricks } = panel();
    const report = assessPhysicalFeasibility(assembly(...bricks));
    expect(report.status).not.toBe('invalid-geometry');
    expect(report.reasons.join(' ')).not.toMatch(/no upright host/);
    const order = planInstructionSteps(assembly(...bricks)).flatMap((step) => step.brickIds);
    for (const [later, earlier] of [
      ['top', 'base'],
      ['plate', 'top'],
      ['tile', 'plate'],
    ])
      expect(order.indexOf(later)).toBeGreaterThan(order.indexOf(earlier));
  });

  it('moves the hinge line with the build when the board is resized', () => {
    const { bricks, tilt } = panel();
    const resized = resizeBuildArea(assembly(...bricks), 32)!;
    expect(validateAssembly(resized)).toEqual([]);
    expect(resized.bricks.find((brick) => brick.id === 'top')!.tilt).toEqual({
      ...tilt,
      at: tilt.at + 8,
    });
  });
});

describe('tilted pieces in patches', () => {
  it('adds tilted pieces and levels them with tilt: null', () => {
    const { bricks } = panel();
    const [tile] = bricks.slice(-1);
    const added = applyPatch(assembly(...bricks.slice(0, -1)), {
      operations: [{ type: 'add', brick: tile }],
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.assembly.bricks.at(-1)!.tilt).toEqual(tile.tilt);
    const leveled = previewPatch(added.assembly, {
      operations: [{ type: 'update', id: 'tile', changes: { tilt: null } }],
    });
    // Levelled, the tile hangs in mid-air above the wall.
    expect(leveled.ok).toBe(false);
    const malformed = previewPatch(added.assembly, {
      operations: [{ type: 'update', id: 'tile', changes: { tilt: { toward: 'up' } as never } }],
    });
    expect(malformed.ok).toBe(false);
  });
});
