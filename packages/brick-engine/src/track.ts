import { TRACK_IN_LINE, TRACK_MEET, angleApart, endsMeet, trackEnds } from './core.ts';
import type { Assembly, TrackEnd } from './core.ts';

/** Straight 9V track: one section, 16 studs from end to end. */
export const STRAIGHT_TRACK = '74746';
/** A straight section's length in studs, from end to end. */
export const TRACK_LENGTH = 16;
/** The 9V curved section: 22.5 degrees of a 40 stud radius, bending towards -z in its own frame. */
export const CURVED_TRACK = '74747';

export interface TrackLinks {
  /** Pairs of section ids that meet end to end, in line and at the same height. */
  links: [string, string][];
  /** Ends nothing meets: the line's open ends, or a gap, a step or a slip. */
  loose: TrackEnd[];
}

const isLinked = endsMeet;

/**
 * Which track sections meet. Two ends link when they share a point (to a fraction of a stud) and a
 * height and lead opposite ways, so a section a stud off, a plate up or at the wrong angle leaves
 * both ends loose. Each end links to at most one other, the nearest.
 */
export function findTrackLinks(assembly: Pick<Assembly, 'bricks'>): TrackLinks {
  const ends = assembly.bricks.flatMap(trackEnds);
  const cells = new Map<string, number[]>();
  ends.forEach((end, index) => {
    const key = `${Math.floor(end.x)}:${Math.floor(end.z)}:${end.y}`;
    cells.set(key, [...(cells.get(key) ?? []), index]);
  });
  const candidates = ends.map((end, index) => {
    const found: number[] = [];
    for (const dx of [-1, 0, 1])
      for (const dz of [-1, 0, 1])
        for (const other of cells.get(
          `${Math.floor(end.x) + dx}:${Math.floor(end.z) + dz}:${end.y}`,
        ) ?? [])
          if (other !== index && isLinked(end, ends[other]!)) found.push(other);
    return found.toSorted(
      (a, b) =>
        Math.hypot(end.x - ends[a]!.x, end.z - ends[a]!.z) -
        Math.hypot(end.x - ends[b]!.x, end.z - ends[b]!.z),
    );
  });
  const partner = new Map<number, number>();
  ends.forEach((_, index) => {
    if (partner.has(index)) return;
    const other = candidates[index]!.find((candidate) => !partner.has(candidate));
    if (other === undefined) return;
    partner.set(index, other);
    partner.set(other, index);
  });
  const links: [string, string][] = [];
  const loose: TrackEnd[] = [];
  ends.forEach((end, index) => {
    const other = partner.get(index);
    if (other === undefined) loose.push(end);
    else if (index < other) links.push([end.brickId, ends[other]!.brickId]);
  });
  return { links, loose };
}

export interface TrackWarning {
  /** The two sections that nearly meet. */
  brickIds: [string, string];
  message: string;
}

/** Ends this close (in studs) that still don't link are a slip, not two separate lines. */
const NEAR = 2.5;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * Sections that nearly meet but don't: a gap, a step up or down, a sideways slip or a wrong angle.
 * A line's own open ends are fine and stay quiet. This is advice, not validation, so
 * `validateAssembly` is unchanged and a build with warnings still stands.
 */
export function trackWarnings(assembly: Pick<Assembly, 'bricks'>): TrackWarning[] {
  const { loose } = findTrackLinks(assembly);
  const warnings: TrackWarning[] = [];
  for (let i = 0; i < loose.length; i++)
    for (let j = i + 1; j < loose.length; j++) {
      const [a, b] = [loose[i]!, loose[j]!];
      if (a.brickId === b.brickId) continue;
      const [dx, dz, dy] = [b.x - a.x, b.z - a.z, b.y - a.y];
      if (Math.hypot(dx, dz) > NEAR || Math.abs(dy) > NEAR * 2.5) continue;
      const reasons: string[] = [];
      const turn = angleApart(a.angle, b.angle + 180);
      if (turn > TRACK_IN_LINE) reasons.push(`they are ${turn}° out of line`);
      if (dy) reasons.push(`one is ${plural(Math.abs(dy), 'plate')} higher`);
      const lead = (a.angle * Math.PI) / 180;
      const along = dx * Math.cos(lead) + dz * Math.sin(lead);
      const across = -dx * Math.sin(lead) + dz * Math.cos(lead);
      const [far, side] = [Math.abs(along) > TRACK_MEET, Math.abs(across) > TRACK_MEET];
      if (side)
        reasons.push(
          `they are ${plural(Math.round(Math.abs(across) * 100) / 100, 'stud')} out of line sideways`,
        );
      if (far)
        reasons.push(`there is a ${Math.round(Math.abs(along) * 100) / 100}-stud gap or overlap`);
      warnings.push({
        brickIds: [a.brickId, b.brickId],
        message: `Track sections ${a.brickId} and ${b.brickId} nearly meet but do not link: ${reasons.join(', ') || 'their ends do not match'}.`,
      });
    }
  return warnings;
}

/** A point on a track path: studs, plates and the heading in degrees (from +x towards +z). */
export interface TrackPoint {
  x: number;
  y: number;
  z: number;
  angle: number;
}

/** One section of a path: its entry and exit, and how far the rails run between them. */
export interface TrackSegment {
  brickId: string;
  from: TrackPoint;
  to: TrackPoint;
  /** Studs along the rails, an arc when the headings differ. */
  length: number;
  /** Distance along the path where this section begins. */
  start: number;
}

export interface TrackPath {
  segments: TrackSegment[];
  /** Total length in studs; for a closed loop, one lap. */
  length: number;
  /** True when the rails lead back to where they began. */
  closed: boolean;
  /** Where the rails are `distance` studs along: clamped on an open line, wrapped on a loop. */
  pointAt(distance: number): TrackPoint;
}

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const signedTurn = (from: number, to: number) => ((((to - from) % 360) + 540) % 360) - 180;

/** The rails of one section, from its entry heading to its exit: a line, or an arc tangent to both. */
function segmentLength(from: TrackPoint, to: TrackPoint) {
  const turn = Math.abs(toRadians(signedTurn(from.angle, to.angle)));
  const chord = Math.hypot(to.x - from.x, to.z - from.z);
  return turn < 1e-6 ? chord : (chord * turn) / (2 * Math.sin(turn / 2));
}

function pointOnSegment(segment: TrackSegment, along: number): TrackPoint {
  const { from, to, length } = segment;
  const s = Math.min(Math.max(along, 0), length);
  const turn = toRadians(signedTurn(from.angle, to.angle));
  if (Math.abs(turn) < 1e-6 || length === 0) {
    const t = length === 0 ? 0 : s / length;
    return {
      x: from.x + (to.x - from.x) * t,
      y: from.y,
      z: from.z + (to.z - from.z) * t,
      angle: from.angle,
    };
  }
  const curvature = turn / length;
  const h0 = toRadians(from.angle);
  const h = h0 + curvature * s;
  return {
    x: from.x + (Math.sin(h) - Math.sin(h0)) / curvature,
    y: from.y,
    z: from.z + (Math.cos(h0) - Math.cos(h)) / curvature,
    angle: ((((h * 180) / Math.PI) % 360) + 360) % 360,
  };
}

/** Which end a train leaves a section by when it came in by end `entered`: switches stay on the route. */
const exitEnd = (entered: number) => (entered === 0 ? 1 : 0);

/**
 * Follows the rails from one section as a train would ride them. `start` names the section and the
 * end the train enters it by (default: the first open end of the line, else the first section's
 * first end). At a switch the train keeps to the route; a branch is entered only by starting on it.
 * The path stops at an open end, or closes when it comes back to where it began.
 */
export function traceTrack(
  assembly: Pick<Assembly, 'bricks'>,
  start?: { brickId: string; end?: number },
): TrackPath {
  const ends = assembly.bricks.map((brick) => trackEnds(brick));
  const index = new Map(assembly.bricks.map((brick, i) => [brick.id, i]));
  const partner = (end: TrackEnd): { brick: number; end: number } | undefined => {
    let best: { brick: number; end: number; gap: number } | undefined;
    ends.forEach((others, brick) =>
      others.forEach((other, i) => {
        if (!endsMeet(end, other)) return;
        const gap = Math.hypot(end.x - other.x, end.z - other.z);
        if (!best || gap < best.gap) best = { brick, end: i, gap };
      }),
    );
    return best && { brick: best.brick, end: best.end };
  };

  let first: { brick: number; end: number } | undefined;
  if (start) {
    const brick = index.get(start.brickId);
    if (brick !== undefined && ends[brick]![start.end ?? 0]) first = { brick, end: start.end ?? 0 };
  } else {
    // Open ends of the line first, entering the section by the end that nothing meets.
    for (let brick = 0; brick < ends.length && !first; brick++)
      ends[brick]!.forEach((end, i) => {
        if (!first && i < 2 && !partner(end)) first = { brick, end: i };
      });
    for (let brick = 0; brick < ends.length && !first; brick++)
      if (ends[brick]!.length) first = { brick, end: 0 };
  }

  const segments: TrackSegment[] = [];
  let closed = false;
  let length = 0;
  let current = first;
  const seen = new Set<string>();
  while (current) {
    const key = `${current.brick}:${current.end}`;
    if (seen.has(key)) {
      closed = segments[0]?.brickId === assembly.bricks[current.brick]!.id;
      break;
    }
    seen.add(key);
    const here = ends[current.brick]!;
    const out = exitEnd(current.end);
    const [a, b] = [here[current.end]!, here[out]!];
    // A section's end `angle` leads out of the section; the train enters against it.
    const from: TrackPoint = {
      x: a.x,
      y: a.y,
      z: a.z,
      angle: (a.angle + 180) % 360,
    };
    const to: TrackPoint = { x: b.x, y: b.y, z: b.z, angle: b.angle };
    const segment: TrackSegment = {
      brickId: a.brickId,
      from,
      to,
      length: segmentLength(from, to),
      start: length,
    };
    segments.push(segment);
    length += segment.length;
    current = partner(b);
  }

  const pointAt = (distance: number): TrackPoint => {
    if (!segments.length) throw new Error('There is no track to ride.');
    const at = closed
      ? ((distance % length) + length) % length
      : Math.min(Math.max(distance, 0), length);
    let low = 0;
    let high = segments.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (segments[mid]!.start <= at) low = mid;
      else high = mid - 1;
    }
    const segment = segments[low]!;
    return pointOnSegment(segment, at - segment.start);
  };

  return { segments, length, closed, pointAt };
}
