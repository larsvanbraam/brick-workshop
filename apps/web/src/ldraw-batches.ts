import {
  BatchedMesh,
  BufferAttribute,
  BufferGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix3,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Sphere,
  Vector2,
  Vector3,
} from 'three';
import type { Color, Intersection, Material, Raycaster } from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { LDrawConditionalLineMaterial } from 'three/addons/materials/LDrawConditionalLineMaterial.js';
import { COLORS, getConnectionSites, getLDrawTransform, getPart } from '@lego-builder/brick-engine';
import type { Brick } from '@lego-builder/brick-engine';
import { coloredLDrawModel } from './ldraw';

Mesh.prototype.raycast = acceleratedRaycast;

// `indirect` leaves the index untouched; the typings lag behind the option.
const BVH_OPTIONS = { indirect: true, maxLeafTris: 10 };

/**
 * Whether a part can join the batch: anything with faces can. Transparent materials go to a
 * sorted glass layer and mirrored sub-parts are baked with their winding flipped.
 */
export function canBatchLDrawModel(model: Group): boolean {
  let faces = false;
  model.traverse((object) => {
    if (object instanceof Mesh) faces = true;
  });
  return faces;
}

/** All of a part's faces in one finish, in part space, with colors baked into the vertices. */
type Surface = {
  key: string;
  finish: string;
  material: MeshStandardMaterial;
  geometry: BufferGeometry;
};
/** Opaque and see-through edges are drawn apart, and conditional edges need their own shader. */
const LINE_KINDS = ['edge', 'conditional', 'glassEdge', 'glassConditional'] as const;
type LineKind = (typeof LINE_KINDS)[number];
/** The kinds whose segments share their end vertices through an index. */
const INDEXED_LINES: ReadonlySet<LineKind> = new Set(['edge', 'glassEdge']);
/**
 * A part in one color with some regions left out, ready to place: faces per finish, and each
 * kind of edge it has. `users` counts the placements drawing it, so it can go once none do.
 */
type Look = {
  key: string;
  baked: Baked;
  surfaces: Surface[];
  lines: Record<LineKind, BufferGeometry | null>;
  users: number;
};
/** Faces that share a finish share one batched mesh, and so one draw call. */
type Layer = {
  mesh: BatchedMesh;
  geometries: Map<string, number>;
  /** The standalone geometry behind each geometry id, carrying the BVH that raycasts use. */
  sources: BufferGeometry[];
  free: number[];
  brickIds: (string | undefined)[];
  /** One past the highest instance id handed out. */
  size: number;
  /** Vertices of deleted geometries still taking up buffer space, until `optimize` packs it. */
  dead: number;
};
type Placement = { key: string; look: Look; slots: { layer: Layer; id: number }[] };

export type BatchEntry = { brick: Brick; model: Group };
export type BatchLayerStats = {
  finish: string;
  /** Visible instances; `free` hidden slots wait to be reused. */
  instances: number;
  free: number;
  maxInstances: number;
  geometries: number;
  vertices: number;
  maxVertices: number;
  indices: number;
  maxIndices: number;
};
export type BatchStats = {
  bricks: number;
  /** Baked part, color and covered-stud combinations. */
  looks: number;
  /** Studs left out because a brick sits on them. */
  coveredStuds: number;
  /** Bricks drawn without their hollow underside, as nothing can see into it. */
  closedUndersides: number;
  edgeSegments: number;
  conditionalSegments: number;
  layers: BatchLayerStats[];
};
/** Gives a part model its brick color; defaults to the LDraw loader's materials. */
export type Colorize = (model: Group, color: number) => Group;

function concat(parts: readonly Float32Array[]) {
  const out = new Float32Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** One color for `count` vertices; `alpha` adds a fourth channel for see-through layers. */
function fill(color: Color, count: number, alpha?: number) {
  const size = alpha === undefined ? 3 : 4;
  const out = new Float32Array(count * size);
  for (let vertex = 0; vertex < count; vertex++) {
    color.toArray(out, vertex * size);
    if (alpha !== undefined) out[vertex * size + 3] = alpha;
  }
  return out;
}

const itemSize = (name: string) => (name === 'color' ? 4 : 3);

/**
 * The first end of each segment, on both of its vertices. The conditional line shader tests a
 * segment from each end; fed the same numbers, both ends reach the same verdict, so a rejected
 * segment can be dropped whole in the vertex shader (one dropped end would streak).
 */
function segmentStarts(position: Float32Array) {
  const out = new Float32Array(position.length);
  for (let segment = 0; segment < position.length; segment += 6) {
    out.set(position.subarray(segment, segment + 3), segment);
    out.set(position.subarray(segment, segment + 3), segment + 3);
  }
  return out;
}

/**
 * An indexed geometry of `attributes`, with vertices that match bit for bit merged into one.
 * Baked parts store every corner of every primitive apart, so neighbours repeat each vertex;
 * sharing them runs the vertex shader (and its batched matrix fetch) about a third as often.
 * Exact matches only, so nothing moves: the same LDraw point through the same matrix comes out
 * the same. An open-addressed table keyed on the position's raw words keeps it linear and free
 * of string keys. Takes over the arrays, which it compacts in place.
 */
function weld(attributes: ReadonlyMap<string, Float32Array>) {
  const count = attributes.get('position')!.length / 3;
  const layout = [...attributes].map(([name, data]) => {
    // -0 draws the same as 0, so it counts as 0.
    for (let i = 0; i < data.length; i++) if (data[i] === 0) data[i] = 0;
    const words = new Uint32Array(data.buffer, data.byteOffset, data.length);
    return { name, data, words, width: data.length / count };
  });
  const position = layout.find(({ name }) => name === 'position')!.words;
  const index = new Uint32Array(count);
  let unique = 0;
  let mask = 1;
  while (mask < count * 2) mask <<= 1;
  // Kept vertex + 1 per slot, so a fresh table reads empty.
  const table = new Int32Array(mask);
  mask--;
  const same = (a: number, b: number) => {
    for (const { width, words } of layout)
      for (let i = 0; i < width; i++)
        if (words[a * width + i] !== words[b * width + i]) return false;
    return true;
  };
  for (let vertex = 0; vertex < count; vertex++) {
    const at = vertex * 3;
    const hash =
      Math.imul(position[at], 0x9e3779b1) ^
      Math.imul(position[at + 1], 0x85ebca77) ^
      Math.imul(position[at + 2], 0xc2b2ae3d);
    for (let slot = (hash ^ (hash >>> 16)) & mask; ; slot = (slot + 1) & mask) {
      const entry = table[slot] - 1;
      if (entry < 0) {
        // Kept vertices move down in place: `unique` never passes `vertex`.
        if (unique !== vertex)
          for (const { width, words } of layout)
            for (let i = 0; i < width; i++) words[unique * width + i] = words[vertex * width + i];
        table[slot] = unique + 1;
        index[vertex] = unique++;
        break;
      }
      if (same(entry, vertex)) {
        index[vertex] = entry;
        break;
      }
    }
  }
  const geometry = new BufferGeometry();
  for (const { name, width, data } of layout)
    geometry.setAttribute(name, new BufferAttribute(data.slice(0, unique * width), width));
  geometry.setIndex(new BufferAttribute(index, 1));
  return geometry;
}

/** The material each draw group of an object uses, with its vertex range. */
function drawGroups(object: Mesh | LineSegments, count: number) {
  const materials: Material[] = Array.isArray(object.material)
    ? object.material
    : [object.material];
  const groups =
    Array.isArray(object.material) && object.geometry.groups.length
      ? object.geometry.groups
      : [{ start: 0, count, materialIndex: 0 }];
  return groups.map((group) => ({
    start: group.start,
    count: Math.min(group.count, count - group.start),
    material: materials[group.materialIndex ?? 0] ?? materials[0],
  }));
}

/** Attribute name to the chunks that make it up. */
type Chunks = Map<string, Float32Array[]>;
/**
 * A part's primitives sorted into its body and the regions that can be left out: each stud,
 * keyed `x:z` in part space, and the hollow underside, keyed `UNDERSIDE`.
 */
type Split = { body: Chunks; studs: Map<string, Chunks> };
/** The region key of a part's hollow underside: its inner walls, ceiling and tubes. */
const UNDERSIDE = 'under';
/** How thick a part's top and walls are, in LDU, with a little slack. */
const SHELL = 3.9;
/** What a part model looks like where it matters for hiding: its studs and its footprint. */
type PartShape = {
  studs: readonly string[];
  studSet: ReadonlySet<string>;
  box: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Whether any faces sit inside the shell, so leaving the underside out saves something. */
  underside: boolean;
};
const emptySplit = (): Split => ({ body: new Map(), studs: new Map() });

/**
 * A stud stands on the part's top (LDraw y = 0, up is -y), 4 LDU tall (a logo adds a little)
 * and 6 LDU in radius, centred on the 10 LDU grid. Anything in that space is also inside a
 * brick pressed onto the stud, so a primitive misread as stud is hidden only where it can't
 * be seen anyway.
 */
const STUD = { top: -5, base: 0.01, radius: 6.5, grid: 10 } as const;
/**
 * The grid points a triangle or segment of `count` vertices from `first` could be a stud
 * around: it sits in the stud's height band and within its radius of the point.
 */
function studCandidates(points: Float32Array, first: number, count: number): string[] {
  let x = 0;
  let z = 0;
  for (let vertex = first; vertex < first + count; vertex++) {
    const y = points[vertex * 3 + 1];
    if (y < STUD.top || y > STUD.base) return [];
    x += points[vertex * 3];
    z += points[vertex * 3 + 2];
  }
  x /= count;
  z /= count;
  const candidates: string[] = [];
  for (const gridX of new Set([Math.floor(x / STUD.grid), Math.ceil(x / STUD.grid)]))
    for (const gridZ of new Set([Math.floor(z / STUD.grid), Math.ceil(z / STUD.grid)])) {
      const centerX = gridX * STUD.grid;
      const centerZ = gridZ * STUD.grid;
      let inside = true;
      for (let vertex = first; inside && vertex < first + count; vertex++)
        inside =
          (points[vertex * 3] - centerX) ** 2 + (points[vertex * 3 + 2] - centerZ) ** 2 <=
          STUD.radius ** 2;
      if (inside) candidates.push(`${centerX + 0}:${centerZ + 0}`);
    }
  return candidates;
}

/**
 * The region a primitive belongs to, if any: its stud (real studs are 20 LDU apart, so one),
 * or the underside when it sits wholly inside the shell, below the top and within the walls.
 */
function regionOf(shape: PartShape, points: Float32Array, first: number, count: number) {
  if (shape.studSet.size) {
    const stud = studCandidates(points, first, count).find((candidate) =>
      shape.studSet.has(candidate),
    );
    if (stud !== undefined) return stud;
  }
  const { box } = shape;
  for (let vertex = first; vertex < first + count; vertex++) {
    const x = points[vertex * 3];
    const z = points[vertex * 3 + 2];
    if (
      points[vertex * 3 + 1] < SHELL ||
      x < box.minX + SHELL ||
      x > box.maxX - SHELL ||
      z < box.minZ + SHELL ||
      z > box.maxZ - SHELL
    )
      return undefined;
  }
  return UNDERSIDE;
}

/**
 * Sorts primitives of `size` vertices into the body or their stud, keeping runs together:
 * a stud's primitives come from one sub-file, so they arrive in a row.
 */
function splitPrimitives(
  split: Split,
  shape: PartShape,
  attributes: Record<string, Float32Array>,
  size: number,
) {
  const points = attributes.position;
  const primitives = points.length / 3 / size;
  const push = (stud: string | undefined, from: number, to: number) => {
    if (to <= from) return;
    let target = split.body;
    if (stud !== undefined) {
      target = split.studs.get(stud) ?? new Map();
      split.studs.set(stud, target);
    }
    const vertices = points.length / 3;
    for (const [name, data] of Object.entries(attributes)) {
      const width = data.length / vertices;
      const chunks = target.get(name) ?? [];
      chunks.push(data.subarray(from * size * width, to * size * width));
      target.set(name, chunks);
    }
  };
  let runStart = 0;
  let runStud: string | undefined;
  for (let primitive = 0; primitive < primitives; primitive++) {
    const stud = regionOf(shape, points, primitive * size, size);
    if (stud === runStud) continue;
    push(runStud, runStart, primitive);
    runStart = primitive;
    runStud = stud;
  }
  push(runStud, runStart, primitives);
}

/** The body plus every stud not in `covered`, attribute by attribute. */
function gather(split: Split, covered: ReadonlySet<string>) {
  const parts = [split.body];
  for (const [stud, chunks] of split.studs) if (!covered.has(stud)) parts.push(chunks);
  const out = new Map<string, Float32Array>();
  for (const name of new Set(parts.flatMap((chunks) => [...chunks.keys()])))
    out.set(name, concat(parts.flatMap((chunks) => chunks.get(name) ?? [])));
  return out;
}

/**
 * A part in one color, read once: faces per finish and each kind of edge, split into body
 * and studs so any set of covered studs can be left out cheaply.
 */
type Baked = {
  key: string;
  faces: { finish: string; material: MeshStandardMaterial; split: Split }[];
  lines: Record<LineKind, Split>;
  /** How many looks are cut from it; it is dropped with the last one. */
  looks: number;
};

function bakePart(
  model: Group,
  color: number,
  colorize: Colorize,
  key: string,
  shape: PartShape,
): Baked {
  const colored = colorize(model, color);
  colored.updateMatrixWorld(true);
  const faces = new Map<string, { material: MeshStandardMaterial; split: Split }>();
  const lines = Object.fromEntries(LINE_KINDS.map((kind) => [kind, emptySplit()])) as Record<
    LineKind,
    Split
  >;
  const used = new Set<Material>();
  colored.traverse((object) => {
    if (!(object instanceof Mesh || object instanceof LineSegments)) return;
    const source = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry;
    const matrix = object.matrixWorld;
    const linear = new Matrix3().setFromMatrix4(matrix);
    const count = source.getAttribute('position').count;
    // A mirrored sub-part turns its triangles inside out; reversing them keeps faces outward.
    const flip = object instanceof Mesh && matrix.determinant() < 0;
    const slice = (
      name: string,
      start: number,
      length: number,
      kind: 'point' | 'vector' | 'normal',
    ) => {
      const attribute = source.getAttribute(name) as BufferAttribute;
      const raw = new Float32Array(length * 3);
      const vector = new Vector3();
      const normalMatrix = kind === 'normal' ? new Matrix3().getNormalMatrix(matrix) : linear;
      for (let vertex = 0; vertex < length; vertex++) {
        const corner = vertex % 3;
        const from = flip && corner > 0 ? vertex - corner + 3 - corner : vertex;
        vector.fromBufferAttribute(attribute, start + from);
        if (kind === 'point') vector.applyMatrix4(matrix);
        else vector.applyMatrix3(normalMatrix);
        if (kind === 'normal') vector.normalize();
        vector.toArray(raw, vertex * 3);
      }
      return raw;
    };
    if (object instanceof Mesh && !source.getAttribute('normal')) source.computeVertexNormals();
    for (const group of drawGroups(object, count)) {
      if (group.count <= 0) continue;
      used.add(group.material);
      const tint = (group.material as MeshStandardMaterial | LineBasicMaterial).color;
      const glass = group.material.transparent;
      if (object instanceof Mesh) {
        const material = group.material as MeshStandardMaterial;
        const finish = `${material.roughness}:${material.metalness}:${material.emissive.getHexString()}${glass ? ':glass' : ''}`;
        let face = faces.get(finish);
        if (!face) {
          face = { material, split: emptySplit() };
          faces.set(finish, face);
        }
        splitPrimitives(
          face.split,
          shape,
          {
            position: slice('position', group.start, group.count, 'point'),
            normal: slice('normal', group.start, group.count, 'normal'),
            color: fill(tint, group.count, glass ? material.opacity : undefined),
          },
          3,
        );
      } else {
        const conditional = Boolean((object as { isConditionalLine?: boolean }).isConditionalLine);
        const kind: LineKind = glass
          ? conditional
            ? 'glassConditional'
            : 'glassEdge'
          : conditional
            ? 'conditional'
            : 'edge';
        const attributes: Record<string, Float32Array> = {
          position: slice('position', group.start, group.count, 'point'),
          color: fill(tint, group.count, group.material.opacity),
        };
        if (conditional) {
          attributes.control0 = slice('control0', group.start, group.count, 'point');
          attributes.control1 = slice('control1', group.start, group.count, 'point');
          attributes.direction = slice('direction', group.start, group.count, 'vector');
          attributes.segmentStart = segmentStarts(attributes.position);
        }
        splitPrimitives(lines[kind], shape, attributes, 2);
      }
    }
    if (source !== object.geometry) source.dispose();
  });
  // The colored copy was only read, never drawn; its materials can go.
  if (colored !== model) for (const material of used) material.dispose();
  return {
    key,
    faces: [...faces.entries()].map(([finish, face]) => ({ finish, ...face })),
    lines,
    looks: 0,
  };
}

/** The part with the `covered` studs left out, ready to place. */
function bakeLook(baked: Baked, covered: ReadonlySet<string>, key: string): Look {
  const surfaces: Surface[] = [];
  for (const { finish, material, split } of baked.faces) {
    const attributes = gather(split, covered);
    if (!attributes.get('position')?.length) continue;
    // Indexed, also for the BVH: `indirect` leaves the welded index as it is.
    const geometry = weld(attributes);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.boundsTree = new MeshBVH(geometry, BVH_OPTIONS);
    surfaces.push({ key: `${key}:${finish}`, finish, material, geometry });
  }
  const lineGeometry = (kind: LineKind) => {
    const attributes = gather(baked.lines[kind], covered);
    if (!attributes.get('position')?.length) return null;
    // Plain edges share their ends; conditional ones carry per-segment controls, so can't.
    if (INDEXED_LINES.has(kind)) {
      const geometry = weld(attributes);
      geometry.computeBoundingSphere();
      return geometry;
    }
    const geometry = new BufferGeometry();
    for (const [name, data] of attributes)
      geometry.setAttribute(name, new BufferAttribute(data, itemSize(name)));
    geometry.computeBoundingSphere();
    return geometry;
  };
  return {
    key,
    baked,
    surfaces,
    lines: Object.fromEntries(LINE_KINDS.map((kind) => [kind, lineGeometry(kind)])) as Record<
      LineKind,
      BufferGeometry | null
    >,
    users: 0,
  };
}

/**
 * The studs a part model has, as `x:z` in part space, and its footprint. Big plates get a look
 * per coverage pattern, which is still far less than drawing every covered stud. The side of a stud is also within reach of the next grid point over, so a
 * point only counts as a stud when its faces wrap all the way around it.
 */
function readShape(model: Group): PartShape {
  model.updateMatrixWorld(true);
  const box = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  const corners: number[] = [];
  const reach = new Map<string, { minX: number; maxX: number; minZ: number; maxZ: number }>();
  const point = new Vector3();
  const points = new Float32Array(9);
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const geometry = object.geometry as BufferGeometry;
    const position = geometry.getAttribute('position');
    const index = geometry.index;
    const triangles = (index ? index.count : position.count) / 3;
    for (let triangle = 0; triangle < triangles; triangle++) {
      for (let corner = 0; corner < 3; corner++) {
        const vertex = triangle * 3 + corner;
        point
          .fromBufferAttribute(position, index ? index.getX(vertex) : vertex)
          .applyMatrix4(object.matrixWorld)
          .toArray(points, corner * 3);
        box.minX = Math.min(box.minX, point.x);
        box.maxX = Math.max(box.maxX, point.x);
        box.minZ = Math.min(box.minZ, point.z);
        box.maxZ = Math.max(box.maxZ, point.z);
      }
      corners.push(...points);
      for (const candidate of studCandidates(points, 0, 3)) {
        const [centerX, centerZ] = candidate.split(':').map(Number);
        const extent = reach.get(candidate) ?? {
          minX: Infinity,
          maxX: -Infinity,
          minZ: Infinity,
          maxZ: -Infinity,
        };
        for (let corner = 0; corner < 3; corner++) {
          extent.minX = Math.min(extent.minX, points[corner * 3] - centerX);
          extent.maxX = Math.max(extent.maxX, points[corner * 3] - centerX);
          extent.minZ = Math.min(extent.minZ, points[corner * 3 + 2] - centerZ);
          extent.maxZ = Math.max(extent.maxZ, points[corner * 3 + 2] - centerZ);
        }
        reach.set(candidate, extent);
      }
    }
  });
  const around = 4;
  const studs = [...reach]
    .filter(
      ([, extent]) =>
        extent.minX <= -around &&
        extent.maxX >= around &&
        extent.minZ <= -around &&
        extent.maxZ >= around,
    )
    .map(([stud]) => stud);
  studs.sort();
  const shape: PartShape = { studs, studSet: new Set(studs), box, underside: false };
  // The footprint is only known once every face is read, so the underside takes a second look.
  const all = new Float32Array(corners);
  for (let triangle = 0; !shape.underside && triangle < all.length / 9; triangle++)
    shape.underside = regionOf(shape, all, triangle * 3, 3) === UNDERSIDE;
  return shape;
}

/**
 * Parts whose underside is only open at the bottom: plain bricks, plates and tiles. Arches,
 * windows and doors open to the side, and the faces of slopes and round parts can reach inside
 * the shell, so those keep their undersides.
 */
const closedSides = (partId: string) => getPart(partId).shape === undefined;

/** Opaque colors hide what they cover; studs under see-through bricks stay. */
const OPAQUE_COLORS = new Set(COLORS.filter((color) => color.alpha >= 255).map(({ id }) => id));
const half = (value: number) => Math.round(value * 2) / 2 + 0;
const siteKey = (x: number, y: number, z: number) => `${half(x)}:${half(y)}:${half(z)}`;

function brickMatrix(brick: Brick, buildArea: number, explode: boolean) {
  const transform = getLDrawTransform(brick);
  const [a, b, c, d, e, f, g, h, i] = transform.matrix;
  return new Matrix4()
    .set(a, b, c, 0, d, e, f, 0, g, h, i, 0, 0, 0, 0, 1)
    .setPosition(
      transform.x - buildArea * 10,
      transform.y - (explode ? brick.y * 0.18 * 20 : 0),
      transform.z - buildArea * 10,
    );
}

const PLACEMENT_KEYS = [
  'partId',
  'color',
  'x',
  'y',
  'z',
  'rotation',
  'facing',
  'upsideDown',
] as const;

/** Everything a brick's placement depends on; the same key means nothing to redo. */
function placementKey(
  brick: Brick,
  model: Group,
  buildArea: number,
  explode: boolean,
  covered = '',
) {
  return `${PLACEMENT_KEYS.map((name) => String(brick[name] ?? '')).join(':')}:${model.uuid}:${buildArea}:${explode}|${covered}`;
}
/** What the batch knows of a brick since the last update. */
type Tracked = {
  brick: Brick;
  model: Group;
  /** Where its model's studs are, as site keys in `shape.studs` order; only for opaque bricks. */
  studSites: readonly string[];
  /** Its receivers and studs as site keys, when it is opaque and so covers or closes them off. */
  receivers: readonly string[];
  studs: readonly string[];
  /** Whether its underside is left out once every receiver sits on an opaque stud. */
  closable: boolean;
  covered: string;
  key: string;
};

const samePlacement = (first: Brick, second: Brick) =>
  first === second || PLACEMENT_KEYS.every((name) => first[name] === second[name]);

function addTo(map: Map<string, Set<string>>, key: string, id: string) {
  const ids = map.get(key);
  if (ids) ids.add(id);
  else map.set(key, new Set([id]));
}
function removeFrom(map: Map<string, Set<string>>, key: string, id: string) {
  const ids = map.get(key);
  if (!ids) return;
  ids.delete(id);
  if (!ids.size) map.delete(key);
}

const probe = new Mesh();
const probeSphere = new Sphere();

/**
 * Raycasts each visible instance against its own part geometry's BVH, so a hit costs a few
 * box tests per brick under the ray rather than every triangle of the batch.
 */
function raycastLayer(layer: Layer, raycaster: Raycaster, intersects: Intersection[]) {
  const mesh = layer.mesh;
  probe.material = mesh.material;
  const hits: Intersection[] = [];
  for (let id = 0; id < layer.size; id++) {
    if (layer.brickIds[id] === undefined) continue;
    const geometry = layer.sources[mesh.getGeometryIdAt(id)];
    mesh.getMatrixAt(id, probe.matrixWorld).premultiply(mesh.matrixWorld);
    probeSphere.copy(geometry.boundingSphere!).applyMatrix4(probe.matrixWorld);
    if (!raycaster.ray.intersectsSphere(probeSphere)) continue;
    probe.geometry = geometry;
    probe.raycast(raycaster, hits);
    for (const hit of hits) intersects.push({ ...hit, object: mesh, batchId: id });
    hits.length = 0;
  }
}

/**
 * A batched mesh drawn as line segments. three picks the draw mode from these flags and the
 * multi-draw path from `isBatchedMesh`, so every brick's edges are one draw, each placed by its
 * own matrix on the GPU: a part's edges are stored once rather than copied for every brick.
 */
class BatchedLines extends BatchedMesh {
  readonly isLine = true;
  readonly isLineSegments = true;

  /** `indexed` lines share vertices between segments, which needs room for an index. */
  constructor(material: Material, indexed: boolean) {
    super(64, 8192, indexed ? 8192 : 0, material);
    (this as unknown as { isMesh: boolean }).isMesh = false;
    this.castShadow = false;
    this.receiveShadow = false;
    // Opaque edges need no order, and see-through ones are too thin to show one.
    this.sortObjects = false;
    this.raycast = () => {};
  }
}

/**
 * Where a vertex goes to not be drawn: outside the clip volume, so when both ends of a segment
 * go there the GPU drops it before rasterizing. A fragment `discard` would still pay for every
 * pixel of the segment.
 */
const OFFSCREEN = 'vec4(2.0, 2.0, 2.0, 1.0)';

/**
 * Teaches LDraw's conditional line shader the batched matrices: its line ends, control points
 * and direction all move with the brick. (The basic line shader knows them already.) It also
 * tests from `segmentStart` rather than each vertex's own position, so both ends agree, and
 * drops a hidden segment in the vertex shader; the fragment discard stays as a backstop.
 */
function batchConditionalLines(shader: { vertexShader: string }) {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      '#include <common>\nattribute vec3 segmentStart;\n#include <batching_pars_vertex>',
    )
    .replace('#include <color_vertex>', '#include <color_vertex>\n#include <batching_vertex>')
    .replace(
      'vec4 p0 = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );',
      'vec4 p0 = projectionMatrix * modelViewMatrix * vec4( segmentStart, 1.0 );',
    )
    .replace('vec4( position + direction, 1.0 )', 'vec4( segmentStart + direction, 1.0 )')
    .replaceAll('modelViewMatrix * vec4(', 'modelViewMatrix * batchingMatrix * vec4(')
    .replace(
      '#include <logdepthbuf_vertex>',
      `#include <logdepthbuf_vertex>
      if (discardFlag > 0.5) gl_Position = ${OFFSCREEN};`,
    );
}

/** How many device pixels a stud has to span before edges start to show, and fully show. */
export const EDGE_FADE_PIXELS = { hidden: 5, full: 14 } as const;

/**
 * Fades a line material out as studs shrink on screen. Zoomed out, a stud's dozen-plus outline
 * segments would land in a few pixels and turn into noise; counting device pixels keeps edges
 * longer on high-density screens, where they still resolve.
 */
function fadeWithZoom(material: Material, viewport: { value: number }) {
  const before = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    shader.uniforms.edgeViewport = viewport;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float edgeViewport;
        varying float vEdgeFade;`,
      )
      .replace(
        '#include <logdepthbuf_vertex>',
        `#include <logdepthbuf_vertex>
        // Pixels one world unit (a stud) spans at the brick's origin, for perspective and ortho
        // alike. One depth per brick gives all its vertices the same fade, so a faded-out
        // segment loses both ends here; a brick around the camera counts as close.
        vec4 edgeOrigin = vec4(0.0, 0.0, 0.0, 1.0);
        #ifdef USE_BATCHING
          edgeOrigin = batchingMatrix[3];
        #endif
        float edgeDepth = max((projectionMatrix * modelViewMatrix * edgeOrigin).w, 1e-3);
        float studPixels = projectionMatrix[1][1] * 0.5 * edgeViewport / edgeDepth;
        vEdgeFade = smoothstep(${EDGE_FADE_PIXELS.hidden.toFixed(1)}, ${EDGE_FADE_PIXELS.full.toFixed(1)}, studPixels);
        if (vEdgeFade <= 0.0) gl_Position = ${OFFSCREEN};`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vEdgeFade;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (vEdgeFade <= 0.0) discard;
        diffuseColor.a *= vEdgeFade;`,
      );
  };
  material.customProgramCacheKey = () => 'ldraw-edge-fade';
  // Fading needs blending, which three only enables for transparent materials.
  material.transparent = true;
}

const drawingBuffer = new Vector2();

/**
 * Every LDraw brick in one batched mesh: each finish (plain, pearl, chrome…) is a single
 * multi-draw call with colors in the vertices, and see-through faces share one more layer that
 * three sorts back to front per brick, with each color's opacity in the vertex alpha. Edges are
 * four more batched draws: plain and conditional, opaque and see-through, with each part's
 * edges stored once and placed per brick on the GPU.
 * Updates are incremental: only bricks that changed are rewritten, and freed slots are reused.
 */
export class LDrawBatch {
  readonly object = new Group();
  private readonly layers = new Map<string, Layer>();
  private readonly baked = new Map<string, Baked>();
  private readonly looks = new Map<string, Look>();
  /** Looks no placement uses since the last update, freed when it finishes. */
  private readonly idle = new Set<Look>();
  private readonly shapes = new WeakMap<Group, PartShape>();
  /** Each brick's coverage and placement key, kept up to date for the last entries. */
  private readonly tracked = new Map<string, Tracked>();
  private trackedFor?: { entries: readonly BatchEntry[]; buildArea: number; explode: boolean };
  /** Opaque bricks' receivers and studs by site key, with the bricks that have one there. */
  private readonly receiverSites = new Map<string, Set<string>>();
  private readonly studSites = new Map<string, Set<string>>();
  /** Bricks by the sites of their model studs, and by their receivers when closable. */
  private readonly studOwners = new Map<string, Set<string>>();
  private readonly underOwners = new Map<string, Set<string>>();
  private readonly placements = new Map<string, Placement>();
  private readonly lineLayers: Record<LineKind, Layer>;

  private readonly colorize: Colorize;
  private readonly hideCovered: boolean;
  private readonly solidGround: boolean;

  /**
   * `fadeEdges` fades edges out as the camera pulls back, for the interactive view; renders at
   * a fixed scale, like the instructions, keep them as they are. `hideCovered` leaves out what
   * no camera can see: studs an opaque brick sits on, and the hollow undersides of opaque bricks
   * whose bottom is closed off. `solidGround` says the build stands on something opaque, so the
   * undersides of bricks on the ground are closed off too.
   */
  constructor(
    colorize: Colorize = coloredLDrawModel,
    {
      fadeEdges = false,
      hideCovered = true,
      solidGround = false,
    }: { fadeEdges?: boolean; hideCovered?: boolean; solidGround?: boolean } = {},
  ) {
    this.colorize = colorize;
    this.hideCovered = hideCovered;
    this.solidGround = solidGround;
    const viewport = { value: 1 };
    this.object.name = 'Native brick batch';
    this.object.scale.set(0.05, -0.05, 0.05);
    const lineMaterial = (kind: LineKind) => {
      const glass = kind.startsWith('glass');
      const conditional = kind.endsWith('onditional');
      const material = conditional
        ? new LDrawConditionalLineMaterial({ fog: true })
        : new LineBasicMaterial();
      material.vertexColors = true;
      material.transparent = glass;
      material.depthWrite = !glass;
      (material as unknown as { color: Color }).color.set(0xffffff);
      if (conditional) {
        material.onBeforeCompile = batchConditionalLines;
        material.customProgramCacheKey = () => 'ldraw-batched-conditional';
      }
      if (fadeEdges) fadeWithZoom(material, viewport);
      return material;
    };
    this.lineLayers = Object.fromEntries(
      LINE_KINDS.map((kind): [LineKind, Layer] => {
        // three types `customSort` against its own class, so the subclass needs widening.
        const mesh = new BatchedLines(
          lineMaterial(kind),
          INDEXED_LINES.has(kind),
        ) as unknown as BatchedMesh;
        mesh.visible = false;
        if (fadeEdges) {
          // Faded edges blend, so they join the transparent queue: ahead of glass, which draws
          // over them, as the opaque edges they are.
          if ((mesh.material as Material).depthWrite) {
            mesh.renderOrder = -1;
            // Ambient occlusion (N8AO) redraws transparent objects in two passes of their own
            // every frame; these write depth like opaque ones, so they can skip that.
            mesh.userData.treatAsOpaque = true;
          }
          // `this`, not a bound mesh: dispose() hands this hook on to the meshes it recreates.
          mesh.onBeforeRender = function (this: BatchedMesh, renderer, ...rest) {
            viewport.value =
              renderer.getRenderTarget()?.height ?? renderer.getDrawingBufferSize(drawingBuffer).y;
            BatchedMesh.prototype.onBeforeRender.call(this, renderer, ...rest);
          };
        }
        this.object.add(mesh);
        return [
          kind,
          { mesh, geometries: new Map(), sources: [], free: [], brickIds: [], size: 0, dead: 0 },
        ];
      }),
    ) as Record<LineKind, Layer>;
  }

  /** The edge objects, for callers that move them onto their own render layer. */
  get lines(): readonly BatchedMesh[] {
    return LINE_KINDS.map((kind) => this.lineLayers[kind].mesh);
  }

  /** The face meshes, one per finish in use. */
  get meshes(): readonly BatchedMesh[] {
    return [...this.layers.values()].map((layer) => layer.mesh);
  }

  /** Brings the batch in line with `entries` in one go: right for edits, which touch a few. */
  update(entries: readonly BatchEntry[], buildArea: number, explode = false) {
    this.run++;
    const steps = this.steps(entries, buildArea, explode);
    while (!steps.next().done);
  }

  /**
   * The same as `update`, in slices of about `budget` ms between frames, so swapping in a big
   * build keeps the page responsive. A newer update or `dispose` cancels it; it resolves to
   * whether it ran to the end. `onProgress` hears how many changed bricks are placed so far.
   */
  async updateInSlices(
    entries: readonly BatchEntry[],
    buildArea: number,
    explode = false,
    {
      budget = 12,
      onProgress,
    }: { budget?: number; onProgress?: (done: number, total: number) => void } = {},
  ): Promise<boolean> {
    const run = ++this.run;
    const progress = { done: 0, total: 0 };
    const steps = this.steps(entries, buildArea, explode, progress);
    for (;;) {
      const start = performance.now();
      for (;;) {
        if (steps.next().done) {
          onProgress?.(progress.total, progress.total);
          return true;
        }
        if (performance.now() - start >= budget) break;
      }
      // Bricks placed so far may sit outside the old bounds, which would cull them.
      this.refreshBounds();
      onProgress?.(progress.done, progress.total);
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (run !== this.run) return false;
    }
  }

  /** How many changed bricks `entries` would place, to decide between the two ways to update. */
  changes(entries: readonly BatchEntry[], buildArea: number, explode = false) {
    const tracked = this.track(entries, buildArea, explode);
    let count = 0;
    for (const { brick } of entries)
      if (this.placements.get(brick.id)?.key !== tracked.get(brick.id)!.key) count++;
    return count;
  }

  /** A part model's studs and footprint, read once per model. */
  private shapeOf(model: Group) {
    let shape = this.shapes.get(model);
    if (!shape) {
      shape = readShape(model);
      this.shapes.set(model, shape);
    }
    return shape;
  }

  /**
   * Brings each brick's coverage and placement key in line with `entries`. What of a brick no
   * camera can see is a sorted list of region keys: the studs an opaque brick is pressed onto,
   * and the underside when the brick is opaque and its bottom is closed off, by the ground or by
   * opaque studs under every one of its receivers. Exploded bricks float apart, so nothing is
   * covered then. Only bricks that changed, and those whose studs or receivers meet theirs, are
   * worked out again.
   */
  private track(entries: readonly BatchEntry[], buildArea: number, explode: boolean) {
    const last = this.trackedFor;
    const tracked = this.tracked;
    if (last?.entries === entries && last.buildArea === buildArea && last.explode === explode)
      return tracked;
    // A new board size or exploding changes every key, and exploding every coverage.
    const rekey = !last || last.buildArea !== buildArea || last.explode !== explode;
    const recover = !last || last.explode !== explode;
    this.trackedFor = { entries, buildArea, explode };
    const changed: BatchEntry[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      seen.add(entry.brick.id);
      const current = tracked.get(entry.brick.id);
      if (!current || current.model !== entry.model || !samePlacement(current.brick, entry.brick))
        changed.push(entry);
    }
    // Sites where an opaque receiver or stud came or went: what meets them may change.
    const receiversMoved = new Set<string>();
    const studsMoved = new Set<string>();
    const forget = (id: string, current: Tracked) => {
      for (const key of current.receivers) {
        removeFrom(this.receiverSites, key, id);
        receiversMoved.add(key);
      }
      for (const key of current.studs) {
        removeFrom(this.studSites, key, id);
        studsMoved.add(key);
      }
      for (const key of current.studSites) removeFrom(this.studOwners, key, id);
      if (current.closable)
        for (const key of current.receivers) removeFrom(this.underOwners, key, id);
    };
    if (seen.size < tracked.size)
      for (const [id, current] of tracked)
        if (!seen.has(id)) {
          forget(id, current);
          tracked.delete(id);
        }
    const coverable = this.hideCovered && !explode;
    for (const { brick, model } of changed) {
      const current = tracked.get(brick.id);
      if (current) forget(brick.id, current);
      const opaque = OPAQUE_COLORS.has(brick.color);
      const sites = (surface: 'top' | 'bottom') =>
        opaque
          ? getConnectionSites(brick, surface).map((site) => siteKey(site.x, site.y, site.z))
          : [];
      let studSites: string[] = [];
      let closable = false;
      // Side-mounted and upside-down parts point their studs and underside elsewhere, and
      // see-through ones show what is inside them.
      const transform = opaque && !brick.facing ? getLDrawTransform(brick) : undefined;
      if (transform && transform.matrix[4] === 1) {
        const shape = this.shapeOf(model);
        const { x, y, z, matrix } = transform;
        studSites = shape.studs.map((stud) => {
          const [studX, studZ] = stud.split(':').map(Number);
          return siteKey(
            (matrix[0] * studX + matrix[2] * studZ + x) / 20,
            -(matrix[3] * studX + matrix[5] * studZ + y) / 8,
            (matrix[6] * studX + matrix[8] * studZ + z) / 20,
          );
        });
        closable = shape.underside && closedSides(brick.partId);
      }
      const next: Tracked = {
        brick,
        model,
        studSites,
        receivers: sites('bottom'),
        studs: sites('top'),
        closable,
        covered: '',
        key: '',
      };
      for (const key of next.receivers) {
        addTo(this.receiverSites, key, brick.id);
        receiversMoved.add(key);
      }
      for (const key of next.studs) {
        addTo(this.studSites, key, brick.id);
        studsMoved.add(key);
      }
      for (const key of studSites) addTo(this.studOwners, key, brick.id);
      if (closable) for (const key of next.receivers) addTo(this.underOwners, key, brick.id);
      tracked.set(brick.id, next);
    }
    const affected = new Set<string>(
      recover ? tracked.keys() : changed.map(({ brick }) => brick.id),
    );
    if (!recover) {
      for (const key of receiversMoved)
        for (const id of this.studOwners.get(key) ?? []) affected.add(id);
      for (const key of studsMoved)
        for (const id of this.underOwners.get(key) ?? []) affected.add(id);
    }
    for (const id of affected) {
      const current = tracked.get(id)!;
      let covered = '';
      if (coverable && current.studSites.length + Number(current.closable) > 0) {
        const { studs } = this.shapeOf(current.model);
        const hidden = studs.filter((_, index) => this.receiverSites.has(current.studSites[index]));
        if (
          current.closable &&
          ((this.solidGround && current.brick.y === 0) ||
            (current.receivers.length > 0 &&
              current.receivers.every((key) => this.studSites.has(key))))
        )
          hidden.push(UNDERSIDE);
        covered = hidden.join(',');
      }
      if (covered !== current.covered || !current.key) {
        current.covered = covered;
        current.key = '';
      }
    }
    for (const current of tracked.values())
      if (rekey || !current.key)
        current.key = placementKey(
          current.brick,
          current.model,
          buildArea,
          explode,
          current.covered || undefined,
        );
    return tracked;
  }

  private run = 0;

  /** The update as steps: one per brick placed, then the lines and bounds as a last step. */
  private *steps(
    entries: readonly BatchEntry[],
    buildArea: number,
    explode: boolean,
    progress = { done: 0, total: 0 },
  ): Generator<void, void> {
    const tracked = this.track(entries, buildArea, explode);
    const changed: BatchEntry[] = [];
    for (const entry of entries)
      if (this.placements.get(entry.brick.id)?.key !== tracked.get(entry.brick.id)!.key)
        changed.push(entry);
    let removed = false;
    for (const [id, placement] of this.placements)
      if (!tracked.has(id)) {
        this.release(placement);
        this.placements.delete(id);
        removed = true;
      }
    // A cancelled run may have left looks to free.
    if (!changed.length && !removed) return this.collect();
    progress.total = changed.length;
    for (const [index, { brick, model }] of changed.entries()) {
      const { covered: hidden, key } = tracked.get(brick.id)!;
      const current = this.placements.get(brick.id);
      // A cancelled run may have placed this brick already.
      if (current?.key === key) continue;
      if (current) this.release(current);
      this.placements.set(brick.id, this.place(brick, model, key, buildArea, explode, hidden));
      progress.done = index + 1;
      yield;
    }
    this.collect();
    this.refreshBounds();
  }

  /**
   * Frees the looks no placement uses any more, with their geometries in the batch, and parts
   * no look is cut from. Waiting for the end of an update keeps a look that one brick lets go
   * of and another picks up, as when a brick moves without changing what covers it.
   */
  private collect() {
    if (!this.idle.size) return;
    const gone = new Map<Layer, Set<number>>();
    const drop = (layer: Layer, key: string) => {
      const id = layer.geometries.get(key);
      if (id === undefined) return;
      layer.geometries.delete(key);
      layer.dead += layer.sources[id].getAttribute('position').count;
      delete layer.sources[id];
      const ids = gone.get(layer) ?? new Set();
      gone.set(layer, ids.add(id));
    };
    for (const look of this.idle) {
      for (const surface of look.surfaces) {
        const layer = this.layers.get(surface.finish);
        if (layer) drop(layer, surface.key);
        surface.geometry.dispose();
      }
      for (const kind of LINE_KINDS) {
        const geometry = look.lines[kind];
        if (!geometry) continue;
        drop(this.lineLayers[kind], look.key);
        geometry.dispose();
      }
      this.looks.delete(look.key);
      if (--look.baked.looks === 0) this.baked.delete(look.baked.key);
    }
    this.idle.clear();
    for (const [layer, ids] of gone) {
      // Deleting a geometry deletes the hidden slots still pointing at it, so they leave the
      // free list; three hands their ids out again first.
      layer.free = layer.free.filter((slot) => !ids.has(layer.mesh.getGeometryIdAt(slot)));
      for (const id of ids) layer.mesh.deleteGeometry(id);
    }
  }

  private refreshBounds() {
    for (const layer of this.layers.values()) {
      layer.mesh.computeBoundingBox();
      layer.mesh.computeBoundingSphere();
    }
    for (const layer of Object.values(this.lineLayers)) {
      // An empty batch still costs a draw call; a hidden one doesn't.
      layer.mesh.visible = layer.mesh.instanceCount > layer.free.length;
      if (!layer.mesh.visible) continue;
      layer.mesh.computeBoundingBox();
      layer.mesh.computeBoundingSphere();
    }
  }

  /** A snapshot of how the batch is laid out, for the debug overlay. */
  stats(): BatchStats {
    const next = (mesh: BatchedMesh) =>
      mesh as unknown as { _nextVertexStart: number; _nextIndexStart: number };
    const segments = (kind: LineKind) => {
      const { mesh, sources, brickIds, size } = this.lineLayers[kind];
      // Two indices a segment when indexed, two vertices when not.
      let ends = 0;
      for (let id = 0; id < size; id++) {
        if (brickIds[id] === undefined) continue;
        const geometry = sources[mesh.getGeometryIdAt(id)];
        ends += geometry.index?.count ?? geometry.getAttribute('position').count;
      }
      return ends / 2;
    };
    const hidden = [...this.placements.values()].flatMap(({ key }) =>
      key.split('|')[1].split(',').filter(Boolean),
    );
    return {
      bricks: this.placements.size,
      looks: this.looks.size,
      coveredStuds: hidden.filter((region) => region !== UNDERSIDE).length,
      closedUndersides: hidden.filter((region) => region === UNDERSIDE).length,
      edgeSegments: segments('edge') + segments('glassEdge'),
      conditionalSegments: segments('conditional') + segments('glassConditional'),
      layers: [...this.layers.entries()].map(([finish, layer]) => ({
        finish,
        instances: layer.mesh.instanceCount - layer.free.length,
        free: layer.size - layer.mesh.instanceCount + layer.free.length,
        maxInstances: layer.mesh.maxInstanceCount,
        geometries: layer.geometries.size,
        vertices: next(layer.mesh)._nextVertexStart,
        maxVertices: next(layer.mesh)._nextVertexStart + layer.mesh.unusedVertexCount,
        indices: next(layer.mesh)._nextIndexStart,
        maxIndices: next(layer.mesh)._nextIndexStart + layer.mesh.unusedIndexCount,
      })),
    };
  }

  /** Frees GPU resources; the batch is left empty and can be filled again. */
  dispose() {
    this.run++;
    for (const layer of this.layers.values()) {
      this.object.remove(layer.mesh);
      layer.mesh.dispose();
      (layer.mesh.material as Material).dispose();
    }
    for (const kind of LINE_KINDS) {
      const layer = this.lineLayers[kind];
      layer.mesh.dispose();
      (layer.mesh.material as Material).dispose();
      // Left empty and hidden, ready to be filled again.
      const mesh = new BatchedLines(
        layer.mesh.material as Material,
        INDEXED_LINES.has(kind),
      ) as unknown as BatchedMesh;
      Object.assign(mesh, {
        renderOrder: layer.mesh.renderOrder,
        onBeforeRender: layer.mesh.onBeforeRender,
        userData: { ...layer.mesh.userData },
      });
      mesh.layers.mask = layer.mesh.layers.mask;
      mesh.visible = false;
      this.object.remove(layer.mesh);
      this.object.add(mesh);
      Object.assign(layer, {
        mesh,
        geometries: new Map(),
        sources: [],
        free: [],
        brickIds: [],
        size: 0,
        dead: 0,
      });
    }
    for (const look of this.looks.values()) {
      for (const surface of look.surfaces) surface.geometry.dispose();
      for (const geometry of Object.values(look.lines)) geometry?.dispose();
    }
    this.layers.clear();
    this.baked.clear();
    this.looks.clear();
    this.idle.clear();
    this.placements.clear();
    this.tracked.clear();
    this.trackedFor = undefined;
    for (const sites of [this.receiverSites, this.studSites, this.studOwners, this.underOwners])
      sites.clear();
  }

  private look(brick: Brick, model: Group, hidden: string) {
    const partKey = `${model.uuid}:${brick.color}`;
    const key = `${partKey}|${hidden}`;
    let look = this.looks.get(key);
    if (!look) {
      let baked = this.baked.get(partKey);
      if (!baked) {
        baked = bakePart(model, brick.color, this.colorize, partKey, this.shapeOf(model));
        this.baked.set(partKey, baked);
      }
      look = bakeLook(baked, new Set(hidden ? hidden.split(',') : []), key);
      baked.looks++;
      this.looks.set(key, look);
    }
    return look;
  }

  private layer(surface: Surface) {
    let layer = this.layers.get(surface.finish);
    if (layer) return layer;
    const glass = surface.finish.endsWith(':glass');
    const material = new MeshStandardMaterial({
      transparent: glass,
      depthWrite: !glass,
      roughness: surface.material.roughness,
      metalness: surface.material.metalness,
      emissive: surface.material.emissive,
      vertexColors: true,
      polygonOffset: true,
      polygonOffsetFactor: 1,
    });
    const mesh = new BatchedMesh(64, 8192, 8192, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    layer = {
      mesh,
      geometries: new Map(),
      sources: [],
      free: [],
      brickIds: [],
      size: 0,
      dead: 0,
    };
    mesh.userData.brickIds = layer.brickIds;
    const owner = layer;
    mesh.raycast = (raycaster, intersects) => raycastLayer(owner, raycaster, intersects);
    this.layers.set(surface.finish, layer);
    this.object.add(mesh);
    return layer;
  }

  private geometryId(layer: Layer, key: string, geometry: BufferGeometry) {
    const existing = layer.geometries.get(key);
    if (existing !== undefined) return existing;
    const mesh = layer.mesh;
    const vertices = geometry.getAttribute('position').count;
    const indices = geometry.index?.count ?? 0;
    const short = () => mesh.unusedVertexCount < vertices || mesh.unusedIndexCount < indices;
    // Before growing, free what this update already let go of (an update that moves many
    // bricks would otherwise hold the old looks and the new at once), then pack the holes.
    if (short()) this.collect();
    if (short() && layer.dead) {
      mesh.optimize();
      layer.dead = 0;
    }
    if (short()) {
      const next = mesh as unknown as { _nextVertexStart: number; _nextIndexStart: number };
      mesh.setGeometrySize(
        Math.max(
          (mesh.unusedVertexCount + next._nextVertexStart) * 2,
          next._nextVertexStart + vertices,
        ),
        Math.max(
          (mesh.unusedIndexCount + next._nextIndexStart) * 2,
          next._nextIndexStart + indices,
        ),
      );
    }
    const id = mesh.addGeometry(geometry);
    layer.sources[id] = geometry;
    layer.geometries.set(key, id);
    return id;
  }

  /** Puts one instance of `geometryId` in `layer` for a brick, reusing a freed slot if any. */
  private slot(layer: Layer, geometryId: number, matrix: Matrix4, brickId: string) {
    let id = layer.free.pop();
    if (id === undefined) {
      if (layer.mesh.instanceCount >= layer.mesh.maxInstanceCount)
        layer.mesh.setInstanceCount(layer.mesh.maxInstanceCount * 2);
      id = layer.mesh.addInstance(geometryId);
      layer.size = Math.max(layer.size, id + 1);
    } else {
      layer.mesh.setGeometryIdAt(id, geometryId);
      layer.mesh.setVisibleAt(id, true);
    }
    layer.mesh.setMatrixAt(id, matrix);
    layer.brickIds[id] = brickId;
    return { layer, id };
  }

  private place(
    brick: Brick,
    model: Group,
    key: string,
    buildArea: number,
    explode: boolean,
    hidden: string,
  ): Placement {
    const look = this.look(brick, model, hidden);
    look.users++;
    this.idle.delete(look);
    const matrix = brickMatrix(brick, buildArea, explode);
    const slots: Placement['slots'] = [];
    for (const surface of look.surfaces) {
      const layer = this.layer(surface);
      slots.push(
        this.slot(layer, this.geometryId(layer, surface.key, surface.geometry), matrix, brick.id),
      );
    }
    for (const kind of LINE_KINDS) {
      const geometry = look.lines[kind];
      if (!geometry) continue;
      const layer = this.lineLayers[kind];
      slots.push(this.slot(layer, this.geometryId(layer, look.key, geometry), matrix, brick.id));
    }
    return { key, look, slots };
  }

  private release(placement: Placement) {
    if (--placement.look.users === 0) this.idle.add(placement.look);
    // Slots are hidden and reused rather than deleted, so ids stay dense and stable.
    for (const { layer, id } of placement.slots) {
      layer.mesh.setVisibleAt(id, false);
      layer.brickIds[id] = undefined;
      layer.free.push(id);
    }
  }
}
