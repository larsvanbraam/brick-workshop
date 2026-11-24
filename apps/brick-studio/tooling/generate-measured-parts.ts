/**
 * Adds the parts official sets use most that the catalogue lacks. It ranks the designs in
 * Rebrickable's inventories (structural categories only), skips what the engine has, measures each
 * remaining part from its LDraw mesh (`measure-part.ts`) and writes entries for the catalogue:
 *
 *   node apps/brick-studio/tooling/generate-measured-parts.ts [count] [skip-list.json]   (default skip list: tooling/measured-parts-skip.json)
 *
 * Output: packages/brick-engine/src/measured-parts.ts (the parts and what they are for). The parts
 * are rigid pieces that stand on their studs, with envelopes, stud cells and side studs measured
 * from the mesh; clips, handles, hinges and sockets are not modelled as grips. A skip list of ids
 * (failures the envelope test or a person found) keeps them out on the next run.
 */
import { createReadStream, existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { parse } from 'csv-parse';
import { PARTS } from '../../../packages/brick-engine/src/core.ts';
import { MEASURED_PARTS } from '../../../packages/brick-engine/src/measured-parts.ts';
import { DEFAULT_PART_COLOR_EVIDENCE } from '../../../packages/brick-engine/src/part-color-evidence.ts';
import { describe, measure } from './measure-part.ts';
import { createCanonical, suffixRelationships, toRebrickablePart } from './rebrickable-report.ts';

const NOT_STRUCTURE =
  /^(Minifig|Technic|Stickers|Electric|Duplo|Mechanical|Non-LEGO|Bulk|Magnet|Pneumatic|Tools|Containers|Plants|Animals|Baseplates|Windows|Wheels|Tyres|Hinges|Train|Transportation|Vehicle|Panels|Cockpit|Rock|Brick Round|Large Figure|Flags|Hose|String|Bar)/i;
const SKIP_NAME =
  /Hinge|Technic|Minifig|Sticker|Wheel|Tyre|Tire|Train|Ball|Pin Hole|with Pin|Pin on|Towball|Crosshole|Axle|Socket|Turntable|Magnet|Spring|Chain|Motor|Rubber|Flexible|Hose|String|Cloth|Flag|Antenna|Propeller|Rotor|Lever|Handle Bar|Cylinder|Dish|Cone|Bar |Window|Door|Windscreen|Arch|Minifigure|Hair|Torso|Pr\d|Print|Pattern| Dual |Stud on Side|Duplo|Quatro|Mold|Moulded|Tube|Tank|Plant|Animal/i;

/**
 * Windows, door frames and window panels, taken by id because the name filter and the structural
 * categories leave this whole family out. They are whole pieces (frame, lattice or panes in one
 * mould) that stand on their studs; hinged leaves, shutters and the panes that hang on pins are
 * not here, since their offsets need measuring against a frame.
 */
const WINDOW_PARTS = [
  '90195',
  '60032',
  '61345',
  '4132',
  '51239',
  '73878',
  '2377',
  '4863',
  '6798',
  '5260',
  '5259',
  '42205',
  '6154',
  '60599',
  '4130',
  '28327',
  '3417',
  '4071',
  '6235',
  '6236',
  '60808',
  '30246',
  '4444',
  '48490',
  '15627',
  '30288',
  '22387',
  '3081a',
  '3081b',
  '31a',
  '31b',
  '3087a',
  '3087b',
  '29a',
  '29b',
  '27a',
  '27b',
];

/**
 * Glass and panes that hang in a frame, with where the piece's own origin sits against the
 * frame's (LDU, LDraw axes: y down), taken from the OMR models that use both and from the meshes
 * (a pane whose box matches its frame's glass shares the frame's origin). None means the same origin.
 */
const GLASS_FOR: Readonly<
  Record<string, { frame: string; delta?: readonly [number, number, number] }>
> = {
  '4862': { frame: '2377' },
  '3082': { frame: '3081b' },
  '848': { frame: '31b' },
  '845': { frame: '29b' },
  '846': { frame: '27b' },
  '844': { frame: '3087b' },
  // Latticed pane for the 1 x 2 x 2 frame: its box is the glass's.
  '38320': { frame: '60592' },
  // The rounded-top panes sit 24 LDU lower and 4 behind their frame's origin (6755, 10185 ...).
  '30045': { frame: '30044', delta: [0, 24, -4] },
  '30046': { frame: '30044', delta: [0, 24, -4] },
  // Opening glass for the 1 x 4 x 3 frame: 8 LDU down, 3 in front (10218).
  '60603': { frame: '60594', delta: [0, 8, 3] },
};

async function readCsv(file: string, onRow: (row: Record<string, string>) => void) {
  const parser = parse({ bom: true, columns: true, skip_empty_lines: true });
  const done = pipeline(createReadStream(file), createGunzip(), parser);
  for await (const row of parser as AsyncIterable<Record<string, string>>) onRow(row);
  await done;
}

/** What a part is for, in a builder's words, from its name. */
function usesOf(name: string, family: 'detail' | 'window' = 'detail'): string {
  const n = name.toLowerCase();
  const parts: string[] = [];
  if (family === 'window')
    return /glass/.test(n)
      ? `glazing: sits in its frame (${name})`
      : /pane/.test(n)
        ? `lattice and barred panes for window frames, cottage and castle windows (${name})`
        : /door frame/.test(n)
          ? `door openings, entrances, gateways, shop fronts (${name})`
          : `windows, lattice and glazed openings, facades, arched wall panels (${name})`;
  if (/bracket/.test(n))
    parts.push('side studs, SNOT, sills, signs, shelves, shop fronts, hanging detail');
  if (/clip/.test(n)) parts.push('clips, rails, lamp and detail mounts (not gripping yet)');
  if (/handle|rail/.test(n)) parts.push('handles, rails, doors, drawers, grab bars');
  if (/jumper|2 studs|only 2/.test(n)) parts.push('half-stud offsets, centred detail');
  if (/wedge/.test(n)) parts.push('angled corners, wings, tapered ends, pointed roofs');
  if (/curved/.test(n)) parts.push('curved edges, domes, rounded roofs, arched detail');
  if (/sloped|slope/.test(n)) parts.push('roofs, sloped walls, ramps');
  if (/corner/.test(n)) parts.push('corners, bays, angled walls');
  if (/round|circle/.test(n)) parts.push('round detail, lamps, barrels, ornaments');
  if (/tile/.test(n)) parts.push('smooth tops, paths, trim, sills');
  if (/grille|groove|log|masonry|palisade/.test(n)) parts.push('wall texture, grilles, vents');
  if (/plate/.test(n)) parts.push('layers, bands, floors, detail on studs');
  if (/brick/.test(n)) parts.push('walls, textured courses, special shapes');
  return (
    (parts.length ? parts.slice(0, 3).join('; ') : 'detail, trim, special shapes') + ` (${name})`
  );
}

async function main(count: number, skipFile?: string) {
  const dir = resolve('data');
  const csv = (name: string) => join(dir, `${name}.csv.gz`);
  const skip = new Set<string>(
    skipFile && existsSync(skipFile) ? JSON.parse(await readFile(skipFile, 'utf8')) : [],
  );

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
  const byDesign = new Map<string, number>();
  const byRaw = new Map<string, Map<string, number>>();
  await readCsv(csv('inventory_parts'), (r) => {
    if (!inventory.has(Number(r.inventory_id)) || r.is_spare === 'True') return;
    const info = parts.get(r.part_num);
    if (!info || NOT_STRUCTURE.test(categories.get(info.category) ?? '')) return;
    const design = canonical(r.part_num);
    const quantity = Number(r.quantity);
    byDesign.set(design, (byDesign.get(design) ?? 0) + quantity);
    const raw = byRaw.get(design) ?? byRaw.set(design, new Map()).get(design)!;
    raw.set(r.part_num, (raw.get(r.part_num) ?? 0) + quantity);
  });

  const mapped = DEFAULT_PART_COLOR_EVIDENCE.mappings.parts;
  // Only the hand-made catalogue counts as present: the measured parts are what this regenerates.
  const measuredIds = new Set(MEASURED_PARTS.map((part) => part.id));
  const handMade = PARTS.filter((part) => !measuredIds.has(part.id));
  const have = new Set(
    handMade.map((part) => canonical(toRebrickablePart(part.id, mapped, parts))),
  );
  const haveIds = new Set(handMade.map((part) => part.id));
  const library = resolve('data/ldraw');
  const ranked = [...byDesign]
    .sort((a, b) => b[1] - a[1])
    .filter(([design]) => !have.has(design))
    .slice(0, count);

  const out: string[] = [];
  const uses: string[] = [];
  const skipped: string[] = [];
  const insertFrames: string[] = [];
  const emit = (
    id: string,
    name: string,
    family: 'detail' | 'window',
    glass?: { frame: string; delta?: readonly [number, number, number] },
  ) => {
    const glassFrame = glass?.frame;
    let data: ReturnType<typeof describe>;
    try {
      // Glass and panes take their frame's size and origin, as the hand-made glass does: the
      // frame's groove holds them, and their own mesh is smaller than the opening.
      data = describe(measure((glassFrame ?? id).toLowerCase(), library));
    } catch {
      return false;
    }
    // A hand-made frame may stand turned from its mesh (1 x 2 for a 2 x 1 mesh): the glass follows it.
    const handFrame = glassFrame ? handMade.find((part) => part.id === glassFrame) : undefined;
    let rotation = 0;
    if (handFrame) {
      rotation = handFrame.ldrawRotation;
      data = {
        ...data,
        width: handFrame.width,
        depth: handFrame.depth,
        height: handFrame.height,
        ldrawCenter: handFrame.ldrawCenter ?? { x: 0, z: 0 },
        ldrawBaseY: handFrame.ldrawBaseY ?? handFrame.height * 8,
      };
    }
    const half = (v: number) => Math.abs(v * 2 - Math.round(v * 2)) < 1e-6;
    // Meshes run a hair off the plate grid (1.94, 1.99, 2.25): snap what is within a rounding of it.
    if (glass?.delta) {
      // The piece's origin sits `delta` from the frame's, so the frame's centre and base move by it.
      const [dx, dy, dz] = glass.delta;
      data = {
        ...data,
        ldrawCenter: { x: data.ldrawCenter.x - dx, z: data.ldrawCenter.z - dz },
        ldrawBaseY: Math.round((data.ldrawBaseY - dy) * 100) / 100,
      };
    }
    // A window frame's height is whole bricks; its mesh can run half a plate over (18.5 for 18).
    const snapped =
      family === 'window' ? Math.floor(data.height + 0.08) : Math.round(data.height * 2) / 2;
    if (Math.abs(data.height - snapped) <= (family === 'window' ? 0.6 : 0.08) && snapped > 0)
      data = { ...data, height: snapped };
    if (
      !half(data.width) ||
      !half(data.depth) ||
      data.width > 12 ||
      data.depth > 12 ||
      data.height <= 0 ||
      data.height > (family === 'window' ? 21 : 15) ||
      !half(data.height)
    )
      return false;
    const kind = data.height < 3 ? 'plate' : 'brick';
    const base =
      data.ldrawBaseY !== Math.round(data.height * 8 * 100) / 100
        ? `, ldrawBaseY: ${data.ldrawBaseY}`
        : '';
    const centre =
      data.ldrawCenter.x || data.ldrawCenter.z
        ? `, ldrawCenter: { x: ${data.ldrawCenter.x}, z: ${data.ldrawCenter.z} }`
        : '';
    const sides = data.sideStuds.length ? `, sideStuds: ${JSON.stringify(data.sideStuds)}` : '';
    // Plates sit on their own stud cells; everything else on its whole footprint.
    const cells = (list: { x: number; z: number }[]) => JSON.stringify(list).replace(/"/g, '');
    const footprint: { x: number; z: number }[] = [];
    for (let z = 0; z < Math.ceil(data.depth); z++)
      for (let x = 0; x < Math.ceil(data.width); x++) footprint.push({ x, z });
    const bottom =
      data.bottom.length && (kind === 'plate' || data.sideStuds.length)
        ? data.top.length
          ? data.top
          : data.bottom
        : footprint;
    // Glass holds and receives nothing: its frame's groove holds it.
    const top = glassFrame ? '[]' : cells(data.top);
    const receivers = glassFrame ? '[]' : cells(bottom);
    out.push(
      `  { id: '${id.toLowerCase()}', name: ${JSON.stringify(name)}, width: ${data.width}, depth: ${data.depth}, height: ${data.height}, kind: '${kind}', family: '${family}', shape: 'detail', clearance: 'reserved', ldrawRotation: ${rotation}, connections: { topStuds: ${top}, bottomReceivers: ${receivers} }${centre}${base}${sides} },`,
    );
    uses.push(`  '${id.toLowerCase()}': ${JSON.stringify(usesOf(name, family))},`);
    if (glassFrame) insertFrames.push(`  '${id.toLowerCase()}': '${glassFrame}',`);
    return true;
  };
  for (const [design] of ranked) {
    // The inventory's own number for the design that has an LDraw file, most used first.
    const raws = [...byRaw.get(design)!].sort((a, b) => b[1] - a[1]).map(([raw]) => raw);
    const id = raws.find((raw) => existsSync(join(library, 'parts', `${raw.toLowerCase()}.dat`)));
    const name = id ? parts.get(id)!.name : design;
    if (
      !id ||
      haveIds.has(id) ||
      skip.has(id) ||
      SKIP_NAME.test(name) ||
      /pr\d|pat\d|^u\d/i.test(id) ||
      !emit(id, name, 'detail')
    )
      skipped.push(`${design}${id ? `/${id}` : ''}`);
  }
  // Windows and their glass, by id (not subject to the structural filters).
  for (const [id, glassFor] of [
    ...WINDOW_PARTS.map((id) => [id, undefined] as const),
    ...Object.entries(GLASS_FOR),
  ]) {
    const header = (await readFile(join(library, 'parts', `${id}.dat`), 'utf8').catch(() => ''))
      .split(/\r?\n/)[0]
      ?.replace(/^0\s*/, '')
      .replace(/^~/, '');
    const name = parts.get(id)?.name ?? (header || id);
    if (haveIds.has(id) || skip.has(id) || !emit(id, name, 'window', glassFor)) skipped.push(id);
  }
  const text = `import type { Part } from './core.ts';

/**
 * Parts official sets use that the hand-made catalogue lacked, measured from their LDraw meshes
 * by apps/brick-studio/tooling/generate-measured-parts.ts: envelope, stud cells and side studs.
 * They are rigid pieces that stand on their studs; clips, handles and sockets do not grip. Do
 * not edit by hand: regenerate, and put a bad part's id in the skip list.
 */
export const MEASURED_PARTS: readonly Part[] = [
${out.join('\n')}
];

/** Glass that sits in a frame, and the frame it fits (merged into INSERT_FRAME_PARTS). */
export const MEASURED_INSERT_FRAMES: Readonly<Record<string, string>> = {
${insertFrames.join('\n')}
};

/** What each measured part is for, in a builder's words (see part-uses.ts). */
export const MEASURED_PART_USES: Readonly<Record<string, string>> = {
${uses.join('\n')}
};
`;
  await writeFile(resolve('packages/brick-engine/src/measured-parts.ts'), text);
  console.log(`${out.length} parts written; skipped ${skipped.length}`);
}

main(
  Number(process.argv[2] ?? 300),
  process.argv[3] ?? 'apps/brick-studio/tooling/measured-parts-skip.json',
).catch((error) => {
  console.error(error);
  process.exit(1);
});
