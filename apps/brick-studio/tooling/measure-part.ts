/**
 * Measures an LDraw part for the engine catalogue: the body's size in studs and plates, where the
 * LDraw origin sits against it, and every stud primitive with the way it points (up: a top
 * stud, down: an underside receiver, level: a side stud). The numbers are what a catalogue
 * entry needs (`width`, `depth`, `height`, `ldrawCenter`, `ldrawBaseY`, stud cells); the
 * envelope test in ldraw-library.test.ts then checks size and centre against the real mesh.
 *
 *   node apps/brick-studio/tooling/measure-part.ts 2420 99207 ...
 *
 * Reads the library in data/ldraw (see `pnpm ldraw:fetch`). Prints JSON per part.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type Matrix = readonly [number, number, number, number, number, number, number, number, number];
type Point = readonly [number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export interface StudInstance {
  /** Primitive name, such as `stud` or `stud3`. */
  readonly primitive: string;
  /** LDU, LDraw axes (y is down). */
  readonly at: Point;
  readonly direction: 'up' | 'down' | 'x+' | 'x-' | 'z+' | 'z-';
}

export interface Measure {
  readonly id: string;
  /** Body bounds in LDU, studs excluded. */
  readonly min: Point;
  readonly max: Point;
  readonly studs: readonly StudInstance[];
}

function multiply(a: Matrix, b: Matrix): Matrix {
  const out: number[] = [];
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 3; col++)
      out.push(
        a[row * 3]! * b[col]! + a[row * 3 + 1]! * b[3 + col]! + a[row * 3 + 2]! * b[6 + col]!,
      );
  return out as unknown as Matrix;
}

const apply = (m: Matrix, v: Point, o: Point): Point => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2] + o[0],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2] + o[1],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2] + o[2],
];

/** Stud primitives: the cylinders and tubes that connect, not part of the body. */
const STUD = /^stud(?!-logo)/;

export function createReader(library: string) {
  const cache = new Map<string, string[]>();
  const find = (name: string): string[] | undefined => {
    const key = name.toLowerCase().replace(/\\/g, '/');
    const hit = cache.get(key);
    if (hit) return hit;
    for (const dir of ['parts', 'p', 'parts/s', 'p/48', 'p/8']) {
      const file = join(library, dir, key);
      if (existsSync(file)) {
        const lines = readFileSync(file, 'utf8').split(/\r?\n/);
        cache.set(key, lines);
        return lines;
      }
    }
    return undefined;
  };
  return find;
}

export function measure(id: string, library: string): Measure {
  const find = createReader(library);
  const points: Point[] = [];
  const studs: StudInstance[] = [];
  const walk = (name: string, matrix: Matrix, origin: Point, depth: number) => {
    if (depth > 10) return;
    const lines = find(name);
    if (!lines) return;
    for (const line of lines) {
      const t = line.trim().split(/\s+/);
      if (t[0] === '1' && t.length >= 15) {
        const n = t.slice(2, 14).map(Number);
        const local: Matrix = [n[3]!, n[4]!, n[5]!, n[6]!, n[7]!, n[8]!, n[9]!, n[10]!, n[11]!];
        const reference = t.slice(14).join(' ').toLowerCase().replace(/\\/g, '/');
        const base = reference
          .replace(/\.dat$/, '')
          .split('/')
          .pop()!;
        const at = apply(matrix, [n[0]!, n[1]!, n[2]!], origin);
        const combined = multiply(matrix, local);
        if (STUD.test(base)) {
          // A stud's own axis runs along local -y; where that points in the part says how it connects.
          const axis: Point = [-combined[1], -combined[4], -combined[7]];
          const [ax, ay, az] = axis;
          const big = Math.max(Math.abs(ax), Math.abs(ay), Math.abs(az)) || 1;
          const direction =
            Math.abs(ay) / big > 0.7
              ? ay < 0
                ? 'up'
                : 'down'
              : Math.abs(ax) >= Math.abs(az)
                ? ax > 0
                  ? 'x+'
                  : 'x-'
                : az > 0
                  ? 'z+'
                  : 'z-';
          studs.push({ primitive: base, at, direction });
        } else walk(reference, combined, at, depth + 1);
      } else if (t[0] === '3' || t[0] === '4') {
        const count = t[0] === '3' ? 3 : 4;
        for (let i = 0; i < count; i++) {
          const v = t.slice(2 + i * 3, 5 + i * 3).map(Number);
          if (v.length === 3 && v.every(Number.isFinite))
            points.push(apply(matrix, v as unknown as Point, origin));
        }
      }
    }
  };
  walk(`${id}.dat`, IDENTITY, [0, 0, 0], 0);
  if (!points.length) throw new Error(`No geometry for ${id}`);
  const min = [0, 1, 2].map((axis) => Math.min(...points.map((p) => p[axis]!))) as unknown as Point;
  const max = [0, 1, 2].map((axis) => Math.max(...points.map((p) => p[axis]!))) as unknown as Point;
  return { id, min, max, studs };
}

/** Tubes and anti-studs on the underside, which receive studs; the rest are studs. */
const TUBE = /^stud(3|4|18|23)/;

export interface PartData {
  readonly id: string;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly ldrawCenter: { x: number; z: number };
  readonly ldrawBaseY: number;
  readonly top: { x: number; z: number }[];
  readonly bottom: { x: number; z: number }[];
  readonly sideStuds: { x: number; y: number; z: number; facing: '+x' | '-x' | '+z' | '-z' }[];
}

/**
 * The numbers a catalogue entry needs, in studs and plates and in the mesh's own frame. The
 * envelope takes in side studs and rounds out to half studs, as the hand-made entries do; stud
 * cells are indexed from the envelope's corner. Receivers are the cells under the studs a part
 * can sit on: its own stud cells, or the whole footprint for a tile with tubes.
 */
export function describe(m: Measure): PartData {
  let [minX, maxX, minZ, maxZ] = [m.min[0], m.max[0], m.min[2], m.max[2]];
  const sides = m.studs.filter(
    (s) => !TUBE.test(s.primitive) && !['up', 'down'].includes(s.direction),
  );
  for (const s of sides) {
    if (s.direction === 'x+') maxX = Math.max(maxX, s.at[0] + 4);
    if (s.direction === 'x-') minX = Math.min(minX, s.at[0] - 4);
    if (s.direction === 'z+') maxZ = Math.max(maxZ, s.at[2] + 4);
    if (s.direction === 'z-') minZ = Math.min(minZ, s.at[2] - 4);
  }
  const eMinX = Math.floor(minX / 10 + 1e-6) * 10;
  const eMaxX = Math.ceil(maxX / 10 - 1e-6) * 10;
  const eMinZ = Math.floor(minZ / 10 + 1e-6) * 10;
  const eMaxZ = Math.ceil(maxZ / 10 - 1e-6) * 10;
  const round = (v: number) => Math.round(v * 100) / 100;
  const halfStud = (v: number) => Math.round(v * 2) / 2;
  const cell = (s: StudInstance) => ({
    x: halfStud((s.at[0] - eMinX) / 20 - 0.5),
    z: halfStud((s.at[2] - eMinZ) / 20 - 0.5),
  });
  const width = (eMaxX - eMinX) / 20;
  const depth = (eMaxZ - eMinZ) / 20;
  const inside = (c: { x: number; z: number }) =>
    c.x >= 0 && c.x < width && c.z >= 0 && c.z < depth;
  const unique = (cells: { x: number; z: number }[]) => {
    const seen = new Set<string>();
    return cells
      .filter((c) => !seen.has(`${c.x},${c.z}`) && seen.add(`${c.x},${c.z}`))
      .sort((a, b) => a.z - b.z || a.x - b.x);
  };
  const top = unique(
    m.studs
      .filter((s) => !TUBE.test(s.primitive) && s.direction === 'up')
      .map(cell)
      .filter(inside),
  );
  const tubes = m.studs.some((s) => TUBE.test(s.primitive));
  const footprint: { x: number; z: number }[] = [];
  for (let z = 0; z < Math.ceil(depth); z++)
    for (let x = 0; x < Math.ceil(width); x++) footprint.push({ x, z });
  return {
    id: m.id,
    width,
    depth,
    height: round((m.max[1] - m.min[1]) / 8),
    ldrawCenter: { x: round((eMinX + eMaxX) / 2), z: round((eMinZ + eMaxZ) / 2) },
    ldrawBaseY: round(m.max[1]),
    top,
    bottom: top.length ? top : tubes ? footprint : [],
    sideStuds: sides.map((s) => ({
      x: round((s.at[0] - eMinX) / 20),
      y: round((m.max[1] - s.at[1]) / 8),
      z: round((s.at[2] - eMinZ) / 20),
      facing: ({ 'x+': '+x', 'x-': '-x', 'z+': '+z', 'z-': '-z' } as const)[
        s.direction as 'x+' | 'x-' | 'z+' | 'z-'
      ],
    })),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const library = resolve('data/ldraw');
  for (const id of process.argv.slice(2)) {
    try {
      console.log(JSON.stringify(describe(measure(id, library))));
    } catch (error) {
      console.log(JSON.stringify({ id, error: String((error as Error).message) }));
    }
  }
}
