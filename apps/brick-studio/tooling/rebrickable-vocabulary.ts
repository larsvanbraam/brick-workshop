/**
 * Mines Rebrickable's bulk downloads for the part vocabulary of each build topic (modular
 * facades, castles, western towns, plants, vehicles, animals, ...): which designs the official
 * sets of a topic lean on, how much more than sets in general, and which of them the engine
 * can place. Inventories list parts, not positions, so this is vocabulary and palette, not
 * construction; the technique notes in docs/techniques/ say how the parts go together.
 *
 *   pnpm rebrickable:vocabulary [data-dir] [output.md]
 *
 * Reuses the CSVs `rebrickable:report` downloads (Git-ignored), plus themes.
 */
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { createGunzip } from 'node:zlib';
import { parse } from 'csv-parse';
import { PARTS } from '../../../packages/brick-engine/src/core.ts';
import { DEFAULT_PART_COLOR_EVIDENCE } from '../../../packages/brick-engine/src/part-color-evidence.ts';
import {
  DOWNLOAD_BASE,
  createCanonical,
  suffixRelationships,
  toRebrickablePart,
} from './rebrickable-report.ts';

export interface Topic {
  readonly id: string;
  readonly title: string;
  /** Matches the theme path ("Icons > Modular Buildings"). */
  readonly theme?: RegExp;
  /** Matches the set name; with `theme`, both must match. */
  readonly name?: RegExp;
}

const BUILDING_NAME =
  /\b(Truck|Car|Train|Locomotive|Bus|Wagon|Boat|Ship|Plane|Tractor|Van|Camper|Bike|Motorcycle|Tram|Carriage|Cart)\b/i;
const ANIMAL_NAME =
  /\b(Horse|Dog|Cat|Bird|Owl|Lion|Elephant|Fish|Dinosaur|Dragon|Rabbit|Panda|Parrot|Penguin|Fox|Deer|Turtle|Shark|Cow|Pig|Sheep|Duck|Chicken|Butterfly|Bee|Frog|Tiger|Giraffe|Zebra|Koala|Hedgehog|Squirrel|Wolf|Bear)\b/i;

export const TOPICS: readonly Topic[] = [
  { id: 'modular', title: 'Modular town buildings', theme: /Modular Buildings/ },
  { id: 'medieval', title: 'Medieval and castle', theme: /Castle|Kingdoms|Knights|Medieval/ },
  { id: 'western', title: 'Western', theme: /Western|Lone Ranger/ },
  { id: 'architecture', title: 'Architecture landmarks', theme: /Architecture/ },
  {
    id: 'city-street',
    title: 'City streets and shops',
    theme: /City|Creator|Icons/,
    name: /Street|Shop|Store|Cafe|Café|Market|Station|Bakery|Pizzeria|Restaurant|Hotel|Bank|Library|Town/i,
  },
  {
    id: 'flora',
    title: 'Plants, trees and gardens',
    theme: /Botanical|Icons|Ideas|Creator|Friends/,
    name: /Flower|Bouquet|Orchid|Bonsai|Succulent|Plant|Tree|Garden|Rose|Cactus|Cherry|Sunflower|Wildflower|Tulip|Lotus|Forest|Orchard|Greenhouse/i,
  },
  {
    id: 'vehicles',
    title: 'Cars, trucks, trains and boats',
    theme: /Speed Champions|Trains|Icons|Creator|Ideas|City|Technic/,
    name: BUILDING_NAME,
  },
  {
    id: 'fauna',
    title: 'Animals',
    theme: /Icons|Ideas|Creator|Animals|Friends|Jurassic/,
    name: ANIMAL_NAME,
  },
  {
    id: 'harbour',
    title: 'Harbour, lighthouse and ships',
    theme: /Icons|Ideas|Creator|Architecture|Pirates/,
    name: /Lighthouse|Harbo|Pirate|Ship|Boat|Dock|Quay|Fishing|Sea/i,
  },
];

/** Rebrickable categories that are gear, mechanisms or packaging, not structure. */
const NOT_STRUCTURE =
  /^(Minifig|Technic|Stickers|Electric|Duplo|Mechanical|Non-LEGO|Bulk|Magnet|Pneumatic|Tools|Containers|Minifigs)/i;

export interface Catalogue {
  readonly parts: ReadonlyMap<string, { name: string; category: number }>;
  readonly categories: ReadonlyMap<number, string>;
  readonly colors: ReadonlyMap<number, { name: string; ldraw: number }>;
  readonly canonical: (part: string) => string;
}

export interface PartStat {
  readonly part: string;
  /** Share of the topic's sets that use the design. */
  readonly coverage: number;
  /** Coverage in the topic divided by coverage in all sets. */
  readonly lift: number;
  readonly sets: number;
}

/** Parts a topic's sets share, ranked by how much they set the topic apart. */
export function rankTopicParts(
  topicSets: readonly ReadonlySet<string>[],
  baseline: ReadonlyMap<string, number>,
  baselineSets: number,
): { staples: PartStat[]; signature: PartStat[] } {
  const counts = new Map<string, number>();
  for (const set of topicSets)
    for (const part of set) counts.set(part, (counts.get(part) ?? 0) + 1);
  const stats = [...counts].map(([part, sets]) => {
    const coverage = sets / topicSets.length;
    const general = (baseline.get(part) ?? 0) / baselineSets;
    return { part, sets, coverage, lift: general > 0 ? coverage / general : Infinity };
  });
  const minSets = Math.max(3, Math.round(topicSets.length * 0.05));
  const staples = [...stats].sort((a, b) => b.coverage - a.coverage).slice(0, 30);
  const signature = stats
    .filter((s) => s.sets >= minSets && s.lift >= 1.8)
    .sort((a, b) => b.lift * b.coverage - a.lift * a.coverage)
    .slice(0, 40);
  return { staples, signature };
}

async function readCsv(file: string, onRow: (row: Record<string, string>) => void) {
  const parser = parse({ bom: true, columns: true, skip_empty_lines: true });
  const done = pipeline(createReadStream(file), createGunzip(), parser);
  for await (const row of parser as AsyncIterable<Record<string, string>>) onRow(row);
  await done;
}

async function ensure(dir: string, names: readonly string[]) {
  await mkdir(dir, { recursive: true });
  for (const name of names) {
    const file = join(dir, `${name}.csv.gz`);
    if (existsSync(file)) continue;
    console.log(`Downloading ${name}.csv.gz`);
    const response = await fetch(`${DOWNLOAD_BASE}${name}.csv.gz`);
    if (!response.ok) throw new Error(`Download failed: ${name} (${response.status})`);
    await writeFile(file, Buffer.from(await response.arrayBuffer()));
  }
}

const pct = (value: number) => `${Math.round(value * 100)}%`;

async function main(dir: string, output: string) {
  await ensure(dir, [
    'sets',
    'themes',
    'inventories',
    'inventory_parts',
    'parts',
    'part_categories',
    'colors',
    'part_relationships',
  ]);
  const csv = (name: string) => join(dir, `${name}.csv.gz`);

  const parts = new Map<string, { name: string; category: number }>();
  await readCsv(csv('parts'), (r) =>
    parts.set(r.part_num, { name: r.name, category: Number(r.part_cat_id) }),
  );
  const categories = new Map<number, string>();
  await readCsv(csv('part_categories'), (r) => categories.set(Number(r.id), r.name));
  const relationships: { type: string; child: string; parent: string }[] = [];
  await readCsv(csv('part_relationships'), (r) =>
    relationships.push({ type: r.rel_type, child: r.child_part_num, parent: r.parent_part_num }),
  );
  const canonical = createCanonical([...relationships, ...suffixRelationships(parts.keys())]);

  const themes = new Map<number, { name: string; parent: number | null }>();
  await readCsv(csv('themes'), (r) =>
    themes.set(Number(r.id), { name: r.name, parent: r.parent_id ? Number(r.parent_id) : null }),
  );
  const themePath = (id: number): string => {
    const theme = themes.get(id);
    return theme ? (theme.parent ? `${themePath(theme.parent)} > ${theme.name}` : theme.name) : '';
  };

  const sets = new Map<string, { name: string; year: number; theme: string; pieces: number }>();
  await readCsv(csv('sets'), (r) => {
    const pieces = Number(r.num_parts);
    if (pieces < 150 || Number(r.year) < 2000) return;
    sets.set(r.set_num, {
      name: r.name,
      year: Number(r.year),
      theme: themePath(Number(r.theme_id)),
      pieces,
    });
  });

  const inventorySet = new Map<number, string>();
  const versions = new Map<string, number>();
  await readCsv(csv('inventories'), (r) => {
    if (!sets.has(r.set_num)) return;
    const version = Number(r.version);
    if (version >= (versions.get(r.set_num) ?? Infinity)) return;
    versions.set(r.set_num, version);
  });
  await readCsv(csv('inventories'), (r) => {
    if (sets.has(r.set_num) && versions.get(r.set_num) === Number(r.version))
      inventorySet.set(Number(r.id), r.set_num);
  });

  const mapped = DEFAULT_PART_COLOR_EVIDENCE.mappings.parts;
  const supported = new Set(
    PARTS.map((part) => canonical(toRebrickablePart(part.id, mapped, parts))),
  );
  const colorsByNum = new Map<number, string>();
  await readCsv(csv('colors'), (r) => colorsByNum.set(Number(r.id), r.name));

  const partSets = new Map<string, Set<string>>();
  const colorWeight = new Map<string, Map<number, number>>();
  await readCsv(csv('inventory_parts'), (r) => {
    const set = inventorySet.get(Number(r.inventory_id));
    if (!set || r.is_spare === 'True') return;
    const info = parts.get(r.part_num);
    // Skip figures, stickers, electrics and prints: they say nothing about construction.
    if (info && NOT_STRUCTURE.test(categories.get(info.category) ?? '')) return;
    if (
      info &&
      [
        13, 17, 31, 41, 42, 43, 45, 48, 50, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 70, 71, 72,
        77, 78,
      ].includes(info.category)
    )
      return;
    const design = canonical(r.part_num);
    (partSets.get(set) ?? partSets.set(set, new Set()).get(set)!).add(design);
    const weights = colorWeight.get(set) ?? colorWeight.set(set, new Map()).get(set)!;
    weights.set(Number(r.color_id), (weights.get(Number(r.color_id)) ?? 0) + Number(r.quantity));
  });

  const baseline = new Map<string, number>();
  for (const set of partSets.values())
    for (const part of set) baseline.set(part, (baseline.get(part) ?? 0) + 1);

  const describe = (part: string) => {
    const info = parts.get(part);
    const name = (info?.name ?? part).replace(/\|/g, '/');
    const category = info ? (categories.get(info.category) ?? '') : '';
    return { name, category };
  };

  const lines = [
    '# Rebrickable part vocabulary by topic',
    '',
    `Generated by \`pnpm rebrickable:vocabulary\` from the Rebrickable bulk downloads (retrieved ${new Date().toISOString().slice(0, 10)}). Sets of 150+ pieces from 2000 on; spares, figures, stickers and electrics are left out. Inventories list parts, not positions: this is the vocabulary official designers reach for, not how they place it. The technique notes next to this file cover placement.`,
    '',
    '_Coverage_ is the share of the topic\'s sets that contain the design; _lift_ is that share divided by the share across all sets (2.0 = twice as common here). _Engine_ says whether the catalogue can place the design today; a "no" on a high-lift part is a candidate for `docs`/README\'s "adding a part".',
    '',
  ];
  for (const topic of TOPICS) {
    const matching = [...partSets.keys()].filter((id) => {
      const set = sets.get(id)!;
      const byTheme = topic.theme ? topic.theme.test(set.theme) : true;
      const byName = topic.name ? topic.name.test(set.name) : true;
      return byTheme && byName;
    });
    // Modular and architecture are theme-only; the rest need both, so require both here.
    if (matching.length < 4) {
      console.warn(`${topic.id}: only ${matching.length} sets, skipped`);
      continue;
    }
    console.log(`${topic.id}: ${matching.length} sets`);
    const topicSets = matching.map((id) => partSets.get(id)!);
    const { staples, signature } = rankTopicParts(topicSets, baseline, partSets.size);

    const weights = new Map<number, number>();
    let total = 0;
    for (const id of matching)
      for (const [color, quantity] of colorWeight.get(id)!) {
        weights.set(color, (weights.get(color) ?? 0) + quantity);
        total += quantity;
      }
    const palette = [...weights]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([color, quantity]) => `${colorsByNum.get(color) ?? color} ${pct(quantity / total)}`);
    const examples = matching
      .sort((a, b) => sets.get(b)!.pieces - sets.get(a)!.pieces)
      .slice(0, 8)
      .map((id) => `${id} ${sets.get(id)!.name}`);

    const table = (rows: PartStat[]) => [
      '| Part | Name | Category | Coverage | Lift | Engine |',
      '| ---- | ---- | -------- | -------: | ---: | :----: |',
      ...rows.map((s) => {
        const { name, category } = describe(s.part);
        const lift = Number.isFinite(s.lift) ? s.lift.toFixed(1) : '∞';
        return `| \`${s.part}\` | ${name} | ${category} | ${pct(s.coverage)} | ${lift} | ${supported.has(s.part) ? 'yes' : 'no'} |`;
      }),
    ];
    lines.push(
      `## ${topic.title}`,
      '',
      `${matching.length} sets. Largest: ${examples.join('; ')}.`,
      '',
      `Palette (Rebrickable colour names, share of pieces): ${palette.join(', ')}.`,
      '',
      '### Signature parts (set this topic apart)',
      '',
      ...table(signature),
      '',
      '### Signature parts the engine cannot place yet',
      '',
      ...table(signature.filter((stat) => !supported.has(stat.part)).slice(0, 15)),
      '',
      '### Staples (most sets use them)',
      '',
      ...table(staples),
      '',
    );
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${lines.join('\n')}\n`);
  console.log(`Wrote ${output}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = resolve(process.argv[2] ?? 'data');
  const output = resolve(process.argv[3] ?? 'docs/techniques/part-vocabulary.md');
  main(dir, output).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
