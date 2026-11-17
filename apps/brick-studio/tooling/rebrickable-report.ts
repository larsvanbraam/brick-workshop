/**
 * Benchmarks the example builds against real sets from Rebrickable's bulk downloads: piece
 * counts, part-category mix, small-part share, palettes, and the parts real sets lean on that
 * the catalogue lacks or the examples underuse. Rebrickable inventories list parts, not
 * positions, so this measures proportions and vocabulary, not construction.
 *
 *   pnpm rebrickable:report [data-dir] [output.md]
 *
 * Missing CSVs are downloaded into the data directory (Git-ignored) first.
 */
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { createGunzip } from 'node:zlib';
import { parse } from 'csv-parse';
import { COLORS, PARTS } from '../../../packages/brick-engine/src/core.ts';
import type { Assembly } from '../../../packages/brick-engine/src/core.ts';
import { DEFAULT_PART_COLOR_EVIDENCE } from '../../../packages/brick-engine/src/part-color-evidence.ts';

export const DOWNLOAD_BASE = 'https://cdn.rebrickable.com/media/downloads/';
export const DOWNLOADS = [
  'sets',
  'inventories',
  'inventory_parts',
  'parts',
  'part_categories',
  'colors',
  'part_relationships',
] as const;

export interface ReferenceGroup {
  readonly id: string;
  readonly title: string;
  readonly sets: readonly string[];
  readonly examples: readonly string[];
}

/** The reference builds CLAUDE.md names, by subject, with the examples they benchmark. */
export const REFERENCE_GROUPS: readonly ReferenceGroup[] = [
  {
    id: 'town',
    title: 'Town buildings (modulars)',
    sets: ['10270-1', '10350-1', '10312-1'],
    examples: ['flower-stall'],
  },
  {
    id: 'cottage',
    title: 'Cottages and village houses',
    sets: ['21325-1', '10332-1', '31139-1'],
    examples: ['courtyard-house'],
  },
  {
    id: 'castle',
    title: 'Castles',
    sets: ['10305-1', '31120-1'],
    examples: ['castle'],
  },
  {
    id: 'landmark',
    title: 'Architecture landmarks',
    sets: ['21061-1', '21060-1'],
    examples: ['nordiska-museet'],
  },
  {
    id: 'coastal',
    title: 'Lighthouse',
    sets: ['21335-1'],
    examples: ['seaside-lighthouse'],
  },
];

/** Rebrickable categories that are not building elements: figures, stickers, electrics. */
const EXCLUDED_CATEGORIES = new Set([
  13, 31, 41, 42, 43, 45, 48, 50, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 70, 71, 72, 77, 78,
]);

/** Rebrickable part categories merged into the buckets the report compares. */
export const CATEGORY_BUCKETS: readonly (readonly [bucket: string, categories: number[]])[] = [
  ['Bricks', [11]],
  ['Bricks special (SNOT, masonry)', [5]],
  ['Plates', [14]],
  ['Plates special (jumpers, brackets, clips)', [9]],
  ['Tiles', [19]],
  ['Tiles special and round', [15, 67]],
  ['Slopes, curves and wedges', [3, 6, 37, 49]],
  ['Round bricks, plates and cones', [20, 21]],
  ['Windows and doors', [16]],
  ['Hinges and turntables', [18]],
  ['Bars, fences and ladders', [32]],
  ['Plants', [76]],
  ['Panels', [23]],
  ['Baseplates', [1]],
  ['Technic', [8, 12, 26, 40, 46, 51, 52, 53, 54, 55]],
];
const OTHER_BUCKET = 'Other';
const BUCKET_OF = new Map(
  CATEGORY_BUCKETS.flatMap(([bucket, ids]) => ids.map((id) => [id, bucket] as const)),
);

export interface Catalogue {
  readonly parts: ReadonlyMap<string, { name: string; category: number }>;
  readonly colors: ReadonlyMap<number, { name: string }>;
  /** Folds prints, patterns and alternative moulds onto one design. */
  readonly canonical: (part: string) => string;
}

export interface Item {
  readonly part: string;
  readonly color: number;
  readonly quantity: number;
}

export interface Model {
  readonly id: string;
  readonly name: string;
  readonly items: readonly Item[];
}

export interface Summary {
  readonly id: string;
  readonly name: string;
  readonly pieces: number;
  readonly designs: number;
  readonly colors: number;
  /** Colours with at least 1% of the pieces. */
  readonly mainColors: number;
  /** Share of 1 x 1 and 1 x 2 pieces, by name. */
  readonly smallShare: number;
  /** Plates and tiles per brick. */
  readonly platesPerBrick: number;
  readonly buckets: ReadonlyMap<string, number>;
  readonly palette: readonly { color: number; share: number }[];
}

/**
 * Pairs each lettered mould (`3665a`, `3040b`) with its plain number when both exist, so old
 * and new moulds of one design count as one.
 */
export function suffixRelationships(
  partNums: Iterable<string>,
): { type: string; child: string; parent: string }[] {
  const all = new Set(partNums);
  return [...all].flatMap((child) => {
    const parent = /^(\d+)[a-z]$/.exec(child)?.[1];
    return parent && all.has(parent) ? [{ type: 'M', child, parent }] : [];
  });
}

/** Builds a union-find over print (P), pattern (T) and mould (M) relationships. */
export function createCanonical(
  relationships: Iterable<{ type: string; child: string; parent: string }>,
): (part: string) => string {
  const root = new Map<string, string>();
  const find = (part: string): string => {
    let current = part;
    while (root.has(current) && root.get(current) !== current) current = root.get(current)!;
    if (current !== part) root.set(part, current);
    return current;
  };
  for (const { type, child, parent } of relationships) {
    if (type !== 'P' && type !== 'T' && type !== 'M') continue;
    const a = find(child);
    const b = find(parent);
    if (a === b) continue;
    // The shorter, then alphabetically first, number is the plain design.
    const [keep, drop] = a.length < b.length || (a.length === b.length && a < b) ? [a, b] : [b, a];
    root.set(drop, keep);
    root.set(keep, keep);
  }
  return find;
}

export function isBuildingItem(item: Item, catalogue: Catalogue): boolean {
  const category = catalogue.parts.get(item.part)?.category;
  return category === undefined || !EXCLUDED_CATEGORIES.has(category);
}

function bucketOf(part: string, catalogue: Catalogue): string {
  const category = catalogue.parts.get(part)?.category;
  if (category === undefined) return 'Not in Rebrickable';
  return BUCKET_OF.get(category) ?? OTHER_BUCKET;
}

function isSmall(name: string): boolean {
  const size = /(\d+)\s*x\s*(\d+)/i.exec(name);
  return !!size && Number(size[1]) * Number(size[2]) <= 2;
}

export function summarise(model: Model, catalogue: Catalogue): Summary {
  const items = model.items.filter((item) => isBuildingItem(item, catalogue));
  const pieces = items.reduce((sum, item) => sum + item.quantity, 0);
  const share = (count: number) => (pieces ? count / pieces : 0);
  const designs = new Set(items.map((item) => catalogue.canonical(item.part)));
  const byColor = new Map<number, number>();
  const byBucket = new Map<string, number>();
  let small = 0;
  for (const item of items) {
    byColor.set(item.color, (byColor.get(item.color) ?? 0) + item.quantity);
    const bucket = bucketOf(item.part, catalogue);
    byBucket.set(bucket, (byBucket.get(bucket) ?? 0) + item.quantity);
    if (isSmall(catalogue.parts.get(item.part)?.name ?? '')) small += item.quantity;
  }
  const count = (...buckets: string[]) =>
    buckets.reduce((sum, bucket) => sum + (byBucket.get(bucket) ?? 0), 0);
  const bricks = count('Bricks', 'Bricks special (SNOT, masonry)');
  const flats = count(
    'Plates',
    'Plates special (jumpers, brackets, clips)',
    'Tiles',
    'Tiles special and round',
  );
  const palette = [...byColor]
    .map(([color, quantity]) => ({ color, share: share(quantity) }))
    .sort((a, b) => b.share - a.share || a.color - b.color);
  return {
    id: model.id,
    name: model.name,
    pieces,
    designs: designs.size,
    colors: byColor.size,
    mainColors: palette.filter((entry) => entry.share >= 0.01).length,
    smallShare: share(small),
    platesPerBrick: bricks ? flats / bricks : 0,
    buckets: new Map([...byBucket].map(([bucket, quantity]) => [bucket, share(quantity)])),
    palette,
  };
}

/** Our part IDs as Rebrickable designs: the reviewed mappings first, then by number. */
export function toRebrickablePart(
  partId: string,
  mapped: Readonly<Record<string, string>>,
  known: ReadonlyMap<string, unknown>,
): string {
  if (mapped[partId]) return mapped[partId];
  if (known.has(partId)) return partId;
  const plain = partId.replace(/[a-z]$/, '');
  return known.has(plain) ? plain : partId;
}

export function assemblyItems(
  assembly: Assembly,
  catalogue: Catalogue,
  mappings = DEFAULT_PART_COLOR_EVIDENCE.mappings,
): Item[] {
  const counts = new Map<string, Item>();
  for (const brick of assembly.bricks) {
    const part = toRebrickablePart(brick.partId, mappings.parts, catalogue.parts);
    const color = mappings.colors[String(brick.color)] ?? brick.color;
    const key = `${part}:${color}`;
    const entry = counts.get(key);
    counts.set(key, { part, color, quantity: (entry?.quantity ?? 0) + 1 });
  }
  return [...counts.values()];
}

export interface PartUse {
  /** The canonical design, as `Catalogue.canonical` gives it. */
  readonly design: string;
  /** The number the reference sets use most for it. */
  readonly part: string;
  readonly name: string;
  readonly bucket: string;
  readonly sets: readonly string[];
  readonly quantity: number;
  /** Mean share of a reference set's pieces. */
  readonly share: number;
}

/** How the reference sets use each design, most widely used first. */
export function rankReferenceParts(references: readonly Model[], catalogue: Catalogue): PartUse[] {
  const uses = new Map<
    string,
    { sets: Set<string>; quantity: number; share: number; numbers: Map<string, number> }
  >();
  for (const model of references) {
    const items = model.items.filter((item) => isBuildingItem(item, catalogue));
    const total = items.reduce((sum, item) => sum + item.quantity, 0) || 1;
    for (const item of items) {
      const part = catalogue.canonical(item.part);
      const use = uses.get(part) ?? { sets: new Set(), quantity: 0, share: 0, numbers: new Map() };
      use.sets.add(model.id);
      use.quantity += item.quantity;
      use.numbers.set(item.part, (use.numbers.get(item.part) ?? 0) + item.quantity);
      use.share += item.quantity / total / references.length;
      uses.set(part, use);
    }
  }
  return [...uses]
    .map(([design, use]) => ({
      design,
      // Labelled by the number the sets use most, usually the current mould.
      part: [...use.numbers].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
      use,
    }))
    .map(({ design, part, use }) => ({
      design,
      part,
      name: catalogue.parts.get(part)?.name ?? part,
      bucket: bucketOf(design, catalogue),
      sets: [...use.sets],
      quantity: use.quantity,
      share: use.share,
    }))
    .sort(
      (a, b) =>
        b.sets.length - a.sets.length || b.quantity - a.quantity || a.part.localeCompare(b.part),
    );
}

export function supportedDesigns(
  catalogue: Catalogue,
  partIds: readonly string[] = PARTS.map((part) => part.id),
  mapped = DEFAULT_PART_COLOR_EVIDENCE.mappings.parts,
): Set<string> {
  return new Set(
    partIds.map((id) => catalogue.canonical(toRebrickablePart(id, mapped, catalogue.parts))),
  );
}

export interface Underuse extends PartUse {
  /** Share of the examples' pieces. */
  readonly exampleShare: number;
}

/** Supported designs the reference sets use far more of than the examples do. */
export function findUnderusedParts(
  ranked: readonly PartUse[],
  examples: readonly Model[],
  supported: ReadonlySet<string>,
  catalogue: Catalogue,
): Underuse[] {
  // Each example weighs the same, as each reference set does, whatever its size.
  const used = new Map<string, number>();
  for (const model of examples) {
    const items = model.items.filter((item) => isBuildingItem(item, catalogue));
    const total = items.reduce((sum, item) => sum + item.quantity, 0) || 1;
    for (const item of items) {
      const design = catalogue.canonical(item.part);
      used.set(design, (used.get(design) ?? 0) + item.quantity / total / examples.length);
    }
  }
  return ranked
    .filter((use) => supported.has(use.design))
    .map((use) => ({ ...use, exampleShare: used.get(use.design) ?? 0 }))
    .filter((use) => use.share >= 0.003 && use.exampleShare < use.share / 3)
    .sort((a, b) => b.share - b.exampleShare - (a.share - a.exampleShare));
}

const percent = (value: number) => `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;
const mean = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0) / (values.length || 1);

export interface ReportInput {
  readonly retrievedAt: string;
  readonly groups: readonly ReferenceGroup[];
  readonly references: ReadonlyMap<string, Summary>;
  readonly examples: ReadonlyMap<string, Summary>;
  readonly gaps: readonly PartUse[];
  readonly underused: readonly Underuse[];
  readonly referenceCount: number;
  /** Our colour ID and name for a Rebrickable colour. */
  readonly colorLabel: (color: number) => string;
}

export function renderReport(input: ReportInput): string {
  const lines: string[] = [];
  const row = (cells: readonly (string | number)[]) => lines.push(`| ${cells.join(' | ')} |`);
  const table = (header: readonly string[], align: readonly ('l' | 'r')[]) => {
    row(header);
    row(align.map((side) => (side === 'r' ? '---:' : '---')));
  };
  const summaryRow = (summary: Summary, label: string) =>
    row([
      label,
      summary.pieces,
      summary.designs,
      summary.mainColors,
      percent(summary.smallShare),
      summary.platesPerBrick.toFixed(1),
    ]);

  lines.push(
    '# Rebrickable benchmarks',
    '',
    'Generated by `pnpm rebrickable:report` from the Rebrickable bulk downloads',
    `(retrieved ${input.retrievedAt}). Inventories exclude spares, minifigures, stickers and`,
    'electrics. They list parts, not positions, so this compares proportions and part',
    'vocabulary, not construction. Colour IDs are the engine (LDraw) IDs.',
    '',
    '## Scale and mix',
    '',
    '"Main colours" have at least 1% of the pieces; "small" is 1 x 1 and 1 x 2 pieces;',
    '"plates/brick" counts plates and tiles per brick.',
  );
  for (const group of input.groups) {
    lines.push('', `### ${group.title}`, '');
    table(
      ['Model', 'Pieces', 'Designs', 'Main colours', 'Small', 'Plates/brick'],
      ['l', 'r', 'r', 'r', 'r', 'r'],
    );
    const references = group.sets.flatMap((id) => input.references.get(id) ?? []);
    for (const summary of references) summaryRow(summary, `${summary.id} ${summary.name}`);
    for (const id of group.examples) {
      const summary = input.examples.get(id);
      if (summary) summaryRow(summary, `**${summary.name}** (example)`);
    }

    const models = [...references, ...group.examples.flatMap((id) => input.examples.get(id) ?? [])];
    const buckets = [...new Set(models.flatMap((summary) => [...summary.buckets.keys()]))]
      .map((bucket) => ({
        bucket,
        reference: mean(references.map((summary) => summary.buckets.get(bucket) ?? 0)),
      }))
      .sort((a, b) => b.reference - a.reference);
    lines.push('');
    const exampleSummaries = group.examples.flatMap((id) => input.examples.get(id) ?? []);
    table(
      ['Category', 'Reference mean', ...exampleSummaries.map((summary) => summary.name)],
      ['l', 'r', ...exampleSummaries.map(() => 'r' as const)],
    );
    for (const { bucket, reference } of buckets) {
      const ours = exampleSummaries.map((summary) => summary.buckets.get(bucket) ?? 0);
      if (reference < 0.005 && ours.every((share) => share < 0.005)) continue;
      row([bucket, percent(reference), ...ours.map(percent)]);
    }

    lines.push('', 'Palettes (top colours by share of pieces):', '');
    for (const summary of models)
      lines.push(
        `- ${summary.name}: ${summary.palette
          .slice(0, 8)
          .map((entry) => `${input.colorLabel(entry.color)} ${percent(entry.share)}`)
          .join(', ')}`,
      );
  }

  lines.push(
    '',
    '## Catalogue gaps',
    '',
    `Designs the ${input.referenceCount} reference sets use that the engine cannot place, by the`,
    'number of sets using them, then by quantity. Prints, patterns and alternative moulds',
    '(including lettered variants such as `3665a` and `3665`) count as one design.',
    '',
  );
  table(['Part', 'Name', 'Category', 'Sets', 'Qty'], ['l', 'l', 'l', 'r', 'r']);
  for (const gap of input.gaps)
    row([`\`${gap.part}\``, gap.name, gap.bucket, gap.sets.length, gap.quantity]);

  lines.push(
    '',
    '## Supported but underused',
    '',
    'Designs the engine supports that the reference sets use at least three times as often as',
    'the examples, by the size of the difference, each model weighing the same. These are',
    'techniques within reach today.',
    '',
  );
  table(['Part', 'Name', 'Sets', 'Reference share', 'Example share'], ['l', 'l', 'r', 'r', 'r']);
  for (const use of input.underused)
    row([
      `\`${use.part}\``,
      use.name,
      use.sets.length,
      percent(use.share),
      percent(use.exampleShare),
    ]);
  return `${lines.join('\n')}\n`;
}

async function readCsv(file: string, onRow: (row: Record<string, string>) => void): Promise<void> {
  const parser = parse({ bom: true, columns: true, skip_empty_lines: true });
  const done = pipeline(createReadStream(file), createGunzip(), parser);
  for await (const row of parser as AsyncIterable<Record<string, string>>) onRow(row);
  await done;
}

async function download(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const name of DOWNLOADS) {
    const file = join(dir, `${name}.csv.gz`);
    if (existsSync(file)) continue;
    console.log(`Downloading ${name}.csv.gz`);
    const response = await fetch(`${DOWNLOAD_BASE}${name}.csv.gz`);
    if (!response.ok) throw new Error(`Download failed: ${name} (${response.status})`);
    await writeFile(file, Buffer.from(await response.arrayBuffer()));
  }
}

async function main(dir: string, output: string) {
  await download(dir);
  const csv = (name: string) => join(dir, `${name}.csv.gz`);

  const parts = new Map<string, { name: string; category: number }>();
  await readCsv(csv('parts'), (row) =>
    parts.set(row.part_num, { name: row.name, category: Number(row.part_cat_id) }),
  );
  const colors = new Map<number, { name: string }>();
  await readCsv(csv('colors'), (row) => colors.set(Number(row.id), { name: row.name }));
  const relationships: { type: string; child: string; parent: string }[] = [];
  await readCsv(csv('part_relationships'), (row) =>
    relationships.push({
      type: row.rel_type,
      child: row.child_part_num,
      parent: row.parent_part_num,
    }),
  );
  const catalogue: Catalogue = {
    parts,
    colors,
    canonical: createCanonical([...relationships, ...suffixRelationships(parts.keys())]),
  };

  const wanted = new Set(REFERENCE_GROUPS.flatMap((group) => group.sets));
  const names = new Map<string, string>();
  await readCsv(csv('sets'), (row) => {
    if (wanted.has(row.set_num)) names.set(row.set_num, row.name);
  });
  const inventories = new Map<string, { id: number; version: number }>();
  await readCsv(csv('inventories'), (row) => {
    if (!wanted.has(row.set_num)) return;
    const current = inventories.get(row.set_num);
    const version = Number(row.version);
    if (!current || version < current.version)
      inventories.set(row.set_num, { id: Number(row.id), version });
  });
  const setOf = new Map([...inventories].map(([set, { id }]) => [id, set]));
  const items = new Map<string, Item[]>();
  await readCsv(csv('inventory_parts'), (row) => {
    const set = setOf.get(Number(row.inventory_id));
    if (!set || row.is_spare === 'True') return;
    const list = items.get(set) ?? [];
    list.push({ part: row.part_num, color: Number(row.color_id), quantity: Number(row.quantity) });
    items.set(set, list);
  });
  const missing = [...wanted].filter((set) => !items.has(set));
  if (missing.length) throw new Error(`No inventory for: ${missing.join(', ')}`);

  const referenceModels = [...wanted].map((id) => ({
    id,
    name: names.get(id) ?? id,
    items: items.get(id)!,
  }));
  // Imported late: building the examples takes a while, and the CSVs should fail first.
  const { EXAMPLES, createExampleAssembly } =
    await import('../../../packages/brick-engine/src/examples/registry.ts');
  const exampleIds = REFERENCE_GROUPS.flatMap((group) => group.examples);
  const exampleModels = exampleIds.map((id) => {
    console.log(`Building ${id}`);
    return {
      id,
      name: EXAMPLES.find((example) => example.id === id)?.name ?? id,
      items: assemblyItems(createExampleAssembly(id), catalogue),
    };
  });

  const ranked = rankReferenceParts(referenceModels, catalogue);
  const supported = supportedDesigns(catalogue);
  const ldrawColor = new Map(
    Object.entries(DEFAULT_PART_COLOR_EVIDENCE.mappings.colors).map(([ours, theirs]) => [
      theirs,
      Number(ours),
    ]),
  );
  const report = renderReport({
    retrievedAt: (await stat(csv('inventory_parts'))).mtime.toISOString().slice(0, 10),
    groups: REFERENCE_GROUPS,
    references: new Map(referenceModels.map((model) => [model.id, summarise(model, catalogue)])),
    examples: new Map(exampleModels.map((model) => [model.id, summarise(model, catalogue)])),
    gaps: ranked.filter((use) => !supported.has(use.design) && use.sets.length >= 2).slice(0, 60),
    underused: findUnderusedParts(ranked, exampleModels, supported, catalogue).slice(0, 40),
    referenceCount: referenceModels.length,
    colorLabel: (color) => {
      const ours = ldrawColor.get(color) ?? color;
      const name =
        COLORS.find((entry) => entry.id === ours)?.name ?? colors.get(color)?.name ?? '?';
      return `${name.replaceAll('_', ' ')} \`${ours}\``;
    },
  });
  await writeFile(output, report);
  console.log(`Wrote ${output}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main(
    resolve(process.argv[2] ?? 'data'),
    resolve(process.argv[3] ?? 'docs/rebrickable-benchmarks.md'),
  );
}
