/**
 * Prints small excerpts of how official sets are built, so a build can borrow a real
 * construction (a parapet, a window surround, a buttress) instead of guessing from averages.
 * Reads the LDraw models `omr:fetch` downloads into data/omr/ (git-ignored); nothing is
 * stored in the repository. Each excerpt names its set and author.
 *
 *   pnpm omr:excerpt find <part> [--radius 3] [--limit 3] [--topic architecture]
 *       where designers use a part: the studs and plates round it, per layer
 *   pnpm omr:excerpt top <set> [--layers 14]
 *       the top plates of a set: its roofline, parapet or spire
 *   pnpm omr:excerpt box <set> <x0,z0,x1,z1> [y0,y1]
 *       everything in a box of a set, in the set's own studs and plates
 *
 * Coordinates in an excerpt: x and z in studs from the excerpt's centre (the part for `find`,
 * the corner for `top` and `box`), y in plates up from its floor; `yaw` is the turn in degrees
 * about the vertical, `side` marks a part turned onto its side (SNOT), `inv` an inverted part.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { flatten, lookupPart, readHeader, readParts } from './omr-analyse.ts';
import type { PartInfo, Placed } from './omr-analyse.ts';
import { TOPIC_SELECTORS, readIndex } from './omr-fetch.ts';

const MAX_LINES = 160;

export interface Site {
  readonly set: string;
  readonly centre: Placed;
}

/** Parts within `radius` studs of a centre part and from `below` to `above` plates of it. */
export function neighbourhood(
  placed: readonly Placed[],
  centre: Placed,
  radius: number,
  below: number,
  above: number,
): Placed[] {
  return placed.filter(
    (p) =>
      Math.abs(p.x - centre.x) <= radius &&
      Math.abs(p.z - centre.z) <= radius &&
      p.y >= centre.y - below &&
      p.y <= centre.y + above,
  );
}

const orientation = (p: Placed) => (Math.abs(p.up) < 0.1 ? 'side' : p.up < -0.9 ? 'inv' : '');

/** Formats parts as layers, lowest first, sorted along x then z inside a layer. */
export function formatLayers(
  placed: readonly Placed[],
  origin: { x: number; y: number; z: number },
  parts: ReadonlyMap<string, PartInfo | null>,
): string[] {
  const rows = [...placed]
    .map((p) => ({ ...p, rx: p.x - origin.x, ry: p.y - origin.y, rz: p.z - origin.z }))
    .sort((a, b) => a.ry - b.ry || a.rx - b.rx || a.rz - b.rz);
  const lines: string[] = [];
  let layer: number | undefined;
  for (const p of rows) {
    if (p.ry !== layer) {
      layer = p.ry;
      lines.push(`y ${Math.round(layer * 10) / 10}`);
    }
    const name = (lookupPart(p.part, parts)?.name ?? '').slice(0, 54);
    lines.push(
      `  x ${p.rx.toFixed(1).padStart(5)}  z ${p.rz.toFixed(1).padStart(5)}  yaw ${String(p.yaw).padStart(3)}  ${p.part.padEnd(8)} c${String(p.color).padEnd(4)} ${orientation(p).padEnd(4)} ${name}`,
    );
  }
  return lines;
}

function option(args: string[], name: string, fallback: number): number {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? Number(args[at + 1]) : fallback;
}

async function load(dataDir: string, number: string) {
  const text = await readFile(join(dataDir, 'omr', 'models', `${number}.mpd`), 'utf8');
  return { placed: flatten(text), header: readHeader(text) };
}

const credit = (number: string, name: string, author: string, license: string) =>
  `# ${number} ${name}, by ${author} (${license}); LDraw/OMR, statistics-only repo: do not commit this output`;

async function find(dataDir: string, part: string, args: string[]) {
  const radius = option(args, 'radius', 3);
  const limit = option(args, 'limit', 3);
  const topicName = args.includes('--topic') ? args[args.indexOf('--topic') + 1] : undefined;
  const topic = topicName ? TOPIC_SELECTORS[topicName] : undefined;
  const parts = await readParts(dataDir);
  const index = await readIndex(join(dataDir, 'omr'));
  const files = (await readdir(join(dataDir, 'omr', 'models'))).map((f) => f.replace(/\.mpd$/, ''));
  let shown = 0;
  for (const number of files.sort()) {
    const set = index.find((s) => s.number === number);
    if (!set) continue;
    if (topic && (!topic.theme.test(set.theme) || (topic.name && !topic.name.test(set.name))))
      continue;
    const { placed: all, header } = await load(dataDir, number);
    const placed = all.filter((p) => lookupPart(p.part, parts));
    const hits = placed.filter((p) => p.part === part);
    if (hits.length === 0) continue;
    // The densest site: the hit with the most neighbours, so the excerpt shows a real surround.
    const best = hits
      .map((centre) => ({ centre, near: neighbourhood(placed, centre, radius, 4, 12) }))
      .sort((a, b) => b.near.length - a.near.length)[0]!;
    console.log(credit(number, set.name, header.author, header.license));
    console.log(`# ${hits.length} uses of ${part}; the excerpt is round the busiest one`);
    const lines = formatLayers(best.near, best.centre, parts).slice(0, MAX_LINES);
    console.log(lines.join('\n'), '\n');
    if (++shown >= limit) return;
  }
  if (shown === 0) console.log(`No model in data/omr uses ${part}.`);
}

async function slice(dataDir: string, number: string, pick: (placed: Placed[]) => Placed[]) {
  const parts = await readParts(dataDir);
  const index = await readIndex(join(dataDir, 'omr'));
  const { placed, header } = await load(dataDir, number);
  const chosen = pick(placed.filter((p) => lookupPart(p.part, parts)));
  if (chosen.length === 0) return console.log('Nothing in that slice.');
  const origin = {
    x: Math.min(...chosen.map((p) => p.x)),
    y: Math.min(...chosen.map((p) => p.y)),
    z: Math.min(...chosen.map((p) => p.z)),
  };
  console.log(
    credit(
      number,
      index.find((s) => s.number === number)?.name ?? '',
      header.author,
      header.license,
    ),
  );
  console.log(formatLayers(chosen, origin, parts).slice(0, MAX_LINES).join('\n'));
}

async function main(dataDir: string, args: string[]) {
  const [command, target, ...rest] = args;
  if (command === 'find' && target) return find(dataDir, target, rest);
  if (command === 'top' && target) {
    const layers = option(rest, 'layers', 14);
    return slice(dataDir, target, (placed) => {
      const top = Math.max(...placed.map((p) => p.y));
      return placed.filter((p) => p.y >= top - layers);
    });
  }
  if (command === 'box' && target && rest[0]) {
    const [x0, z0, x1, z1] = rest[0].split(',').map(Number) as [number, number, number, number];
    const [y0, y1] = (rest[1] ?? '-1e9,1e9').split(',').map(Number) as [number, number];
    return slice(dataDir, target, (placed) =>
      placed.filter(
        (p) => p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1 && p.y >= y0 && p.y <= y1,
      ),
    );
  }
  console.log('Usage: omr:excerpt find <part> | top <set> | box <set> <x0,z0,x1,z1> [y0,y1]');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(resolve('data'), process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
