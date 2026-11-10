import {
  AmbientLight,
  Box3,
  CanvasTexture,
  Color,
  DirectionalLight,
  Fog,
  Group,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  MeshNormalMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import type { Object3D } from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  COLORS,
  PLATE_HEIGHT,
  footprint,
  isFloorPlate,
  getLDrawTransform,
  getPart,
} from '@brick-workshop/engine';
import type { Assembly, Brick } from '@brick-workshop/engine';
import { createFallbackGeometry } from '../fallback-geometry';
import { coloredLDrawModel, loadLDrawModels } from '../ldraw';
import { LDrawBatch, canBatchLDrawModel } from '../ldraw-batches';
import type { BatchEntry } from '../ldraw-batches';
import { colorMaterialProperties } from '../ldraw-materials';
import {
  MOODS,
  createCinematicComposer,
  createCinematicRig,
  createStudioEnvironment,
  fogRange,
  paintSky,
} from '../cinematic-look';
import type { CinematicMood } from '../cinematic-look';
import { rgbCss } from './layout';
import type { Rgb } from './layout';

/**
 * The four sides the model is shown from, a quarter turn apart, all looking down at the same
 * angle. The first matches the workshop's opening view.
 */
const VIEWS = [
  new Vector3(0.65, 0.55, -0.8),
  new Vector3(0.8, 0.55, 0.65),
  new Vector3(-0.65, 0.55, 0.8),
  new Vector3(-0.8, 0.55, -0.65),
].map((view) => view.normalize());

/** Edges live on their own layer so visibility checks count faces only. */
const EDGE_LAYER = 1;
/** Loose pieces are merged into instanced batches once this many have piled up. */
const BATCH_THRESHOLD = 300;
/** Early steps zoom in on the first pieces, but never more than this past the finished model. */
const MAX_ZOOM = 2.5;
/** Below this many pixels per stud, edge lines would bury the colors, so they're left out. */
const MIN_EDGE_DETAIL = 10;
/**
 * Cinematic shots are lit like photos, where unlit edge lines read as a pale haze over the
 * model, so only close-ups this sharp keep them.
 */
const MIN_CINEMATIC_EDGE_DETAIL = 28;
/** Smallest stretch of the model, in studs across, a close-up step shows. */
const FOCUS_SIZE = 16;
/** Room left around a step's new pieces when its close-up moves. */
const FOCUS_MARGIN = 3;
const VISIBILITY_SIZE = 160;
/** Outline around each step's new pieces: a vivid pink-red few bricks share. */
const HIGHLIGHT = [255, 45, 85, 255];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StepImage {
  url: string;
  /** Quarter turns from the previous step's view: 1 is clockwise seen from above. */
  turn: -1 | 0 | 1 | 2;
  /** The whole model with the new pieces ringed, when the close-up has moved or turned. */
  overview?: string;
}

/** Share of the step image's width and height an overview inset takes. */
export const OVERVIEW_SCALE = 0.38;

function brickBounds(brick: Brick) {
  const size = footprint(brick);
  return new Box3(
    new Vector3(brick.x, brick.y * PLATE_HEIGHT, brick.z),
    new Vector3(
      brick.x + size.width,
      (brick.y + size.height) * PLATE_HEIGHT + 0.17,
      brick.z + size.depth,
    ),
  );
}

/** Baseplates and plate floors are the ground the model stands on, not what a step frames. */
function isGround(brick: Brick) {
  return getPart(brick.partId).family === 'baseplate' || isFloorPlate(brick);
}

/** The outward direction of the box's long side that faces the camera of `view`. */
function longSide(box: Box3, view: number) {
  const side = VIEWS[view];
  return box.max.x - box.min.x >= box.max.z - box.min.z
    ? new Vector3(0, 0, Math.sign(side.z) || 1)
    : new Vector3(Math.sign(side.x) || 1, 0, 0);
}

function corners(box: Box3) {
  return [0, 1, 2, 3, 4, 5, 6, 7].map(
    (index) =>
      new Vector3(
        index & 1 ? box.max.x : box.min.x,
        index & 2 ? box.max.y : box.min.y,
        index & 4 ? box.max.z : box.min.z,
      ),
  );
}

export class ManualRenderer {
  private readonly renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera();
  private readonly placed = new Group();
  private readonly fresh = new Group();
  /** The everyday lights, switched off while the cinematic stage lights the model. */
  private readonly lights = new Group();
  private readonly target = new WebGLRenderTarget(VISIBILITY_SIZE, VISIBILITY_SIZE);
  private readonly highlightTarget = new WebGLRenderTarget(1, 1);
  private readonly canvas = document.createElement('canvas');
  private readonly colored = new Map<string, Group>();
  private readonly owned: { dispose(): void }[] = [];
  private readonly bricks: Map<string, Brick>;
  /** Everything in the finished build, baseplates included. */
  private readonly sceneBounds = new Box3();
  /** The finished model without its baseplates, or the baseplates when that's all there is. */
  private readonly finalBounds = new Box3();
  /** What's been placed so far, without baseplates once anything stands on them. */
  private readonly bounds = new Box3();
  /** What's been placed so far, baseplates included. */
  private readonly placedBounds = new Box3();
  private readonly modelBounds = new Box3();
  /** The area close-ups show, kept while work stays inside it so the camera holds still. */
  private focus: Box3 | null = null;
  private loose: { brick: Brick; object: Object3D }[] = [];
  /** Every consolidated piece, drawn by one batched mesh. */
  private batch: LDrawBatch | null = null;
  private readonly batched: BatchEntry[] = [];
  private view = 0;
  private readonly models: Record<string, Group>;

  private constructor(assembly: Assembly, models: Record<string, Group>) {
    this.models = models;
    this.bricks = new Map(assembly.bricks.map((brick) => [brick.id, brick]));
    for (const brick of assembly.bricks) {
      this.sceneBounds.union(brickBounds(brick));
      if (!isGround(brick)) this.finalBounds.union(brickBounds(brick));
    }
    if (this.finalBounds.isEmpty()) this.finalBounds.copy(this.sceneBounds);
    this.renderer.setPixelRatio(1);
    const environment = new RoomEnvironment();
    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(environment).texture;
    this.owned.push(this.scene.environment, this.target, this.highlightTarget, this.renderer);
    environment.dispose();
    pmrem.dispose();
    const key = new DirectionalLight(0xffffff, 1.8);
    key.position.set(8, 14, -10);
    const fill = new DirectionalLight(0xffffff, 0.6);
    fill.position.set(-10, 4, 8);
    this.lights.add(new AmbientLight(0xffffff, 0.6), key, fill);
    this.scene.add(this.lights, this.placed, this.fresh);
    this.camera.layers.enable(EDGE_LAYER);
  }

  /** Loads the build's parts; pieces whose geometry can't load are drawn as simple shapes. */
  static async create(assembly: Assembly) {
    const ids = [...new Set(assembly.bricks.map((brick) => brick.partId))];
    const models: Record<string, Group> = {};
    const settled = await Promise.allSettled(ids.map((id) => loadLDrawModels([id])));
    for (const result of settled)
      if (result.status === 'fulfilled') Object.assign(models, result.value);
    return {
      renderer: new ManualRenderer(assembly, models),
      missing: ids.filter((id) => !models[id]),
    };
  }

  private coloredModel(partId: string, color: number) {
    const key = `${partId}:${color}`;
    let model = this.colored.get(key);
    if (!model) {
      model = coloredLDrawModel(this.models[partId], color);
      this.colored.set(key, model);
    }
    return model;
  }

  private createPiece(brick: Brick): Object3D {
    let piece: Object3D;
    if (this.models[brick.partId]) {
      const instance = this.coloredModel(brick.partId, brick.color).clone();
      const transform = getLDrawTransform(brick);
      const [a, b, c, d, e, f, g, h, i] = transform.matrix;
      instance.matrixAutoUpdate = false;
      instance.matrix
        .set(a, b, c, 0, d, e, f, 0, g, h, i, 0, 0, 0, 0, 1)
        .setPosition(transform.x, transform.y, transform.z);
      piece = new Group();
      // LDraw's y axis points down and its units are 20 to a stud.
      piece.scale.set(0.05, -0.05, 0.05);
      piece.add(instance);
    } else {
      const size = footprint(brick);
      const geometry = createFallbackGeometry(brick);
      const material = new MeshStandardMaterial(
        colorMaterialProperties(COLORS.find((color) => color.id === brick.color)!),
      );
      this.owned.push(geometry, material);
      piece = new Mesh(geometry, material);
      piece.position.set(
        brick.x + size.width / 2,
        (brick.y + size.height / 2) * PLATE_HEIGHT,
        brick.z + size.depth / 2,
      );
    }
    piece.traverse((object) => {
      if (object instanceof LineSegments) object.layers.set(EDGE_LAYER);
    });
    return piece;
  }

  /** Merges loose opaque LDraw pieces into the batched mesh. */
  private consolidate() {
    const remaining: typeof this.loose = [];
    let added = false;
    for (const entry of this.loose) {
      const { brick } = entry;
      const model = this.models[brick.partId];
      if (!model || !canBatchLDrawModel(model)) {
        remaining.push(entry);
        continue;
      }
      this.placed.remove(entry.object);
      this.batched.push({ brick, model });
      added = true;
    }
    if (added) {
      if (!this.batch) {
        this.batch = new LDrawBatch();
        for (const lines of this.batch.lines) lines.layers.set(EDGE_LAYER);
        this.owned.push(this.batch);
      }
      this.batch.update(this.batched, 0);
      if (!this.batch.object.parent) this.placed.add(this.batch.object);
    }
    this.loose = remaining;
  }

  /** Points the camera at a box from one of the four views, filling the given aspect. */
  private frame(box: Box3, view: number, aspect: number, minimum?: Box3) {
    const center = box.getCenter(new Vector3());
    // Far enough back that the whole board stays in front of the camera when it's cropped.
    const radius = Math.max(this.sceneBounds.getSize(new Vector3()).length(), 1);
    this.camera.position.copy(center).addScaledVector(VIEWS[view], radius * 2);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(center);
    this.camera.updateMatrixWorld();
    const extent = (target: Box3) => {
      const projected = new Box3().setFromPoints(
        corners(target).map((corner) => corner.applyMatrix4(this.camera.matrixWorldInverse)),
      );
      return projected;
    };
    const projected = extent(box);
    let halfWidth = (projected.max.x - projected.min.x) / 2;
    let halfHeight = (projected.max.y - projected.min.y) / 2;
    if (minimum) {
      const full = extent(minimum);
      halfWidth = Math.max(halfWidth, (full.max.x - full.min.x) / 2 / MAX_ZOOM);
      halfHeight = Math.max(halfHeight, (full.max.y - full.min.y) / 2 / MAX_ZOOM);
    }
    halfWidth = Math.max(halfWidth, halfHeight * aspect) * 1.08;
    halfHeight = halfWidth / aspect;
    const middleX = (projected.max.x + projected.min.x) / 2;
    const middleY = (projected.max.y + projected.min.y) / 2;
    Object.assign(this.camera, {
      left: middleX - halfWidth,
      right: middleX + halfWidth,
      top: middleY + halfHeight,
      bottom: middleY - halfHeight,
      near: 0.1,
      far: radius * 4,
    });
    this.camera.updateProjectionMatrix();
  }

  /**
   * Renders the new pieces white on black into a target, behind the build so far when
   * `withPlaced` is set, and returns its pixels (rows bottom-up, RGBA).
   */
  private mask(target: WebGLRenderTarget, withPlaced: boolean) {
    const { renderer, scene, camera } = this;
    const environment = scene.environment;
    const black = new MeshBasicMaterial({ color: 0x000000 });
    const white = new MeshBasicMaterial({ color: 0xffffff });
    scene.environment = null;
    camera.layers.set(0);
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.autoClear = false;
    try {
      if (withPlaced) {
        this.fresh.visible = false;
        scene.overrideMaterial = black;
        renderer.render(scene, camera);
        this.fresh.visible = true;
      }
      this.placed.visible = false;
      scene.overrideMaterial = white;
      renderer.render(scene, camera);
      const pixels = new Uint8Array(target.width * target.height * 4);
      renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, pixels);
      return pixels;
    } finally {
      renderer.autoClear = true;
      scene.overrideMaterial = null;
      black.dispose();
      white.dispose();
      this.placed.visible = true;
      renderer.setRenderTarget(null);
      camera.layers.enable(EDGE_LAYER);
      scene.environment = environment;
    }
  }

  /** Whether the model so far is small enough that a close-up already shows all of it. */
  private get compact() {
    const size = this.bounds.getSize(new Vector3());
    return !this.focus || Math.max(size.x, size.z) <= FOCUS_SIZE;
  }

  /** Frames the close-up area, or the whole model so far when it's no bigger than that. */
  private frameStep(view: number, aspect: number) {
    if (this.compact) this.frame(this.bounds, view, aspect, this.finalBounds);
    else this.frame(this.focus!, view, aspect);
  }

  /**
   * Moves the close-up area when a step's pieces fall outside it. Returns whether it jumped
   * somewhere new, rather than sliding along to neighbouring work.
   */
  private refocus(pieces: Box3) {
    const needed = pieces.clone().expandByVector(new Vector3(1, PLATE_HEIGHT * 3, 1));
    if (this.focus?.containsBox(needed)) return false;
    const next = pieces.clone().expandByVector(new Vector3(FOCUS_MARGIN, 1.2, FOCUS_MARGIN));
    const size = next.getSize(new Vector3());
    next.expandByVector(
      new Vector3(Math.max(0, FOCUS_SIZE - size.x) / 2, 0, Math.max(0, FOCUS_SIZE - size.z) / 2),
    );
    const jumped = !this.focus?.intersectsBox(next);
    this.focus = next;
    return jumped;
  }

  /** Share of the new pieces' pixels a view shows past the build so far. */
  private visibility(view: number, aspect: number) {
    this.frameStep(view, aspect);
    const count = (withPlaced: boolean) => {
      const pixels = this.mask(this.target, withPlaced);
      let total = 0;
      for (let index = 0; index < pixels.length; index += 4) if (pixels[index] > 127) total++;
      return total;
    };
    const alone = count(false);
    return alone ? count(true) / alone : 0;
  }

  /**
   * Draws a ring in the highlight color around the new pieces' visible silhouette, so a
   * single small piece stands out in a large model.
   */
  private outline(context: CanvasRenderingContext2D, width: number, height: number) {
    this.highlightTarget.setSize(width, height);
    const pixels = this.mask(this.highlightTarget, true);
    const inside = new Uint8Array(width * height);
    for (let row = 0; row < height; row++)
      for (let column = 0; column < width; column++)
        // Render target rows run bottom-up; the canvas's run top-down.
        inside[(height - 1 - row) * width + column] =
          pixels[(row * width + column) * 4] > 127 ? 1 : 0;
    const radius = Math.max(2, Math.round(Math.max(width, height) / 350));
    // Dilate with a box: a running count along rows, then along columns.
    const rows = new Uint8Array(width * height);
    for (let row = 0; row < height; row++) {
      let count = 0;
      for (let column = -radius; column < width; column++) {
        const entering = column + radius;
        if (entering < width) count += inside[row * width + entering];
        if (column - radius - 1 >= 0) count -= inside[row * width + column - radius - 1];
        if (column >= 0) rows[row * width + column] = count > 0 ? 1 : 0;
      }
    }
    const image = context.getImageData(0, 0, width, height);
    for (let column = 0; column < width; column++) {
      let count = 0;
      for (let row = -radius; row < height; row++) {
        const entering = row + radius;
        if (entering < height) count += rows[entering * width + column];
        if (row - radius - 1 >= 0) count -= rows[(row - radius - 1) * width + column];
        if (row < 0) continue;
        const index = row * width + column;
        if (count > 0 && !inside[index]) image.data.set(HIGHLIGHT, index * 4);
      }
    }
    context.putImageData(image, 0, 0);
  }

  /** Renders the camera's view onto a flat background as a JPEG. */
  private capture(width: number, height: number, background: Rgb, highlight = false) {
    this.renderer.setSize(width, height, false);
    this.renderer.setClearColor(0x000000, 0);
    const detailed = width / (this.camera.right - this.camera.left) >= MIN_EDGE_DETAIL;
    if (!detailed) this.camera.layers.disable(EDGE_LAYER);
    this.renderer.render(this.scene, this.camera);
    this.camera.layers.enable(EDGE_LAYER);
    // Composite in 2D so the background is exactly the page color the PDF draws around it.
    this.canvas.width = width;
    this.canvas.height = height;
    const context = this.canvas.getContext('2d', { willReadFrequently: true })!;
    context.fillStyle = rgbCss(background);
    context.fillRect(0, 0, width, height);
    context.drawImage(this.renderer.domElement, 0, 0);
    if (highlight) this.outline(context, width, height);
    return this.canvas.toDataURL('image/jpeg', 0.9);
  }

  /**
   * Adds a step's pieces to the model and renders it. Steps must be rendered in order. The
   * view only turns when another side shows clearly more of the new pieces. Steps are close-ups
   * of the area being worked on, so the new pieces are always readable; when work moves to a
   * new area or the view turns, an overview of the whole model comes along on `overviewBackground`
   * so the reader can find their place.
   */
  renderStep(
    brickIds: readonly string[],
    width: number,
    height: number,
    background: Rgb,
    overviewBackground: Rgb,
  ): StepImage {
    const pieces = new Box3();
    const added = brickIds.map((id) => {
      const brick = this.bricks.get(id);
      if (!brick) throw new Error(`Unknown piece in step: ${id}`);
      const object = this.createPiece(brick);
      this.fresh.add(object);
      this.placedBounds.union(brickBounds(brick));
      if (!isGround(brick)) {
        this.modelBounds.union(brickBounds(brick));
        pieces.union(brickBounds(brick));
      }
      return { brick, object };
    });
    // Frame the model itself and let the baseplates run off the edges, so a small build on a
    // large board stays readable; steps that only lay baseplates show the board.
    this.bounds.copy(this.modelBounds.isEmpty() ? this.placedBounds : this.modelBounds);
    const jumped = !pieces.isEmpty() && this.refocus(pieces);
    const aspect = width / height;
    const previous = this.view;
    const current = this.visibility(this.view, aspect);
    if (current < 0.7) {
      let best = current;
      for (let view = 0; view < VIEWS.length; view++) {
        if (view === previous) continue;
        const score = this.visibility(view, aspect);
        if (score > best + 0.2) {
          best = score;
          this.view = view;
        }
      }
    }
    const highlight = this.placed.children.length > 0;
    let overview: string | undefined;
    if ((jumped || this.view !== previous) && !this.compact) {
      const insetWidth = Math.max(64, Math.round(width * OVERVIEW_SCALE));
      const insetHeight = Math.max(64, Math.round(height * OVERVIEW_SCALE));
      this.frame(this.bounds, this.view, insetWidth / insetHeight, this.finalBounds);
      overview = this.capture(insetWidth, insetHeight, overviewBackground, highlight);
    }
    this.frameStep(this.view, aspect);
    const url = this.capture(width, height, background, highlight);
    for (const entry of added) {
      this.fresh.remove(entry.object);
      this.placed.add(entry.object);
      this.loose.push(entry);
    }
    if (this.loose.length >= BATCH_THRESHOLD) this.consolidate();
    const turn = ((this.view - previous + 4) % 4) as 0 | 1 | 2 | 3;
    return { url, turn: turn === 3 ? -1 : turn, overview };
  }

  /**
   * The whole model so far from one of the four sides, on a transparent background. Returns
   * the renderer's own canvas, valid until the next render.
   */
  renderModel(view: number, width: number, height: number): HTMLCanvasElement {
    this.frame(
      this.placedBounds.isEmpty() ? this.sceneBounds : this.placedBounds,
      view,
      width / height,
    );
    this.renderer.setSize(width, height, false);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement;
  }

  /**
   * The whole model so far on the workshop's cinematic stage, for covers: a perspective shot a
   * little lower than the steps' views, the model filling `hero` (in pixels) and standing on its
   * bottom edge, with the dark backdrop running across the rest of the `width` × `height` image.
   * Returns the renderer's own canvas, valid until the next render.
   */
  renderCinematic(
    view: number,
    width: number,
    height: number,
    hero: Rect,
    mood: CinematicMood,
    {
      detail,
      keepClear = [],
      elevation = 0.42,
      outdoor = false,
      street = false,
    }: {
      /** Part of the model to fill the hero with instead of all of it, for close-ups. */
      detail?: Box3;
      /** Areas of the image, such as text, the model is shrunk or slid sideways to stay out of. */
      keepClear?: Rect[];
      /** How steeply the camera looks down: the rise per unit across. Low angles look up to it. */
      elevation?: number;
      /** Stands the model under a painted sky on open ground instead of in the dark studio. */
      outdoor?: boolean;
      /**
       * Faces the model's long side nearly head-on from close by with a wider lens, so it looms
       * like a building seen from across the street, instead of the corner from far off.
       */
      street?: boolean;
    } = {},
  ): HTMLCanvasElement {
    const { renderer, scene } = this;
    const whole = this.placedBounds.isEmpty() ? this.sceneBounds : this.placedBounds;
    const bounds = detail ?? whole;
    const settings = MOODS[mood];
    const environment = createStudioEnvironment(renderer, mood);
    const previous = {
      environment: scene.environment,
      intensity: scene.environmentIntensity,
      background: scene.background,
      fog: scene.fog,
    };
    const camera = new PerspectiveCamera(street ? 42 : 30, hero.width / hero.height);
    const size = bounds.getSize(new Vector3());
    if (
      Math.min(hero.width, hero.height) / Math.max(size.x, size.z, 1) >=
      MIN_CINEMATIC_EDGE_DETAIL
    )
      camera.layers.enable(EDGE_LAYER);
    const diagonal = VIEWS[view].clone().setY(0).normalize();
    // Head-on to the long side, turned a little toward the corner so its depth still shows.
    const horizontal = street
      ? longSide(whole, view).addScaledVector(diagonal, 0.35).normalize()
      : diagonal;
    // The lights turn with the camera, in quarter turns from the first view as the rig counts them.
    const first = VIEWS[0];
    const turn =
      -(Math.atan2(horizontal.x, horizontal.z) - Math.atan2(first.x, first.z)) / (Math.PI / 2);
    const rig = createCinematicRig(mood, whole, street ? turn : view, outdoor);
    const direction = horizontal.clone().setY(elevation).normalize();
    const focus = bounds.getCenter(new Vector3());
    const distance = street
      ? rig.radius * 1.9
      : rig.radius / Math.sin((camera.fov * Math.PI) / 360);
    camera.position.copy(focus).addScaledVector(direction, distance);
    camera.lookAt(focus);
    camera.near = distance * 0.05;
    camera.far = distance + rig.radius * 20;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    // Zoom to the model's projected outline, then shift the view so it sits centred on the
    // hero's bottom edge; the rest of the image extends the same view outwards. The whole model
    // is fitted by its pieces rather than its bounding box, whose corners stick out well past
    // a model that doesn't fill it. Close-ups fill the hero instead and crop what spills over.
    const points = detail
      ? corners(detail)
      : [...this.bricks.values()].flatMap((brick) => corners(brickBounds(brick)));
    const flat = points.map((point) => point.project(camera));
    const projected = new Box3().setFromPoints(flat);
    const fit = detail ? Math.max : Math.min;
    const zoom =
      (detail ? 1 : 0.98) *
      fit(2 / (projected.max.x - projected.min.x), 2 / (projected.max.y - projected.min.y));
    const middleX = (projected.max.x + projected.min.x) / 2;
    const [scale, shift] = this.clearPlacement(
      flat,
      keepClear,
      width,
      height,
      (point, scale, shift) => [
        hero.x + hero.width / 2 + shift + (point.x - middleX) * zoom * scale * (hero.width / 2),
        hero.y + hero.height - (point.y - projected.min.y) * zoom * scale * (hero.height / 2),
      ],
    );
    camera.zoom = zoom * scale;
    const centerX = ((middleX * camera.zoom + 1) / 2) * hero.width;
    const bottom = ((1 - projected.min.y * camera.zoom) / 2) * hero.height;
    const middle =
      ((1 - ((projected.max.y + projected.min.y) / 2) * camera.zoom) / 2) * hero.height;
    camera.setViewOffset(
      hero.width,
      hero.height,
      centerX - hero.x - hero.width / 2 - shift,
      detail ? middle - hero.y - hero.height / 2 : bottom - hero.y - hero.height,
      width,
      height,
    );
    this.lights.visible = false;
    scene.add(rig.group);
    scene.environment = environment;
    scene.environmentIntensity = outdoor ? settings.daylight.environment : settings.environment;
    let sky: CanvasTexture | null = null;
    if (outdoor) {
      // The painted horizon runs just behind the back edge of the model's footprint, so the
      // model stands in front of the water like a building on the shore.
      const back = Math.min(
        ...corners(whole)
          .filter((point) => point.y === whole.min.y)
          .map((point) => ((1 - point.project(camera).y) / 2) * height),
      );
      sky = new CanvasTexture(paintSky(mood, width, height, back));
      sky.colorSpace = SRGBColorSpace;
      scene.background = sky;
      scene.fog = null;
    } else {
      scene.background = new Color(settings.background);
      scene.fog = new Fog(settings.background, ...fogRange(rig.radius));
    }
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    renderer.setSize(width, height, false);
    renderer.setClearColor(0x000000, 1);
    const composer = createCinematicComposer(renderer, scene, camera, mood, width, height, outdoor);
    try {
      composer.render();
      return renderer.domElement;
    } finally {
      composer.dispose();
      sky?.dispose();
      scene.remove(rig.group);
      rig.dispose();
      environment.dispose();
      scene.environment = previous.environment;
      scene.environmentIntensity = previous.intensity;
      scene.background = previous.background;
      scene.fog = previous.fog;
      renderer.shadowMap.enabled = false;
      this.lights.visible = true;
    }
  }

  /**
   * The largest scale, up to a little past the fit, and the smallest sideways slide in pixels, at
   * which none of the model's points land in the areas to keep clear or off the image's sides.
   * Exactly the fit when there are none.
   */
  private clearPlacement(
    points: Vector3[],
    keepClear: Rect[],
    width: number,
    height: number,
    place: (point: Vector3, scale: number, shift: number) => [number, number],
  ): [number, number] {
    if (!keepClear.length) return [1, 0];
    // Whatever drops below the image is cut off by it anyway, so only what shows must fit the sides.
    const fits = (scale: number, shift: number) =>
      points.every((point) => {
        const [x, y] = place(point, scale, shift);
        return (
          (y > height || (x >= 0 && x <= width)) &&
          keepClear.every(
            (rect) =>
              x < rect.x || x > rect.x + rect.width || y < rect.y || y > rect.y + rect.height,
          )
        );
      });
    const slides = [0];
    for (let step = 1; step <= 12; step++) slides.push(step * width * 0.01, -step * width * 0.01);
    // Start larger than the fit: parts that run off the bottom no longer hold the model back.
    for (let scale = 1.6; scale > 0.5; scale -= 0.02)
      for (const shift of slides) if (fits(scale, shift)) return [scale, shift];
    return [0.5, 0];
  }

  /**
   * The model drawn as white line art on a transparent background, like an architect's elevation:
   * seen straight on from the side of `view` that shows its long face, with lines wherever the
   * surface turns or steps back. It sits centred on the image's bottom edge.
   */
  renderLineArt(view: number, width: number, height: number): HTMLCanvasElement {
    const { renderer, scene } = this;
    const bounds = this.placedBounds.isEmpty() ? this.sceneBounds : this.placedBounds;
    const size = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());
    const axis = longSide(bounds, view);
    const across = size.x >= size.z ? size.x : size.z;
    const deep = size.x >= size.z ? size.z : size.x;
    // Drawn at twice the size and scaled down, so the lines come out fine and smooth.
    const [w, h] = [width * 2, height * 2];
    const scale = Math.min((w * 0.98) / across, (h * 0.98) / size.y);
    const camera = new OrthographicCamera(
      -w / 2 / scale,
      w / 2 / scale,
      h / scale - size.y / 2,
      -size.y / 2,
      1,
      deep + 2,
    );
    camera.position.copy(center).addScaledVector(axis, deep / 2 + 1);
    camera.lookAt(center);
    const previous = { background: scene.background, fog: scene.fog };
    scene.background = null;
    scene.fog = null;
    renderer.setSize(w, h, false);
    renderer.setClearColor(0x000000, 1);
    const [normals, depth] = [new MeshNormalMaterial(), new MeshDepthMaterial()];
    const pixels = (material: MeshNormalMaterial | MeshDepthMaterial) => {
      scene.overrideMaterial = material;
      renderer.render(scene, camera);
      const copy = document.createElement('canvas');
      copy.width = w;
      copy.height = h;
      const context = copy.getContext('2d', { willReadFrequently: true })!;
      context.drawImage(renderer.domElement, 0, 0);
      return context.getImageData(0, 0, w, h).data;
    };
    let normal: Uint8ClampedArray;
    let distance: Uint8ClampedArray;
    try {
      normal = pixels(normals);
      distance = pixels(depth);
    } finally {
      scene.overrideMaterial = null;
      scene.background = previous.background;
      scene.fog = previous.fog;
      normals.dispose();
      depth.dispose();
    }
    const lines = new ImageData(w, h);
    const covered = (index: number) => normal[index] + normal[index + 1] + normal[index + 2] > 0;
    const differs = (a: number, b: number) => {
      if (covered(a) !== covered(b)) return true;
      if (!covered(a)) return false;
      if (Math.abs(distance[a] - distance[b]) > 2) return true;
      const turn =
        Math.abs(normal[a] - normal[b]) +
        Math.abs(normal[a + 1] - normal[b + 1]) +
        Math.abs(normal[a + 2] - normal[b + 2]);
      return turn > 60;
    };
    const mark = (index: number) => {
      lines.data[index] = lines.data[index + 1] = lines.data[index + 2] = 255;
      lines.data[index + 3] = 230;
    };
    for (let y = 0; y < h - 1; y++)
      for (let x = 0; x < w - 1; x++) {
        const index = (y * w + x) * 4;
        for (const other of [index + 4, index + w * 4]) if (differs(index, other)) mark(index);
      }
    const full = document.createElement('canvas');
    full.width = w;
    full.height = h;
    full.getContext('2d')!.putImageData(lines, 0, 0);
    const art = document.createElement('canvas');
    art.width = width;
    art.height = height;
    const context = art.getContext('2d')!;
    context.imageSmoothingQuality = 'high';
    context.drawImage(full, 0, 0, width, height);
    return art;
  }

  /** Places every piece at once, for pictures of the finished model without rendering steps. */
  placeAll() {
    if (this.placed.children.length) return;
    for (const brick of this.bricks.values()) {
      const object = this.createPiece(brick);
      this.placed.add(object);
      this.loose.push({ brick, object });
      this.placedBounds.union(brickBounds(brick));
    }
    this.consolidate();
  }

  /**
   * The busiest corners of the finished model for close-ups: the footprint is cut into squares,
   * each scored by how many different pieces it holds and how tall it stands, and the best
   * squares that aren't neighbours are framed at their top, from the side they face.
   */
  closeUps(count: number): { view: number; bounds: Box3 }[] {
    const model = this.finalBounds;
    const center = model.getCenter(new Vector3());
    const height = Math.max(model.max.y - model.min.y, 1);
    const cell = Math.max(Math.max(model.max.x - model.min.x, model.max.z - model.min.z) / 6, 6);
    const cells = new Map<string, { column: number; row: number; kinds: Set<string>; box: Box3 }>();
    for (const brick of this.bricks.values()) {
      if (isGround(brick)) continue;
      const bounds = brickBounds(brick);
      const column = Math.floor((bounds.min.x - model.min.x) / cell);
      const row = Math.floor((bounds.min.z - model.min.z) / cell);
      const key = `${column}:${row}`;
      let entry = cells.get(key);
      if (!entry) {
        entry = { column, row, kinds: new Set(), box: new Box3() };
        cells.set(key, entry);
      }
      entry.kinds.add(`${brick.partId}:${brick.color}`);
      entry.box.union(bounds);
    }
    const ranked = [...cells.values()]
      .map((entry) => ({
        ...entry,
        score: entry.kinds.size * (1 + (entry.box.max.y - model.min.y) / height),
      }))
      .sort((a, b) => b.score - a.score);
    const picked: typeof ranked = [];
    // Small models have few squares, so neighbours are let in once the far-apart ones run out.
    for (const spacing of [1, 0])
      for (const entry of ranked) {
        if (picked.length === count) break;
        if (
          picked.every(
            (other) =>
              Math.max(Math.abs(other.column - entry.column), Math.abs(other.row - entry.row)) >
              spacing,
          )
        )
          picked.push(entry);
      }
    return picked.map(({ box }) => {
      const bounds = box.clone();
      bounds.min.y = Math.max(bounds.min.y, bounds.max.y - cell * 1.2);
      const offset = bounds.getCenter(new Vector3()).sub(center).setY(0);
      // Look from the side the square sits on, so the rest of the model doesn't block it.
      const view = offset.lengthSq()
        ? VIEWS.reduce(
            (best, direction, index) =>
              direction.dot(offset) > VIEWS[best].dot(offset) ? index : best,
            0,
          )
        : 0;
      return { view, bounds };
    });
  }

  /** One piece on its own, seen like the model, for parts callouts and the parts list. */
  renderPart(partId: string, color: number, size: number, background: Rgb) {
    const brick: Brick = { id: 'part', partId, color, x: 0, y: 0, z: 0, rotation: 0 };
    const piece = this.createPiece(brick);
    const stage = new Group();
    stage.add(piece);
    this.placed.visible = false;
    this.fresh.visible = false;
    this.scene.add(stage);
    try {
      const box = new Box3().setFromObject(piece);
      this.frame(box.isEmpty() ? brickBounds(brick) : box, 0, 1);
      return this.capture(size, size, background);
    } finally {
      this.scene.remove(stage);
      this.placed.visible = true;
      this.fresh.visible = true;
    }
  }

  dispose() {
    for (const model of this.colored.values())
      model.traverse((object) => {
        if (object instanceof Mesh || object instanceof LineSegments)
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material])
            material.dispose();
      });
    for (const resource of this.owned) resource.dispose();
    this.renderer.forceContextLoss();
  }
}
