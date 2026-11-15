import { describe, expect, it } from 'vite-plus/test';
import { footprint, placeBrick } from '@brick-workshop/engine';
import type { Assembly, Brick, Rotation } from '@brick-workshop/engine';
import { tryRemove } from './build.ts';
import { CHUNK, applyToChunks, chunkOf, splitIntoChunks } from './chunks.ts';
import { WorldIndex } from './world-index.ts';
import { random } from './world/noise.ts';
import { generateWorld } from './world/generate.ts';

const world = generateWorld(1234);
const assembly: Assembly = world.assembly;
const index = new WorldIndex(assembly.bricks, assembly.buildArea!);

describe('the world index', () => {
  it('agrees with the engine on where a piece can go', { timeout: 60_000 }, () => {
    const next = random(42);
    const parts = ['3001', '3003', '3005', '3020', '3022', '3039', '3068b', '3062b'];
    const tops = assembly.bricks.filter((brick) => brick.y > 0);
    let compared = 0;
    let fits = 0;
    for (let trial = 0; trial < 300; trial++) {
      // Mostly on top of a piece already there, so many land on studs; some anywhere.
      const host = tops[Math.floor(next() * tops.length)];
      const partId = parts[Math.floor(next() * parts.length)];
      const rotation = ([0, 90, 180, 270] as const)[Math.floor(next() * 4)] as Rotation;
      const probe: Brick = { id: `probe-${trial}`, partId, color: 4, x: 0, y: 0, z: 0, rotation };
      const size = footprint(probe);
      const brick: Brick = {
        ...probe,
        x: Math.max(0, Math.min(128 - size.width, host.x + Math.floor(next() * 3) - 1)),
        z: Math.max(0, Math.min(128 - size.depth, host.z + Math.floor(next() * 3) - 1)),
        y: host.y + footprint(host).height + (next() < 0.15 ? 3 : 0),
      };
      const engine = placeBrick(assembly, brick).ok;
      expect({ trial, brick, ok: index.check(brick).ok }).toEqual({ trial, brick, ok: engine });
      compared++;
      if (engine) fits++;
    }
    expect(compared).toBe(300);
    // Both outcomes were tried.
    expect(fits).toBeGreaterThan(20);
    expect(fits).toBeLessThan(280);
  });

  // The engine re-checks the whole world on every break, about a tenth of a second each.
  it('agrees with the engine on what a break brings down', { timeout: 60_000 }, () => {
    const next = random(7);
    const candidates = assembly.bricks.filter((brick) => brick.y > 0);
    let allowed = 0;
    for (let trial = 0; trial < 40; trial++) {
      const brick = candidates[Math.floor(next() * candidates.length)];
      const engine = tryRemove(assembly, brick.id);
      const local = index.breakAt(brick.id);
      expect(local.ok).toBe(engine.ok);
      if (local.ok && engine.ok) {
        allowed++;
        expect(new Set(local.removed)).toEqual(new Set(engine.removed));
      }
    }
    expect(allowed).toBeGreaterThan(5);
  });

  it('keeps up as pieces come and go', () => {
    const local = new WorldIndex(assembly.bricks, 128);
    const host = assembly.bricks.find(
      (brick) =>
        brick.partId === '3001' &&
        local.check({ ...brick, id: 'on', y: brick.y + 3, partId: '3005', rotation: 0 }).ok,
    )!;
    const placed: Brick = { ...host, id: 'on', partId: '3005', y: host.y + 3, rotation: 0 };
    local.add(placed);
    expect(local.check({ ...placed, id: 'again' })).toEqual({
      ok: false,
      reason: 'Something is in the way.',
    });
    expect(local.check({ ...placed, id: 'above', y: placed.y + 3 }).ok).toBe(true);
    local.remove('on');
    expect(local.check({ ...placed, id: 'above', y: placed.y + 3 })).toEqual({
      ok: false,
      reason: 'Nothing holds it there.',
    });
  });
});

describe('chunks', () => {
  it('puts every piece in the chunk of its corner, and changes only the chunks touched', () => {
    const chunks = splitIntoChunks(assembly.bricks);
    expect(chunks.size).toBeLessThanOrEqual((128 / CHUNK) ** 2);
    let total = 0;
    for (const [key, pieces] of chunks) {
      total += pieces.length;
      for (const brick of pieces) expect(chunkOf(brick)).toBe(key);
    }
    expect(total).toBe(assembly.bricks.length);

    const victim = chunks.get('1,1')![0];
    const added: Brick = { ...victim, id: 'new', x: 100, z: 5 };
    const { chunks: next, changed } = applyToChunks(chunks, [added], [victim]);
    expect(changed).toEqual(new Set(['1,1', '3,0']));
    expect(next.get('1,1')!.some((brick) => brick.id === victim.id)).toBe(false);
    expect(next.get('3,0')!.some((brick) => brick.id === 'new')).toBe(true);
    expect(next.get('0,0')).toBe(chunks.get('0,0'));
  });
});
