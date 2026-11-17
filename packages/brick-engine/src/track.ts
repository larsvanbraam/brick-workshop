import { SWITCH_TRACKS, getLDrawTransform } from './core.ts';
import type { Assembly, Brick } from './core.ts';

/** Straight 9V track: one section, 16 studs from end to end. */
export const STRAIGHT_TRACK = '74746';
/** A straight section's length in studs, from end to end. */
export const TRACK_LENGTH = 16;
/** The 9V curved section: 22.5 degrees of a 40 stud radius, its ends tipped 11.25 degrees. */
export const CURVED_TRACK = '74747';

/** An end of a part's rails in the part's own LDraw frame. */
interface ModelEnd {
  /** LDraw units from the part's origin. */
  x: number;
  z: number;
  /** Degrees the rails lead out, from the part's +x towards its +z. */
  angle: number;
}

const CURVE_RADIUS = 800;
const HALF_CURVE = 11.25;
const curveHalfChord = CURVE_RADIUS * Math.sin((HALF_CURVE * Math.PI) / 180);

/**
 * The lateral reach of a 9V switch's branch end: measured from the model, where the branch ends
 * 22.5 degrees off the route, about 16.3 studs on and 13 studs aside. Good to a few LDU.
 */
const BRANCH = { x: 326, z: 259, angle: 22.5 };

/**
 * Where the rails of each track part end, in the part's own frame. A switch has the two ends of its
 * straight route, 32 studs long, and the end of its branch, which leaves to -z (right) or +z (left).
 */
const MODEL_ENDS: Readonly<Record<string, readonly ModelEnd[]>> = {
  [STRAIGHT_TRACK]: [
    { x: -160, z: 0, angle: 180 },
    { x: 160, z: 0, angle: 0 },
  ],
  // The bend turns towards +z: both ends lead away 11.25 degrees round it.
  [CURVED_TRACK]: [
    { x: -curveHalfChord, z: 0, angle: 180 - HALF_CURVE },
    { x: curveHalfChord, z: 0, angle: HALF_CURVE },
  ],
  ...Object.fromEntries(
    SWITCH_TRACKS.map((id) => {
      const right = id.startsWith('75541');
      const sign = right ? -1 : 1;
      return [
        id,
        [
          { x: -320, z: 0, angle: 180 },
          { x: 320, z: 0, angle: 0 },
          { x: BRANCH.x, z: sign * BRANCH.z, angle: sign * BRANCH.angle },
        ],
      ];
    }),
  ),
};

/** One end of a track section: the middle of its end face, and the way it leads out. */
export interface TrackEnd {
  brickId: string;
  /** Studs, at the section's own height `y` (plates). */
  x: number;
  y: number;
  z: number;
  /** Degrees the rails lead out, from +x towards +z, in [0, 360). */
  angle: number;
}

const normalise = (angle: number) => ((angle % 360) + 360) % 360;
/** How far apart two angles are, in degrees, round the circle. */
const apart = (a: number, b: number) => {
  const gap = Math.abs(normalise(a) - normalise(b));
  return Math.min(gap, 360 - gap);
};

/** The ends of a track section, wherever it lies and however it is turned. */
export function trackEnds(brick: Brick): TrackEnd[] {
  const ends = MODEL_ENDS[brick.partId];
  if (!ends) return [];
  const { x, z, matrix } = getLDrawTransform(brick);
  const round = (value: number, places = 1000) => Math.round(value * places) / places + 0;
  return ends.map((end) => {
    // The matrix turns the part's x and z: world x = m0 x + m2 z, world z = m6 x + m8 z.
    const lead = (end.angle * Math.PI) / 180;
    const [hx, hz] = [Math.cos(lead), Math.sin(lead)];
    return {
      brickId: brick.id,
      x: round((x + matrix[0] * end.x + matrix[2] * end.z) / 20),
      y: brick.y,
      z: round((z + matrix[6] * end.x + matrix[8] * end.z) / 20),
      angle: round(
        normalise(
          (Math.atan2(matrix[6] * hx + matrix[8] * hz, matrix[0] * hx + matrix[2] * hz) * 180) /
            Math.PI,
        ),
        100,
      ),
    };
  });
}

export interface TrackLinks {
  /** Pairs of section ids that meet end to end, in line and at the same height. */
  links: [string, string][];
  /** Ends nothing meets: the line's open ends, or a gap, a step or a slip. */
  loose: TrackEnd[];
}

/** Ends this close (in studs) that lead opposite ways meet: switch branch ends are measured only to a few LDU. */
const MEET = 0.3;
/** Opposite headings may differ by this many degrees. */
const IN_LINE = 1;

const isLinked = (a: TrackEnd, b: TrackEnd) =>
  a.brickId !== b.brickId &&
  a.y === b.y &&
  Math.hypot(a.x - b.x, a.z - b.z) <= MEET &&
  apart(a.angle, b.angle + 180) <= IN_LINE;

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
      const turn = apart(a.angle, b.angle + 180);
      if (turn > IN_LINE) reasons.push(`they are ${turn}° out of line`);
      if (dy) reasons.push(`one is ${plural(Math.abs(dy), 'plate')} higher`);
      const lead = (a.angle * Math.PI) / 180;
      const along = dx * Math.cos(lead) + dz * Math.sin(lead);
      const across = -dx * Math.sin(lead) + dz * Math.cos(lead);
      const [far, side] = [Math.abs(along) > MEET, Math.abs(across) > MEET];
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
