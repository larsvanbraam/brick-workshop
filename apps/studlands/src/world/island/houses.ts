import { getWorldBounds } from '@brick-workshop/engine';
import type { Brick, Rotation } from '@brick-workshop/engine';

/**
 * Brick Island's houses, laid brick by brick from a small plan: bonded walls with corner quoins,
 * framed and glazed windows, an open doorway to walk through, a contrasting band between storeys
 * and a gabled roof of 45° slopes in two shades with eaves over the walls and a ridge on top.
 * Built facing +z, then turned to face their street.
 */

export type Piece = Omit<Brick, 'id'>;

export interface HousePlan {
  /** Studs along the front, even, at least 8. */
  width: number;
  /** Studs from front to back, even, at least 6. */
  depth: number;
  storeys: 1 | 2;
  /** Wall colours, the second sprinkled through the first. */
  wall: number;
  wallShade: number;
  /** The upper storey's walls, and the gables. */
  upper: number;
  /** Corner quoins and the band between storeys. */
  trim: number;
  roof: number;
  roofLight: number;
  /** Window frames. */
  frame: number;
}

const GLASS = 47;
/** Courses in a storey: the doorway is six bricks tall, with a course of wall over it. */
const STOREY = 7;
/** Window frames 1 x 2 x 3 and their glass. */
const WINDOW = '60593';
const WINDOW_GLASS = '60602';
const DOOR_FRAME = '60596';

/** Bricks to fill a run of wall, longest first, by length. */
const RUN: Record<number, string> = { 1: '3005', 2: '3004', 3: '3622', 4: '3010' };
/** Plates 1 x n by length; the catalogue has no 1 x 2 plate, so two 1 x 1s stand in. */
const PLATE: Record<number, string> = { 1: '3024', 3: '3623', 4: '3710' };

/** A run of `length` studs as plate lengths, from where each starts. */
function plateRuns(length: number): [number, number][] {
  const runs: [number, number][] = [];
  let at = 0;
  while (at < length) {
    const left = length - at;
    const size = left >= 4 ? 4 : left === 3 ? 3 : 1;
    runs.push([at, size]);
    at += size;
  }
  return runs;
}

/**
 * Where windows go along a wall of `length` studs, corners included: two studs each, a stud of
 * wall at least between them and from the corners, and clear of the door if there is one.
 */
function windowsAlong(length: number, door?: { from: number; to: number }) {
  const spots: number[] = [];
  const fits = (at: number) => !door || at + 2 <= door.from - 1 || at >= door.to + 1;
  const count = Math.floor((length - 1) / 3);
  // Spread them evenly over the wall.
  const gap = (length - 2 - count * 2) / (count + 1);
  for (let i = 0; i < count; i++) {
    const at = Math.round(1 + gap * (i + 1) + i * 2 - 1);
    if (at >= 1 && at + 2 <= length - 1 && fits(at)) spots.push(at);
  }
  return spots;
}

export function buildHouse(plan: HousePlan, next: () => number): Piece[] {
  const { width: w, depth: d } = plan;
  const pieces: Piece[] = [];
  const add = (
    partId: string,
    color: number,
    x: number,
    y: number,
    z: number,
    rotation: Rotation = 0,
  ) => pieces.push({ partId, color, x, y, z, rotation });

  // Openings by storey: which wall cells they take, from which course to which.
  const door = { from: Math.floor(w / 2) - 2, to: Math.floor(w / 2) + 2 };
  const taken = new Set<string>();
  const cell = (x: number, z: number, course: number) => `${x},${z},${course}`;

  let y = 0;
  for (let storey = 0; storey < plan.storeys; storey++) {
    const wall = storey === 0 ? plan.wall : plan.upper;
    const shade = storey === 0 ? plan.wallShade : plan.wall;
    // The openings of this storey, in courses from the storey's foot.
    const openings: {
      x: number;
      z: number;
      along: 'x' | 'z';
      part: string;
      from: number;
      to: number;
    }[] = [];
    const front = storey === 0 ? door : undefined;
    if (front)
      openings.push({ x: front.from, z: d - 1, along: 'x', part: DOOR_FRAME, from: 0, to: 6 });
    for (const at of windowsAlong(w, front)) {
      openings.push({ x: at, z: d - 1, along: 'x', part: WINDOW, from: 2, to: 5 });
      openings.push({ x: at, z: 0, along: 'x', part: WINDOW, from: 2, to: 5 });
    }
    for (const at of windowsAlong(d)) {
      openings.push({ x: 0, z: at, along: 'z', part: WINDOW, from: 2, to: 5 });
      openings.push({ x: w - 1, z: at, along: 'z', part: WINDOW, from: 2, to: 5 });
    }
    for (const opening of openings) {
      const length = opening.part === DOOR_FRAME ? 4 : 2;
      for (let course = opening.from; course < opening.to; course++)
        for (let i = 0; i < length; i++) {
          const x = opening.along === 'x' ? opening.x + i : opening.x;
          const z = opening.along === 'z' ? opening.z + i : opening.z;
          taken.add(cell(x, z, storey * STOREY + course));
        }
    }

    for (let course = 0; course < STOREY; course++) {
      const at = storey * STOREY + course;
      const base = y + course * 3;
      // Courses trade corners: the front and back walls run the full width on even courses, the
      // side walls the full depth on odd ones, so the joints overlap at the corners.
      const long = course % 2 === 0;
      type Line = { x: number; z: number; along: 'x' | 'z'; length: number };
      const lines = (
        [
          { x: 0, z: 0, along: 'x', length: w },
          { x: 0, z: d - 1, along: 'x', length: w },
          { x: 0, z: 0, along: 'z', length: d },
          { x: w - 1, z: 0, along: 'z', length: d },
        ] satisfies Line[]
      ).map((line): Line =>
        (line.along === 'x') === long
          ? line
          : line.along === 'x'
            ? { ...line, x: 1, length: w - 2 }
            : { ...line, z: 1, length: d - 2 },
      );
      for (const line of lines) {
        // Runs of wall between openings, cut into bricks staggered from the course below.
        let start = 0;
        const flush = (end: number) => {
          let i = start;
          let first = course % 2 === 1;
          while (i < end) {
            let size = Math.min(4, end - i);
            if (first && size > 2) size = 2;
            first = false;
            const x = line.along === 'x' ? line.x + i : line.x;
            const z = line.along === 'z' ? line.z + i : line.z;
            // Corners in the trim colour, as quoins: long and short by turns.
            const corner = (x === 0 || x === w - 1) && (z === 0 || z === d - 1);
            const color = corner ? plan.trim : next() < 0.14 ? shade : wall;
            const quoin = corner && size > 1 ? (course % 2 === 0 ? 2 : 1) : size;
            add(RUN[quoin], color, x, base, z, line.along === 'x' ? 90 : 0);
            i += quoin;
          }
        };
        for (let i = 0; i < line.length; i++) {
          const x = line.along === 'x' ? line.x + i : line.x;
          const z = line.along === 'z' ? line.z + i : line.z;
          if (taken.has(cell(x, z, at))) {
            flush(i);
            start = i + 1;
          }
        }
        flush(line.length);
      }
    }
    for (const opening of openings) {
      const rotation: Rotation = opening.along === 'x' ? 90 : 0;
      const oy = y + opening.from * 3;
      add(
        opening.part,
        opening.part === DOOR_FRAME ? plan.frame : plan.frame,
        opening.x,
        oy,
        opening.z,
        rotation,
      );
      if (opening.part === WINDOW) add(WINDOW_GLASS, GLASS, opening.x, oy, opening.z, rotation);
    }
    y += STOREY * 3;
    // A band of plates in the trim colour between storeys, and round the top of the walls.
    for (const [from, size] of plateRuns(w)) {
      add(PLATE[size], plan.trim, from, y, 0, 90);
      add(PLATE[size], plan.trim, from, y, d - 1, 90);
    }
    for (const [from, size] of plateRuns(d - 2)) {
      add(PLATE[size], plan.trim, 0, y, from + 1);
      add(PLATE[size], plan.trim, w - 1, y, from + 1);
    }
    y += 1;
  }

  // The roof: a course of 2 x 2 slopes each side, a stud in and a brick up from the last, with
  // eaves a stud over the front and back walls; the gables filled; a ridge along the top.
  const roofColor = () => (next() < 0.33 ? plan.roofLight : plan.roof);
  const courses = d / 2;
  for (let k = 0; k < courses; k++) {
    const ry = y + k * 3;
    for (let x = 0; x < w; x += 2) {
      add('3039', roofColor(), x, ry, k - 1, 0);
      add('3039', roofColor(), x, ry, d - 1 - k, 180);
    }
    for (const x of [0, w - 1])
      for (let z = k + 1; z < d - 1 - k;) {
        const size = Math.min(4, d - 1 - k - z);
        add(RUN[size], plan.upper, x, ry, z, 0);
        z += size;
      }
  }
  for (let x = 0; x < w; x += 2) add('3043', plan.roof, x, y + courses * 3, courses - 1, 0);
  return pieces;
}

/**
 * Pieces turned a quarter at a time round the vertical, as a whole: a plan `width` by `depth`
 * studs turned so its front, +z, faces +x after one quarter, -z after two and -x after three.
 */
export function turnPieces(
  pieces: readonly Piece[],
  quarters: number,
  width: number,
  depth: number,
) {
  const turns = ((quarters % 4) + 4) % 4;
  if (!turns) return pieces.map((piece) => ({ ...piece }));
  return pieces.map((piece) => {
    let { minX: x0, maxX: x1, minZ: z0, maxZ: z1 } = getWorldBounds({ ...piece, id: '' });
    let w = width;
    let d = depth;
    for (let t = 0; t < turns; t++) {
      // A quarter turn takes (x, z) to (z, w - x): +z to +x, the way a piece's own turn does.
      [x0, x1, z0, z1] = [z0, z1, w - x1, w - x0];
      [w, d] = [d, w];
    }
    return { ...piece, x: x0, z: z0, rotation: ((piece.rotation + 90 * turns) % 360) as Rotation };
  });
}
