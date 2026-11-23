/**
 * Downloads LDraw models of official sets from the LDraw Official Model Repository
 * (library.ldraw.org/omr) for `omr:analyse`. The models are CC BY 2.0 / 4.0 (see each file's
 * !LICENSE line); the analyser keeps statistics and no geometry, and credits the repository.
 *
 *   pnpm omr:fetch index                 # list every set (about 60 requests) into data/omr/index.json
 *   pnpm omr:fetch get <set-number>...   # download those sets' main models into data/omr/models/
 *   pnpm omr:fetch topics                # download the sets the technique notes sample
 *
 * One request a second; files already on disk are kept. Git-ignored output.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const BASE = 'https://library.ldraw.org';
const DELAY_MS = 1000;
const HEADERS = { 'user-agent': 'brick-workshop-research/1.0 (polite, 1 req/s)' };

export interface OmrSet {
  readonly id: number;
  readonly number: string;
  readonly name: string;
  readonly theme: string;
  readonly year: number;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: HEADERS, redirect: 'follow' });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.text();
}

const decode = (text: string) =>
  text
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&quot;/g, '"');

/** Reads one page of the repository's set list. */
export function parseSetList(html: string): { sets: OmrSet[]; total: number } {
  const sets: OmrSet[] = [];
  for (const row of html.split(/<tr\s/).slice(1)) {
    const id = /omr\/sets\/(\d+)/.exec(row)?.[1];
    const cell = (column: string) =>
      /fi-size-sm">([^<]*)</.exec(
        row.slice(row.indexOf(`column.${column}"`) >= 0 ? row.indexOf(`column.${column}"`) : 0),
      )?.[1];
    const number = cell('number');
    const name = cell('name');
    const theme = cell('theme.name');
    const year = cell('year');
    if (id && number && name && theme && year)
      sets.push({
        id: Number(id),
        number: decode(number).trim(),
        name: decode(name).trim(),
        theme: decode(theme).trim(),
        year: Number(year),
      });
  }
  const total = Number(/of ([\d,]+) results/.exec(html)?.[1]?.replace(/,/g, '') ?? sets.length);
  return { sets, total };
}

/** The set page's main model download, skipping alternate and sub-models. */
export function mainModelUrl(html: string, setNumber: string): string | undefined {
  const urls = [
    ...html.matchAll(/https:\/\/library\.ldraw\.org\/media\/omr_models\/\d+\/[^"?]+\.(?:mpd|ldr)/g),
  ]
    .map((m) => m[0])
    .filter((url) => !/B-Model|C-Model|Alternate|Sub/i.test(url));
  return urls.find((url) => url.includes(`/${setNumber}.`)) ?? urls[0];
}

async function buildIndex(dir: string): Promise<OmrSet[]> {
  const all = new Map<number, OmrSet>();
  let total = Infinity;
  for (let page = 1; all.size < total; page++) {
    const { sets, total: found } = parseSetList(await fetchText(`${BASE}/omr/sets?page=${page}`));
    total = found;
    if (!sets.length) break;
    for (const set of sets) all.set(set.id, set);
    console.log(`page ${page}: ${all.size}/${total}`);
    await sleep(DELAY_MS);
  }
  const list = [...all.values()];
  await writeFile(join(dir, 'index.json'), `${JSON.stringify(list, null, 1)}\n`);
  return list;
}

export async function readIndex(dir: string): Promise<OmrSet[]> {
  return JSON.parse(await readFile(join(dir, 'index.json'), 'utf8')) as OmrSet[];
}

async function getSet(dir: string, set: OmrSet): Promise<void> {
  const out = join(dir, 'models', `${set.number}.mpd`);
  if (existsSync(out)) return;
  const page = await fetchText(`${BASE}/omr/sets/${set.id}`);
  await sleep(DELAY_MS);
  const url = mainModelUrl(page, set.number);
  if (!url) {
    console.warn(`${set.number}: no model link`);
    return;
  }
  const model = await fetchText(url);
  await writeFile(out, model);
  console.log(`${set.number} ${set.name} (${(model.length / 1024).toFixed(0)} KB)`);
  await sleep(DELAY_MS);
}

/** Themes and names the technique notes sample, by topic. */
export const TOPIC_SELECTORS: Record<string, { theme: RegExp; name?: RegExp }> = {
  modular: { theme: /Modular Buildings/ },
  medieval: { theme: /Castle|Medieval|Kingdoms|Knights/ },
  western: { theme: /Western|Lone Ranger/ },
  architecture: { theme: /Architecture/ },
  town: {
    theme: /Town|Creator Expert|Icons/,
    name: /Shop|Store|Cafe|Café|Market|Station|Bakery|Hotel|House|Fire|Police|Bank/i,
  },
  vehicles: {
    theme: /Speed Champions|Train|Creator|Icons|Town/,
    name: /Truck|Car|Train|Locomotive|Bus|Van|Wagon|Boat|Ship|Plane|Tractor/i,
  },
};

async function main(args: string[]) {
  const dir = resolve('data/omr');
  await mkdir(join(dir, 'models'), { recursive: true });
  const [command, ...rest] = args;
  if (command === 'index') {
    await buildIndex(dir);
    return;
  }
  const index = existsSync(join(dir, 'index.json')) ? await readIndex(dir) : await buildIndex(dir);
  if (command === 'get') {
    for (const number of rest) {
      const set = index.find((entry) => entry.number === number || entry.number === `${number}-1`);
      if (set) await getSet(dir, set);
      else console.warn(`${number}: not in the repository`);
    }
    return;
  }
  if (command === 'topics') {
    const chosen = new Map<string, OmrSet>();
    for (const selector of Object.values(TOPIC_SELECTORS))
      for (const set of index)
        if (selector.theme.test(set.theme) && (!selector.name || selector.name.test(set.name)))
          chosen.set(set.number, set);
    console.log(`${chosen.size} sets`);
    for (const set of chosen.values()) await getSet(dir, set);
    return;
  }
  console.error('Usage: omr-fetch index | get <set>... | topics');
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
