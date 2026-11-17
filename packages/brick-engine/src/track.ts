import { footprint } from './core.ts';
import type { Assembly, Brick, Facing } from './core.ts';

/** Straight 9V track: the only section whose ends are on the grid, so the only one that links. */
export const STRAIGHT_TRACK = '74746';
/** A straight section's length in studs, from end to end. */
export const TRACK_LENGTH = 16;

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

/** The two ends of a straight section, or none for any other piece. */
export function trackEnds(brick: Brick): TrackEnd[] {
  if (brick.partId !== STRAIGHT_TRACK) return [];
  const { width, depth } = footprint(brick);
  const along = width > depth ? 'x' : 'z';
  const [cx, cz] = [brick.x + width / 2, brick.z + depth / 2];
  const half = TRACK_LENGTH / 2;
  const [minus, plus]: [Facing, Facing] = along === 'x' ? ['-x', '+x'] : ['-z', '+z'];
  return [
    {
      brickId: brick.id,
      x: along === 'x' ? cx - half : cx,
      y: brick.y,
      z: along === 'z' ? cz - half : cz,
      heading: minus,
    },
    {
      brickId: brick.id,
      x: along === 'x' ? cx + half : cx,
      y: brick.y,
      z: along === 'z' ? cz + half : cz,
      heading: plus,
    },
  ];
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
