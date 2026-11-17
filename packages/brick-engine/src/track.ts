import type { Assembly, Brick, Facing } from './core.ts';

import { getLDrawTransform } from './core.ts';
import { SWITCH_TRACKS } from './core.ts';

/** Straight 9V track: one section, 16 studs from end to end. */
export const STRAIGHT_TRACK = '74746';
/** A straight section's length in studs, from end to end. */
export const TRACK_LENGTH = 16;

/** Which way a point of a part faces, in the part's own LDraw frame (x along the rails). */
type Along = '-x' | '+x';
interface ModelEnd {
  /** LDraw units from the part's origin. */
  x: number;
  z: number;
  heading: Along;
}

/**
 * Where the rails of each track part end, in the part's own frame. A switch's straight route is two
 * sections long and ends on the same grid; its branch leaves at 22.5 degrees, off the grid, so it
 * has no end here and cannot be linked.
 */
const MODEL_ENDS: Readonly<Record<string, readonly ModelEnd[]>> = (() => {
  const straight: ModelEnd[] = [
    { x: -160, z: 0, heading: '-x' },
    { x: 160, z: 0, heading: '+x' },
  ];
  const switchRoute: ModelEnd[] = [
    { x: -320, z: 0, heading: '-x' },
    { x: 320, z: 0, heading: '+x' },
  ];
  return {
    [STRAIGHT_TRACK]: straight,
    ...Object.fromEntries(SWITCH_TRACKS.map((id) => [id, switchRoute])),
  };
})();

/** One end of a track section: the middle of its end face, and the way it points out. */
export interface TrackEnd {
  brickId: string;
  /** Studs, on the section's own height `y` (plates). */
  x: number;
  y: number;
  z: number;
  /** The direction a neighbouring section would lie in. */
  heading: Facing;
}

const OPPOSITE: Readonly<Record<Facing, Facing>> = {
  '-x': '+x',
  '+x': '-x',
  '-z': '+z',
  '+z': '-z',
};

/** The ends of a track section that lie on the grid, or none for any other piece. */
export function trackEnds(brick: Brick): TrackEnd[] {
  const ends = MODEL_ENDS[brick.partId];
  if (!ends) return [];
  const { x, z, rotation } = getLDrawTransform(brick);
  const cosine = Math.round(Math.cos((rotation * Math.PI) / 180));
  const sine = Math.round(Math.sin((rotation * Math.PI) / 180));
  const round = (value: number) => Math.round(value * 1000) / 1000 + 0;
  return ends.map((end) => {
    const direction = end.heading === '+x' ? 1 : -1;
    const [dx, dz] = [cosine * direction, -sine * direction];
    return {
      brickId: brick.id,
      x: round((x + cosine * end.x + sine * end.z) / 20),
      y: brick.y,
      z: round((z - sine * end.x + cosine * end.z) / 20),
      heading: dx ? (dx > 0 ? '+x' : '-x') : dz > 0 ? '+z' : '-z',
    };
  });
}

export interface TrackLinks {
  /** Pairs of section ids that meet end to end, in line and at the same height. */
  links: [string, string][];
  /** Ends nothing meets: the line's two ends, or a gap, a step or a sideways slip. */
  loose: TrackEnd[];
}

/**
 * Which track sections meet. Two ends link when they share a point and a height and point
 * opposite ways, so a section laid a stud off, a plate up or crosswise leaves both ends loose.
 */
export function findTrackLinks(assembly: Pick<Assembly, 'bricks'>): TrackLinks {
  const byPoint = new Map<string, TrackEnd[]>();
  for (const brick of assembly.bricks)
    for (const end of trackEnds(brick)) {
      const key = `${end.x},${end.y},${end.z}`;
      byPoint.set(key, [...(byPoint.get(key) ?? []), end]);
    }
  const links: [string, string][] = [];
  const loose: TrackEnd[] = [];
  for (const ends of byPoint.values()) {
    const [a, b, ...rest] = ends;
    if (a && b && !rest.length && OPPOSITE[a.heading] === b.heading)
      links.push([a.brickId, b.brickId]);
    else loose.push(...ends);
  }
  return { links, loose };
}

export interface TrackWarning {
  /** The two sections that nearly meet. */
  brickIds: [string, string];
  message: string;
}

/** Ends this close (in studs) that still don't link are a slip, not two separate lines. */
const NEAR = 2.5;

/**
 * Sections that nearly meet but don't: a gap, a step up or down, a sideways slip or a crosswise
 * section. A line's own open ends are fine and stay quiet. This is advice, not validation, so
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
      if (OPPOSITE[a.heading] !== b.heading) reasons.push('they are not in line');
      if (dy) reasons.push(`one is ${Math.abs(dy)} plate${Math.abs(dy) === 1 ? '' : 's'} higher`);
      const along = a.heading.endsWith('x') ? dx : dz;
      const across = a.heading.endsWith('x') ? dz : dx;
      if (across && OPPOSITE[a.heading] === b.heading)
        reasons.push(
          `they are ${Math.abs(across)} stud${Math.abs(across) === 1 ? '' : 's'} out of line`,
        );
      if (along && OPPOSITE[a.heading] === b.heading)
        reasons.push(`there is a ${Math.abs(along)}-stud gap or overlap`);
      warnings.push({
        brickIds: [a.brickId, b.brickId],
        message: `Track sections ${a.brickId} and ${b.brickId} nearly meet but do not link: ${reasons.join(', ') || 'their ends do not match'}.`,
      });
    }
  return warnings;
}
