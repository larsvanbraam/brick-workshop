import { getConnectionSites, getPart } from '../core.ts';
import type { Rotation } from '../core.ts';
import type { ExampleBrickAdder } from './types.ts';

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);

/** Small seeded random numbers, so every tree grows the same way each time. */
export function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Crown bricks, largest first, with the cells each covers at either quarter turn. */
const CROWN_BRICKS = ['3001', '3002', '3003', '3010', '3622', '3004', '3005'].flatMap((partId) => {
  const { width, depth } = getPart(partId);
  return (width === depth ? [0] : [0, 90]).map((rotation) => ({
    partId,
    rotation: rotation as Rotation,
    width: rotation ? depth : width,
    depth: rotation ? width : depth,
  }));
});

/**
 * A broadleaf tree: a thick round trunk with branches reaching into a lumpy crown of bricks,
 * built up course by course as the union of a main mass and a few smaller clumps round it, so
 * no two trees match. Each brick holds onto the course below; the crown is darker underneath and
 * catches the light on top, where leaf sprigs break up its outline.
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
) {
  const next = random(seed * 7919 + 17);
  for (let course = 0; course <= trunk; course++)
    add('3941', bark, x - 1, base + course * 3, z - 1);
  // Clumps as [x, height, z, radius] in studs from the foot of the crown on the trunk's axis.
  const courses = 6 + Math.round(next());
  const clumps = [
    [0, courses * 0.6, 0, 3.4 + next() * 0.5],
    ...Array.from({ length: 4 }, (_, index) => {
      const angle = (index / 4 + next() * 0.2) * Math.PI * 2;
      const out = 1.6 + next() * 0.9;
      return [
        Math.cos(angle) * out,
        courses * (0.45 + next() * 0.4),
        Math.sin(angle) * out,
        1.9 + next() * 0.8,
      ];
    }),
  ];
  const inCrown = (u: number, course: number, v: number) =>
    Math.abs(u + 0.5) <= 4 &&
    Math.abs(v + 0.5) <= 4 &&
    clumps.some(
      ([cx, cy, cz, radius]) =>
        Math.hypot(u + 0.5 - cx, ((course + 0.5) * 1.2 - cy) * 1.1, v + 0.5 - cz) < radius,
    );
  const key = (u: number, v: number) => `${u},${v}`;
  // The trunk carries the crown's first course, two branches reach out into it.
  const stem = [key(-1, -1), key(0, -1), key(-1, 0), key(0, 0)];
  let below = new Set(stem);
  const tops = new Map<string, number>();
  const branches = new Set(
    [
      [-3, -1],
      [-2, -1],
      [1, 0],
      [2, 0],
      [-1, 1],
      [-1, 2],
      [0, -2],
      [0, -3],
    ].map(([u, v]) => key(u, v)),
  );
  for (let course = 0; course < courses; course++) {
    const y = base + (trunk + 1 + course) * 3;
    const cells = new Map<string, readonly [number, number]>();
    for (let u = -4; u < 4; u++)
      for (let v = -4; v < 4; v++)
        if (inCrown(u, course, v) || (course === 0 && below.has(key(u, v))))
          cells.set(key(u, v), [u, v]);
    const placed = new Set<string>();
    // Outer cells first, so their bricks reach in to the course below rather than being cut off.
    const order = [...cells.values()]
      .map(([u, v]) => ({ u, v, reach: Math.hypot(u + 0.5, v + 0.5) + next() * 0.8 }))
      .sort((first, second) => second.reach - first.reach);
    for (const { u, v } of order) {
      if (placed.has(key(u, v))) continue;
      const candidates = CROWN_BRICKS.flatMap((brick) =>
        Array.from({ length: brick.width * brick.depth }, (_, index) => {
          const u0 = u - (index % brick.width);
          const v0 = v - Math.floor(index / brick.width);
          const covered = Array.from({ length: brick.width * brick.depth }, (_, cell) =>
            key(u0 + (cell % brick.width), v0 + Math.floor(cell / brick.width)),
          );
          return { brick, u0, v0, covered };
        }),
      ).filter(
        ({ covered }) =>
          covered.every((cell) => cells.has(cell) && !placed.has(cell)) &&
          covered.some((cell) => below.has(cell)),
      );
      if (!candidates.length) continue;
      const best = Math.max(...candidates.map(({ covered }) => covered.length));
      const choices = candidates.filter(({ covered }) => covered.length === best);
      const { brick, u0, v0, covered } = choices[Math.floor(next() * choices.length)];
      for (const cell of covered) placed.add(cell);
      const underside = covered.filter((cell) => !below.has(cell)).length * 2 > covered.length;
      const exposed = covered.some((cell) => {
        const [cu, cv] = cells.get(cell)!;
        return !inCrown(cu, course + 1, cv);
      });
      const color =
        course === 0 && covered.every((cell) => stem.includes(cell) || branches.has(cell))
          ? bark
          : underside || course === 0
            ? shade
            : exposed && next() < 0.55
              ? light
              : next() < 0.2
                ? shade
                : body;
      add(brick.partId, color, x + u0, y, z + v0, brick.rotation);
    }
    for (const cell of placed) tops.set(cell, y + 3);
    below = placed;
  }
  // A couple of leaf sprays lie across the crown's highest courses, held by their stem stud,
  // each wholly over the crown and nothing of it higher, so the top reads as layered leaves.
  const sprigged = new Set<string>();
  let sprays = 0;
  for (const [cell, top] of [...tops].sort(([, first], [, second]) => second - first)) {
    if (sprays === 2) break;
    if (next() > 0.5) continue;
    const [u, v] = cell.split(',').map(Number);
    const rotation = ([0, 90, 180, 270] as const)[Math.floor(next() * 4)];
    const probe = { id: '', partId: '2423', color: 0, x: 0, y: 0, z: 0, rotation };
    const receiver = getConnectionSites(probe, 'bottom')[0];
    const [u0, v0] = [u - (receiver.x - 0.5), v - (receiver.z - 0.5)];
    const [width, depth] = rotation % 180 ? [4, 3] : [3, 4];
    const footprint = range(0, width - 1).flatMap((du) =>
      range(0, depth - 1).map((dv) => key(u0 + du, v0 + dv)),
    );
    if (
      footprint.some((other) => sprigged.has(other) || !tops.has(other) || tops.get(other)! > top)
    )
      continue;
    for (const other of footprint) sprigged.add(other);
    add('2423', next() < 0.5 ? light : body, x + u0, top, z + v0, rotation);
    sprays++;
  }
  // Leaf sprigs on the studs left bare on top, where nothing higher would cover them.
  for (const [cell, top] of tops) {
    if (next() > 0.4) continue;
    const [u, v] = cell.split(',').map(Number);
    const rotation = ([0, 90, 180, 270] as const)[Math.floor(next() * 4)];
    const receiver = getConnectionSites(
      { id: '', partId: '32607', color: 0, x: 0, y: 0, z: 0, rotation },
      'bottom',
    )[0];
    const [u0, v0] = [u - (receiver.x - 0.5), v - (receiver.z - 0.5)];
    const footprint = [0, 1].flatMap((du) => [0, 1].map((dv) => key(u0 + du, v0 + dv)));
    if (footprint.some((other) => sprigged.has(other) || (tops.get(other) ?? 0) > top)) continue;
    for (const other of footprint) sprigged.add(other);
    add('32607', next() < 0.6 ? light : body, x + u0, top, z + v0, rotation);
  }
}
