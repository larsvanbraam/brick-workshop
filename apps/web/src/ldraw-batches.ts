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
  Vector3,
} from 'three';
import type { Color, Intersection, Material, Raycaster } from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { LDrawConditionalLineMaterial } from 'three/addons/materials/LDrawConditionalLineMaterial.js';
import { getLDrawTransform } from '@lego-builder/brick-engine';
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
/** Vertex attributes of one kind of edge: position and RGBA color, plus controls if conditional. */
type LineArrays = Record<string, Float32Array>;
/** A part in one color, ready to place: faces per finish and each kind of edge. */
type Look = { surfaces: Surface[]; lines: Record<LineKind, LineArrays> };
/** Faces that share a finish share one batched mesh, and so one draw call. */
type Layer = {
  mesh: BatchedMesh;
  geometries: Map<string, number>;
  /** The standalone geometry behind each geometry id, carrying the BVH that raycasts use. */
  sources: BufferGeometry[];
  free: number[];
  brickIds: (string | undefined)[];
  size: number;
};
type Placement = {
  key: string;
  slots: { layer: Layer; id: number }[];
  lines: Record<LineKind, LineArrays>;
};

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
  /** Baked part-and-color combinations. */
  looks: number;
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

function transformed(source: Float32Array, matrix: Matrix4 | Matrix3) {
  const out = new Float32Array(source.length);
  const point = new Vector3();
  for (let offset = 0; offset < source.length; offset += 3) {
    point.fromArray(source, offset);
    if (matrix instanceof Matrix4) point.applyMatrix4(matrix);
    else point.applyMatrix3(matrix);
    point.toArray(out, offset);
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

function bakeLook(model: Group, color: number, colorize: Colorize, key: string): Look {
  const colored = colorize(model, color);
  colored.updateMatrixWorld(true);
  const faces = new Map<
    string,
    {
      material: MeshStandardMaterial;
      position: Float32Array[];
      normal: Float32Array[];
      color: Float32Array[];
    }
  >();
  const lines = Object.fromEntries(
    LINE_KINDS.map((kind) => [kind, {} as Record<string, Float32Array[]>]),
  ) as Record<LineKind, Record<string, Float32Array[]>>;
  const push = (kind: LineKind, name: string, data: Float32Array) =>
    (lines[kind][name] ??= []).push(data);
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
          face = { material, position: [], normal: [], color: [] };
          faces.set(finish, face);
        }
        face.position.push(slice('position', group.start, group.count, 'point'));
        face.normal.push(slice('normal', group.start, group.count, 'normal'));
        face.color.push(fill(tint, group.count, glass ? material.opacity : undefined));
      } else {
        const conditional = Boolean((object as { isConditionalLine?: boolean }).isConditionalLine);
        const kind: LineKind = glass
          ? conditional
            ? 'glassConditional'
            : 'glassEdge'
          : conditional
            ? 'conditional'
            : 'edge';
        push(kind, 'position', slice('position', group.start, group.count, 'point'));
        push(kind, 'color', fill(tint, group.count, group.material.opacity));
        if (conditional) {
          push(kind, 'control0', slice('control0', group.start, group.count, 'point'));
          push(kind, 'control1', slice('control1', group.start, group.count, 'point'));
          push(kind, 'direction', slice('direction', group.start, group.count, 'vector'));
        }
      }
    }
    if (source !== object.geometry) source.dispose();
  });
  const surfaces = [...faces.entries()].map(([finish, face]): Surface => {
    const geometry = new BufferGeometry();
    const position = concat(face.position);
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('normal', new BufferAttribute(concat(face.normal), 3));
    geometry.setAttribute(
      'color',
      new BufferAttribute(concat(face.color), finish.endsWith(':glass') ? 4 : 3),
    );
    const count = position.length / 3;
    const index = new Uint32Array(count);
    for (let vertex = 0; vertex < count; vertex++) index[vertex] = vertex;
    geometry.setIndex(new BufferAttribute(index, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.boundsTree = new MeshBVH(geometry, BVH_OPTIONS);
    return { key: `${key}:${finish}`, finish, material: face.material, geometry };
  });
  // The colored copy was only read, never drawn; its materials can go.
  if (colored !== model) for (const material of used) material.dispose();
  const empty = (kind: LineKind): LineArrays =>
    Object.fromEntries(
      [
        'position',
        'color',
        ...(kind.endsWith('onditional') ? ['control0', 'control1', 'direction'] : []),
      ].map((name) => [name, new Float32Array(0)]),
    );
  return {
    surfaces,
    lines: Object.fromEntries(
      LINE_KINDS.map((kind) => [
        kind,
        {
          ...empty(kind),
          ...Object.fromEntries(
            Object.entries(lines[kind]).map(([name, parts]) => [name, concat(parts)]),
          ),
        },
      ]),
    ) as Record<LineKind, LineArrays>,
  };
}

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

const PLACEMENT_KEYS = ['partId', 'color', 'x', 'y', 'z', 'rotation', 'facing'] as const;
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
 * Every LDraw brick in one batched mesh: each finish (plain, pearl, chrome…) is a single
 * multi-draw call with colors in the vertices, and see-through faces share one more layer that
 * three sorts back to front per brick, with each color's opacity in the vertex alpha. Edges are
 * four merged line buffers: plain and conditional, opaque and see-through.
 * Updates are incremental: only bricks that changed are rewritten, and freed slots are reused.
 */
export class LDrawBatch {
  readonly object = new Group();
  private readonly layers = new Map<string, Layer>();
  private readonly looks = new Map<string, Look>();
  private readonly placements = new Map<string, Placement>();
  private readonly lineObjects: Record<LineKind, LineSegments>;

  private readonly colorize: Colorize;

  constructor(colorize: Colorize = coloredLDrawModel) {
    this.colorize = colorize;
    this.object.name = 'Native brick batch';
    this.object.scale.set(0.05, -0.05, 0.05);
    const lineMaterial = (kind: LineKind) => {
      const glass = kind.startsWith('glass');
      const material = kind.endsWith('onditional')
        ? new LDrawConditionalLineMaterial({ fog: true })
        : new LineBasicMaterial();
      material.vertexColors = true;
      material.transparent = glass;
      material.depthWrite = !glass;
      (material as unknown as { color: Color }).color.set(0xffffff);
      return material;
    };
    this.lineObjects = Object.fromEntries(
      LINE_KINDS.map((kind) => [kind, new LineSegments(new BufferGeometry(), lineMaterial(kind))]),
    ) as unknown as Record<LineKind, LineSegments>;
    for (const lines of this.lines) {
      lines.raycast = () => {};
      lines.frustumCulled = false;
      this.object.add(lines);
    }
  }

  /** The edge objects, for callers that move them onto their own render layer. */
  get lines(): readonly LineSegments[] {
    return LINE_KINDS.map((kind) => this.lineObjects[kind]);
  }

  /** The face meshes, one per finish in use. */
  get meshes(): readonly BatchedMesh[] {
    return [...this.layers.values()].map((layer) => layer.mesh);
  }

  update(entries: readonly BatchEntry[], buildArea: number, explode = false) {
    const seen = new Set<string>();
    let changed = false;
    for (const { brick, model } of entries) {
      seen.add(brick.id);
      const key = `${PLACEMENT_KEYS.map((name) => String(brick[name] ?? '')).join(':')}:${model.uuid}:${buildArea}:${explode}`;
      const current = this.placements.get(brick.id);
      if (current?.key === key) continue;
      if (current) this.release(current);
      this.placements.set(brick.id, this.place(brick, model, key, buildArea, explode));
      changed = true;
    }
    for (const [id, placement] of this.placements)
      if (!seen.has(id)) {
        this.release(placement);
        this.placements.delete(id);
        changed = true;
      }
    if (!changed) return;
    this.rebuildLines();
    for (const layer of this.layers.values()) {
      layer.mesh.computeBoundingBox();
      layer.mesh.computeBoundingSphere();
    }
  }

  /** A snapshot of how the batch is laid out, for the debug overlay. */
  stats(): BatchStats {
    const next = (mesh: BatchedMesh) =>
      mesh as unknown as { _nextVertexStart: number; _nextIndexStart: number };
    const segments = (lines: LineSegments) =>
      (lines.geometry.getAttribute('position')?.count ?? 0) / 2;
    return {
      bricks: this.placements.size,
      looks: this.looks.size,
      edgeSegments: segments(this.lineObjects.edge) + segments(this.lineObjects.glassEdge),
      conditionalSegments:
        segments(this.lineObjects.conditional) + segments(this.lineObjects.glassConditional),
      layers: [...this.layers.entries()].map(([finish, layer]) => ({
        finish,
        instances: layer.size - layer.free.length,
        free: layer.free.length,
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
    for (const layer of this.layers.values()) {
      this.object.remove(layer.mesh);
      layer.mesh.dispose();
      (layer.mesh.material as Material).dispose();
    }
    for (const lines of this.lines) {
      lines.geometry.dispose();
      lines.geometry = new BufferGeometry();
      (lines.material as Material).dispose();
    }
    for (const look of this.looks.values())
      for (const surface of look.surfaces) surface.geometry.dispose();
    this.layers.clear();
    this.looks.clear();
    this.placements.clear();
  }

  private look(brick: Brick, model: Group) {
    const key = `${model.uuid}:${brick.color}`;
    let look = this.looks.get(key);
    if (!look) {
      look = bakeLook(model, brick.color, this.colorize, key);
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
    layer = { mesh, geometries: new Map(), sources: [], free: [], brickIds: [], size: 0 };
    mesh.userData.brickIds = layer.brickIds;
    const owner = layer;
    mesh.raycast = (raycaster, intersects) => raycastLayer(owner, raycaster, intersects);
    this.layers.set(surface.finish, layer);
    this.object.add(mesh);
    return layer;
  }

  private geometryId(layer: Layer, surface: Surface) {
    const existing = layer.geometries.get(surface.key);
    if (existing !== undefined) return existing;
    const mesh = layer.mesh;
    const vertices = surface.geometry.getAttribute('position').count;
    const indices = surface.geometry.index!.count;
    if (mesh.unusedVertexCount < vertices || mesh.unusedIndexCount < indices) {
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
    const id = mesh.addGeometry(surface.geometry);
    layer.sources[id] = surface.geometry;
    layer.geometries.set(surface.key, id);
    return id;
  }

  private place(
    brick: Brick,
    model: Group,
    key: string,
    buildArea: number,
    explode: boolean,
  ): Placement {
    const look = this.look(brick, model);
    const matrix = brickMatrix(brick, buildArea, explode);
    const slots: Placement['slots'] = [];
    for (const surface of look.surfaces) {
      const layer = this.layer(surface);
      const geometryId = this.geometryId(layer, surface);
      let id = layer.free.pop();
      if (id === undefined) {
        if (layer.size >= layer.mesh.maxInstanceCount)
          layer.mesh.setInstanceCount(layer.mesh.maxInstanceCount * 2);
        id = layer.mesh.addInstance(geometryId);
        layer.size++;
      } else {
        layer.mesh.setGeometryIdAt(id, geometryId);
        layer.mesh.setVisibleAt(id, true);
      }
      layer.mesh.setMatrixAt(id, matrix);
      layer.brickIds[id] = brick.id;
      slots.push({ layer, id });
    }
    const linear = new Matrix3().setFromMatrix4(matrix);
    const lines = Object.fromEntries(
      LINE_KINDS.map((kind) => [
        kind,
        Object.fromEntries(
          Object.entries(look.lines[kind]).map(([name, data]) => [
            name,
            name === 'color' ? data : transformed(data, name === 'direction' ? linear : matrix),
          ]),
        ),
      ]),
    ) as Record<LineKind, LineArrays>;
    return { key, slots, lines };
  }

  private release(placement: Placement) {
    // Slots are hidden and reused rather than deleted, so ids stay dense and stable.
    for (const { layer, id } of placement.slots) {
      layer.mesh.setVisibleAt(id, false);
      layer.brickIds[id] = undefined;
      layer.free.push(id);
    }
  }

  private rebuildLines() {
    const placements = [...this.placements.values()];
    for (const kind of LINE_KINDS) {
      const lines = this.lineObjects[kind];
      lines.geometry.dispose();
      const geometry = new BufferGeometry();
      const picked = placements.map((placement) => placement.lines[kind]);
      for (const name of Object.keys(picked[0] ?? {}))
        geometry.setAttribute(
          name,
          new BufferAttribute(concat(picked.map((entry) => entry[name])), itemSize(name)),
        );
      lines.geometry = geometry;
      // Nothing to draw costs nothing: an empty buffer would still be a draw call.
      lines.visible = geometry.getAttribute('position')?.count > 0;
    }
  }
}
