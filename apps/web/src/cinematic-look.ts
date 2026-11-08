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
  /** The painted backdrop of outdoor shots: sky from top to horizon, then water below it. */
  sky: { top: string; middle: string; horizon: string; water: string; clouds: string };
}

export const MOODS: Record<CinematicMood, Mood> = {
  studio: {
    label: 'Studio',
    background: '#15171c',
    pool: '#4a505c',
    key: '#fff3e2',
    keyIntensity: 2.5,
    rim: '#a8c8ff',
    rimIntensity: 1.6,
    fill: ['#8d9ab8', '#1b1d22', 0.3],
    environment: 0.4,
    bloom: 0.25,
    vignette: 0.55,
    sky: {
      top: '#1a3d6b',
      middle: '#4f80b6',
      horizon: '#b7c3cc',
      water: '#0c1a2a',
      clouds: '236, 232, 224',
    },
  },
  golden: {
    label: 'Golden hour',
    background: '#1a120d',
    pool: '#5a4232',
    key: '#ffc48a',
    keyIntensity: 2.7,
    rim: '#7f95ff',
    rimIntensity: 1.5,
    fill: ['#ffae7a', '#20140e', 0.3],
    environment: 0.3,
    bloom: 0.3,
    vignette: 0.65,
    sky: {
      top: '#131a38',
      middle: '#6a4466',
      horizon: '#f0a66c',
      water: '#1e1622',
      clouds: '255, 200, 160',
    },
  },
  night: {
    label: 'Night',
    background: '#060910',
    pool: '#1f2c44',
    key: '#c9dcff',
    keyIntensity: 2.1,
    rim: '#45d0ff',
    rimIntensity: 2.3,
    fill: ['#3b4f86', '#05070c', 0.22],
    environment: 0.28,
    bloom: 0.55,
    vignette: 0.75,
    sky: {
      top: '#02040a',
      middle: '#0a1630',
      horizon: '#2a3f66',
      water: '#03060c',
      clouds: '80, 98, 136',
    },
  },
};

/** Ambient occlusion settings, in studs: enough to darken the gaps between studs and bricks. */
export const AMBIENT_OCCLUSION = { aoRadius: 1.4, distanceFalloff: 1, intensity: 2.4 };
export const BLOOM = { luminanceThreshold: 1, luminanceSmoothing: 0.15 };
export const VIGNETTE_OFFSET = 0.25;

/**
 * Directions relative to the default 3D view, which looks at the board from +x, -z: the key light
 * comes from the camera's front left and high, the rim light from behind the model on its right.
 * The rim light stands steep: any lower and the flat tops of plates and studs mirror it straight
 * into a camera looking down at the model, glazing them white.
 * Turning `view` quarter turns keeps that arrangement for the manual's other sides.
 */
function lightDirection(base: Vector3, view: number) {
  return base
    .clone()
    .applyAxisAngle(new Vector3(0, 1, 0), (-view * Math.PI) / 2)
    .normalize();
}
const KEY_DIRECTION = new Vector3(1.1, 1.5, -0.35);
/** Outdoors the sun stands high over the camera's left shoulder, so the side in view is lit. */
const SUN_DIRECTION = new Vector3(0.1, 1.3, -1);

/**
 * Outdoor shots are daylight rather than a dark stage: the same mood colours, but a much brighter
 * sky fill and reflections, a softer rim and only a hint of vignette.
 */
export const DAYLIGHT = { key: 1.1, rim: 0.4, fill: 3.5, environment: 1.8, vignette: 0.35 };
const RIM_DIRECTION = new Vector3(-0.8, 2.2, 0.65);

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
 * model: an unlit pool that fades into the backdrop, with a shadow catcher on top. Outdoors there
 * is only the shadow, falling on whatever backdrop is painted behind the model.
 */
export function createCinematicRig(
  mood: CinematicMood,
  bounds: Box3 | null,
  view = 0,
  outdoor = false,
) {
  const settings = MOODS[mood];
  const { center, radius } = stageSphere(bounds);
  const group = new Group();
  const target = new Object3D();
  target.position.copy(center);
  const distance = radius * 4;

  const key = new SpotLight(settings.key, settings.keyIntensity * (outdoor ? DAYLIGHT.key : 1));
  key.position.copy(
    lightDirection(outdoor ? SUN_DIRECTION : KEY_DIRECTION, view)
      .multiplyScalar(distance)
      .add(center),
  );
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

  const rim = new DirectionalLight(
    settings.rim,
    settings.rimIntensity * (outdoor ? DAYLIGHT.rim : 1),
  );
  rim.position.copy(lightDirection(RIM_DIRECTION, view).multiplyScalar(distance).add(center));
  rim.target = target;

  const [sky, ground, intensity] = settings.fill;
  const fill = new HemisphereLight(sky, ground, intensity * (outdoor ? DAYLIGHT.fill : 1));

  const texture = poolTexture(settings);
  const plane = new PlaneGeometry(radius * 8, radius * 8);
  const poolMaterial = new MeshBasicMaterial({ map: texture });
  const shadowMaterial = new ShadowMaterial({ opacity: 0.6 });
  const pool = new Mesh(plane, poolMaterial);
  pool.visible = !outdoor;
  const shadow = new Mesh(plane, shadowMaterial);
  shadow.receiveShadow = true;
  for (const [mesh, lift] of [
    [pool, -0.004],
    [shadow, -0.002],
  ] as const) {
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(center.x, lift, center.z);
  }
  // Outdoors there is no floor past the model's own base, so its shadow mustn't fall beyond it
  // onto the painted water.
  if (outdoor && bounds && !bounds.isEmpty()) {
    const footprint = bounds.getSize(new Vector3());
    const middle = bounds.getCenter(new Vector3());
    shadow.scale.set(footprint.x / (radius * 8), footprint.z / (radius * 8), 1);
    shadow.position.set(middle.x, -0.002, middle.z);
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
  outdoor = false,
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
      new VignetteEffect({
        offset: VIGNETTE_OFFSET,
        darkness: settings.vignette * (outdoor ? DAYLIGHT.vignette : 1),
      }),
    ),
  );
  composer.addPass(new EffectPass(camera, new SMAAEffect()));
  composer.setSize(width, height, false);
  return composer;
}

/** A small seeded random source, so the same build always gets the same clouds and stars. */
function random(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

/**
 * A sky for outdoor shots: a gradient down to a glowing horizon at `horizon` pixels from the top,
 * soft banks of cloud above it and plain ground colour below, which the fogged floor runs into.
 */
export function paintSky(mood: CinematicMood, width: number, height: number, horizon: number) {
  const { sky } = MOODS[mood];
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  const line = Math.max(horizon, height * 0.05);
  const gradient = context.createLinearGradient(0, 0, 0, line);
  gradient.addColorStop(0, sky.top);
  gradient.addColorStop(0.55, sky.middle);
  gradient.addColorStop(1, sky.horizon);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, line);
  // Still water below the horizon: it mirrors the pale horizon and deepens toward the viewer,
  // with faint ripples catching the light.
  const water = context.createLinearGradient(0, line, 0, height);
  water.addColorStop(0, sky.horizon);
  water.addColorStop(0.08, sky.middle);
  water.addColorStop(0.5, sky.water);
  water.addColorStop(1, sky.water);
  context.fillStyle = water;
  context.fillRect(0, line, width, height - line);

  const next = random(width * 7 + height);
  for (let ripple = 0; ripple < (height - line) / 3; ripple++) {
    const y = line + Math.pow(next(), 1.6) * (height - line);
    const fade = 1 - (y - line) / (height - line);
    context.fillStyle = `rgba(${sky.clouds}, ${0.1 * fade})`;
    context.fillRect(next() * width, y, width * (0.02 + next() * 0.12), 1 + fade);
  }
  if (mood === 'night')
    for (let star = 0; star < (width * line) / 2500; star++) {
      context.fillStyle = `rgba(255, 255, 255, ${0.25 + next() * 0.6})`;
      const size = next() < 0.92 ? 1 : 2;
      context.fillRect(next() * width, next() * line * 0.85, size, size);
    }
  // Each bank is a cluster of soft, flattened puffs, thinning out toward the top of the sky.
  context.save();
  context.scale(1, 0.32);
  for (let bank = 0; bank < 16; bank++) {
    const depth = 0.25 + next() * 0.7;
    const x = next() * width;
    const y = (line * depth) / 0.32;
    const spread = width * (0.06 + next() * 0.14);
    for (let puff = 0; puff < 14; puff++) {
      const px = x + (next() - 0.5) * spread * 2;
      const py = y + (next() - 0.5) * spread * 0.5;
      const size = spread * (0.25 + next() * 0.45);
      const glow = context.createRadialGradient(px, py, 0, px, py, size);
      const alpha = (mood === 'night' ? 0.15 : 0.32) * depth;
      glow.addColorStop(0, `rgba(${sky.clouds}, ${alpha})`);
      glow.addColorStop(1, `rgba(${sky.clouds}, 0)`);
      context.fillStyle = glow;
      context.fillRect(px - size, py - size, size * 2, size * 2);
    }
  }
  context.restore();
  // A glow along the horizon, fading up into the sky.
  const haze = context.createLinearGradient(0, line - height * 0.12, 0, line);
  haze.addColorStop(0, `rgba(${sky.clouds}, 0)`);
  haze.addColorStop(1, `rgba(${sky.clouds}, 0.25)`);
  context.fillStyle = haze;
  context.fillRect(0, line - height * 0.12, width, height * 0.12);
  return canvas;
}
