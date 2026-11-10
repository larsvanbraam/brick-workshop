import { BatchedMesh, Color, Group, Matrix4, MeshStandardMaterial } from 'three';
import type { BufferGeometry, Material } from 'three';
import { COLORS, PLATE_HEIGHT, footprint } from '@brick-workshop/engine';
import type { Brick, LDrawColor } from '@brick-workshop/engine';
import { createFallbackBrickGeometry, fallbackShapeKey } from './fallback-geometry';
import { colorMaterialProperties } from './ldraw-materials';

/** Bricks of colors that share a finish share one batched mesh, and so one draw call. */
type Layer = {
  mesh: BatchedMesh;
  geometries: Map<string, number>;
  free: number[];
  brickIds: (string | undefined)[];
  size: number;
};
type Placement = { key: string; layer: Layer; id: number };

const COLOR_BY_ID = new Map(COLORS.map((color) => [color.id, color]));

/**
 * What a color's material looks like apart from its hue, which each instance carries. A glowing
 * color tints its own glow, so it gets a layer of its own.
 */
function finishKey(color: LDrawColor) {
  const { roughness, metalness, opacity, emissive, emissiveIntensity } =
    colorMaterialProperties(color);
  return `${roughness}:${metalness}:${opacity}${emissiveIntensity > 0 ? `:${emissive}:${emissiveIntensity}` : ''}`;
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

const instanceColor = new Color();
const instanceMatrix = new Matrix4();

/**
 * Bricks without an LDraw model, drawn from procedural shapes in a few batched meshes: one per
 * finish, with each brick's color set per instance. Every brick of the same part, turn and stud
 * layout shares one geometry. Updates are incremental, like the LDraw batch: only bricks that
 * changed are rewritten, and freed slots are reused.
 */
export class FallbackBatch {
  readonly object = new Group();
  private readonly layers = new Map<string, Layer>();
  private readonly shapes = new Map<string, BufferGeometry>();
  private readonly placements = new Map<string, Placement>();

  constructor() {
    this.object.name = 'Fallback brick batch';
  }

  /** The face meshes, one per finish in use. */
  get meshes(): readonly BatchedMesh[] {
    return [...this.layers.values()].map((layer) => layer.mesh);
  }

  /** Brings the batch in line with `bricks`; returns whether anything changed. */
  update(bricks: readonly Brick[], buildArea: number, explode = false): boolean {
    const seen = new Set<string>();
    let changed = false;
    for (const brick of bricks) {
      seen.add(brick.id);
      const key = `${PLACEMENT_KEYS.map((name) => String(brick[name] ?? '')).join(':')}:${buildArea}:${explode}`;
      const current = this.placements.get(brick.id);
      if (current?.key === key) continue;
      if (current) this.release(current);
      this.placements.set(brick.id, this.place(brick, key, buildArea, explode));
      changed = true;
    }
    for (const [id, placement] of this.placements)
      if (!seen.has(id)) {
        this.release(placement);
        this.placements.delete(id);
        changed = true;
      }
    if (changed) this.refreshBounds();
    return changed;
  }

  dispose() {
    for (const layer of this.layers.values()) {
      this.object.remove(layer.mesh);
      layer.mesh.dispose();
      (layer.mesh.material as Material).dispose();
    }
    for (const geometry of this.shapes.values()) geometry.dispose();
    this.layers.clear();
    this.shapes.clear();
    this.placements.clear();
  }

  private refreshBounds() {
    for (const layer of this.layers.values()) {
      // An empty batch still costs a draw call; a hidden one doesn't.
      layer.mesh.visible = layer.size > layer.free.length;
      if (!layer.mesh.visible) continue;
      layer.mesh.computeBoundingBox();
      layer.mesh.computeBoundingSphere();
    }
  }

  private shape(brick: Brick) {
    const key = fallbackShapeKey(brick);
    let geometry = this.shapes.get(key);
    if (!geometry) {
      geometry = createFallbackBrickGeometry(brick);
      this.shapes.set(key, geometry);
    }
    return { key, geometry };
  }

  private layer(color: LDrawColor) {
    const finish = finishKey(color);
    let layer = this.layers.get(finish);
    if (layer) return layer;
    const properties = colorMaterialProperties(color);
    const material = new MeshStandardMaterial({
      roughness: properties.roughness,
      metalness: properties.metalness,
      opacity: properties.opacity,
      transparent: properties.transparent,
      depthWrite: properties.depthWrite,
      emissive: properties.emissiveIntensity > 0 ? properties.emissive : 0x000000,
      emissiveIntensity: properties.emissiveIntensity,
    });
    const mesh = new BatchedMesh(64, 16384, 0, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    layer = { mesh, geometries: new Map(), free: [], brickIds: [], size: 0 };
    // Picking maps an instance back to its brick, as for the LDraw batch.
    mesh.userData.brickIds = layer.brickIds;
    this.layers.set(finish, layer);
    this.object.add(mesh);
    return layer;
  }

  private geometryId(layer: Layer, key: string, geometry: BufferGeometry) {
    const existing = layer.geometries.get(key);
    if (existing !== undefined) return existing;
    const mesh = layer.mesh;
    const vertices = geometry.getAttribute('position').count;
    if (mesh.unusedVertexCount < vertices) {
      const used = (mesh as unknown as { _nextVertexStart: number })._nextVertexStart;
      mesh.setGeometrySize(Math.max((mesh.unusedVertexCount + used) * 2, used + vertices), 0);
    }
    const id = mesh.addGeometry(geometry);
    layer.geometries.set(key, id);
    return id;
  }

  private place(brick: Brick, key: string, buildArea: number, explode: boolean): Placement {
    const color = COLOR_BY_ID.get(brick.color)!;
    const layer = this.layer(color);
    const shape = this.shape(brick);
    const geometryId = this.geometryId(layer, shape.key, shape.geometry);
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
    const size = footprint(brick);
    layer.mesh.setMatrixAt(
      id,
      instanceMatrix.makeTranslation(
        brick.x + size.width / 2 - buildArea / 2,
        brick.y * PLATE_HEIGHT + (explode ? brick.y * 0.18 : 0),
        brick.z + size.depth / 2 - buildArea / 2,
      ),
    );
    layer.mesh.setColorAt(id, instanceColor.set(colorMaterialProperties(color).color));
    layer.brickIds[id] = brick.id;
    return { key, layer, id };
  }

  private release({ layer, id }: Placement) {
    // Slots are hidden and reused rather than deleted, so ids stay dense and stable.
    layer.mesh.setVisibleAt(id, false);
    layer.brickIds[id] = undefined;
    layer.free.push(id);
  }
}
