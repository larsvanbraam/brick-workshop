/**
 * How much of what official sets use the catalogue can place, by design count and by pieces
 * (every instance in the latest inventory of each 150+ piece set since 2000), split by whether the
 * category is structural. Lists the biggest gaps with the reason each is not in.
 *
 *   node apps/brick-studio/tooling/part-coverage.ts [top-gaps] [category-or-name regex]
 *
 * With a regex the gap list covers every category whose name or part name matches it, such as
 * `Window|Door|Glass|Shutter`.
 */
import { createReadStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { parse } from 'csv-parse';
import { PARTS } from '../../../packages/brick-engine/src/core.ts';
import { DEFAULT_PART_COLOR_EVIDENCE } from '../../../packages/brick-engine/src/part-color-evidence.ts';
import { createCanonical, suffixRelationships, toRebrickablePart } from './rebrickable-report.ts';

const NOT_STRUCTURE =
  /^(Minifig|Technic|Stickers|Electric|Duplo|Mechanical|Non-LEGO|Bulk|Magnet|Pneumatic|Tools|Containers|Baseplates|Wheels|Tyres|Train|Transportation|Vehicle|Cockpit|Large Figure|Flags|Hose|String)/i;

async function readCsv(file: string, onRow: (row: Record<string, string>) => void) {
  const parser = parse({ bom: true, columns: true, skip_empty_lines: true });
  const done = pipeline(createReadStream(file), createGunzip(), parser);
  for await (const row of parser as AsyncIterable<Record<string, string>>) onRow(row);
  await done;
}

async function main(top: number, only?: RegExp) {
  const csv = (name: string) => join(resolve('data'), `${name}.csv.gz`);
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
  const sets = new Set<string>();
  await readCsv(csv('sets'), (r) => {
    if (Number(r.num_parts) >= 150 && Number(r.year) >= 2000) sets.add(r.set_num);
  });
  const version = new Map<string, number>();
  await readCsv(csv('inventories'), (r) => {
    if (sets.has(r.set_num) && Number(r.version) < (version.get(r.set_num) ?? 9))
      version.set(r.set_num, Number(r.version));
  });
  const inventory = new Set<number>();
  await readCsv(csv('inventories'), (r) => {
    if (sets.has(r.set_num) && version.get(r.set_num) === Number(r.version))
      inventory.add(Number(r.id));
  });
  const byDesign = new Map<string, { n: number; name: string; cat: string }>();
  await readCsv(csv('inventory_parts'), (r) => {
    if (!inventory.has(Number(r.inventory_id)) || r.is_spare === 'True') return;
    const info = parts.get(r.part_num);
    if (!info) return;
    const design = canonical(r.part_num);
    const entry = byDesign.get(design) ?? {
      n: 0,
      name: parts.get(design)?.name ?? info.name,
      cat: categories.get(info.category) ?? '?',
    };
    entry.n += Number(r.quantity);
    byDesign.set(design, entry);
  });
  const mapped = DEFAULT_PART_COLOR_EVIDENCE.mappings.parts;
  const have = new Set(PARTS.map((p) => canonical(toRebrickablePart(p.id, mapped, parts))));
  const rows = [...byDesign].map(([design, e]) => ({
    design,
    ...e,
    structural: !NOT_STRUCTURE.test(e.cat),
    have: have.has(design),
  }));
  const report = (label: string, list: typeof rows) => {
    const total = list.reduce((s, r) => s + r.n, 0);
    const covered = list.filter((r) => r.have).reduce((s, r) => s + r.n, 0);
    console.log(
      `${label}: ${list.filter((r) => r.have).length}/${list.length} designs, ${((covered / total) * 100).toFixed(1)}% of pieces`,
    );
  };
  report('All parts', rows);
  report(
    'Structural categories',
    rows.filter((r) => r.structural),
  );
  const sorted = rows
    .filter((r) => (only ? only.test(`${r.cat} | ${r.name}`) : r.structural))
    .sort((a, b) => b.n - a.n);
  for (const cut of [100, 300, 1000]) {
    const slice = sorted.slice(0, cut);
    console.log(`  top ${cut} structural designs: ${slice.filter((r) => r.have).length} in`);
  }
  console.log(`\nBiggest ${only ? 'matching' : 'structural'} gaps:`);
  for (const r of sorted.filter((r) => !r.have).slice(0, top))
    console.log(`  ${r.design.padEnd(10)} ${String(r.n).padStart(7)}  ${r.cat} | ${r.name}`);
  console.log(`\nCatalogue: ${PARTS.length} parts`);
}

main(
  Number(process.argv[2] ?? 40),
  process.argv[3] ? new RegExp(process.argv[3], 'i') : undefined,
).catch((e) => {
  console.error(e);
  process.exit(1);
});
