import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { EffectComposer, N8AO, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { DirectionalLight, HemisphereLight, Object3D } from 'three';
import { AMBIENT_OCCLUSION, createStudioEnvironment } from '@brick-workshop/render/cinematic-look';

const SKY = '#a9cdea';
/** Where the sun stands, as a direction toward it: high in the south-west, so faces shade. */
const SUN = [-0.55, 1, 0.4] as const;

/**
 * Daylight over the island: a sky-blue backdrop that the far shore fades into, a sun casting
 * shadows over the whole board, a sky and ground fill, softbox reflections on the plastic and a
 * little ambient occlusion in the joints. The sun stands still, so its shadow map is only drawn
 * again when the world changes.
 */
export function GameStage({ size }: { size: number }) {
  const { gl, scene, invalidate } = useThree();
  const rig = useMemo(() => {
    const sun = new DirectionalLight('#fff1dc', 2.6);
    const distance = size;
    sun.position.set(SUN[0] * distance, SUN[1] * distance, SUN[2] * distance);
    sun.castShadow = true;
    const camera = sun.shadow.camera;
    const reach = size * 0.75;
    camera.left = -reach;
    camera.right = reach;
    camera.top = reach;
    camera.bottom = -reach;
    camera.near = 1;
    camera.far = distance * 3;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    const target = new Object3D();
    sun.target = target;
    const fill = new HemisphereLight('#d6e9ff', '#6b5b47', 1.1);
    return { sun, target, fill };
  }, [size]);
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
    const environment = createStudioEnvironment(gl, 'studio');
    scene.environment = environment;
    scene.environmentIntensity = 0.35;
    return () => {
      if (scene.environment === environment) scene.environment = null;
      environment.dispose();
    };
  }, [gl, scene]);
  return (
    <>
      <color attach="background" args={[SKY]} />
      <fog attach="fog" args={[SKY, size * 0.45, size * 1.6]} />
      <primitive object={rig.sun} />
      <primitive object={rig.target} />
      <primitive object={rig.fill} />
      <EffectComposer multisampling={4}>
        <N8AO {...AMBIENT_OCCLUSION} quality="low" halfRes />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    </>
  );
}
