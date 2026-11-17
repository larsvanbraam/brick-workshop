import { TRACK_IN_LINE, TRACK_MEET, angleApart, endsMeet, trackEnds } from './core.ts';
import type { Assembly, TrackEnd } from './core.ts';

/** Straight 9V track: one section, 16 studs from end to end. */
export const STRAIGHT_TRACK = '74746';
/** A straight section's length in studs, from end to end. */
export const TRACK_LENGTH = 16;
/** The 9V curved section: 22.5 degrees of a 40 stud radius, its ends tipped 11.25 degrees. */
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
