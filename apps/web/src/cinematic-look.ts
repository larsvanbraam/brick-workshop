import {
  Box3,
  CanvasTexture,
  Color,
  DirectionalLight,
  Group,
  HalfFloatType,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShadowMaterial,
  SpotLight,
  SRGBColorSpace,
  Sphere,
  Vector3,
} from 'three';
import type { Camera, WebGLRenderer } from 'three';
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

export type CinematicMood = 'studio' | 'golden' | 'night';

export interface Mood {
  label: string;
  background: string;
  /** The pool of light the key spot leaves on the floor. */
  pool: string;
  key: string;
  keyIntensity: number;
  rim: string;
  rimIntensity: number;
  /** Sky and ground tints of the faint fill that keeps shadows from crushing to black. */
  fill: [string, string, number];
  environment: number;
  bloom: number;
  vignette: number;
}

export const MOODS: Record<CinematicMood, Mood> = {
  studio: {
    label: 'Studio',
    background: '#15171c',
    pool: '#4a505c',
    key: '#fff3e2',
    keyIntensity: 3.4,
    rim: '#a8c8ff',
    rimIntensity: 2.4,
    fill: ['#8d9ab8', '#1b1d22', 0.35],
    environment: 0.55,
    bloom: 0.25,
    vignette: 0.55,
  },
  golden: {
    label: 'Golden hour',
    background: '#1a120d',
    pool: '#5a4232',
    key: '#ffc48a',
    keyIntensity: 3.6,
    rim: '#7f95ff',
    rimIntensity: 2.2,
    fill: ['#ffae7a', '#20140e', 0.3],
    environment: 0.4,
    bloom: 0.4,
    vignette: 0.65,
  },
  night: {
    label: 'Night',
    background: '#060910',
    pool: '#1f2c44',
    key: '#c9dcff',
    keyIntensity: 2.6,
    rim: '#45d0ff',
    rimIntensity: 3.2,
    fill: ['#3b4f86', '#05070c', 0.22],
    environment: 0.28,
    bloom: 0.55,
    vignette: 0.75,
  },
};

/** Ambient occlusion settings, in studs: enough to darken the gaps between studs and bricks. */
export const AMBIENT_OCCLUSION = { aoRadius: 1.4, distanceFalloff: 1, intensity: 2.4 };
export const BLOOM = { luminanceThreshold: 0.85, luminanceSmoothing: 0.2 };
export const VIGNETTE_OFFSET = 0.25;

/**
 * Directions relative to the default 3D view, which looks at the board from +x, -z: the key light
 * comes from the camera's front left and high, the rim light from behind the model on its right.
 * Turning `view` quarter turns keeps that arrangement for the manual's other sides.
 */
function lightDirection(base: Vector3, view: number) {
  return base
    .clone()
    .applyAxisAngle(new Vector3(0, 1, 0), (-view * Math.PI) / 2)
    .normalize();
}
const KEY_DIRECTION = new Vector3(1.1, 1.5, -0.35);
const RIM_DIRECTION = new Vector3(-1, 0.75, 0.8);

export function stageSphere(bounds: Box3 | null) {
  const sphere = (
    bounds && !bounds.isEmpty() ? bounds : new Box3(new Vector3(-4, 0, -4), new Vector3(4, 4, 4))
  ).getBoundingSphere(new Sphere());
  sphere.radius = Math.max(sphere.radius, 3);
  return sphere;
}

/** How far fog starts and ends, so the floor melts into the backdrop past the light pool. */
export function fogRange(radius: number): [number, number] {
  return [radius * 5, radius * 13];
}

function poolTexture({ pool, background }: Mood) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(256, 256, 0, 256, 256, 256);
  gradient.addColorStop(0, pool);
  gradient.addColorStop(0.35, pool);
  gradient.addColorStop(1, background);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 512, 512);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * The stage's lights and floor: a key spot that casts the shadow, a rim light behind the model
 * and a faint fill. The floor is painted rather than lit, so the rim light only catches the
 * model: an unlit pool that fades into the backdrop, with a shadow catcher on top.
 */
export function createCinematicRig(mood: CinematicMood, bounds: Box3 | null, view = 0) {
  const settings = MOODS[mood];
  const { center, radius } = stageSphere(bounds);
  const group = new Group();
  const target = new Object3D();
  target.position.copy(center);
  const distance = radius * 4;

  const key = new SpotLight(settings.key, settings.keyIntensity);
  key.position.copy(lightDirection(KEY_DIRECTION, view).multiplyScalar(distance).add(center));
  key.target = target;
  key.decay = 0;
  key.angle = Math.atan((radius * 1.7) / distance);
  key.penumbra = 0.8;
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.camera.near = distance - radius * 2;
  key.shadow.camera.far = distance + radius * 3;
  key.shadow.bias = -0.0001;
  key.shadow.normalBias = 0.03;

  const rim = new DirectionalLight(settings.rim, settings.rimIntensity);
  rim.position.copy(lightDirection(RIM_DIRECTION, view).multiplyScalar(distance).add(center));
  rim.target = target;

  const [sky, ground, intensity] = settings.fill;
  const fill = new HemisphereLight(sky, ground, intensity);

  const texture = poolTexture(settings);
  const plane = new PlaneGeometry(radius * 8, radius * 8);
  const poolMaterial = new MeshBasicMaterial({ map: texture });
  const shadowMaterial = new ShadowMaterial({ opacity: 0.6 });
  const pool = new Mesh(plane, poolMaterial);
  const shadow = new Mesh(plane, shadowMaterial);
  shadow.receiveShadow = true;
  for (const [mesh, lift] of [
    [pool, -0.004],
    [shadow, -0.002],
  ] as const) {
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(center.x, lift, center.z);
  }

  group.add(target, key, rim, fill, pool, shadow);
  return {
    group,
    center,
    radius,
    dispose() {
      key.dispose();
      rim.dispose();
      fill.dispose();
      texture.dispose();
      plane.dispose();
      poolMaterial.dispose();
      shadowMaterial.dispose();
    },
  };
}

/**
 * Studio softboxes for reflections: one large overhead and two strips tinted like the key and
 * rim lights, prefiltered into an environment map.
 */
export function createStudioEnvironment(renderer: WebGLRenderer, mood: CinematicMood) {
  const settings = MOODS[mood];
  const room = new Scene();
  const geometry = new PlaneGeometry(1, 1);
  const materials: MeshBasicMaterial[] = [];
  const boxes: [string, number, [number, number, number], [number, number]][] = [
    ['#ffffff', 3, [0, 6, 0], [8, 8]],
    [settings.key, 4, [7, 3, -2], [3, 7]],
    [settings.rim, 5, [-7, 2, 6], [2, 8]],
  ];
  for (const [color, intensity, position, [width, height]] of boxes) {
    const material = new MeshBasicMaterial({
      color: new Color(color).multiplyScalar(intensity),
      side: 2,
      toneMapped: false,
    });
    materials.push(material);
    const box = new Mesh(geometry, material);
    box.position.set(...position);
    box.scale.set(width, height, 1);
    box.lookAt(0, 0, 0);
    room.add(box);
  }
  const pmrem = new PMREMGenerator(renderer);
  const texture = pmrem.fromScene(room, 0.04).texture;
  pmrem.dispose();
  geometry.dispose();
  for (const material of materials) material.dispose();
  return texture;
}

/**
 * The post-processing chain for renderers outside React: ambient occlusion, bloom, filmic tone
 * mapping, a vignette and anti-aliasing, matching the workshop's cinematic view.
 */
export function createCinematicComposer(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  mood: CinematicMood,
  width: number,
  height: number,
) {
  const settings = MOODS[mood];
  const composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType });
  composer.addPass(new RenderPass(scene, camera));
  const occlusion = new N8AOPostPass(scene, camera, width, height);
  Object.assign(occlusion.configuration, AMBIENT_OCCLUSION);
  occlusion.setQualityMode('High');
  composer.addPass(occlusion);
  composer.addPass(
    new EffectPass(
      camera,
      new BloomEffect({ mipmapBlur: true, intensity: settings.bloom, ...BLOOM }),
      new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }),
      new VignetteEffect({ offset: VIGNETTE_OFFSET, darkness: settings.vignette }),
    ),
  );
  composer.addPass(new EffectPass(camera, new SMAAEffect()));
  composer.setSize(width, height, false);
  return composer;
}
