/**
 * Scores an example build against what official sets do, so "boring and flat" is a number the
 * build loop can read: part variety, small-part share, side-mounted detail, sloped roofs,
 * colours, thin layers, and how closely the part mix matches the other examples. The targets
 * come from docs/techniques/placement-statistics.md and docs/rebrickable-benchmarks.md.
 *
 *   pnpm example:score <id>... [--all] [--no-compare] [--strict] [--json]
 *
 * Needs the Rebrickable CSVs in data/ (see `pnpm rebrickable:report`). The comparison with other
 * examples builds each of them once and caches its part mix in data/example-fingerprints.json.
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { createGunzip } from 'node:zlib';
import { parse } from 'csv-parse';
import { getWorldBounds } from '../../../packages/brick-engine/src/core.ts';
import type { Assembly } from '../../../packages/brick-engine/src/core.ts';
import { DEFAULT_PART_COLOR_EVIDENCE } from '../../../packages/brick-engine/src/part-color-evidence.ts';
import {
  assemblyItems,
  bucketOf,
  createCanonical,
  summarise,
  suffixRelationships,
  toRebrickablePart,
} from './rebrickable-report.ts';
import type { Catalogue } from './rebrickable-report.ts';

export interface Score {
  readonly id: string;
  readonly pieces: number;
  readonly designs: number;
  readonly smallShare: number;
  /** Bricks mounted on their side studs or tipped on hinges, as a share of all bricks. */
  readonly detailShare: number;
  /** Slopes and round pieces among the top fifth of the build by height; undefined if it has no real top. */
  readonly roofSlopes: number | undefined;
  readonly mainColors: number;
  readonly platesPerBrick: number;
  /** Share of neighbouring visible wall cells at different depths: 0 is a flat box. */
  readonly wallRelief: number;
  /** Foliage parts as a share of pieces, and how many different ones. */
  readonly plantShare: number;
  readonly plantDesigns: number;
  /** The most similar other example and the cosine similarity of their part mixes. */
  readonly nearest?: { id: string; similarity: number };
}

export interface Check {
  readonly key: string;
  readonly label: string;
  /** What official sets do, in words. */
  readonly target: string;
  readonly measure: (score: Score) => string;
  /** Undefined when the check does not apply to this build. */
  readonly pass: (score: Score) => boolean | undefined;
  readonly fix: string;
}

const pct = (value: number) => `${Math.round(value * 100)}%`;
/** Designs a build of this size should use: about 8 per 100 pieces, 40 to 150. */
export const targetDesigns = (pieces: number) =>
  Math.min(150, Math.max(40, Math.round(pieces * 0.08)));

export const CHECKS: readonly Check[] = [
  {
    key: 'variety',
    label: 'Part variety',
    target: 'about 8 designs per 100 pieces (40 to 150); modulars use 230 to 300',
    measure: (s) => `${s.designs} designs (target ${targetDesigns(s.pieces)})`,
    pass: (s) => s.designs >= targetDesigns(s.pieces),
    fix: 'Replace plain bricks with masonry, grille, log and headlight bricks, slopes, arches, round parts, tiles of mixed shapes and plants (walls.md, facades-and-openings.md).',
  },
  {
    key: 'small',
    label: 'Small parts',
    target: '38-62% of pieces are 1 x 1 or 1 x 2',
    measure: (s) => pct(s.smallShare),
    pass: (s) => s.smallShare >= 0.38,
    fix: 'Texture runs of large bricks with 1 x 1 and 1 x 2 bricks in a second shade, headers, sills, bands and props.',
  },
  {
    key: 'detail',
    label: 'Side-mounted detail',
    target: 'official models build 3-10% sideways (19% in landmarks)',
    measure: (s) => pct(s.detailShare),
    pass: (s) => s.detailShare >= 0.03,
    fix: 'Hang things off the walls on side studs: sills, shutters, lamps, ivy, brackets, signs, beam ends (seatOnSideStud).',
  },
  {
    key: 'roof',
    label: 'Sloped top',
    target: '25-35% slopes and round pieces in the top fifth',
    measure: (s) => (s.roofSlopes === undefined ? 'n/a' : pct(s.roofSlopes)),
    pass: (s) => (s.roofSlopes === undefined ? undefined : s.roofSlopes >= 0.25),
    fix: 'Shape the top: real slopes, hips, dormers, chimneys, finials, a ridge, not flat tiles on steps (roofs-and-rooflines.md).',
  },
  {
    key: 'colors',
    label: 'Main colours',
    target: '6-16 colours with at least 1% of the pieces',
    measure: (s) => String(s.mainColors),
    pass: (s) => s.mainColors >= 6 && s.mainColors <= 16,
    fix: 'Give every material two or three shades and keep accents under 5% (build-standard.md, colour).',
  },
  {
    key: 'layers',
    label: 'Thin layers',
    target: 'at least 0.6 plates and tiles per brick',
    measure: (s) => s.platesPerBrick.toFixed(1),
    pass: (s) => s.platesPerBrick >= 0.6,
    fix: 'Add plate and tile courses: bands, cornices, paving, sills, floors, roof edges.',
  },
  {
    key: 'relief',
    label: 'Wall relief',
    target: 'at least 12% of neighbouring wall cells at different depths (a flat box is 0%)',
    measure: (s) => pct(s.wallRelief),
    pass: (s) => s.wallRelief >= RELIEF_TARGET,
    fix: 'Break the wall plane: recess openings, push headers, piers, sills and cornices a stud out, mount bay windows, porches and buttresses (walls.md, depth levels).',
  },
  {
    key: 'plants',
    label: 'Planting',
    target: '0.5-8% foliage in at least four different plant designs',
    measure: (s) => `${pct(s.plantShare)} in ${s.plantDesigns} designs`,
    pass: (s) =>
      s.pieces < 300
        ? undefined
        : s.plantShare >= 0.005 && s.plantShare <= 0.08 && s.plantDesigns >= 4,
    fix: 'Plant in clusters of several kinds and heights: trees, bushes, tall grass, ferns, flowers in clumps of one colour, ivy and window boxes (flora-and-terrain.md).',
  },
  {
    key: 'distinct',
    label: 'Not a copy',
    target: 'part mix at most 85% similar to any other example',
    measure: (s) =>
      s.nearest ? `${pct(s.nearest.similarity)} like ${s.nearest.id}` : 'not compared',
    pass: (s) => (s.nearest ? s.nearest.similarity <= 0.85 : undefined),
    fix: 'Change the wall material, roof type and palette so the build is not the previous one in a new shape.',
  },
];

/** Cosine similarity of two part-quantity vectors. */
export function cosine(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [key, value] of a) {
    na += value * value;
    dot += value * (b.get(key) ?? 0);
  }
  for (const value of b.values()) nb += value * value;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Wall relief below this reads as a flat box (heuristic, calibrated on the examples). */
export const RELIEF_TARGET = 0.12;

/** Engine foliage parts; they are scenery, not wall, so relief ignores them. */
export const PLANT_PARTS: ReadonlySet<string> = new Set([
  '3470',
  '3471',
  '6064',
  '30093',
  '2417',
  '32607',
  '24866',
  '4727',
  '30176',
  '6255',
  '2423',
]);

/**
 * How much the visible wall surface steps in and out. Looking at the build from each of the
 * four sides, every row of the wall zone (the middle of the build's height, where roofs and
 * the base do not dominate) has a first piece in each column; relief is the share of
 * neighbouring columns and rows whose first piece sits at a different depth, in half studs.
 * Foliage is left out so trees do not count as wall relief.
 */
export function wallRelief(assembly: Assembly): number {
  const boxes = assembly.bricks
    .filter((brick) => !PLANT_PARTS.has(brick.partId))
    .map((brick) => getWorldBounds(brick));
  if (!boxes.length) return 0;
  const minX = Math.min(...boxes.map((b) => b.minX));
  const minZ = Math.min(...boxes.map((b) => b.minZ));
  const minY = Math.min(...boxes.map((b) => b.minY));
  const maxY = Math.max(...boxes.map((b) => b.maxY));
  const nx = Math.ceil((Math.max(...boxes.map((b) => b.maxX)) - minX) * 2);
  const nz = Math.ceil((Math.max(...boxes.map((b) => b.maxZ)) - minZ) * 2);
  const ny = Math.ceil(maxY - minY);
  const lo = Math.floor(ny * 0.25);
  const hi = Math.ceil(ny * 0.75);
  if (hi - lo < 3) return 0;
  const grid = new Uint8Array(nx * nz * (hi - lo));
  const at = (x: number, y: number, z: number) => (y * nz + z) * nx + x;
  for (const b of boxes) {
    const x0 = Math.floor((b.minX - minX) * 2 + 1e-6);
    const x1 = Math.ceil((b.maxX - minX) * 2 - 1e-6);
    const z0 = Math.floor((b.minZ - minZ) * 2 + 1e-6);
    const z1 = Math.ceil((b.maxZ - minZ) * 2 - 1e-6);
    const y0 = Math.max(lo, Math.floor(b.minY - minY + 1e-6));
    const y1 = Math.min(hi, Math.ceil(b.maxY - minY - 1e-6));
    for (let y = y0; y < y1; y++)
      for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) grid[at(x, y - lo, z)] = 1;
  }
  let pairs = 0;
  let steps = 0;
  const rows = hi - lo;
  // depth[y][lateral] from each of four sides; -1 where the ray finds nothing.
  const faces: {
    lateral: number;
    depth: number;
    cell: (l: number, d: number, y: number) => number;
  }[] = [
    { lateral: nx, depth: nz, cell: (l, d, y) => at(l, y, d) },
    { lateral: nx, depth: nz, cell: (l, d, y) => at(l, y, nz - 1 - d) },
    { lateral: nz, depth: nx, cell: (l, d, y) => at(d, y, l) },
    { lateral: nz, depth: nx, cell: (l, d, y) => at(nx - 1 - d, y, l) },
  ];
  for (const face of faces) {
    const first = new Int32Array(rows * face.lateral).fill(-1);
    for (let y = 0; y < rows; y++)
      for (let l = 0; l < face.lateral; l++)
        for (let d = 0; d < face.depth; d++)
          if (grid[face.cell(l, d, y)]) {
            first[y * face.lateral + l] = d;
            break;
          }
    const compare = (a: number, b: number) => {
      if (a < 0 || b < 0) return;
      pairs++;
      if (a !== b) steps++;
    };
    for (let y = 0; y < rows; y++)
      for (let l = 0; l < face.lateral; l++) {
        const here = first[y * face.lateral + l]!;
        if (l + 1 < face.lateral) compare(here, first[y * face.lateral + l + 1]!);
        if (y + 1 < rows) compare(here, first[(y + 1) * face.lateral + l]!);
      }
  }
  return pairs ? steps / pairs : 0;
}

export function partMix(assembly: Assembly, catalogue: Catalogue): Map<string, number> {
  const mix = new Map<string, number>();
  for (const item of assemblyItems(assembly, catalogue)) {
    const design = catalogue.canonical(item.part);
    mix.set(design, (mix.get(design) ?? 0) + item.quantity);
  }
  return mix;
}

export function scoreAssembly(
  id: string,
  assembly: Assembly,
  catalogue: Catalogue,
  others: ReadonlyMap<string, ReadonlyMap<string, number>> = new Map(),
): Score {
  const summary = summarise({ id, name: id, items: assemblyItems(assembly, catalogue) }, catalogue);
  const mappings = DEFAULT_PART_COLOR_EVIDENCE.mappings.parts;
  const bricks = assembly.bricks;
  const detail = bricks.filter((brick) => brick.facing !== undefined || brick.tilt !== undefined);
  const top = bricks.length ? Math.max(...bricks.map((brick) => brick.y)) : 0;
  const roof = bricks.filter((brick) => brick.y >= top * 0.8);
  const bucket = (partId: string) =>
    bucketOf(toRebrickablePart(partId, mappings, catalogue.parts), catalogue);
  const sloped = roof.filter((brick) => {
    const name = bucket(brick.partId);
    return name.startsWith('Slopes') || name.startsWith('Round');
  });
  const plants = bricks.filter((brick) => PLANT_PARTS.has(brick.partId));
  const mix = partMix(assembly, catalogue);
  let nearest: Score['nearest'];
  for (const [other, vector] of others) {
    if (other === id) continue;
    const similarity = cosine(mix, vector);
    if (!nearest || similarity > nearest.similarity) nearest = { id: other, similarity };
  }
  return {
    id,
    pieces: summary.pieces,
    designs: summary.designs,
    smallShare: summary.smallShare,
    detailShare: bricks.length ? detail.length / bricks.length : 0,
    roofSlopes: roof.length >= 20 ? sloped.length / roof.length : undefined,
    mainColors: summary.mainColors,
    platesPerBrick: summary.platesPerBrick,
    wallRelief: wallRelief(assembly),
    plantShare: bricks.length ? plants.length / bricks.length : 0,
    plantDesigns: new Set(plants.map((brick) => brick.partId)).size,
    ...(nearest ? { nearest } : {}),
  };
}

export function renderScore(score: Score): string {
  const lines = [`${score.id}: ${score.pieces} pieces`];
  let failed = 0;
  for (const check of CHECKS) {
    const result = check.pass(score);
    const mark = result === undefined ? '-' : result ? 'ok ' : 'LOW';
    if (result === false) failed++;
    lines.push(`  ${mark}  ${check.label.padEnd(20)} ${check.measure(score)}`);
    if (result === false) lines.push(`        target: ${check.target}\n        fix: ${check.fix}`);
  }
  lines.push(failed ? `  ${failed} of ${CHECKS.length} checks low` : '  all checks pass');
  return lines.join('\n');
}

async function readCsv(file: string, onRow: (row: Record<string, string>) => void) {
  const parser = parse({ bom: true, columns: true, skip_empty_lines: true });
  const done = pipeline(createReadStream(file), createGunzip(), parser);
  for await (const row of parser as AsyncIterable<Record<string, string>>) onRow(row);
  await done;
}

async function loadCatalogue(dir: string): Promise<Catalogue> {
  const csv = (name: string) => join(dir, `${name}.csv.gz`);
  for (const name of ['parts', 'colors', 'part_relationships'])
    if (!existsSync(csv(name)))
      throw new Error(`Missing ${csv(name)}; run pnpm rebrickable:report first.`);
  const parts = new Map<string, { name: string; category: number }>();
  await readCsv(csv('parts'), (r) =>
    parts.set(r.part_num, { name: r.name, category: Number(r.part_cat_id) }),
  );
  const colors = new Map<number, { name: string }>();
  await readCsv(csv('colors'), (r) => colors.set(Number(r.id), { name: r.name }));
  const relationships: { type: string; child: string; parent: string }[] = [];
  await readCsv(csv('part_relationships'), (r) =>
    relationships.push({ type: r.rel_type, child: r.child_part_num, parent: r.parent_part_num }),
  );
  return {
    parts,
    colors,
    canonical: createCanonical([...relationships, ...suffixRelationships(parts.keys())]),
  };
}

type Fingerprints = Record<string, { hash: string; mix: Record<string, number> }>;

const hashOf = (assembly: Assembly) =>
  createHash('sha1')
    .update(assembly.bricks.map((b) => `${b.partId}:${b.color}:${b.x}:${b.y}:${b.z}`).join('|'))
    .digest('hex');

async function main(args: string[]) {
  const flags = new Set(args.filter((arg) => arg.startsWith('--')));
  const ids = args.filter((arg) => !arg.startsWith('--'));
  const { EXAMPLES, createExampleAssembly } =
    await import('../../../packages/brick-engine/src/examples/registry.ts');
  const wanted = flags.has('--all') ? EXAMPLES.map((example) => example.id) : ids;
  if (!wanted.length) {
    console.error('Usage: pnpm example:score <id>... [--all] [--no-compare] [--strict] [--json]');
    console.error(`Examples: ${EXAMPLES.map((example) => example.id).join(', ')}`);
    process.exit(1);
  }
  const dir = resolve('data');
  const catalogue = await loadCatalogue(dir);

  const cacheFile = join(dir, 'example-fingerprints.json');
  const cache: Fingerprints = existsSync(cacheFile)
    ? JSON.parse(await readFile(cacheFile, 'utf8'))
    : {};
  const others = new Map<string, Map<string, number>>();
  const assemblies = new Map<string, Assembly>();
  const build = (id: string) => {
    let assembly = assemblies.get(id);
    if (!assembly) {
      console.error(`Building ${id}`);
      assembly = createExampleAssembly(id);
      assemblies.set(id, assembly);
    }
    return assembly;
  };
  if (!flags.has('--no-compare')) {
    for (const example of EXAMPLES) {
      const assembly = build(example.id);
      const hash = hashOf(assembly);
      if (cache[example.id]?.hash !== hash)
        cache[example.id] = { hash, mix: Object.fromEntries(partMix(assembly, catalogue)) };
      others.set(example.id, new Map(Object.entries(cache[example.id]!.mix)));
    }
    await writeFile(cacheFile, `${JSON.stringify(cache)}\n`);
  }

  let low = 0;
  const scores = wanted.map((id) => {
    if (!EXAMPLES.some((example) => example.id === id)) throw new Error(`Unknown example: ${id}`);
    const score = scoreAssembly(id, build(id), catalogue, others);
    if (CHECKS.some((check) => check.pass(score) === false)) low++;
    return score;
  });
  if (flags.has('--json')) console.log(JSON.stringify(scores, null, 2));
  else console.log(scores.map(renderScore).join('\n\n'));
  if (flags.has('--strict') && low) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
