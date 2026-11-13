import { crc32, deflateSync } from 'node:zlib';
import { COLORS, getBuildArea, getLDrawTransform, getPart } from '@brick-workshop/engine';
import type { Assembly, Brick, Part } from '@brick-workshop/engine';

/**
 * A small software renderer for the builder tools: every piece as flat-shaded solids (boxes,
 * wedges for slopes, octagonal prisms for round parts, studs on top) in an orthographic view,
 * with dark outlines between faces like an instruction booklet. It needs no browser or GPU, so
 * Claude can look at its build from any side mid-run.
 */

export const RENDER_VIEWS = ['front', 'back', 'left', 'right', 'top', 'iso', 'iso-back'] as const;
export type RenderView = (typeof RENDER_VIEWS)[number];

type Vec = [number, number, number];

/** Polygons in world LDU with y up, each with its colour and outward normal. */
interface Face {
  points: Vec[];
  normal: Vec;
  rgb: Vec;
  /** Glass and other transparent colours. */
  clear: boolean;
}

const COLOR_RGB = new Map(
  COLORS.map((color) => {
    const value = Number.parseInt(color.hex.slice(1), 16);
    return [
      color.id,
      { rgb: [(value >> 16) & 255, (value >> 8) & 255, value & 255] as Vec, alpha: color.alpha },
    ];
  }),
);

const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec): Vec => {
  const size = Math.hypot(...a) || 1;
  return [a[0] / size, a[1] / size, a[2] / size];
};

/** A convex prism: a polygon in the y/z plane (plates up, studs back) run along x. */
function extrudeX(section: [number, number][], x0: number, x1: number): Vec[][] {
  const left = section.map(([y, z]): Vec => [x0, y, z]);
  const right = section.map(([y, z]): Vec => [x1, y, z]);
  const faces: Vec[][] = [[...left].reverse(), right];
  for (let index = 0; index < section.length; index += 1) {
    const next = (index + 1) % section.length;
    faces.push([left[index], left[next], right[next], right[index]]);
  }
  return faces;
}

/** An upright octagonal frustum centred on (cx, cz) from y0 to y1 (plates), radii in studs. */
function octagon(
  cx: number,
  cz: number,
  y0: number,
  y1: number,
  rx: number,
  rz: number,
  top = 1,
): Vec[][] {
  const ring = (y: number, scale: number) =>
    Array.from({ length: 8 }, (_, index): Vec => {
      const angle = ((index + 0.5) * Math.PI) / 4;
      return [cx + Math.cos(angle) * rx * scale, y, cz + Math.sin(angle) * rz * scale];
    });
  const low = ring(y0, 1);
  const high = ring(y1, top);
  const faces: Vec[][] = [low, [...high].reverse()];
  for (let index = 0; index < 8; index += 1) {
    const next = (index + 1) % 8;
    faces.push([low[index], high[index], high[next], low[next]]);
  }
  return faces;
}

const box = (w: number, h: number, d: number) =>
  extrudeX(
    [
      [0, 0],
      [h, 0],
      [h, d],
      [0, d],
    ],
    0,
    w,
  );

/**
 * A part's convex solids in its own upright frame at rotation 0: x across its width, y up in
 * plates, z across its depth (the low side of a slope at z 0). Shapes are rough: enough to read
 * the silhouette, colours and slopes, not the moulding.
 */
function partSolids(part: Part): Vec[][][] {
  const { width: w, depth: d, height: h } = part;
  if (part.shape === 'slope' || part.shape === 'inverted-slope') {
    const flat = Math.min(d - 0.5, d >= 2 ? 1 : 0);
    const lip = d >= 2 ? Math.min(h, 1) / 3 : 0;
    const section: [number, number][] =
      part.shape === 'slope'
        ? [
            [0, 0],
            [lip, 0],
            [h, d - flat],
            [h, d],
            [0, d],
          ]
        : [
            [h, 0],
            [h, d],
            [0, d],
            [0, d - flat],
            [h - lip, 0],
          ];
    return [extrudeX(section, 0, w)];
  }
  if (part.shape === 'foliage') {
    if (/tree|evergreen|pine/i.test(part.name))
      return [octagon(w / 2, d / 2, 0, h, w / 2, d / 2, 0.08)];
    // A mound: wider in the middle than at its foot, rounded over the top.
    const [rx, rz] = [w / 2, d / 2];
    return [
      octagon(w / 2, d / 2, 0, h * 0.45, rx * 0.75, rz * 0.75, 1 / 0.75),
      octagon(w / 2, d / 2, h * 0.45, h, rx, rz, 0.5),
    ];
  }
  if (part.shape === 'round') return [octagon(w / 2, d / 2, 0, h, w / 2, d / 2)];
  if (part.shape === 'cone') return [octagon(w / 2, d / 2, 0, h, w / 2, d / 2, 0.45)];
  if (/lamp/i.test(part.name)) {
    const head = Math.min(h / 4, 6);
    return [
      octagon(w / 2, d / 2, 0, 1, w / 2, d / 2),
      octagon(w / 2, d / 2, 1, h - head, 0.2, 0.2),
      octagon(w / 2, d / 2, h - head, h, w / 3, d / 3, 0.7),
    ];
  }
  if (part.shape === 'arch' && Math.max(w, d) >= 3) {
    // Two legs and the span over the opening.
    const along = w >= d;
    const length = along ? w : d;
    const span = Math.max(1, h / 3);
    const piece = (from: number, to: number, y0: number, y1: number) =>
      offsetBox(along ? [from, y0, 0] : [0, y0, from], along ? [to, y1, d] : [w, y1, to]);
    return [
      piece(0, 1, 0, h - span),
      piece(length - 1, length, 0, h - span),
      piece(0, length, h - span, h),
    ];
  }
  return [box(w, h, d)];
}

/** A box between two corners (studs, plates, studs). */
function offsetBox(low: Vec, high: Vec): Vec[][] {
  return box(high[0] - low[0], high[1] - low[1], high[2] - low[2]).map((polygon) =>
    polygon.map(([x, y, z]): Vec => [x + low[0], y + low[1], z + low[2]]),
  );
}

const STUD_HEIGHT = 0.5;
const STUD_RADIUS = 0.3;

/** Studs on the part's top, in its own frame. */
function partStuds(part: Part): Vec[][] {
  return part.connections.topStuds.flatMap((site) =>
    octagon(
      site.x + 0.5,
      site.z + 0.5,
      part.height,
      part.height + STUD_HEIGHT,
      STUD_RADIUS,
      STUD_RADIUS,
    ),
  );
}

/** Convex solids, each a list of polygons. */
const SOLIDS = new Map<string, { solid: Vec[][][]; studs: Vec[][][] }>();

/** A part's convex solids in its own frame, cached per part. */
function partGeometry(partId: string) {
  let geometry = SOLIDS.get(partId);
  if (!geometry) {
    const part = getPart(partId);
    const studs = partStuds(part);
    geometry = {
      solid: partSolids(part),
      studs: Array.from({ length: studs.length / 10 }, (_, index) =>
        studs.slice(index * 10, index * 10 + 10),
      ),
    };
    SOLIDS.set(partId, geometry);
  }
  return geometry;
}

const centroid = (points: readonly Vec[]): Vec => {
  const sum = points.reduce<Vec>(
    (total, point) => [total[0] + point[0], total[1] + point[1], total[2] + point[2]],
    [0, 0, 0],
  );
  return [sum[0] / points.length, sum[1] / points.length, sum[2] / points.length];
};

type Matrix = readonly number[];
const turn = (m: Matrix, [x, y, z]: Vec): Vec => [
  m[0] * x + m[1] * y + m[2] * z,
  m[3] * x + m[4] * y + m[5] * z,
  m[6] * x + m[7] * y + m[8] * z,
];
const turnBack = (m: Matrix, [x, y, z]: Vec): Vec => [
  m[0] * x + m[3] * y + m[6] * z,
  m[1] * x + m[4] * y + m[7] * z,
  m[2] * x + m[5] * y + m[8] * z,
];

/**
 * Maps a point in the piece's own frame (studs, plates, studs) to world LDU with y up. The
 * engine's LDraw transform places the part's LDraw origin; the same part placed upright at the
 * origin tells where that origin sits in the part's own frame.
 */
function pieceTransform(brick: Brick) {
  const placed = getLDrawTransform(brick);
  const home = getLDrawTransform({
    ...brick,
    x: 0,
    y: 0,
    z: 0,
    rotation: 0,
    facing: undefined,
    tilt: undefined,
    upsideDown: undefined,
  });
  return ([u, v, w]: Vec): Vec => {
    const local = turnBack(home.matrix, [u * 20 - home.x, -v * 8 - home.y, w * 20 - home.z]);
    const [x, y, z] = turn(placed.matrix, local);
    return [x + placed.x, -(y + placed.y), z + placed.z];
  };
}

function brickFaces(brick: Brick, faces: Face[], studs: boolean) {
  const color = COLOR_RGB.get(brick.color) ?? { rgb: [160, 160, 160] as Vec, alpha: 255 };
  const geometry = partGeometry(brick.partId);
  const place = pieceTransform(brick);
  for (const solid of studs ? [...geometry.solid, ...geometry.studs] : geometry.solid) {
    const polygons = solid.map((polygon) => polygon.map(place));
    // Each solid is convex, so its faces point away from its middle whatever their winding.
    const middle = centroid(polygons.flat());
    for (const points of polygons) {
      let normal = unit(cross(sub(points[1], points[0]), sub(points[2], points[0])));
      if (dot(normal, sub(centroid(points), middle)) < 0)
        normal = [-normal[0], -normal[1], -normal[2]];
      faces.push({ points, normal, rgb: color.rgb, clear: color.alpha < 255 });
    }
  }
}

/** Where the camera looks from: toward the camera, and the screen's up. */
const VIEWS: Record<RenderView, { toward: Vec; up: Vec }> = {
  front: { toward: [0, 0, 1], up: [0, 1, 0] },
  back: { toward: [0, 0, -1], up: [0, 1, 0] },
  left: { toward: [-1, 0, 0], up: [0, 1, 0] },
  right: { toward: [1, 0, 0], up: [0, 1, 0] },
  top: { toward: [0, 1, 0], up: [0, 0, -1] },
  iso: { toward: [1, 1.15, 1.4], up: [0, 1, 0] },
  'iso-back': { toward: [-1, 1.15, -1.4], up: [0, 1, 0] },
};

export interface RenderOptions {
  view?: RenderView;
  /** Only pieces whose minimum corner lies in this box (studs for x/z, plates for y). */
  region?: Partial<Record<'minX' | 'maxX' | 'minY' | 'maxY' | 'minZ' | 'maxZ', number>>;
  /** Longest side of the image in pixels. */
  size?: number;
}

/** Studs are left off above this many pieces; at that scale they are a pixel or two wide. */
const MAX_STUDDED_PIECES = 6000;

/** Renders the assembly to a PNG and returns it with what it shows. */
export function renderAssembly(assembly: Assembly, options: RenderOptions = {}) {
  const view = options.view ?? 'iso';
  const size = Math.round(options.size ?? 768);
  const region = options.region ?? {};
  const bricks = assembly.bricks.filter(
    (brick) =>
      brick.x >= (region.minX ?? -Infinity) &&
      brick.x <= (region.maxX ?? Infinity) &&
      brick.y >= (region.minY ?? -Infinity) &&
      brick.y <= (region.maxY ?? Infinity) &&
      brick.z >= (region.minZ ?? -Infinity) &&
      brick.z <= (region.maxZ ?? Infinity),
  );
  const faces: Face[] = [];
  const studs = bricks.length <= MAX_STUDDED_PIECES;
  for (const brick of bricks) brickFaces(brick, faces, studs);
  // The board, a plate's thickness under the ground, unless the render is of a region.
  const board = getBuildArea(assembly) * 20;
  if (!options.region)
    faces.push({
      points: [
        [0, -0.5, 0],
        [0, -0.5, board],
        [board, -0.5, board],
        [board, -0.5, 0],
      ],
      normal: [0, 1, 0],
      rgb: [214, 216, 212],
      clear: false,
    });

  const camera = VIEWS[view];
  const toward = unit(camera.toward);
  const right = unit(cross(camera.up, toward));
  const up = cross(toward, right);
  // Light from above, over the camera's left shoulder.
  const light = unit([
    toward[0] * 0.8 - right[0] * 0.5 + 0.9 * (view === 'top' ? -up[0] : 0),
    toward[1] * 0.8 - right[1] * 0.5 + 1,
    toward[2] * 0.8 - right[2] * 0.5 + 0.9 * (view === 'top' ? -up[2] : 0),
  ]);
  const visible = faces.filter((face) => dot(face.normal, toward) > 1e-6);

  let [minU, maxU, minV, maxV] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const face of visible)
    for (const point of face.points) {
      const u = dot(point, right);
      const v = dot(point, up);
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
  if (!visible.length) [minU, maxU, minV, maxV] = [0, 20, 0, 20];
  const spanU = Math.max(maxU - minU, 20);
  const spanV = Math.max(maxV - minV, 20);
  const width = spanU >= spanV ? size : Math.max(64, Math.round((size * spanU) / spanV));
  const height = spanV >= spanU ? size : Math.max(64, Math.round((size * spanV) / spanU));
  const margin = 0.04;
  const scale = Math.min(width / spanU, height / spanV) * (1 - 2 * margin);
  const offsetX = (width - spanU * scale) / 2;
  const offsetY = (height - spanV * scale) / 2;

  const depth = new Float32Array(width * height).fill(-Infinity);
  const ids = new Int32Array(width * height).fill(-1);
  const pixels = new Uint8Array(width * height * 3);
  for (let index = 0; index < width * height; index += 1) {
    pixels[index * 3] = 238;
    pixels[index * 3 + 1] = 240;
    pixels[index * 3 + 2] = 243;
  }

  const draw = (face: Face, id: number) => {
    const light_ = Math.max(0, dot(face.normal, light));
    const shade = 0.42 + 0.62 * light_;
    const rgb = face.rgb.map((channel) => Math.min(255, channel * shade));
    const screen = face.points.map((point): Vec => [
      offsetX + (dot(point, right) - minU) * scale,
      height - offsetY - (dot(point, up) - minV) * scale,
      dot(point, toward),
    ]);
    for (let index = 1; index + 1 < screen.length; index += 1)
      fillTriangle(screen[0], screen[index], screen[index + 1], (pixel, z) => {
        if (z <= depth[pixel]) return;
        if (face.clear) {
          // Glass: tint what is behind it rather than hide it.
          pixels[pixel * 3] = pixels[pixel * 3] * 0.45 + rgb[0] * 0.55;
          pixels[pixel * 3 + 1] = pixels[pixel * 3 + 1] * 0.45 + rgb[1] * 0.55;
          pixels[pixel * 3 + 2] = pixels[pixel * 3 + 2] * 0.45 + rgb[2] * 0.55;
          return;
        }
        depth[pixel] = z;
        ids[pixel] = id;
        pixels[pixel * 3] = rgb[0];
        pixels[pixel * 3 + 1] = rgb[1];
        pixels[pixel * 3 + 2] = rgb[2];
      });
  };

  function fillTriangle(a: Vec, b: Vec, c: Vec, plot: (pixel: number, z: number) => void) {
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(area) < 1e-9) return;
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    const x1 = Math.min(width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    const y1 = Math.min(height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    for (let y = y0; y <= y1; y += 1) {
      const py = y + 0.5;
      for (let x = x0; x <= x1; x += 1) {
        const px = x + 0.5;
        const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
        const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        plot(y * width + x, w0 * a[2] + w1 * b[2] + w2 * c[2]);
      }
    }
  }

  // Opaque faces first, then glass over them, nearest last so it tints only what it covers.
  const opaque = visible.filter((face) => !face.clear);
  const clear = visible
    .filter((face) => face.clear)
    .sort(
      (first, second) =>
        Math.min(...first.points.map((point) => dot(point, toward))) -
        Math.min(...second.points.map((point) => dot(point, toward))),
    );
  opaque.forEach((face, index) => draw(face, index));
  clear.forEach((face) => draw(face, -1));

  // Outlines where neighbouring pixels show different faces.
  const outline = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const id = ids[pixel];
      if ((x + 1 < width && ids[pixel + 1] !== id) || (y + 1 < height && ids[pixel + width] !== id))
        outline[pixel] = 1;
    }
  for (let pixel = 0; pixel < width * height; pixel += 1)
    if (outline[pixel])
      for (let channel = 0; channel < 3; channel += 1)
        pixels[pixel * 3 + channel] = pixels[pixel * 3 + channel] * 0.55;

  return {
    view,
    width,
    height,
    pieces: bricks.length,
    studs,
    png: encodePng(width, height, pixels),
  };
}

/** An RGB PNG, written without dependencies. */
function encodePng(width: number, height: number, rgb: Uint8Array) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0;
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
