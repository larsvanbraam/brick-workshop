import { COLORS, DEFAULT_PART_COLOR_EVIDENCE, PARTS, placeBrick } from '@brick-workshop/engine';
import type { Assembly, Brick, Part, Rotation } from '@brick-workshop/engine';
import { PALETTE } from './hotbar.ts';

const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];

/**
 * How far a part sits off the stud grid when placed: plants and other pieces with their
 * receivers between studs stand half a stud over. Per rotation, in studs along x and z.
 */
export interface Snap {
  dx: number;
  dz: number;
}

/** A plate floor to try parts on: 16 studs square, studs on top at plate 1. */
const FLOOR: Assembly = {
  name: 'floor',
  buildArea: 32,
  bricks: Array.from({ length: 32 }, (_, index) => ({
    id: `floor-${index}`,
    partId: '3020',
    color: 71,
    x: 4 + (index % 8) * 2,
    y: 0,
    z: 4 + Math.floor(index / 8) * 4,
    rotation: 0 as const,
  })),
};

let snaps: Map<string, Snap> | null = null;

/**
 * Tries every part in every rotation on the floor, on the stud grid and half a stud over, and
 * keeps the first spot it fits. A part that fits nowhere (window glass and door leaves need their
 * frame, bars need a clip, side-mounted pieces need a wall) is left out of the game for now.
 */
function measureSnaps() {
  const found = new Map<string, Snap>();
  const offsets: Snap[] = [
    { dx: 0, dz: 0 },
    { dx: 0.5, dz: 0 },
    { dx: 0, dz: 0.5 },
    { dx: 0.5, dz: 0.5 },
  ];
  for (const part of PARTS)
    for (const rotation of ROTATIONS)
      for (const offset of offsets) {
        const probe: Brick = {
          id: 'probe',
          partId: part.id,
          color: 71,
          x: 10 + offset.dx,
          y: 1,
          z: 10 + offset.dz,
          rotation,
        };
        if (!placeBrick(FLOOR, probe).ok) continue;
        found.set(`${part.id}@${rotation}`, offset);
        break;
      }
  return found;
}

/** The offset a part needs in a rotation, or null when the game cannot place it that way. */
export function getSnap(partId: string, rotation: Rotation): Snap | null {
  snaps ??= measureSnaps();
  return snaps.get(`${partId}@${rotation}`) ?? null;
}

/** Whether the game can place the part at all, in some rotation. */
export const isPlaceable = (partId: string) =>
  ROTATIONS.some((rotation) => getSnap(partId, rotation) !== null);

/** The next rotation, a quarter turn on, that the part can be placed in. */
export function nextRotation(partId: string, rotation: Rotation): Rotation {
  for (let step = 1; step <= 4; step++) {
    const next = ((rotation + step * 90) % 360) as Rotation;
    if (getSnap(partId, next)) return next;
  }
  return rotation;
}

export type Category =
  | 'bricks'
  | 'plates'
  | 'tiles'
  | 'slopes'
  | 'round'
  | 'windows'
  | 'plants'
  | 'details';

export const CATEGORIES: readonly { id: Category; label: string }[] = [
  { id: 'bricks', label: 'Bricks' },
  { id: 'plates', label: 'Plates' },
  { id: 'tiles', label: 'Tiles' },
  { id: 'slopes', label: 'Slopes' },
  { id: 'round', label: 'Round & arches' },
  { id: 'windows', label: 'Windows & doors' },
  { id: 'plants', label: 'Plants' },
  { id: 'details', label: 'Details' },
];

export function categoryOf(part: Part): Category {
  switch (part.family) {
    case 'slope':
      return 'slopes';
    case 'round':
    case 'cone':
    case 'arch':
      return 'round';
    case 'door':
    case 'window':
      return 'windows';
    case 'foliage':
      return 'plants';
    case 'detail':
    case 'baseplate':
      return 'details';
    default:
      return part.kind === 'plate' ? 'plates' : part.kind === 'tile' ? 'tiles' : 'bricks';
  }
}

/** The parts the brick box offers, in catalogue order. */
export function placeableParts(): readonly Part[] {
  return PARTS.filter((part) => isPlaceable(part.id));
}

/** Colour IDs known to be made per Rebrickable part, from the engine's bundled evidence. */
let made: Map<string, Set<number>> | null = null;

function madeColors() {
  if (made) return made;
  made = new Map();
  for (const { partId, colorId } of DEFAULT_PART_COLOR_EVIDENCE.observations) {
    let colors = made.get(partId);
    if (!colors) made.set(partId, (colors = new Set()));
    colors.add(colorId);
  }
  return made;
}

/**
 * The colours a part really comes in, by the bundled Rebrickable evidence, muted ones first as
 * in the palette. Parts with no evidence get the game's palette, so they can still be used.
 */
export function colorsFor(partId: string): number[] {
  const { parts, colors } = DEFAULT_PART_COLOR_EVIDENCE.mappings;
  const external = parts[partId];
  const observed = external === undefined ? undefined : madeColors().get(external);
  if (!observed?.size) return [...PALETTE];
  const found = COLORS.filter((color) => {
    const id = colors[String(color.id)];
    return id !== undefined && observed.has(id);
  }).map((color) => color.id);
  if (!found.length) return [...PALETTE];
  const rank = (id: number) => {
    const at = PALETTE.indexOf(id);
    return at === -1 ? PALETTE.length : at;
  };
  return found.toSorted((a, b) => rank(a) - rank(b));
}
