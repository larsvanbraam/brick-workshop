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
/** A part in one color, ready to place: faces per finish, and each kind of edge it has. */
type Look = { key: string; surfaces: Surface[]; lines: Record<LineKind, BufferGeometry | null> };
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
type Placement = { key: string; slots: { layer: Layer; id: number }[] };

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
  const lineGeometry = (kind: LineKind) => {
    const attributes = Object.entries(lines[kind]);
    if (!attributes.length) return null;
    const geometry = new BufferGeometry();
    for (const [name, parts] of attributes)
      geometry.setAttribute(name, new BufferAttribute(concat(parts), itemSize(name)));
    geometry.computeBoundingSphere();
    return geometry;
  };
  return {
    key,
    surfaces,
    lines: Object.fromEntries(LINE_KINDS.map((kind) => [kind, lineGeometry(kind)])) as Record<
      LineKind,
      BufferGeometry | null
    >,
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

/** Everything a brick's placement depends on; the same key means nothing to redo. */
function placementKey(brick: Brick, model: Group, buildArea: number, explode: boolean) {
  return `${PLACEMENT_KEYS.map((name) => String(brick[name] ?? '')).join(':')}:${model.uuid}:${buildArea}:${explode}`;
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

  constructor(material: Material) {
    super(64, 8192, 0, material);
    (this as unknown as { isMesh: boolean }).isMesh = false;
    this.castShadow = false;
    this.receiveShadow = false;
    // Opaque edges need no order, and see-through ones are too thin to show one.
    this.sortObjects = false;
    this.raycast = () => {};
  }
}

/**
 * Teaches LDraw's conditional line shader the batched matrices: its line ends, control points
 * and direction all move with the brick. (The basic line shader knows them already.)
 */
function batchConditionalLines(shader: { vertexShader: string }) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n#include <batching_pars_vertex>')
    .replace('#include <color_vertex>', '#include <color_vertex>\n#include <batching_vertex>')
    .replaceAll('modelViewMatrix * vec4(', 'modelViewMatrix * batchingMatrix * vec4(');
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
        // Pixels one world unit (a stud) spans at this depth, for perspective and ortho alike.
        float studPixels = projectionMatrix[1][1] * 0.5 * edgeViewport / gl_Position.w;
        vEdgeFade = smoothstep(${EDGE_FADE_PIXELS.hidden.toFixed(1)}, ${EDGE_FADE_PIXELS.full.toFixed(1)}, studPixels);`,
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
  private readonly looks = new Map<string, Look>();
  private readonly placements = new Map<string, Placement>();
  private readonly lineLayers: Record<LineKind, Layer>;

  private readonly colorize: Colorize;

  /**
   * `fadeEdges` fades edges out as the camera pulls back, for the interactive view; renders at
   * a fixed scale, like the instructions, keep them as they are.
   */
  constructor(
    colorize: Colorize = coloredLDrawModel,
    { fadeEdges = false }: { fadeEdges?: boolean } = {},
  ) {
    this.colorize = colorize;
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
        const mesh = new BatchedLines(lineMaterial(kind)) as unknown as BatchedMesh;
        mesh.visible = false;
        if (fadeEdges) {
          // Faded edges blend, so they join the transparent queue: ahead of glass, which draws
          // over them, as the opaque edges they are.
          if ((mesh.material as Material).depthWrite) mesh.renderOrder = -1;
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
          { mesh, geometries: new Map(), sources: [], free: [], brickIds: [], size: 0 },
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
    let count = 0;
    for (const { brick, model } of entries)
      if (this.placements.get(brick.id)?.key !== placementKey(brick, model, buildArea, explode))
        count++;
    return count;
  }

  private run = 0;

  /** The update as steps: one per brick placed, then the lines and bounds as a last step. */
  private *steps(
    entries: readonly BatchEntry[],
    buildArea: number,
    explode: boolean,
    progress = { done: 0, total: 0 },
  ): Generator<void, void> {
    const seen = new Set<string>();
    const changed: BatchEntry[] = [];
    for (const entry of entries) {
      seen.add(entry.brick.id);
      if (
        this.placements.get(entry.brick.id)?.key !==
        placementKey(entry.brick, entry.model, buildArea, explode)
      )
        changed.push(entry);
    }
    let removed = false;
    for (const [id, placement] of this.placements)
      if (!seen.has(id)) {
        this.release(placement);
        this.placements.delete(id);
        removed = true;
      }
    if (!changed.length && !removed) return;
    progress.total = changed.length;
    for (const [index, { brick, model }] of changed.entries()) {
      const key = placementKey(brick, model, buildArea, explode);
      const current = this.placements.get(brick.id);
      // A cancelled run may have placed this brick already.
      if (current?.key === key) continue;
      if (current) this.release(current);
      this.placements.set(brick.id, this.place(brick, model, key, buildArea, explode));
      progress.done = index + 1;
      yield;
    }
    this.refreshBounds();
  }

  private refreshBounds() {
    for (const layer of this.layers.values()) {
      layer.mesh.computeBoundingBox();
      layer.mesh.computeBoundingSphere();
    }
    for (const layer of Object.values(this.lineLayers)) {
      // An empty batch still costs a draw call; a hidden one doesn't.
      layer.mesh.visible = layer.size > layer.free.length;
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
      let vertices = 0;
      for (let id = 0; id < size; id++)
        if (brickIds[id] !== undefined)
          vertices += sources[mesh.getGeometryIdAt(id)].getAttribute('position').count;
      return vertices / 2;
    };
    return {
      bricks: this.placements.size,
      looks: this.looks.size,
      edgeSegments: segments('edge') + segments('glassEdge'),
      conditionalSegments: segments('conditional') + segments('glassConditional'),
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
    this.run++;
    for (const layer of this.layers.values()) {
      this.object.remove(layer.mesh);
      layer.mesh.dispose();
      (layer.mesh.material as Material).dispose();
    }
    for (const layer of Object.values(this.lineLayers)) {
      layer.mesh.dispose();
      (layer.mesh.material as Material).dispose();
      // Left empty and hidden, ready to be filled again.
      const mesh = new BatchedLines(layer.mesh.material as Material) as unknown as BatchedMesh;
      Object.assign(mesh, {
        renderOrder: layer.mesh.renderOrder,
        onBeforeRender: layer.mesh.onBeforeRender,
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
      });
    }
    for (const look of this.looks.values()) {
      for (const surface of look.surfaces) surface.geometry.dispose();
      for (const geometry of Object.values(look.lines)) geometry?.dispose();
    }
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

  private geometryId(layer: Layer, key: string, geometry: BufferGeometry) {
    const existing = layer.geometries.get(key);
    if (existing !== undefined) return existing;
    const mesh = layer.mesh;
    const vertices = geometry.getAttribute('position').count;
    const indices = geometry.index?.count ?? 0;
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
    const id = mesh.addGeometry(geometry);
    layer.sources[id] = geometry;
    layer.geometries.set(key, id);
    return id;
  }

  /** Puts one instance of `geometryId` in `layer` for a brick, reusing a freed slot if any. */
  private slot(layer: Layer, geometryId: number, matrix: Matrix4, brickId: string) {
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
    layer.brickIds[id] = brickId;
    return { layer, id };
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
    return { key, slots };
  }

  private release(placement: Placement) {
    // Slots are hidden and reused rather than deleted, so ids stay dense and stable.
    for (const { layer, id } of placement.slots) {
      layer.mesh.setVisibleAt(id, false);
      layer.brickIds[id] = undefined;
      layer.free.push(id);
    }
  }
}
