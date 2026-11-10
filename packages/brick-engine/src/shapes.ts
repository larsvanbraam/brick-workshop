import { MAX_BUILD_AREA, MAX_HEIGHT } from './core.ts';

export type Vec3 = readonly [number, number, number];

/**
 * A solid in studs (x, z across the board, y up from the sculpt's base; a brick is 1.2 studs
 * tall and a plate 0.4). 'add' fills it with its color, 'paint' recolors only what earlier
 * shapes filled (eyes, emblems, buttons) and 'cut' empties it. Later shapes win.
 */
export type SculptShape = {
  color?: number;
  mode?: 'add' | 'paint' | 'cut';
  /** Keeps only the part inside this box: a cap is an ellipsoid clipped above the brow. */
  clipMin?: Vec3;
  clipMax?: Vec3;
} & (
  | { type: 'ellipsoid'; center: Vec3; radii: Vec3 }
  | { type: 'box'; min: Vec3; max: Vec3 }
  /** Round segments: a capsule has round ends, a cylinder flat ones; toRadius tapers it. */
  | { type: 'capsule' | 'cylinder'; from: Vec3; to: Vec3; radius: number; toRadius?: number }
);

export interface ShapeGrid {
  /** Board position of cell [0, 0]. */
  x: number;
  z: number;
  width: number;
  depth: number;
  layers: number;
  /** `cells[(layer * depth + z) * width + x]`: an LDraw color or null. */
  cells: (number | null)[];
  /** Shapes (by index) that changed no cell: thinner than a cell or outside what they paint. */
  unseen: number[];
}

export const PLATE_STUDS = 0.4;

function bounds(shape: SculptShape): [Vec3, Vec3] {
  const [min, max] = solidBounds(shape);
  return [
    [0, 1, 2].map((axis) =>
      Math.max(min[axis], shape.clipMin?.[axis] ?? -Infinity),
    ) as unknown as Vec3,
    [0, 1, 2].map((axis) =>
      Math.min(max[axis], shape.clipMax?.[axis] ?? Infinity),
    ) as unknown as Vec3,
  ];
}

function solidBounds(shape: SculptShape): [Vec3, Vec3] {
  if (shape.type === 'ellipsoid') {
    const [c, r] = [shape.center, shape.radii];
    return [
      [c[0] - r[0], c[1] - r[1], c[2] - r[2]],
      [c[0] + r[0], c[1] + r[1], c[2] + r[2]],
    ];
  }
  if (shape.type === 'box') return [shape.min, shape.max];
  const radius = Math.max(shape.radius, shape.toRadius ?? shape.radius);
  const [a, b] = [shape.from, shape.to];
  return [
    [Math.min(a[0], b[0]) - radius, Math.min(a[1], b[1]) - radius, Math.min(a[2], b[2]) - radius],
    [Math.max(a[0], b[0]) + radius, Math.max(a[1], b[1]) + radius, Math.max(a[2], b[2]) + radius],
  ];
}

function contains(shape: SculptShape, x: number, y: number, z: number) {
  const point = [x, y, z];
  if (
    point.some(
      (value, axis) =>
        value < (shape.clipMin?.[axis] ?? -Infinity) || value > (shape.clipMax?.[axis] ?? Infinity),
    )
  )
    return false;
  if (shape.type === 'ellipsoid') {
    const [c, r] = [shape.center, shape.radii];
    return ((x - c[0]) / r[0]) ** 2 + ((y - c[1]) / r[1]) ** 2 + ((z - c[2]) / r[2]) ** 2 <= 1;
  }
  if (shape.type === 'box')
    return [x, y, z].every((value, axis) => value >= shape.min[axis] && value <= shape.max[axis]);
  const [a, b] = [shape.from, shape.to];
  const axis = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const length = axis[0] ** 2 + axis[1] ** 2 + axis[2] ** 2;
  const raw = length
    ? ((x - a[0]) * axis[0] + (y - a[1]) * axis[1] + (z - a[2]) * axis[2]) / length
    : 0;
  if (shape.type === 'cylinder' && (raw < 0 || raw > 1)) return false;
  const t = Math.min(1, Math.max(0, raw));
  const radius = shape.radius + ((shape.toRadius ?? shape.radius) - shape.radius) * t;
  const nearest = [a[0] + axis[0] * t, a[1] + axis[1] * t, a[2] + axis[2] * t];
  return (x - nearest[0]) ** 2 + (y - nearest[1]) ** 2 + (z - nearest[2]) ** 2 <= radius ** 2;
}

/**
 * Samples shapes at cell centres, one stud across and `layerStuds` tall, inside a board of
 * `buildArea` studs. Cells deeper than `shell` studs inside the solid are left empty, so a
 * sculpture costs its surface, not its volume (0 keeps it solid).
 */
export function voxelizeShapes(
  shapes: readonly SculptShape[],
  options: { buildArea: number; layerStuds?: number; shell?: number },
): ShapeGrid | null {
  const layerStuds = options.layerStuds ?? PLATE_STUDS;
  const added = shapes.filter((shape) => (shape.mode ?? 'add') === 'add');
  if (!added.length) return null;
  const boxes = added.map(bounds);
  const board = Math.min(options.buildArea, MAX_BUILD_AREA);
  const x = Math.max(0, Math.floor(Math.min(...boxes.map(([min]) => min[0]))));
  const z = Math.max(0, Math.floor(Math.min(...boxes.map(([min]) => min[2]))));
  const width = Math.min(board, Math.ceil(Math.max(...boxes.map(([, max]) => max[0])))) - x;
  const depth = Math.min(board, Math.ceil(Math.max(...boxes.map(([, max]) => max[2])))) - z;
  const top = Math.max(...boxes.map(([, max]) => max[1]));
  const layers = Math.min(
    Math.ceil(top / layerStuds),
    Math.floor(MAX_HEIGHT * (PLATE_STUDS / layerStuds)),
  );
  if (width < 1 || depth < 1 || layers < 1) return null;
  const cells: (number | null)[] = new Array(width * depth * layers).fill(null);
  const unseen: number[] = [];
  for (const [position, shape] of shapes.entries()) {
    const mode = shape.mode ?? 'add';
    let touched = false;
    const [min, max] = bounds(shape);
    const [x0, x1] = [
      Math.max(0, Math.floor(min[0]) - x),
      Math.min(width - 1, Math.ceil(max[0]) - x),
    ];
    const [z0, z1] = [
      Math.max(0, Math.floor(min[2]) - z),
      Math.min(depth - 1, Math.ceil(max[2]) - z),
    ];
    const [l0, l1] = [
      Math.max(0, Math.floor(min[1] / layerStuds)),
      Math.min(layers - 1, Math.ceil(max[1] / layerStuds)),
    ];
    for (let layer = l0; layer <= l1; layer += 1)
      for (let k = z0; k <= z1; k += 1)
        for (let i = x0; i <= x1; i += 1) {
          if (!contains(shape, x + i + 0.5, (layer + 0.5) * layerStuds, z + k + 0.5)) continue;
          const cell = (layer * depth + k) * width + i;
          touched ||= mode === 'add' || cells[cell] !== null;
          if (mode === 'cut') cells[cell] = null;
          else if (mode === 'add') cells[cell] = shape.color ?? null;
          else if (cells[cell] !== null) cells[cell] = shape.color ?? cells[cell];
        }
    if (!touched) unseen.push(position);
  }
  const shell = options.shell ?? 0;
  if (shell > 0) {
    // Interior: everything within `shell` studs (and the same height in layers) is filled.
    const reach = Math.max(1, Math.round(shell / layerStuds));
    const at = (layer: number, k: number, i: number) =>
      layer >= 0 && layer < layers && k >= 0 && k < depth && i >= 0 && i < width
        ? cells[(layer * depth + k) * width + i]
        : null;
    const interior: number[] = [];
    for (let layer = 0; layer < layers; layer += 1)
      for (let k = 0; k < depth; k += 1)
        for (let i = 0; i < width; i += 1) {
          if (at(layer, k, i) === null) continue;
          let inside = true;
          for (let dl = -reach; dl <= reach && inside; dl += 1)
            for (let dk = -shell; dk <= shell && inside; dk += 1)
              for (let di = -shell; di <= shell && inside; di += 1)
                if (at(layer + dl, k + dk, i + di) === null) inside = false;
          if (inside) interior.push((layer * depth + k) * width + i);
        }
    for (const cell of interior) cells[cell] = null;
  }
  return { x, z, width, depth, layers, cells, unseen };
}
