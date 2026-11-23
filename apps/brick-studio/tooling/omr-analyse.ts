/**
 * Measures how official sets are built, from the LDraw models `omr:fetch` downloads: how much
 * of each model is built sideways, how much sits in the roof, how many tiny parts there are,
 * which parts designers turn on their sides. Only statistics leave this script: no geometry is
 * stored or reproduced. Authors and licences are listed so the source is credited.
 *
 *   pnpm omr:analyse [data-dir] [output.md]
 *
 * Needs data/omr/ (run `pnpm omr:fetch topics`) and the Rebrickable parts CSVs in data/.
 */
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { createGunzip } from 'node:zlib';
import { parse } from 'csv-parse';
import { CATEGORY_BUCKETS } from './rebrickable-report.ts';
import { TOPIC_SELECTORS, readIndex } from './omr-fetch.ts';
import type { OmrSet } from './omr-fetch.ts';

export interface Placed {
  readonly part: string;
  readonly color: number;
  /** Direction of the part's own up axis in the model, y pointing up. */
  readonly up: number;
  /** Height of the part's origin above the model's lowest origin, in plates. */
  readonly y: number;
}

type Matrix = readonly [number, number, number, number, number, number, number, number, number];
type Vector = readonly [number, number, number];

export interface Header {
  readonly author: string;
  readonly license: string;
}

const IDENTITY: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const MAX_PARTS = 60_000;

function multiply(a: Matrix, b: Matrix): Matrix {
  const out: number[] = [];
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 3; col++)
      out.push(
        a[row * 3]! * b[col]! + a[row * 3 + 1]! * b[3 + col]! + a[row * 3 + 2]! * b[6 + col]!,
      );
  return out as unknown as Matrix;
}

function apply(m: Matrix, v: Vector, origin: Vector): Vector {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2] + origin[0],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2] + origin[1],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2] + origin[2],
  ];
}

/** Splits an MPD into its named files; a plain LDR is one file. The first is the main model. */
export function splitFiles(text: string): Map<string, string[]> {
  const files = new Map<string, string[]>();
  let current: string[] | undefined;
  let first = true;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const file = /^0\s+FILE\s+(.+)$/i.exec(line);
    if (file) {
      current = [];
      files.set(file[1]!.trim().toLowerCase(), current);
      first = false;
      continue;
    }
    if (first) {
      current = [];
      files.set('main', current);
      first = false;
    }
    if (line) current!.push(line);
  }
  return files;
}

export function readHeader(text: string): Header {
  return {
    author: /^0\s+Author:\s*(.+)$/im.exec(text)?.[1]?.trim() ?? 'unknown',
    license:
      /^0\s+!LICENSE\s+(.+)$/im
        .exec(text)?.[1]
        ?.replace(/ : see CAreadme\.txt/, '')
        .trim() ?? 'unknown',
  };
}

/** Flattens a model's sub-models into placed parts. LDraw's y axis points down; `up` flips it. */
export function flatten(text: string): Placed[] {
  const files = splitFiles(text);
  const main = files.keys().next().value as string | undefined;
  if (!main) return [];
  const raw: { part: string; color: number; up: number; y: number }[] = [];
  const walk = (name: string, matrix: Matrix, origin: Vector, color: number, depth: number) => {
    if (depth > 12 || raw.length > MAX_PARTS) return;
    for (const line of files.get(name) ?? []) {
      if (!line.startsWith('1 ')) continue;
      const t = line.split(/\s+/);
      if (t.length < 15) continue;
      const n = t.slice(2, 14).map(Number);
      if (n.some((value) => !Number.isFinite(value))) continue;
      const local: Matrix = [n[3]!, n[4]!, n[5]!, n[6]!, n[7]!, n[8]!, n[9]!, n[10]!, n[11]!];
      const reference = t.slice(14).join(' ').toLowerCase();
      const own = Number(t[1]);
      const inherited = own === 16 ? color : own;
      const position = apply(matrix, [n[0]!, n[1]!, n[2]!], origin);
      const combined = multiply(matrix, local);
      if (files.has(reference)) {
        walk(reference, combined, position, inherited, depth + 1);
      } else if (reference.endsWith('.dat') && !/[\\/]/.test(reference)) {
        raw.push({
          part: reference.slice(0, -4),
          color: inherited,
          up: combined[4],
          y: -position[1],
        });
      }
    }
  };
  walk(main, IDENTITY, [0, 0, 0], 15, 0);
  const floor = raw.length ? Math.min(...raw.map((p) => p.y)) : 0;
  return raw.map((p) => ({ ...p, y: (p.y - floor) / 8 }));
}

export interface PartInfo {
  readonly name: string;
  readonly bucket: string;
}

const BUCKET_OF = new Map(
  CATEGORY_BUCKETS.flatMap(([bucket, ids]) => ids.map((id) => [id, bucket] as const)),
);
const NOT_STRUCTURE =
  /^(Minifig|Technic|Stickers|Electric|Duplo|Mechanical|Non-LEGO|Bulk|Magnet|Pneumatic|Tools|Containers)/i;

/** Looks an LDraw design up in Rebrickable's parts, trying print and mould suffixes off. */
export function lookupPart(
  id: string,
  parts: ReadonlyMap<string, PartInfo | null>,
): PartInfo | undefined {
  const candidates = [
    id,
    id.replace(/(p[a-z0-9]+|pat[a-z0-9]*|pr\d+)$/, ''),
    id.replace(/c\d\d$/, ''),
    id.replace(/[a-z]$/, ''),
  ];
  for (const candidate of candidates) {
    const found = parts.get(candidate);
    if (found) return found;
  }
  return undefined;
}

export interface SetStats {
  readonly number: string;
  readonly name: string;
  readonly author: string;
  readonly license: string;
  readonly pieces: number;
  readonly sideways: number;
  readonly upsideDown: number;
  readonly small: number;
  readonly slopes: number;
  readonly tiles: number;
  readonly platesPerBrick: number;
  readonly roofSlopes: number;
  readonly plants: number;
  readonly colors: number;
  readonly height: number;
}

const isSmall = (name: string) => /\b1 x 1\b|\b1 x 2\b/.test(name);

export function measure(
  placed: readonly Placed[],
  parts: ReadonlyMap<string, PartInfo | null>,
):
  | {
      stats: Omit<SetStats, 'number' | 'name' | 'author' | 'license'>;
      sideways: Map<string, [number, number]>;
    }
  | undefined {
  const used = placed
    .map((p) => ({ ...p, info: lookupPart(p.part, parts) }))
    .filter((p) => p.info !== null && p.info !== undefined) as (Placed & { info: PartInfo })[];
  if (used.length < 50) return undefined;
  const count = (test: (bucket: string) => boolean) =>
    used.filter((p) => test(p.info.bucket)).length;
  const sideways = new Map<string, [number, number]>();
  let side = 0;
  let upside = 0;
  for (const p of used) {
    const horizontal = Math.abs(p.up) < 0.1;
    // Plates, tiles and bricks lying on their side are the SNOT cases that matter.
    const entry = sideways.get(p.part) ?? [0, 0];
    entry[1]++;
    if (horizontal) {
      side++;
      entry[0]++;
    }
    sideways.set(p.part, entry);
    if (p.up < -0.9) upside++;
  }
  const height = Math.max(...used.map((p) => p.y));
  const roof = used.filter((p) => p.y >= height * 0.8);
  const colorShares = new Map<number, number>();
  for (const p of used) colorShares.set(p.color, (colorShares.get(p.color) ?? 0) + 1);
  const bricks = count((b) => b === 'Bricks' || b === 'Bricks special (SNOT, masonry)');
  const plates = count((b) => b === 'Plates' || b === 'Tiles');
  const share = (n: number) => n / used.length;
  return {
    stats: {
      pieces: used.length,
      sideways: share(side),
      upsideDown: share(upside),
      small: share(used.filter((p) => isSmall(p.info.name)).length),
      slopes: share(count((b) => b.startsWith('Slopes'))),
      tiles: share(count((b) => b === 'Tiles' || b === 'Tiles special and round')),
      platesPerBrick: bricks ? plates / bricks : 0,
      roofSlopes: roof.length
        ? roof.filter(
            (p) => p.info.bucket.startsWith('Slopes') || p.info.bucket.startsWith('Round'),
          ).length / roof.length
        : 0,
      plants: share(count((b) => b === 'Plants')),
      colors: [...colorShares.values()].filter((n) => n / used.length >= 0.01).length,
      height: Math.round(height / 3),
    },
    sideways,
  };
}

async function readParts(dir: string): Promise<Map<string, PartInfo | null>> {
  const read = async (file: string, onRow: (row: Record<string, string>) => void) => {
    const parser = parse({ bom: true, columns: true, skip_empty_lines: true });
    const done = pipeline(createReadStream(join(dir, file)), createGunzip(), parser);
    for await (const row of parser as AsyncIterable<Record<string, string>>) onRow(row);
    await done;
  };
  const categories = new Map<number, string>();
  await read('part_categories.csv.gz', (r) => categories.set(Number(r.id), r.name));
  const parts = new Map<string, PartInfo | null>();
  await read('parts.csv.gz', (r) => {
    const category = Number(r.part_cat_id);
    parts.set(
      r.part_num.toLowerCase(),
      NOT_STRUCTURE.test(categories.get(category) ?? '')
        ? null
        : { name: r.name, bucket: BUCKET_OF.get(category) ?? 'Other' },
    );
  });
  return parts;
}

const mean = (values: readonly number[]) =>
  values.reduce((a, b) => a + b, 0) / (values.length || 1);
const pct = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;

async function main(dataDir: string, output: string) {
  const omr = join(dataDir, 'omr');
  const index = await readIndex(omr);
  const parts = await readParts(dataDir);
  const files = new Set((await readdir(join(omr, 'models'))).map((f) => f.replace(/\.mpd$/, '')));
  const byNumber = new Map<string, OmrSet>(index.map((s) => [s.number, s]));

  const perSet = new Map<string, SetStats>();
  const sidewaysByTopic = new Map<string, Map<string, [number, number]>>();
  const topics = new Map<string, string[]>();
  for (const number of [...files].sort()) {
    const set = byNumber.get(number);
    if (!set) continue;
    const text = await readFile(join(omr, 'models', `${number}.mpd`), 'utf8');
    const measured = measure(flatten(text), parts);
    if (!measured) continue;
    perSet.set(number, { number, name: set.name, ...readHeader(text), ...measured.stats });
    for (const [topic, selector] of Object.entries(TOPIC_SELECTORS)) {
      if (!selector.theme.test(set.theme) || (selector.name && !selector.name.test(set.name)))
        continue;
      (topics.get(topic) ?? topics.set(topic, []).get(topic)!).push(number);
      const bucket =
        sidewaysByTopic.get(topic) ?? sidewaysByTopic.set(topic, new Map()).get(topic)!;
      for (const [part, [side, total]] of measured.sideways) {
        const entry = bucket.get(part) ?? [0, 0];
        bucket.set(part, [entry[0] + side, entry[1] + total]);
      }
    }
  }

  const lines = [
    '# Placement statistics from official models',
    '',
    `Generated by \`pnpm omr:analyse\` from LDraw models of official sets in the LDraw Official Model Repository (library.ldraw.org/omr), ${perSet.size} sets with at least 50 structural pieces. Only statistics are kept, no geometry. Each model is credited below; its licence line is shown (CCAL 2.0 and CC BY 4.0 are both attribution licences). LDraw is a trademark of the Estate of James Jessiman; LEGO is a trademark of the LEGO Group.`,
    '',
    'Unlike `part-vocabulary.md` these numbers come from where parts really sit: _sideways_ is the share of parts turned onto their side (SNOT: side studs, brackets, headlight bricks, plates on a wall); _upside down_ the share of inverted parts (corbels, cornices, inverted slopes); _roof slopes_ the share of slopes and round pieces among the top fifth of the model by height; _small_ the share of 1 x 1 and 1 x 2 parts. Figures, Technic and gear are excluded.',
    '',
  ];
  for (const [topic, numbers] of [...topics].sort()) {
    const all = numbers.map((n) => perSet.get(n)!).filter(Boolean);
    // Small early sets would drag the means down; they still appear in the table.
    const rows = all.filter((s) => s.pieces >= 150);
    if (rows.length < 3) continue;
    const m = (pick: (s: SetStats) => number) => mean(rows.map(pick));
    lines.push(
      `## ${topic} (${rows.length} sets of 150+ pieces, ${all.length} analysed)`,
      '',
      `Mean: ${Math.round(m((s) => s.pieces))} pieces, ${pct(m((s) => s.sideways))} sideways, ${pct(m((s) => s.upsideDown))} upside down, ${pct(m((s) => s.small))} small, ${pct(m((s) => s.slopes))} slopes, ${pct(m((s) => s.tiles))} tiles, ${pct(m((s) => s.roofSlopes))} roof slopes, ${pct(m((s) => s.plants))} plants, ${m((s) => s.platesPerBrick).toFixed(1)} plates and tiles per brick, ${m((s) => s.colors).toFixed(0)} main colours, ${m((s) => s.height).toFixed(0)} bricks tall.`,
      '',
      '### Parts designers turn on their sides',
      '',
      '| Part | Name | Sideways uses | Share of its uses |',
      '| ---- | ---- | ------------: | ----------------: |',
      ...[...(sidewaysByTopic.get(topic) ?? [])]
        .filter(([, [side, total]]) => side >= 8 && side / total >= 0.3)
        .sort((a, b) => b[1][0] - a[1][0])
        .slice(0, 15)
        .map(
          ([part, [side, total]]) =>
            `| \`${part}\` | ${(lookupPart(part, parts)?.name ?? part).replace(/\|/g, '/')} | ${side} | ${pct(side / total)} |`,
        ),
      '',
      '### Sets analysed',
      '',
      '| Set | Name | Pieces | Sideways | Roof slopes | Author | Licence |',
      '| --- | ---- | -----: | -------: | ----------: | ------ | ------- |',
      ...all.map(
        (s) =>
          `| ${s.number} | ${s.name.replace(/\|/g, '/')} | ${s.pieces} | ${pct(s.sideways)} | ${pct(s.roofSlopes)} | ${s.author.replace(/\|/g, '/')} | ${s.license} |`,
      ),
      '',
    );
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${lines.join('\n')}\n`);
  console.log(`Wrote ${output} (${perSet.size} sets)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(
    resolve(process.argv[2] ?? 'data'),
    resolve(process.argv[3] ?? 'docs/techniques/placement-statistics.md'),
  ).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
