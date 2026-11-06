import { Box3, BufferAttribute, BufferGeometry, Color, DoubleSide, Matrix4, Mesh, Ray, Vector3 } from 'three';
import type { Material, Object3D, Texture } from 'three';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshBVH } from 'three-mesh-bvh';
import { buildScene, extractThumbnail, parseSkp } from 'openskp';
import {
  COLORS,
  DEFAULT_PART_COLOR_EVIDENCE,
  MAX_BUILD_AREA,
  MAX_VOXEL_LAYERS,
  fillVoxelModel,
  getPartColorStatus,
  styleVoxelFill,
} from '@lego-builder/brick-engine';
import type { PartColorEvidence, VoxelDirection, VoxelModel, VoxelOpening } from '@lego-builder/brick-engine';

/** World-space triangles, Y-up, any unit: 9 position values and 3 sRGB color values each. */
export interface ModelTriangles {
  name: string;
  positions: Float32Array;
  colors: Float32Array;
  /** 1 for faces without a material of their own; any painted face in a cell wins over them. */
  unpainted?: Uint8Array;
  /** Objects left out of the conversion, such as terrain or a distant scale figure. */
  omitted?: string[];
  /** The preview image stored in the file (SketchUp), a visual reference for revising. */
  preview?: File;
  /** Texture coordinates, six per triangle, for triangles with a see-through texture. */
  uvs?: Float32Array;
  /** Per triangle, the index into alphaMasks of its see-through texture, or -1. */
  masks?: Int16Array;
  /** Opacity of see-through textures (a lattice, a fence, foliage); null when not decoded. */
  alphaMasks?: (AlphaMask | null)[];
}

/** Which texels of a texture are opaque, one byte per texel (0 or 1). */
export interface AlphaMask {
  width: number;
  height: number;
  opaque: Uint8Array;
}
export interface PaletteColor {
  id: number;
  hex: string;
}

export const MODEL_EXTENSIONS = ['.skp', '.dae', '.glb'] as const;

/**
 * Current-production solid brick colors. The full LDraw list also holds retired, Modulex and
 * near-duplicate shades, which would split one stone wall into several greys.
 */
const MODEL_COLOR_IDS: ReadonlySet<number> = new Set([
  0, 1, 2, 4, 5, 10, 14, 15, 19, 25, 26, 27, 28, 29, 30, 31, 70, 71, 72, 73, 74, 78, 84, 85, 92,
  191, 212, 226, 272, 288, 308, 320, 321, 322, 323, 326, 378, 379, 484,
]);

/**
 * Colors the fill may use: with observedOnly, only colors observed for a 1 x 1 brick (so every
 * cell can fall back to one), checked per part through colorAllowed.
 */
export function modelColorPolicy(evidence: PartColorEvidence | undefined, observedOnly: boolean) {
  const source = evidence ?? DEFAULT_PART_COLOR_EVIDENCE;
  const colorAllowed = (partId: string, color: number) =>
    !observedOnly || getPartColorStatus(partId, color, source).manufactured === 'observed';
  const palette: PaletteColor[] = COLORS.filter(
    (color) => MODEL_COLOR_IDS.has(color.id) && colorAllowed('3005', color.id),
  ).map(({ id, hex }) => ({ id, hex }));
  return { palette, colorAllowed };
}
const MAX_MODEL_BYTES = 100_000_000;
const MAX_TRIANGLES = 2_000_000;
/** Faces more transparent than this (glass) are left out, so windows become openings. */
const MIN_OPACITY = 0.5;
/** SketchUp's geo-location tags: an aerial photo and terrain far larger than the model. */
const LOCATION_TAG = /^(Location|Google Earth) (Terrain|Snapshot)$/;
/** One stud is 8 mm across and one brick 9.6 mm tall. */
const BRICK_HEIGHT_IN_STUDS = 1.2;

export async function loadModelTriangles(file: File): Promise<ModelTriangles> {
  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (!(MODEL_EXTENSIONS as readonly string[]).includes(extension))
    throw new Error('Use a SketchUp (.skp), COLLADA (.dae) or binary glTF (.glb) model.');
  if (file.size > MAX_MODEL_BYTES) throw new Error('Models must be smaller than 100 MB.');
  const name = file.name.replace(/\.[^.]+$/, '').slice(0, 100) || 'Model';
  let triangles: ModelTriangles;
  if (extension === '.skp') {
    try {
      const buffer = await file.arrayBuffer();
      triangles = await skpTriangles(name, buffer);
      const thumbnail = extractThumbnail(buffer);
      if (thumbnail)
        triangles.preview = new File([thumbnail.data as BlobPart], `${name} preview`, { type: thumbnail.mimeType });
    } catch (error) {
      throw new Error(
        `This SketchUp file could not be read (${error instanceof Error ? error.message : 'unknown error'}). Try the COLLADA (.dae) download instead.`,
      );
    }
  } else if (extension === '.dae') {
    const collada = new ColladaLoader().parse(await file.text(), '');
    if (!collada) throw new Error('This COLLADA file could not be read.');
    triangles = objectTriangles(name, collada.scene);
  } else {
    const gltf = await new GLTFLoader().parseAsync(await file.arrayBuffer(), '');
    triangles = objectTriangles(name, gltf.scene);
  }
  if (!triangles.colors.length) throw new Error('The model contains no surfaces.');
  return triangles;
}

async function skpTriangles(name: string, buffer: ArrayBuffer): Promise<ModelTriangles> {
  const scene = buildScene(buffer, { respectEdgeVisibility: true });
  const tags = parseSkp(buffer).layers;
  // openskp gives unpainted faces their tag's color; SketchUp itself shows its default material.
  const tagColors = new Set(tags.map(({ color }) => `${color.r},${color.g},${color.b}`));
  const skippedTags = new Set(
    tags.filter((tag) => tag.hidden || LOCATION_TAG.test(tag.name)).map((tag) => tag.name),
  );
  const materials = scene.gltfMaterials as {
    pbrMetallicRoughness?: { baseColorFactor?: number[]; baseColorTexture?: { index: number } };
  }[];
  // openskp writes SketchUp's sRGB material color as the factor. For a textured material that
  // color is SketchUp's average of the texture, or its tint when colorized, so it is what
  // SketchUp shows and the texture itself is not needed.
  const materialColors = materials.map((material) => {
    const pbr = material.pbrMetallicRoughness;
    const [red, green, blue, alpha] = pbr?.baseColorFactor ?? [1, 1, 1, 1];
    if (alpha < MIN_OPACITY) return null;
    const unpainted =
      !pbr?.baseColorTexture &&
      tagColors.has([red, green, blue].map((value) => Math.round(value * 255)).join(','));
    return { color: unpainted ? [1, 1, 1] : [red, green, blue], unpainted, texture: pbr?.baseColorTexture?.index ?? -1 };
  });
  // See-through textures (a lattice, a fence) decide which cells their faces fill.
  const alphaMasks = await Promise.all(
    scene.textures.map((texture) =>
      texture.mimeType === 'image/png'
        ? decodeAlphaMask(new Blob([texture.data as BlobPart], { type: texture.mimeType }))
        : null,
    ),
  );
  const omitted = new Set<string>();
  const primitives = scene.glbPrimitives.filter((primitive) => {
    const tag = scene.meshIndex[primitive.geomName]?.layer ?? '';
    // Geo-location tags are named differently in the tag list and on the geometry.
    const skip = skippedTags.has(tag) || LOCATION_TAG.test(tag);
    if (skip) omitted.add(LOCATION_TAG.test(tag) ? tag : `hidden tag ${tag}`);
    return !skip;
  });
  // Top-level objects, so distant extras can be left out; loose geometry is one object.
  const objectKeys = new Map<string, number>();
  const objectNames: string[] = [];
  const total = primitives.reduce((sum, primitive) => sum + primitive.indices.length / 3, 0);
  if (total > MAX_TRIANGLES) throw new Error('Models are limited to two million triangles.');
  const positions = new Float32Array(total * 9);
  const colors = new Float32Array(total * 3);
  const unpainted = new Uint8Array(total);
  const objects = new Uint32Array(total);
  const uvs = new Float32Array(total * 6);
  const masks = new Int16Array(total).fill(-1);
  let triangle = 0;
  for (const primitive of primitives) {
    const meta = scene.meshIndex[primitive.geomName];
    const segments = (meta?.path ?? 'ROOT').split(' / ');
    const key = segments.slice(0, 2).join(' / ');
    if (!objectKeys.has(key)) {
      objectKeys.set(key, objectNames.length);
      const own = segments.length === 2 ? meta?.name || meta?.definitionName : '';
      objectNames.push(own || (segments[1] ?? 'loose geometry'));
    }
    const object = objectKeys.get(key)!;
    const material =
      primitive.materialIndex in materialColors
        ? materialColors[primitive.materialIndex]
        : { color: [1, 1, 1], unpainted: true, texture: -1 };
    // Glass and other see-through faces become openings.
    if (!material) continue;
    for (let index = 0; index < primitive.indices.length; index += 3, triangle += 1) {
      for (let corner = 0; corner < 3; corner += 1) {
        const vertex = primitive.indices[index + corner] * 3;
        positions.set(primitive.positions.subarray(vertex, vertex + 3), triangle * 9 + corner * 3);
      }
      colors.set(material.color, triangle * 3);
      unpainted[triangle] = material.unpainted ? 1 : 0;
      objects[triangle] = object;
      if (material.texture >= 0 && primitive.uvs) {
        masks[triangle] = material.texture;
        for (let corner = 0; corner < 3; corner += 1) {
          const vertex = primitive.indices[index + corner] * 2;
          uvs.set(primitive.uvs.subarray(vertex, vertex + 2), triangle * 6 + corner * 2);
        }
      }
    }
  }
  return keepMainObjects(
    {
      name,
      positions: positions.subarray(0, triangle * 9),
      colors: colors.subarray(0, triangle * 3),
      unpainted: unpainted.subarray(0, triangle),
      uvs: uvs.subarray(0, triangle * 6),
      masks: masks.subarray(0, triangle),
      alphaMasks,
      omitted: [...omitted],
    },
    objects.subarray(0, triangle),
    objectNames,
  );
}

/**
 * Keeps the main object and whatever touches it. Downloaded models often carry a scale figure
 * standing beside them or a ground plane far larger than the model; either would set the scale
 * and shrink the model itself to a few studs.
 */
export function keepMainObjects(triangles: ModelTriangles, objects: Uint32Array, names: string[]): ModelTriangles {
  if (names.length < 2) return triangles;
  const boxes = names.map(() => new Box3());
  const areas = new Float64Array(names.length);
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let triangle = 0; triangle < objects.length; triangle += 1) {
    const box = boxes[objects[triangle]];
    a.fromArray(triangles.positions, triangle * 9);
    b.fromArray(triangles.positions, triangle * 9 + 3);
    c.fromArray(triangles.positions, triangle * 9 + 6);
    box.expandByPoint(a).expandByPoint(b).expandByPoint(c);
    areas[objects[triangle]] += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  const size = (box: Box3) => box.getSize(new Vector3());
  const flat = (box: Box3) => {
    const { x, y, z } = size(box);
    return y < 0.02 * Math.max(x, z);
  };
  const solid = names.map((_, object) => object).filter((object) => !flat(boxes[object]));
  if (!solid.length) return triangles;
  const seed = solid.reduce((best, object) => (areas[object] > areas[best] ? object : best));
  const kept = new Set([seed]);
  const cluster = boxes[seed].clone();
  const margin = size(boxes[seed]).length() * 0.05;
  for (let grown = true; grown; ) {
    grown = false;
    for (const object of solid)
      if (!kept.has(object) && boxes[object].intersectsBox(cluster.clone().expandByScalar(margin))) {
        kept.add(object);
        cluster.union(boxes[object]);
        grown = true;
      }
  }
  // A base slab under the model stays; a ground plane much larger than the model does not.
  const extent = size(cluster);
  for (let object = 0; object < names.length; object += 1) {
    if (kept.has(object) || !flat(boxes[object])) continue;
    const footprint = size(boxes[object]);
    if (
      boxes[object].intersectsBox(cluster.clone().expandByScalar(margin)) &&
      footprint.x <= extent.x * 1.5 + margin &&
      footprint.z <= extent.z * 1.5 + margin
    )
      kept.add(object);
  }
  if (kept.size === names.length) return triangles;
  let count = 0;
  for (let triangle = 0; triangle < objects.length; triangle += 1) if (kept.has(objects[triangle])) count += 1;
  const positions = new Float32Array(count * 9);
  const colors = new Float32Array(count * 3);
  const unpainted = new Uint8Array(count);
  const uvs = new Float32Array(count * 6);
  const masks = new Int16Array(count).fill(-1);
  let target = 0;
  for (let triangle = 0; triangle < objects.length; triangle += 1) {
    if (!kept.has(objects[triangle])) continue;
    positions.set(triangles.positions.subarray(triangle * 9, triangle * 9 + 9), target * 9);
    colors.set(triangles.colors.subarray(triangle * 3, triangle * 3 + 3), target * 3);
    unpainted[target] = triangles.unpainted?.[triangle] ?? 0;
    if (triangles.uvs) uvs.set(triangles.uvs.subarray(triangle * 6, triangle * 6 + 6), target * 6);
    masks[target] = triangles.masks?.[triangle] ?? -1;
    target += 1;
  }
  return {
    ...triangles,
    positions,
    colors,
    unpainted,
    ...(triangles.masks && { uvs, masks }),
    omitted: [...(triangles.omitted ?? []), ...names.filter((_, object) => !kept.has(object))],
  };
}

function objectTriangles(name: string, root: Object3D): ModelTriangles {
  root.updateMatrixWorld(true);
  // Exporters wrap the scene in single-child nodes; the first level that branches holds the objects.
  let top = root;
  while (top.children.length === 1 && !(top instanceof Mesh)) top = top.children[0];
  const objectNames: string[] = [];
  const meshes: { mesh: Mesh; object: number }[] = [];
  const collect = (node: Object3D, object: number) => {
    if (!node.visible) return;
    if (node instanceof Mesh && node.geometry.getAttribute('position')) meshes.push({ mesh: node, object });
    for (const child of node.children) collect(child, object);
  };
  if (top instanceof Mesh) collect(top, objectNames.push(top.name || 'model') - 1);
  else for (const child of top.children) collect(child, objectNames.push(child.name || 'unnamed object') - 1);
  const total = meshes.reduce((sum, { mesh }) => {
    const geometry = mesh.geometry as BufferGeometry;
    return sum + (geometry.index ?? geometry.getAttribute('position')).count / 3;
  }, 0);
  if (total > MAX_TRIANGLES) throw new Error('Models are limited to two million triangles.');
  const textureColors = new Map<Texture, Color | null>();
  const materialColor = (material: Material | undefined) => {
    if (material?.transparent && material.opacity < MIN_OPACITY) return null;
    const base = (material as { color?: Color } | undefined)?.color?.clone() ?? new Color(1, 1, 1);
    const map = (material as { map?: Texture | null } | undefined)?.map;
    if (map?.image) {
      if (!textureColors.has(map))
        textureColors.set(map, averageImageColor(map.image as CanvasImageSource));
      const average = textureColors.get(map);
      if (average) base.multiply(average);
    }
    return srgb(base);
  };
  const positions = new Float32Array(total * 9);
  const colors = new Float32Array(total * 3);
  const objects = new Uint32Array(total);
  const vertex = new Vector3();
  let triangle = 0;
  for (const { mesh, object } of meshes) {
    const geometry = mesh.geometry as BufferGeometry;
    const position = geometry.getAttribute('position');
    const count = (geometry.index ?? position).count;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const resolved = materials.map(materialColor);
    const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count, materialIndex: 0 }];
    for (const group of groups) {
      const color = resolved[group.materialIndex ?? 0];
      // Glass and other see-through faces become openings.
      if (color === null) continue;
      for (let index = group.start; index < Math.min(count, group.start + group.count) - 2; index += 3, triangle += 1) {
        for (let corner = 0; corner < 3; corner += 1) {
          const source = geometry.index ? geometry.index.getX(index + corner) : index + corner;
          vertex.fromBufferAttribute(position, source).applyMatrix4(mesh.matrixWorld);
          positions.set([vertex.x, vertex.y, vertex.z], triangle * 9 + corner * 3);
        }
        colors.set(color ?? [1, 1, 1], triangle * 3);
        objects[triangle] = object;
      }
    }
  }
  return keepMainObjects(
    { name, positions: positions.subarray(0, triangle * 9), colors: colors.subarray(0, triangle * 3) },
    objects.subarray(0, triangle),
    objectNames,
  );
}

/** Share of transparent texels from which a texture counts as see-through. */
const SEE_THROUGH = 0.1;

/**
 * Which texels of a texture are opaque (browser only; null elsewhere, or for a texture that is
 * essentially opaque). Large textures are read at up to 512 texels a side.
 */
async function decodeAlphaMask(source: Blob | CanvasImageSource): Promise<AlphaMask | null> {
  if (typeof document === 'undefined') return null;
  try {
    const image = source instanceof Blob ? await createImageBitmap(source) : source;
    const [imageWidth, imageHeight] =
      'width' in image && typeof image.width === 'number'
        ? [image.width, (image as { height: number }).height]
        : [512, 512];
    const scale = Math.min(1, 512 / Math.max(imageWidth, imageHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(imageWidth * scale));
    canvas.height = Math.max(1, Math.round(imageHeight * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (image instanceof ImageBitmap && source instanceof Blob) image.close();
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const opaque = new Uint8Array(canvas.width * canvas.height);
    let clear = 0;
    for (let texel = 0; texel < opaque.length; texel += 1)
      if (data[texel * 4 + 3] >= 128) opaque[texel] = 1;
      else clear += 1;
    return clear / opaque.length >= SEE_THROUGH ? { width: canvas.width, height: canvas.height, opaque } : null;
  } catch {
    return null;
  }
}

/** Linear working-space color to sRGB components. */
function srgb(color: Color): [number, number, number] {
  const hex = color.getHex();
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

/** Average color of a texture image (browser only), as a linear Color; null when unreadable. */
function averageImageColor(source: CanvasImageSource): Color | null {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(source, 0, 0, 16, 16);
    const { data } = context.getImageData(0, 0, 16, 16);
    let red = 0;
    let green = 0;
    let blue = 0;
    let weight = 0;
    for (let offset = 0; offset < data.length; offset += 4) {
      const alpha = data[offset + 3] / 255;
      red += data[offset] * alpha;
      green += data[offset + 1] * alpha;
      blue += data[offset + 2] * alpha;
      weight += alpha;
    }
    if (!weight) return null;
    return new Color().setRGB(red / weight / 255, green / weight / 255, blue / weight / 255, 'srgb');
  } catch {
    return null;
  }
}

function modelBounds(triangles: ModelTriangles) {
  const bounds = new Box3();
  const point = new Vector3();
  for (let offset = 0; offset < triangles.positions.length; offset += 3)
    bounds.expandByPoint(point.fromArray(triangles.positions, offset));
  return bounds;
}

function grid(bounds: Box3, widthStuds: number) {
  const size = bounds.getSize(new Vector3());
  const span = Math.max(size.x, size.z);
  if (!(span > 0)) throw new Error('The model has no horizontal extent.');
  const stud = span / widthStuds;
  const layerHeight = stud * BRICK_HEIGHT_IN_STUDS;
  // The grid starts half a cell before the model, so faces on the model's outer planes (and
  // SketchUp's grid-aligned walls) fall mid-cell instead of on a cell boundary.
  return {
    stud,
    layerHeight,
    width: Math.floor(size.x / stud + 1e-6) + 1,
    depth: Math.floor(size.z / stud + 1e-6) + 1,
    layers: Math.floor(size.y / layerHeight + 1e-6) + 1,
  };
}

/**
 * Minifig scale: one stud is about 34 cm (a minifig is four bricks, about a 1.75 m person). Doors,
 * windows and railings are made for it, so a model converted at it gets parts that fit.
 */
export const MINIFIG_STUD_METERS = 0.34;

/**
 * Converts at the widest width, at most `maxWidth` studs (and, with `studMeters`, no wider than
 * that scale for a model in metres), that stays within the brick layer limit and fills
 * completely within `pieceBudget` pieces, so detail is as fine as the budget allows.
 */
export function fitModel(
  triangles: ModelTriangles,
  options: {
    maxWidth: number;
    pieceBudget: number;
    palette: readonly PaletteColor[];
    colorAllowed: (partId: string, color: number) => boolean;
    buildArea?: number;
    /** Real-world metres per stud, e.g. MINIFIG_STUD_METERS; models are read in metres. */
    studMeters?: number;
  },
) {
  const size = modelBounds(triangles).getSize(new Vector3());
  const scaled = options.studMeters
    ? Math.max(4, Math.round(Math.max(size.x, size.z) / options.studMeters))
    : Infinity;
  const limit = Math.min(options.maxWidth, scaled);
  // One layer of headroom for the baseplate, caps and ridge pieces the styling adds on top.
  // The grid is one cell wider than the width, so stay a stud under the board limit.
  const tallest = maxModelWidth(triangles, Math.min(limit, MAX_BUILD_AREA - 1), MAX_VOXEL_LAYERS - 1);
  // The search runs the full fill, hidden support columns included, so the budget holds;
  // set styling runs once on the result.
  const fillOptions = {
    buildArea: options.buildArea,
    maxPieces: options.pieceBudget,
    colorAllowed: options.colorAllowed,
    texture: true,
    supportGaps: true,
  };
  const convert = (widthStuds: number) => {
    const model = voxelizeTriangles(triangles, { widthStuds, palette: options.palette });
    return { width: widthStuds, model, fill: fillVoxelModel(model, fillOptions) };
  };
  // Piece count grows roughly with the square of the width (it is mostly surface), so predict
  // the width from each trial and refine; a few conversions instead of a full search.
  let best: ReturnType<typeof convert> | null = null;
  // The narrowest width that ran over the budget; the answer lies below it.
  let miss = tallest + 1;
  let width = Math.min(tallest, 32);
  for (let step = 0; step < 8; step += 1) {
    const attempt = convert(width);
    const pieces = Math.max(1, attempt.fill.assembly.bricks.length);
    const predicted = Math.floor(width * Math.sqrt((options.pieceBudget * 0.95) / pieces));
    if (attempt.fill.truncated) {
      miss = width;
      // A truncated fill only shows the budget ran out, not by how much: step down firmly.
      width = Math.min(predicted, Math.floor(width * 0.75));
    } else {
      best = attempt;
      width = Math.max(predicted, width + 1);
    }
    width = Math.max((best?.width ?? 3) + 1, Math.min(width, miss - 1, tallest));
    if (width >= miss || (best && best.width >= Math.min(tallest, miss - 1))) break;
  }
  best ??= convert(4);
  // A model that cannot stand at this size (a lattice leaning further per course than any
  // brick can reach) is converted smaller until little of it is left out.
  let unsupported = false;
  for (let step = 0; step < 6 && best.width > 8; step += 1) {
    if (best.fill.skippedCells <= MAX_LEFT_OUT * best.fill.filledCells) break;
    unsupported = true;
    const smaller = convert(Math.max(8, Math.floor(best.width * 0.8)));
    if (smaller.fill.truncated) break;
    best = smaller;
  }
  const limitedBy = unsupported
    ? 'support'
    : best.width === scaled ? 'scale' : best.width === options.maxWidth ? null : best.width === tallest ? 'height' : 'pieces';
  // Set-style finishing runs once, on the chosen width.
  const fill = styleVoxelFill(best.fill, best.model, { colorAllowed: options.colorAllowed });
  return { ...best, fill, limitedBy } as const;
}

/** The widest conversion, at most `limit` studs, that stays within `maxLayers` brick layers. */
export function maxModelWidth(triangles: ModelTriangles, limit: number, maxLayers = MAX_VOXEL_LAYERS) {
  const bounds = modelBounds(triangles);
  let width = limit;
  while (width > 1 && grid(bounds, width).layers > maxLayers) width -= 1;
  return width;
}

/**
 * Samples the model surface into brick cells: the longest horizontal side becomes `widthStuds`
 * studs, and height keeps real proportions (a brick is 1.2 studs tall). Surface sampling copes
 * with SketchUp's single-face walls, which have no inside to test. Each cell takes the color of
 * the surfaces facing open air outside the model, so the inner sides of walls (often unpainted)
 * do not leak through; with `hollow`, cells no outside air reaches (floors, inner walls) are dropped.
 */
export function voxelizeTriangles(
  triangles: ModelTriangles,
  options: { widthStuds: number; palette: readonly PaletteColor[]; hollow?: boolean },
): VoxelModel {
  if (!options.palette.length) throw new Error('No brick colors are available.');
  const hollow = options.hollow ?? true;
  const bounds = modelBounds(triangles);
  const { stud, layerHeight, width, depth, layers } = grid(bounds, options.widthStuds);
  const start = bounds.min.clone().sub(new Vector3(stud / 2, layerHeight / 2, stud / 2));
  if (layers > MAX_VOXEL_LAYERS)
    throw new Error(
      `At ${options.widthStuds} studs wide the model is ${layers} bricks tall; the limit is ${MAX_VOXEL_LAYERS}. Use a smaller width.`,
    );
  const palette = options.palette.map(({ id, hex }) => {
    const value = Number.parseInt(hex.slice(1), 16);
    return { id, lab: lab(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255) };
  });
  // Perceptual (CIE76) distance: plain RGB distance prefers LDraw's blue-tinted Black over
  // Dark Bluish Grey for dark stone and wood.
  const nearest = (red: number, green: number, blue: number) => {
    const [l, a, b] = lab(red, green, blue);
    let best = palette[0];
    let bestDistance = Infinity;
    for (const entry of palette) {
      const distance = (l - entry.lab[0]) ** 2 + (a - entry.lab[1]) ** 2 + (b - entry.lab[2]) ** 2;
      if (distance < bestDistance) [best, bestDistance] = [entry, distance];
    }
    return best.id;
  };
  const count = triangles.colors.length / 3;
  const triangleColor = new Int32Array(count);
  const normals = new Float32Array(count * 3);
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let triangle = 0; triangle < count; triangle += 1) {
    triangleColor[triangle] = nearest(
      triangles.colors[triangle * 3],
      triangles.colors[triangle * 3 + 1],
      triangles.colors[triangle * 3 + 2],
    );
    a.fromArray(triangles.positions, triangle * 9);
    b.fromArray(triangles.positions, triangle * 9 + 3).sub(a);
    c.fromArray(triangles.positions, triangle * 9 + 6).sub(a);
    b.cross(c).normalize().toArray(normals, triangle * 3);
  }
  // Triangles with a decoded see-through texture are sampled texel by texel below; the rest
  // are solid surfaces found through the BVH.
  const masked = (triangle: number) => {
    const mask = triangles.masks?.[triangle] ?? -1;
    return mask >= 0 && !!triangles.alphaMasks?.[mask];
  };
  const solid: number[] = [];
  for (let triangle = 0; triangle < count; triangle += 1) if (!masked(triangle)) solid.push(triangle);
  const solidPositions = new Float32Array(Math.max(1, solid.length) * 9);
  solid.forEach((triangle, position) =>
    solidPositions.set(triangles.positions.subarray(triangle * 9, triangle * 9 + 9), position * 9),
  );
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(solidPositions, 3));
  // The BVH reorders the index; the triangle is its first vertex / 3, mapped back through solid.
  const bvh = new MeshBVH(geometry);
  const index = geometry.index!;
  const originalOf = (triangleIndex: number) => solid[Math.floor(index.getX(triangleIndex * 3) / 3)] ?? -1;
  const cellBox = (layer: number, x: number, z: number, box: Box3) => {
    // A hair of inset keeps faces that merely end on a boundary out of the neighbouring cell.
    const inset = 0.001;
    box.min.set(
      start.x + (x + inset) * stud,
      start.y + (layer + inset) * layerHeight,
      start.z + (z + inset) * stud,
    );
    box.max.set(
      start.x + (x + 1 - inset) * stud,
      start.y + (layer + 1 - inset) * layerHeight,
      start.z + (z + 1 - inset) * stud,
    );
    return box;
  };
  const identity = new Matrix4();
  const box = new Box3();
  const cellIndex = (layer: number, x: number, z: number) => (layer * depth + z) * width + x;
  const occupied = new Uint8Array(width * depth * layers);
  if (solid.length)
    for (let layer = 0; layer < layers; layer += 1)
      for (let z = 0; z < depth; z += 1)
        for (let x = 0; x < width; x += 1)
          occupied[cellIndex(layer, x, z)] = bvh.intersectsBox(cellBox(layer, x, z, box), identity) ? 1 : 0;
  const maskColor = sampleMasks(triangles, triangleColor, { start, stud, layerHeight, width, depth, layers });
  for (const [cell] of maskColor) occupied[cell] = 1;
  // Open air reachable from outside the grid, through empty cells.
  const outside = new Uint8Array(occupied.length);
  const queue: number[] = [];
  const directions = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ] as const;
  const neighbour = (cell: number, [dx, dy, dz]: readonly [number, number, number]) => {
    const x = (cell % width) + dx;
    const z = (Math.floor(cell / width) % depth) + dz;
    const layer = Math.floor(cell / (width * depth)) + dy;
    if (x < 0 || z < 0 || layer < 0 || x >= width || z >= depth || layer >= layers) return -1;
    return cellIndex(layer, x, z);
  };
  for (let cell = 0; cell < occupied.length; cell += 1)
    if (!occupied[cell] && directions.some((direction) => neighbour(cell, direction) === -1)) {
      outside[cell] = 1;
      queue.push(cell);
    }
  while (queue.length) {
    const cell = queue.pop()!;
    for (const direction of directions) {
      const next = neighbour(cell, direction);
      if (next !== -1 && !occupied[next] && !outside[next]) {
        outside[next] = 1;
        queue.push(next);
      }
    }
  }
  const cells: (number | null)[] = [];
  const slopes: (VoxelDirection | null)[] = [];
  const slopeNormal = new Vector3();
  for (let cell = 0; cell < occupied.length; cell += 1) {
    slopes.push(null);
    if (!occupied[cell]) {
      cells.push(null);
      continue;
    }
    const open = directions.filter((direction) => {
      const next = neighbour(cell, direction);
      // The ground below the model is not a viewpoint.
      return next === -1 ? direction[1] !== -1 : outside[next] === 1;
    });
    if (hollow && !open.length) {
      cells.push(null);
      continue;
    }
    const x = cell % width;
    const z = Math.floor(cell / width) % depth;
    const layer = Math.floor(cell / (width * depth));
    cellBox(layer, x, z, box);
    const facing = new Map<number, number>();
    const any = new Map<number, number>();
    slopeNormal.set(0, 0, 0);
    if (solid.length) bvh.shapecast({
      intersectsBounds: (bounds) => bounds.intersectsBox(box),
      intersectsTriangle: (triangle, triangleIndex) => {
        if (!triangle.intersectsBox(box)) return;
        const original = originalOf(triangleIndex);
        const color = triangleColor[original];
        // Faces vote by the area they cover inside this cell.
        const weight =
          (clippedArea(triangles.positions, original, box) || 1e-9) * (triangles.unpainted?.[original] ? 1e-6 : 1);
        any.set(color, (any.get(color) ?? 0) + weight);
        const faces = open.some(
          ([dx, dy, dz]) =>
            normals[original * 3] * dx + normals[original * 3 + 1] * dy + normals[original * 3 + 2] * dz > 0.2,
        );
        if (faces) facing.set(color, (facing.get(color) ?? 0) + weight);
        // Face winding is unreliable in downloaded models, so orient each normal toward the open air.
        const [nx, ny, nz] = [normals[original * 3], normals[original * 3 + 1], normals[original * 3 + 2]];
        const toward = open.reduce((sum, [dx, dy, dz]) => sum + nx * dx + ny * dy + nz * dz, 0);
        const sign = toward < 0 || (toward === 0 && ny < 0) ? -weight : weight;
        slopeNormal.x += nx * sign;
        slopeNormal.y += ny * sign;
        slopeNormal.z += nz * sign;
      },
    });
    slopes[cell] = downhill(slopeNormal);
    const votes = facing.size ? facing : any;
    let best: number | null = null;
    let bestWeight = -1;
    for (const [color, weight] of votes)
      if (weight > bestWeight) [best, bestWeight] = [color, weight];
    cells.push(best ?? maskColor.get(cell) ?? palette[0].id);
  }
  return {
    name: triangles.name,
    width,
    depth,
    layers,
    cells: despeckle(cells, width, depth, layers),
    slopes,
    openings: solid.length ? findOpenings(bvh, { start, stud, layerHeight, width, depth, layers }) : [],
  };
}

/** Share of a model that may be left out unsupported before the converter goes smaller. */
const MAX_LEFT_OUT = 0.05;
/** Share of a cell's see-through surface that must be opaque for the cell to be filled. */
const MASK_COVERAGE = 0.1;

/**
 * Samples triangles with see-through textures (a lattice painted on flat panels, a fence,
 * foliage) at a third of a cell, looking up each sample's texel, and returns the cells where
 * enough of that surface is opaque, with their colour.
 */
function sampleMasks(
  triangles: ModelTriangles,
  triangleColor: Int32Array,
  grid: { start: Vector3; stud: number; layerHeight: number; width: number; depth: number; layers: number },
) {
  const { start, stud, layerHeight, width, depth, layers } = grid;
  const total = new Map<number, number>();
  const opaque = new Map<number, number>();
  const color = new Map<number, number>();
  const { uvs, masks, alphaMasks } = triangles;
  if (!uvs || !masks || !alphaMasks) return color;
  const spacing = Math.min(stud, layerHeight) / 3;
  const point = new Vector3();
  for (let triangle = 0; triangle < masks.length; triangle += 1) {
    const mask = masks[triangle] >= 0 ? alphaMasks[masks[triangle]] : null;
    if (!mask) continue;
    const p = triangles.positions.subarray(triangle * 9, triangle * 9 + 9);
    const t = uvs.subarray(triangle * 6, triangle * 6 + 6);
    const longest = Math.max(
      Math.hypot(p[3] - p[0], p[4] - p[1], p[5] - p[2]),
      Math.hypot(p[6] - p[0], p[7] - p[1], p[8] - p[2]),
      Math.hypot(p[6] - p[3], p[7] - p[4], p[8] - p[5]),
    );
    const steps = Math.min(600, Math.max(1, Math.ceil(longest / spacing)));
    for (let i = 0; i < steps; i += 1)
      for (let j = 0; i + j < steps; j += 1) {
        // Centres of a regular subdivision of the triangle.
        const [u, v] = [(i + 1 / 3) / steps, (j + 1 / 3) / steps];
        const w = 1 - u - v;
        point.set(
          p[0] * w + p[3] * u + p[6] * v,
          p[1] * w + p[4] * u + p[7] * v,
          p[2] * w + p[5] * u + p[8] * v,
        );
        const x = Math.floor((point.x - start.x) / stud);
        const z = Math.floor((point.z - start.z) / stud);
        const layer = Math.floor((point.y - start.y) / layerHeight);
        if (x < 0 || z < 0 || layer < 0 || x >= width || z >= depth || layer >= layers) continue;
        const cell = (layer * depth + z) * width + x;
        const tu = t[0] * w + t[2] * u + t[4] * v;
        const tv = t[1] * w + t[3] * u + t[5] * v;
        // Textures repeat across a face.
        const tx = Math.floor((tu - Math.floor(tu)) * mask.width);
        const ty = Math.floor((tv - Math.floor(tv)) * mask.height);
        total.set(cell, (total.get(cell) ?? 0) + 1);
        if (mask.opaque[ty * mask.width + tx]) {
          opaque.set(cell, (opaque.get(cell) ?? 0) + 1);
          if (!color.has(cell)) color.set(cell, triangleColor[triangle]);
        }
      }
  }
  for (const [cell] of color) if ((opaque.get(cell) ?? 0) < MASK_COVERAGE * total.get(cell)!) color.delete(cell);
  return color;
}

/** The way a roof surface runs down, from its outward normal; null unless it is sloped. */
function downhill(normal: Vector3): VoxelDirection | null {
  if (!normal.lengthSq()) return null;
  normal.normalize();
  if (normal.y < 0.25 || normal.y > 0.95) return null;
  return Math.abs(normal.x) >= Math.abs(normal.z)
    ? normal.x > 0 ? 'x+' : 'x-'
    : normal.z > 0 ? 'z+' : 'z-';
}

/** Openings at most this many cells wide and layers tall; larger recesses are setbacks. */
const MAX_OPENING = { width: 6, height: 8 };

/**
 * Finds doors and windows by looking at each side of the model: a small patch set back from
 * the wall around it (a recessed window, or a hole into the building) is an opening. Doors are
 * openings at least three bricks tall with no wall below them, only ground, steps or nothing.
 */
function findOpenings(
  bvh: MeshBVH,
  grid: { start: Vector3; stud: number; layerHeight: number; width: number; depth: number; layers: number },
): VoxelOpening[] {
  const { start, stud, layerHeight, layers } = grid;
  const openings: VoxelOpening[] = [];
  const ray = new Ray();
  for (const [facing, normal] of [
    ['x+', new Vector3(1, 0, 0)],
    ['x-', new Vector3(-1, 0, 0)],
    ['z+', new Vector3(0, 0, 1)],
    ['z-', new Vector3(0, 0, -1)],
  ] as const) {
    const alongX = facing[0] === 'z';
    const span = alongX ? grid.width : grid.depth;
    const across = alongX ? grid.depth : grid.width;
    const sign = facing[1] === '+' ? 1 : -1;
    // Distance into the model (from its outer side) of the first face seen, per cell of this side.
    const seen = new Float64Array(span * layers).fill(Infinity);
    const wall = new Uint8Array(span * layers);
    const outer = sign > 0 ? across * stud : 0;
    for (let layer = 0; layer < layers; layer += 1)
      for (let u = 0; u < span; u += 1) {
        const position = new Vector3(0, start.y + (layer + 0.5) * layerHeight, 0);
        const offset = (alongX ? start.x : start.z) + (u + 0.5) * stud;
        const from = (alongX ? start.z : start.x) + outer + sign * stud;
        if (alongX) position.set(offset, position.y, from);
        else position.set(from, position.y, offset);
        ray.set(position, normal.clone().negate());
        const hit = bvh.raycastFirst(ray, DoubleSide);
        if (!hit) continue;
        seen[layer * span + u] = hit.distance - stud;
        wall[layer * span + u] = Math.abs(hit.face!.normal.dot(normal)) > 0.9 ? 1 : 0;
      }
    const recessed = new Uint8Array(span * layers);
    const reference = new Float64Array(span * layers).fill(NaN);
    for (let layer = 0; layer < layers; layer += 1)
      for (let u = 0; u < span; u += 1) {
        const around: number[] = [];
        for (let dl = -3; dl <= 3; dl += 1)
          for (let du = -3; du <= 3; du += 1) {
            const [l, v] = [layer + dl, u + du];
            if (l >= 0 && v >= 0 && l < layers && v < span && wall[l * span + v]) around.push(seen[l * span + v]);
          }
        if (around.length < 8) continue;
        around.sort((a, b) => a - b);
        const median = around[Math.floor(around.length / 2)];
        reference[layer * span + u] = median;
        if (seen[layer * span + u] - median > 0.15 * stud) recessed[layer * span + u] = 1;
      }
    const visited = new Uint8Array(span * layers);
    const boxes: { u0: number; u1: number; l0: number; l1: number; depthIn: number }[] = [];
    for (let first = 0; first < span * layers; first += 1) {
      if (!recessed[first] || visited[first]) continue;
      const component: number[] = [];
      const queue = [first];
      visited[first] = 1;
      while (queue.length) {
        const pixel = queue.pop()!;
        component.push(pixel);
        const [layer, u] = [Math.floor(pixel / span), pixel % span];
        for (const [l, v] of [[layer + 1, u], [layer - 1, u], [layer, u + 1], [layer, u - 1]])
          if (l >= 0 && v >= 0 && l < layers && v < span && recessed[l * span + v] && !visited[l * span + v]) {
            visited[l * span + v] = 1;
            queue.push(l * span + v);
          }
      }
      const us = component.map((pixel) => pixel % span);
      const ls = component.map((pixel) => Math.floor(pixel / span));
      const [u0, u1, l0, l1] = [Math.min(...us), Math.max(...us), Math.min(...ls), Math.max(...ls)];
      const [w, h] = [u1 - u0 + 1, l1 - l0 + 1];
      if (w > MAX_OPENING.width || h > MAX_OPENING.height || component.length < 0.5 * w * h) continue;
      // Most of the ring around it must be wall, so the edge of a setback does not count.
      let ring = 0;
      let solid = 0;
      for (let l = l0 - 1; l <= l1 + 1; l += 1)
        for (let v = u0 - 1; v <= u1 + 1; v += 1) {
          if (l >= l0 && l <= l1 && v >= u0 && v <= u1) continue;
          if (l < 0 || v < 0 || v >= span || l >= layers) continue;
          ring += 1;
          if (wall[l * span + v] && !recessed[l * span + v]) solid += 1;
        }
      // The bottom ring row may be the ground for a door.
      if (!ring || solid < 0.6 * ring) continue;
      boxes.push({ u0, u1, l0, l1, depthIn: reference[component[0]] });
    }
    // A bar across a tall door (a transom, or an arch's springing line) splits it in two;
    // pieces stacked one layer apart in the same wall are one opening.
    boxes.sort((a, b) => a.l0 - b.l0);
    for (let lower = 0; lower < boxes.length; lower += 1)
      for (let upper = lower + 1; upper < boxes.length; upper += 1) {
        const [a, b] = [boxes[lower], boxes[upper]];
        const overlap = Math.min(a.u1, b.u1) - Math.max(a.u0, b.u0) + 1;
        if (
          b.l0 - a.l1 <= 2 &&
          overlap >= 0.5 * Math.min(a.u1 - a.u0 + 1, b.u1 - b.u0 + 1) &&
          Math.abs(a.depthIn - b.depthIn) < 0.5 * stud &&
          Math.max(a.l1, b.l1) - a.l0 + 1 <= MAX_OPENING.height
        ) {
          boxes[lower] = { ...a, u0: Math.min(a.u0, b.u0), u1: Math.max(a.u1, b.u1), l1: Math.max(a.l1, b.l1) };
          boxes.splice(upper, 1);
          upper = lower;
        }
      }
    for (const { u0, u1, l0, l1, depthIn } of boxes) {
      const plane = Math.floor((sign > 0 ? across * stud - depthIn : depthIn) / stud + (sign > 0 ? -0.05 : 0.05));
      if (!(plane >= 0 && plane < across)) continue;
      // A window has wall flush with the facade below it; a door has only ground, steps or nothing.
      let wallBelow = false;
      for (let l = 0; l < l0 && !wallBelow; l += 1)
        for (let v = u0; v <= u1; v += 1)
          if (wall[l * span + v] && Math.abs(seen[l * span + v] - depthIn) <= 0.15 * stud) wallBelow = true;
      const h = l1 - l0 + 1;
      openings.push({
        kind: h >= 3 && !wallBelow ? 'door' : 'window',
        x: alongX ? u0 : plane,
        z: alongX ? plane : u0,
        layer: l0,
        width: u1 - u0 + 1,
        height: h,
        axis: alongX ? 'x' : 'z',
        facing,
      });
    }
  }
  return openings;
}

/** Area of a triangle (by index into 9-value positions) inside a box, by polygon clipping. */
function clippedArea(positions: Float32Array, triangle: number, box: Box3) {
  let polygon = [0, 1, 2].map((corner) => new Vector3().fromArray(positions, triangle * 9 + corner * 3));
  for (const axis of ['x', 'y', 'z'] as const)
    for (const [limit, sign] of [[box.min[axis], 1], [box.max[axis], -1]] as const) {
      const inside = (point: Vector3) => (point[axis] - limit) * sign >= 0;
      const clipped: Vector3[] = [];
      polygon.forEach((point, position) => {
        const next = polygon[(position + 1) % polygon.length];
        if (inside(point)) clipped.push(point);
        if (inside(point) !== inside(next))
          clipped.push(point.clone().lerp(next, (limit - point[axis]) / (next[axis] - point[axis])));
      });
      polygon = clipped;
      if (polygon.length < 3) return 0;
    }
  const sum = new Vector3();
  const edge = new Vector3();
  for (let position = 1; position < polygon.length - 1; position += 1)
    sum.add(
      edge
        .subVectors(polygon[position], polygon[0])
        .cross(new Vector3().subVectors(polygon[position + 1], polygon[0])),
    );
  return sum.length() / 2;
}

/** sRGB components (0-1) to CIELAB under D65. */
function lab(red: number, green: number, blue: number): [number, number, number] {
  const [r, g, b] = [red, green, blue].map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  const f = (value: number) => (value > 216 / 24389 ? Math.cbrt(value) : (24389 / 27 * value + 16) / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/**
 * Recolors cells whose color none of their filled neighbours share (texture noise, a stray
 * beam end) to the neighbours' most common color, so walls fill with longer bricks.
 */
function despeckle(cells: (number | null)[], width: number, depth: number, layers: number) {
  const result = [...cells];
  for (let layer = 0; layer < layers; layer += 1)
    for (let z = 0; z < depth; z += 1)
      for (let x = 0; x < width; x += 1) {
        const own = cells[(layer * depth + z) * width + x];
        if (own === null) continue;
        const counts = new Map<number, number>();
        for (let dy = -1; dy <= 1; dy += 1)
          for (let dz = -1; dz <= 1; dz += 1)
            for (let dx = -1; dx <= 1; dx += 1) {
              const [nx, ny, nz] = [x + dx, layer + dy, z + dz];
              if ((!dx && !dy && !dz) || nx < 0 || nz < 0 || ny < 0 || nx >= width || nz >= depth || ny >= layers)
                continue;
              const color = cells[(ny * depth + nz) * width + nx];
              if (color !== null) counts.set(color, (counts.get(color) ?? 0) + 1);
            }
        if (counts.has(own) || [...counts.values()].reduce((sum, count) => sum + count, 0) < 2) continue;
        result[(layer * depth + z) * width + x] = [...counts].sort((a, b) => b[1] - a[1])[0][0];
      }
  return result;
}
