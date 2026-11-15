import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, N8AO, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  Object3D,
  PointLight,
  Points,
  PointsMaterial,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { AMBIENT_OCCLUSION, createStudioEnvironment } from '@brick-workshop/render/cinematic-look';
import { random } from './world/noise.ts';
import { PLATE_HEIGHT } from '@brick-workshop/engine';
import { SHADOW_INTERVAL, requestShadows, takeShadowRequest } from './shadows.ts';
import { skyAt } from './sky.ts';
import type { DayClock } from './sky.ts';
import type { Glow } from './world/glows.ts';
import type { Volcano } from './world/terrain.ts';

/** The lights near the walker besides the sun's. */
export interface Glows {
  fire: Glow | null;
  crystal: Glow | null;
}

/** The sky dome's radius: inside the camera's far plane, round wherever the camera is. */
const DOME = 480;
const STAR_COUNT = 1400;

const SKY_SHADER = {
  vertexShader: /* glsl */ `
    varying vec3 vDirection;
    void main() {
      vDirection = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 zenith;
    uniform vec3 horizon;
    uniform vec3 sun;
    uniform vec3 moon;
    uniform vec3 sunColor;
    uniform float sunDisc;
    uniform float moonDisc;
    varying vec3 vDirection;
    void main() {
      vec3 direction = normalize(vDirection);
      float height = direction.y;
      // Horizon colour low down, zenith colour overhead; under the horizon stays horizon-dark.
      vec3 color = mix(horizon, zenith, smoothstep(0.0, 0.55, max(height, 0.0)));
      color = mix(color, horizon * 0.55, smoothstep(0.0, -0.25, height));
      // The sun: a bright disc in a soft glow that warms the sky round it.
      float toSun = max(dot(direction, sun), 0.0);
      color += sunColor * (pow(toSun, 600.0) * 3.0 + pow(toSun, 12.0) * 0.25) * sunDisc;
      color = mix(color, vec3(1.0, 0.98, 0.9) * 4.0, smoothstep(0.9993, 0.9996, toSun) * sunDisc);
      // The moon: a pale disc with a faint halo.
      float toMoon = max(dot(direction, moon), 0.0);
      color += vec3(0.6, 0.7, 0.9) * pow(toMoon, 300.0) * 0.4 * moonDisc;
      color = mix(color, vec3(0.92, 0.94, 1.0) * 1.6, smoothstep(0.99955, 0.9998, toMoon) * moonDisc);
      gl_FragColor = vec4(color, 1.0);
      #include <colorspace_fragment>
    }
  `,
};

/** Stars scattered over the upper sky, the same every night. */
function createStars() {
  const next = random(20261114);
  const positions = new Float32Array(STAR_COUNT * 3);
  const colors = new Float32Array(STAR_COUNT * 3);
  const tint = new Color();
  for (let index = 0; index < STAR_COUNT; index++) {
    // Uniform over the sphere, kept above a little below the horizon.
    const y = -0.1 + next() * 1.1;
    const around = next() * Math.PI * 2;
    const ring = Math.sqrt(1 - y * y);
    positions.set(
      [
        Math.cos(around) * ring * DOME * 0.95,
        y * DOME * 0.95,
        Math.sin(around) * ring * DOME * 0.95,
      ],
      index * 3,
    );
    // Mostly white, some faint and some a touch blue or warm.
    const brightness = 0.35 + next() ** 3 * 0.65;
    tint.setHSL(next() < 0.5 ? 0.6 : 0.1, 0.25 * next(), brightness);
    colors.set([tint.r, tint.g, tint.b], index * 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  const material = new PointsMaterial({
    size: 1.6,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    fog: false,
    opacity: 0,
  });
  return new Points(geometry, material);
}

/**
 * The world under a moving sky: a dome whose colours run from dawn through noon and dusk to
 * night, with the sun and moon on it and stars coming out after dark. One light casts shadows,
 * the sun by day and the moon by night, with a sky and ground fill, plastic reflections and a
 * little ambient occlusion in the joints. Shadows are redrawn as the light moves, a few times a
 * second rather than every frame.
 */
export function GameStage({
  size,
  view,
  shadowView,
  clock,
  volcano,
  glows,
}: {
  /** The scene's frame: positions are centred on a board this size. */
  size: number;
  /** How far round the walker the world is drawn, in studs: the fog closes in before it. */
  view: number;
  /** How far round the walker the world is loaded in full: the shadows cover that. */
  shadowView: number;
  clock: DayClock;
  volcano: Volcano | null;
  /** The campfire and the cave crystals nearest the walker, each lit by a light of its own. */
  glows: Glows;
}) {
  const { gl, scene, invalidate } = useThree();
  const rig = useMemo(() => {
    const key = new DirectionalLight('#fff1dc', 2.6);
    key.castShadow = true;
    const camera = key.shadow.camera;
    // The shadows cover the ground near the walker, where they show, and follow it; further out
    // the fog softens everything anyway. Every redraw draws all of it, so it is kept small.
    const reach = shadowView * 0.6;
    camera.left = -reach;
    camera.right = reach;
    camera.top = reach;
    camera.bottom = -reach;
    camera.near = 1;
    camera.far = shadowView * 4;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    const target = new Object3D();
    key.target = target;
    const fill = new HemisphereLight('#d6e9ff', '#6b5b47', 1.1);
    const material = new ShaderMaterial({
      ...SKY_SHADER,
      uniforms: {
        zenith: { value: new Color() },
        horizon: { value: new Color() },
        sun: { value: new Vector3() },
        moon: { value: new Vector3() },
        sunColor: { value: new Color() },
        sunDisc: { value: 1 },
        moonDisc: { value: 0 },
      },
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    const dome = new Mesh(new SphereGeometry(DOME, 48, 24), material);
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    dome.raycast = () => {};
    const stars = createStars();
    stars.renderOrder = -9;
    stars.frustumCulled = false;
    stars.raycast = () => {};
    const fog = new Fog('#bcd7ec', view * 0.4, view);
    return { key, target, fill, dome, stars, fog };
  }, [view, shadowView]);
  /**
   * A warm light just over the crater's lava, lighting the rim and the slopes round it. It stays
   * in the scene, dark where there is no volcano: adding or taking out a light changes every lit
   * material's shader, and three would compile them all again as the walker crosses a region.
   */
  const glow = useMemo(() => new PointLight('#ff6a24', 0, 26, 2), []);
  useEffect(() => {
    if (volcano)
      glow.position.set(
        volcano.x + 0.5 - size / 2,
        (volcano.lake * 3 + 4) * PLATE_HEIGHT,
        size / 2 - volcano.z - 0.5,
      );
    invalidate();
  }, [glow, volcano, size, invalidate]);

  useEffect(
    () => () => {
      rig.dome.geometry.dispose();
      (rig.dome.material as ShaderMaterial).dispose();
      rig.stars.geometry.dispose();
      (rig.stars.material as PointsMaterial).dispose();
      rig.key.dispose();
    },
    [rig],
  );
  useEffect(() => () => glow.dispose(), [glow]);
  /**
   * A flickering warm light over the nearest campfire, and a cold one in the nearest cave's
   * chamber, coloured by its crystals. Like the volcano's, they stay in the scene, dark when
   * there is nothing to light.
   */
  const lamps = useMemo(
    () => ({
      fire: new PointLight('#ff8a3c', 0, 16, 2),
      crystal: new PointLight('#7fd4ff', 0, 12, 2),
    }),
    [],
  );
  useEffect(() => {
    for (const kind of ['fire', 'crystal'] as const) {
      const spot = glows[kind];
      if (!spot) continue;
      lamps[kind].color.set(spot.color);
      lamps[kind].position.set(spot.x - size / 2, spot.y * PLATE_HEIGHT, size / 2 - spot.z);
    }
    invalidate();
  }, [lamps, glows, size, invalidate]);
  useEffect(
    () => () => {
      lamps.fire.dispose();
      lamps.crystal.dispose();
    },
    [lamps],
  );

  useEffect(() => {
    const previous = scene.fog;
    scene.fog = rig.fog;
    return () => {
      scene.fog = previous;
    };
  }, [scene, rig]);

  useEffect(() => {
    const shadows = gl.shadowMap;
    shadows.autoUpdate = false;
    shadows.needsUpdate = true;
    invalidate();
    return () => {
      shadows.autoUpdate = true;
    };
  }, [gl, rig, invalidate]);

  useEffect(() => {
    const texture = createStudioEnvironment(gl, 'studio');
    scene.environment = texture;
    return () => {
      if (scene.environment === texture) scene.environment = null;
      texture.dispose();
    };
  }, [gl, scene]);

  /** Where the shadow-casting light pointed, and where it was centred, when shadows were drawn. */
  const shadowed = useRef(new Vector3());
  const followed = useRef(new Vector3(Infinity, 0, Infinity));
  const lastShadows = useRef(0);
  // A new rig's light starts aimed at the origin: centre it on the walker again, wherever it is.
  useEffect(() => {
    followed.current.set(Infinity, 0, Infinity);
  }, [rig]);
  useFrame(({ camera }, delta) => {
    clock.advance(delta);
    const sky = skyAt(clock.time);
    const { key, target, fill, dome, stars, fog } = rig;
    // The light's shadows are centred on the walker in steps of a few studs, so they do not
    // shimmer as it walks and are redrawn only when it has moved on.
    const step = 16;
    const centreX = Math.round(camera.position.x / step) * step;
    const centreZ = Math.round(camera.position.z / step) * step;
    if (centreX !== followed.current.x || centreZ !== followed.current.z) {
      followed.current.set(centreX, 0, centreZ);
      target.position.set(centreX, 0, centreZ);
      target.updateMatrixWorld();
      requestShadows();
    }
    key.position
      .copy(sky.key.direction)
      .multiplyScalar(shadowView * 1.5)
      .add(followed.current);
    key.color.copy(sky.key.color);
    key.intensity = sky.key.intensity;
    fill.color.copy(sky.fill.sky);
    fill.groundColor.copy(sky.fill.ground);
    fill.intensity = sky.fill.intensity;
    const uniforms = (dome.material as ShaderMaterial).uniforms;
    uniforms.zenith.value.copy(sky.zenith);
    uniforms.horizon.value.copy(sky.horizon);
    uniforms.sun.value.copy(sky.sun);
    uniforms.moon.value.copy(sky.moon);
    uniforms.sunColor.value.copy(sky.key.color);
    uniforms.sunDisc.value = sky.sunDisc;
    uniforms.moonDisc.value = sky.moonDisc;
    (stars.material as PointsMaterial).opacity = sky.stars;
    stars.visible = sky.stars > 0.01;
    fog.color.copy(sky.horizon);
    scene.environmentIntensity = sky.environment;
    // The lava glows all day; it only shows once the sun is down.
    glow.intensity = volcano ? 8 + 60 * sky.stars : 0;
    // A campfire shows at dusk and flickers; crystals glow the same day and night underground.
    const flicker =
      0.85 + Math.sin(performance.now() / 90) * 0.08 + Math.sin(performance.now() / 37) * 0.07;
    lamps.fire.intensity = glows.fire ? (6 + 50 * sky.stars) * flicker : 0;
    lamps.crystal.intensity = glows.crystal ? 30 : 0;
    // The sky goes wherever the camera does, so it is never reached.
    dome.position.copy(camera.position);
    stars.position.copy(camera.position);
    // Shadows follow the light once it has turned about a quarter of a degree: in bigger steps
    // the long shadows of a low sun visibly jump.
    if (shadowed.current.angleTo(sky.key.direction) > 0.004) {
      shadowed.current.copy(sky.key.direction);
      requestShadows();
    }
    // Every request since the last redraw is served by one, at most four times a second.
    if (performance.now() - lastShadows.current > SHADOW_INTERVAL * 1000)
      if (takeShadowRequest()) {
        gl.shadowMap.needsUpdate = true;
        lastShadows.current = performance.now();
      }
  });

  return (
    <>
      <primitive object={rig.dome} />
      <primitive object={rig.stars} />
      <primitive object={rig.key} />
      <primitive object={lamps.fire} />
      <primitive object={lamps.crystal} />
      <primitive object={rig.target} />
      <primitive object={rig.fill} />
      <primitive object={glow} />
      <EffectComposer multisampling={4}>
        <N8AO {...AMBIENT_OCCLUSION} quality="low" halfRes />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    </>
  );
}
