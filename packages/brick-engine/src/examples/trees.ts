import { footprint, getConnectionSites } from '../core.ts';
import type { Rotation } from '../core.ts';
import type { ExampleBrickAdder } from './types.ts';

/** Small seeded random numbers, so every tree grows the same way each time. */
export function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);
const TURNS = [0, 90, 180, 270] as const satisfies readonly Rotation[];
/** Leaf pieces the crown is draped with, largest first. */
const LEAVES = ['2417', '2423'] as const;
/** How far the crown's sprays may reach from the trunk's axis, in studs. */
const GRID = 10;

/** A piece's box: x and z (or u and v round a tree's trunk) in studs, y in plates. */
export interface Box {
  readonly u0: number;
  readonly u1: number;
  readonly v0: number;
  readonly v1: number;
  readonly y0: number;
  readonly y1: number;
}

const shapes = new Map<string, ReturnType<typeof measure>>();
function measure(partId: string, rotation: Rotation) {
  const probe = { id: '', partId, color: 0, x: 0, y: 0, z: 0, rotation };
  const { width, depth, height } = footprint(probe);
  const cells = (surface: 'top' | 'bottom') =>
    getConnectionSites(probe, surface).map(({ x, z }) => [x - 0.5, z - 0.5] as const);
  return { width, depth, height, studs: cells('top'), receivers: cells('bottom') };
}

/** A piece's box and its top studs and bottom receivers as cells, placed at the origin. */
function shape(partId: string, rotation: Rotation) {
  const id = `${partId}@${rotation}`;
  let found = shapes.get(id);
  if (!found) shapes.set(id, (found = measure(partId, rotation)));
  return found;
}

/**
 * A broadleaf tree like the ones in the castle sets. A tall round trunk stands on a green plate,
 * flaring out into roots stepped down from it in plates and cheese slopes, with round bushes
 * round the plate's edge. Its crown is layers of leaf sprays, each layer hung on its own
 * branches, two plates crossed on the trunk, and two sheets thick. Each sheet's sprays are laid
 * one at a time where they cover the most of its lumpy, roughly round outline still bare, held
 * by studs of the branches, of the sprays below or of a short stalk on a firmly held spray, so
 * they overlap like leaves. The lowest sprays are the darkest, the highest catch the light, and
 * sprigs and buds dot the studs left bare on top. A seed varies the outline, lean and fill.
 */
export function addTree(
  add: ExampleBrickAdder,
  x: number,
  z: number,
  base: number,
  [shade, body, light]: readonly [number, number, number],
  bark: number,
  trunk: number,
  seed: number,
  /**
   * What already stands round the tree, in world studs, so its leaves grow round it. The tree
   * adds its own pieces, so trees grown in turn with one list leave room for each other.
   */
  around: Box[] = [],
  /**
   * The tree's form. Without a foot the trunk stands straight on the base, like a street tree
   * in a pit; radii give each crown layer's reach in studs, lowest first, for a smaller crown.
   */
  { foot = true, radii: layerRadii }: { foot?: boolean; radii?: readonly number[] } = {},
) {
  const next = random(seed * 7919 + 17);
  const boxes: Box[] = [];
  const studs = new Set<string>();
  // Studs of pieces held firmly, by the structure or by two or more studs, which may carry a
  // stalk and the spray on it without one stud bearing a long chain.
  const firm = new Set<string>();
  const key = (y: number, u: number, v: number) => `${y}:${u}:${v}`;
  const world = ({ u0, u1, v0, v1, y0, y1 }: Box): Box => ({
    u0: x + u0,
    u1: x + u1,
    v0: z + v0,
    v1: z + v1,
    y0,
    y1,
  });
  // What is taken, as world cells a stud by a stud by a plate, within the crown's reach: what
  // stands round the tree, then its own pieces as they are laid. Pieces off the grid take every
  // cell they touch.
  const REACH = 12;
  const taken = new Set<string>();
  const cells = (box: Box, visit: (cell: string) => boolean | void) => {
    for (
      let u = Math.max(Math.floor(box.u0), x - REACH);
      u < Math.min(Math.ceil(box.u1), x + REACH);
      u++
    )
      for (
        let v = Math.max(Math.floor(box.v0), z - REACH);
        v < Math.min(Math.ceil(box.v1), z + REACH);
        v++
      )
        for (let y = Math.floor(box.y0); y < Math.ceil(box.y1); y++)
          if (visit(`${u},${v},${y}`) === false) return false;
    return true;
  };
  for (const box of around) cells(box, (cell) => void taken.add(cell));
  const fits = (box: Box) => cells(world(box), (cell) => !taken.has(cell));
  const boxOf = (partId: string, rotation: Rotation, u: number, y: number, v: number): Box => {
    const { width, depth, height } = shape(partId, rotation);
    return { u0: u, u1: u + width, v0: v, v1: v + depth, y0: y, y1: y + height };
  };
  // Positions are in studs from the corner the trunk stands round, its four studs at -1 and 0.
  const place = (
    partId: string,
    color: number,
    u: number,
    y: number,
    v: number,
    rotation: Rotation = 0,
    carries = true,
    steady = true,
  ) => {
    const box = boxOf(partId, rotation, u, y, v);
    boxes.push(box);
    cells(world(box), (cell) => void taken.add(cell));
    around.push(world(box));
    if (carries)
      for (const [su, sv] of shape(partId, rotation).studs) {
        studs.add(key(box.y1, u + su, v + sv));
        if (steady) firm.add(key(box.y1, u + su, v + sv));
      }
    add(partId, color, x + u, y, z + v, rotation);
    return box;
  };

  // The foot: a green plate with round bushes round its edge, and the trunk standing in the
  // middle on a stepped flare of roots.
  const ground = foot ? base + 1 : base;
  // The trunk stands tall and bare below the crown.
  const courses = foot ? trunk + 3 : trunk;
  if (foot) place('3958', shade, -3, base, -3);
  for (let course = 0; course < courses; course++) place('3941', bark, -1, ground + course * 3, -1);
  if (foot) {
    // Each side steps down from the trunk to the plate: a stack of plates capped with a cheese
    // slope against the trunk, then a lower cheese slope outside it, so the foot flares out low
    // and wide like roots. Positions are the side's outer row, its inner row, and the quarter
    // turn that faces each slope's high end into the trunk.
    for (const [outer, inner, rotation] of [
      [[-1, -3], [-1, -2], 0],
      [[-1, 2], [-1, 1], 180],
      [[-3, -1], [-2, -1], 90],
      [[2, -1], [1, -1], 270],
    ] as const) {
      const across = rotation % 180 === 0;
      place('3022', bark, Math.min(outer[0], inner[0]), ground, Math.min(outer[1], inner[1]));
      place('85984', bark, outer[0], ground + 1, outer[1], rotation);
      for (const rise of [1, 2])
        place('3023b', bark, inner[0], ground + rise, inner[1], across ? 90 : 0);
      place('85984', bark, inner[0], ground + 3, inner[1], rotation);
    }
    for (const u of range(-3, 2))
      for (const v of range(-3, 2)) {
        if (next() < 0.1) continue;
        if (!fits({ u0: u, u1: u + 1, v0: v, v1: v + 1, y0: ground, y1: ground + 3 })) continue;
        const roll = next();
        place('3062b', roll < 0.35 ? shade : roll < 0.8 ? body : light, u, ground, v);
        if (next() < 0.3) place('6141', next() < 0.5 ? light : body, u, ground + 3, v, 0, false);
      }
  }

  // The crown: a layer every three plates, each hung on its own branches, two plates crossed
  // on the trunk and turned against the layer below, with a round plate on top carrying the
  // trunk on up to the next.
  const crown = ground + courses * 3;
  const profile = layerRadii ?? [4, 4.5, 4.6, 4.1, 3.3, 2.2];
  const layers = profile.length;
  const sheets = 2;
  // Sprays may also stand on short stalks, one round plate high, on the layer below.
  const STALK = 1;
  const spacing = sheets + STALK;
  const first = crown + 1;
  for (let layer = 0; layer < layers; layer++) {
    const y = crown + layer * spacing;
    // Long branches only where the layer reaches far enough to hide them.
    const [arm, reach] =
      layer < layers - 2 && profile[layer] >= 4 ? (['3795', 3] as const) : (['3020', 2] as const);
    const across = (layer + Math.floor(next() * 2)) % 2 === 0;
    // Only the lowest branches show brown; higher up they sit in the leaves' shade, and the
    // topmost, open to the sky, are leaf green.
    const wood = layer === 0 ? bark : layer === layers - 1 ? body : shade;
    place(arm, wood, across ? -reach : -1, y, across ? -1 : -reach, across ? 90 : 0);
    place(arm, wood, across ? -1 : -reach, y + 1, across ? -reach : -1, across ? 0 : 90);
    if (layer < layers - 1) place('4032a', layer < 2 ? bark : shade, -1, y + 2, -1);
  }

  // Each layer's outline: wide low down, narrowing to a dome, with lobes round it so the crown
  // is lumpy rather than round or square, and leaning a little off the trunk.
  const grow = 0.92 + next() * 0.16;
  const [cu, cv] = [(next() - 0.5) * 0.4, (next() - 0.5) * 0.4];
  const lobes = [next() * Math.PI * 2, next() * Math.PI * 2];
  const distance = (u: number, v: number) => {
    const [du, dv] = [u + 0.5 - cu, v + 0.5 - cv];
    const angle = Math.atan2(dv, du);
    const wobble =
      1 + 0.07 * Math.sin(3 * angle + lobes[0]) + 0.05 * Math.sin(5 * angle + lobes[1]);
    return Math.hypot(du, dv) / wobble;
  };
  const radii = profile.map((radius) => radius * grow + next() * 0.3);

  // Leaf sprays laid a layer at a time, each where it covers the most of the layer's outline
  // still bare. A spray sits on the trunk or branches, or on a round plate standing on a
  // firmly held spray of the layer below, like the stalks of a set's tree.
  const laid = new Set<string>();
  for (let sheet = 0; sheet < layers * sheets; sheet++) {
    // Each layer is a few sheets thick, the later ones lying on the studs of the first.
    const layer = Math.floor(sheet / sheets);
    const level = first + layer * spacing + (sheet % sheets);
    const radius = radii[layer] - (sheet % sheets) * 0.5;
    // What the sheet should cover: its outline, branches included, so they end up under leaves.
    // Cells are kept in flat grids round the trunk, as the search below visits them many times.
    const SIDE = 2 * GRID;
    const cell = (u: number, v: number) => (u + GRID) * SIDE + (v + GRID);
    const bare = new Uint8Array(SIDE * SIDE);
    const outside = new Uint8Array(SIDE * SIDE);
    for (let u = -GRID; u < GRID; u++)
      for (let v = -GRID; v < GRID; v++) {
        const reach = distance(u, v);
        if (reach <= radius) bare[cell(u, v)] = 1;
        else if (reach > radius + 1.5) outside[cell(u, v)] = 1;
      }
    // Where a spray can be held: studs already at this height, or a stalk on a firm stud just
    // below.
    const stalk = (u: number, v: number) =>
      firm.has(key(level - STALK, u, v)) &&
      fits({ u0: u, u1: u + 1, v0: v, v1: v + 1, y0: level - STALK, y1: level });
    const sites = new Map<string, readonly [number, number, boolean]>();
    for (const site of studs) {
      const [sy, su, sv] = site.split(':').map(Number);
      if (sy === level) sites.set(`${su},${sv}`, [su, sv, false]);
      else if (
        sheet % sheets === 0 &&
        sy === level - STALK &&
        stalk(su, sv) &&
        !sites.has(`${su},${sv}`)
      )
        sites.set(`${su},${sv}`, [su, sv, true]);
    }
    for (;;) {
      let best:
        | {
            score: number;
            partId: string;
            rotation: Rotation;
            u: number;
            v: number;
            stalk?: readonly [number, number];
          }
        | undefined;
      for (const [su, sv, needsStalk] of sites.values()) {
        if (needsStalk && !stalk(su, sv)) continue;
        for (const partId of LEAVES)
          for (const rotation of TURNS) {
            const { width, depth, receivers } = shape(partId, rotation);
            for (const [ru, rv] of receivers) {
              const [u, v] = [su - ru, sv - rv];
              if (u < -GRID || v < -GRID || u + width > GRID || v + depth > GRID) continue;
              let gain = 0;
              let spill = 0;
              for (let du = 0; du < width; du++)
                for (let dv = 0; dv < depth; dv++) {
                  const at = cell(u + du, v + dv);
                  gain += bare[at];
                  spill += outside[at];
                }
              // Rather a spray on the branches than one needing a stalk of its own.
              let score = gain - spill * 0.8 - (needsStalk ? 1 : 0) + next() * 0.8;
              // Only a candidate that would win is worth checking for room.
              if (best && score <= best.score) continue;
              // A spray right on top of a matching one only builds a pillar of studs.
              if (laid.has(`${level - 1}:${partId}:${rotation}:${u}:${v}`)) score -= 6;
              if ((best && score <= best.score) || !fits(boxOf(partId, rotation, u, level, v)))
                continue;
              best = { score, partId, rotation, u, v, stalk: needsStalk ? [su, sv] : undefined };
            }
          }
      }
      if (!best || best.score < 1.5) break;
      if (best.stalk) {
        place('6141', shade, best.stalk[0], level - STALK, best.stalk[1], 0, true, false);
        sites.set(`${best.stalk[0]},${best.stalk[1]}`, [best.stalk[0], best.stalk[1], false]);
      }
      // Darker leaves low down and underneath, lighter ones catching the light on top.
      const h = sheet / (layers * sheets - 1);
      const roll = next();
      const color = roll < 0.45 - h * 0.45 ? shade : roll < 0.9 - h * 0.4 ? body : light;
      // A spray carries the sheet lying on it, but only one held by two studs or more is firm
      // enough for a stalk.
      const held =
        shape(best.partId, best.rotation).receivers.filter(([du, dv]) =>
          studs.has(key(level, best.u + du, best.v + dv)),
        ).length + (best.stalk ? 1 : 0);
      const box = place(best.partId, color, best.u, level, best.v, best.rotation, true, held > 1);
      laid.add(`${level}:${best.partId}:${best.rotation}:${best.u}:${best.v}`);
      for (let u = box.u0; u < box.u1; u++)
        for (let v = box.v0; v < box.v1; v++) bare[cell(u, v)] = 0;
    }
  }

  // Sprigs and round buds on the studs left bare on top, where nothing higher would cover them.
  const open = (u: number, v: number, y: number) =>
    !boxes.some((box) => u >= box.u0 && u < box.u1 && v >= box.v0 && v < box.v1 && box.y1 > y);
  // The crown's top layer is dotted more thickly, so its branches end up under leaves.
  const top = crown + (layers - 1) * spacing;
  for (const site of [...studs].sort()) {
    const [sy, su, sv] = site.split(':').map(Number);
    if (sy <= crown || !open(su, sv, sy)) continue;
    const roll = next() * (sy >= top ? 0.45 : 1);
    if (roll < 0.3) {
      const rotation = TURNS[Math.floor(next() * 4)];
      const [[ru, rv]] = shape('32607', rotation).receivers;
      const box = boxOf('32607', rotation, su - ru, sy, sv - rv);
      if (
        fits(box) &&
        [box.u0, box.u1 - 1].every((u) => [box.v0, box.v1 - 1].every((v) => open(u, v, sy)))
      )
        place('32607', next() < 0.6 ? light : body, box.u0, sy, box.v0, rotation, false);
    } else if (roll < 0.42 && fits(boxOf('6141', 0, su, sy, sv)))
      place('6141', next() < 0.5 ? light : body, su, sy, sv, 0, false);
  }
}
