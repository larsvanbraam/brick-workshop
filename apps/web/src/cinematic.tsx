import { useEffect, useMemo, useState } from 'react';
import { Environment, Lightformer } from '@react-three/drei';
import {
  Bloom,
  EffectComposer,
  N8AO,
  SMAA,
  ToneMapping,
  Vignette,
} from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { Box3, CanvasTexture, Object3D, SRGBColorSpace, Sphere, Vector3 } from 'three';

export type CinematicMood = 'studio' | 'golden' | 'night';

interface Mood {
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

/**
 * Directions relative to the default 3D view, which looks at the board from +x, -z: the key light
 * comes from the camera's front left and high, the rim light from behind the model on its right.
 */
const KEY_DIRECTION = new Vector3(1.1, 1.5, -0.35).normalize();
const RIM_DIRECTION = new Vector3(-1, 0.75, 0.8).normalize();

/**
 * A dark, fogged stage for screenshots: a warm key spot that pools light around the model, a cool
 * rim light behind it, studio softboxes for reflections, and ambient occlusion, bloom and a
 * vignette on top. Replaces the workshop lighting, board and grid while it is mounted.
 */
export function CinematicStage({ mood, bounds }: { mood: CinematicMood; bounds: Box3 | null }) {
  const settings = MOODS[mood];
  const { center, radius } = useMemo(() => {
    const sphere = (
      bounds ?? new Box3(new Vector3(-4, 0, -4), new Vector3(4, 4, 4))
    ).getBoundingSphere(new Sphere());
    return { center: sphere.center, radius: Math.max(sphere.radius, 3) };
  }, [bounds]);
  const [target] = useState(() => new Object3D());
  useEffect(() => {
    target.position.copy(center);
    target.updateMatrixWorld();
  }, [target, center]);
  const distance = radius * 4;
  const key = KEY_DIRECTION.clone().multiplyScalar(distance).add(center);
  const rim = RIM_DIRECTION.clone().multiplyScalar(distance).add(center);
  return (
    <>
      <color attach="background" args={[settings.background]} />
      <fog attach="fog" args={[settings.background, radius * 5, radius * 13]} />
      <Environment resolution={256} environmentIntensity={settings.environment}>
        <Lightformer
          form="rect"
          intensity={3}
          color="#ffffff"
          position={[0, 6, 0]}
          scale={[8, 8, 1]}
          target
        />
        <Lightformer
          form="rect"
          intensity={4}
          color={settings.key}
          position={[7, 3, -2]}
          scale={[3, 7, 1]}
          target
        />
        <Lightformer
          form="rect"
          intensity={5}
          color={settings.rim}
          position={[-7, 2, 6]}
          scale={[2, 8, 1]}
          target
        />
      </Environment>
      <hemisphereLight args={settings.fill} />
      <primitive object={target} />
      <spotLight
        position={key.toArray()}
        target={target}
        color={settings.key}
        intensity={settings.keyIntensity}
        decay={0}
        angle={Math.atan((radius * 1.7) / distance)}
        penumbra={0.8}
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-camera-near={distance - radius * 2}
        shadow-camera-far={distance + radius * 3}
        shadow-bias={-0.0001}
        shadow-normalBias={0.03}
      />
      <directionalLight
        position={rim.toArray()}
        target={target}
        color={settings.rim}
        intensity={settings.rimIntensity}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[center.x, -0.002, center.z]} receiveShadow>
        <circleGeometry args={[radius * 20, 96]} />
        <meshStandardMaterial
          color={settings.floor}
          roughness={0.55}
          metalness={0.1}
          envMapIntensity={0.3}
        />
      </mesh>
      <EffectComposer multisampling={0}>
        <N8AO aoRadius={1.4} distanceFalloff={1} intensity={2.4} quality="high" />
        <Bloom
          mipmapBlur
          intensity={settings.bloom}
          luminanceThreshold={0.85}
          luminanceSmoothing={0.2}
        />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <Vignette offset={0.25} darkness={settings.vignette} />
        <SMAA />
      </EffectComposer>
    </>
  );
}
