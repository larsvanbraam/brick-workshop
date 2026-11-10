import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import {
  Bloom,
  EffectComposer,
  N8AO,
  SMAA,
  ToneMapping,
  Vignette,
} from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import type { Box3 } from 'three';
import {
  AMBIENT_OCCLUSION,
  BLOOM,
  MOODS,
  VIGNETTE_OFFSET,
  createCinematicRig,
  createStudioEnvironment,
  fogRange,
  getCinematicDpr,
} from './cinematic-look';
import type { CinematicMood } from './cinematic-look';

export { MOODS };
export type { CinematicMood };

/**
 * A dark, fogged stage for screenshots: a warm key spot that pools light around the model, a cool
 * rim light behind it, studio softboxes for reflections, and ambient occlusion, bloom and a
 * vignette on top. Replaces the workshop lighting, board and grid while it is mounted.
 */
export function CinematicStage({
  mood,
  bounds,
  full = false,
}: {
  mood: CinematicMood;
  bounds: Box3 | null;
  /** Renders at the screen's full pixel ratio and AO resolution, for a saved screenshot. */
  full?: boolean;
}) {
  const settings = MOODS[mood];
  const { gl, scene, size, setDpr, invalidate } = useThree();
  const rig = useMemo(() => createCinematicRig(mood, bounds), [mood, bounds]);
  useEffect(() => () => rig.dispose(), [rig]);
  useEffect(() => {
    const ratio = window.devicePixelRatio || 1;
    setDpr(full ? Math.min(ratio, 2) : getCinematicDpr(size.width, size.height, ratio));
  }, [full, size.width, size.height, setDpr]);
  // The workshop renders at the screen's ratio again once the stage closes.
  useEffect(() => () => setDpr([1, 2]), [setDpr]);
  useEffect(() => {
    // The lights stand still, even on the turntable, which only moves the camera: the 4096²
    // shadow map is redrawn when the stage or the build changes rather than every frame.
    const shadows = gl.shadowMap;
    shadows.autoUpdate = false;
    shadows.needsUpdate = true;
    invalidate();
    return () => {
      shadows.autoUpdate = true;
    };
  }, [gl, rig, invalidate]);
  useEffect(() => {
    const environment = createStudioEnvironment(gl, mood);
    scene.environment = environment;
    scene.environmentIntensity = settings.environment;
    return () => {
      // The workshop's environment may already have taken over by the time this cleans up.
      if (scene.environment === environment) scene.environment = null;
      scene.environmentIntensity = 1;
      environment.dispose();
    };
  }, [gl, scene, mood, settings.environment]);
  return (
    <>
      <color attach="background" args={[settings.background]} />
      <fog attach="fog" args={[settings.background, ...fogRange(rig.radius)]} />
      <primitive object={rig.group} />
      <EffectComposer multisampling={0}>
        <N8AO {...AMBIENT_OCCLUSION} quality="high" halfRes={!full} />
        <Bloom mipmapBlur intensity={settings.bloom} {...BLOOM} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <Vignette offset={VIGNETTE_OFFSET} darkness={settings.vignette} />
        <SMAA />
      </EffectComposer>
    </>
  );
}
