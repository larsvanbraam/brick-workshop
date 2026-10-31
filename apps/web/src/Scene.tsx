import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Edges, Environment, Grid, OrbitControls } from '@react-three/drei';
import { Group, LineSegments, Mesh, PerspectiveCamera, Vector3 } from 'three';
import { createFallbackGeometry } from './fallback-geometry';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { coloredLDrawModel } from './ldraw';
import { canBatchLDrawModel, createLDrawBatch, disposeLDrawBatch } from './ldraw-batches';
import type { ThreeEvent } from '@react-three/fiber';
import { colorMaterialProperties } from './ldraw-materials';
import { getLDrawModelOffset, getSceneFrame, getSceneHeight } from './scene-frame';
import {
  BUILD_AREA,
  COLORS,
  PLATE_HEIGHT,
  footprint,
  getConnectionSites,
  getBuildArea,
  getLDrawTransform,
} from '@lego-builder/brick-engine';
import type { Assembly, Brick } from '@lego-builder/brick-engine';

interface SceneProps {
  assembly: Assembly;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  ghost: Brick | null;
  ghostValid: boolean;
  layer: number;
  explode: boolean;
  view: 'perspective' | 'top' | 'front';
  cameraRevision: number;
  models: Record<string, Group>;
  onReady: () => void;
}

function SceneReady({ onReady }: { onReady: () => void }) {
  const frame = useRef<number | undefined>(undefined);
  useFrame(() => {
    if (frame.current === undefined) frame.current = requestAnimationFrame(onReady);
  });
  useEffect(
    () => () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
    },
    [],
  );
  return null;
}

export function WorkshopEnvironment() {
  const [room] = useState(() => new RoomEnvironment());
  useEffect(() => () => room.dispose(), [room]);
  return (
    <Environment resolution={128}>
      <primitive object={room} dispose={null} />
    </Environment>
  );
}

function CameraRig({
  view,
  revision,
  height,
  buildArea,
}: {
  view: SceneProps['view'];
  revision: number;
  height: number;
  buildArea: number;
}) {
  const { camera, controls, size, invalidate } = useThree();
  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return;
    const frame = getSceneFrame(height, view, size.width / size.height, camera.fov, buildArea);
    camera.position.fromArray(frame.position);
    camera.lookAt(...frame.target);
    const orbit = controls as unknown as { target: Vector3; update(): void } | null;
    if (orbit) {
      orbit.target.fromArray(frame.target);
      orbit.update();
    }
    camera.updateProjectionMatrix();
    invalidate();
  }, [view, revision, height, buildArea, size.width, size.height, camera, controls, invalidate]);
  return null;
}

export function LDrawMesh({
  model,
  color,
  rotation,
}: {
  model: Group;
  color: number;
  rotation: number;
}) {
  const [instance] = useState(() => coloredLDrawModel(model, color));
  useEffect(
    () => () => {
      instance.traverse((object) => {
        if (object instanceof Mesh || object instanceof LineSegments) {
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material])
            material.dispose();
        }
      });
    },
    [instance],
  );
  return (
    <group rotation={[0, (rotation * Math.PI) / 180, 0]} scale={[0.05, -0.05, 0.05]} dispose={null}>
      <primitive object={instance} />
    </group>
  );
}

function FallbackGeometry({ brick }: { brick: Brick }) {
  const [geometry] = useState(() => createFallbackGeometry(brick));
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <primitive object={geometry} attach="geometry" />;
}

const BrickMesh = memo(function BrickMesh({
  brick,
  buildArea = BUILD_AREA,
  selected,
  onSelect,
  opacity = 1,
  overrideColor,
  explode = false,
  model,
}: {
  brick: Brick;
  buildArea?: number;
  selected?: boolean;
  onSelect?: (id: string) => void;
  opacity?: number;
  overrideColor?: string;
  explode?: boolean;
  model?: Group;
}) {
  const size = footprint(brick);
  const definition = COLORS.find((entry) => entry.id === brick.color)!;
  const material = colorMaterialProperties(definition);
  const color = overrideColor ?? definition.hex;
  const actualOpacity = overrideColor ? opacity : opacity * material.opacity;
  const elevation = brick.y * PLATE_HEIGHT + (explode ? brick.y * 0.18 : 0);
  const bodyHeight = size.height * PLATE_HEIGHT;
  return (
    <group
      position={[
        brick.x + size.width / 2 - buildArea / 2,
        elevation,
        brick.z + size.depth / 2 - buildArea / 2,
      ]}
      onClick={
        onSelect
          ? (event) => {
              event.stopPropagation();
              onSelect(brick.id);
            }
          : undefined
      }
    >
      {model ? (
        <>
          <group position={getLDrawModelOffset(brick)}>
            <LDrawMesh
              key={`${brick.partId}:${brick.color}`}
              model={model}
              color={brick.color}
              rotation={getLDrawTransform(brick).rotation}
            />
          </group>
          {selected && (
            <mesh position={[0, bodyHeight / 2, 0]}>
              <boxGeometry args={[size.width, bodyHeight, size.depth]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              <Edges color="#156dff" linewidth={2} />
            </mesh>
          )}
        </>
      ) : (
        <>
          <mesh position={[0, bodyHeight / 2, 0]} castShadow receiveShadow>
            <FallbackGeometry key={`${brick.partId}:${brick.rotation}`} brick={brick} />
            <meshStandardMaterial
              {...material}
              color={color}
              transparent={actualOpacity < 1}
              opacity={actualOpacity}
              depthWrite={actualOpacity === 1}
            />
            {selected && <Edges color="#156dff" linewidth={2} />}
          </mesh>
          {getConnectionSites(brick, 'top').map((site) => (
            <mesh
              key={`${site.x}:${site.z}`}
              position={[
                site.x - brick.x - size.width / 2,
                bodyHeight + 0.07,
                site.z - brick.z - size.depth / 2,
              ]}
              castShadow
              receiveShadow
            >
              <cylinderGeometry args={[0.3, 0.3, 0.17, 24]} />
              <meshStandardMaterial
                {...material}
                color={color}
                transparent={actualOpacity < 1}
                opacity={actualOpacity}
                depthWrite={actualOpacity === 1}
              />
            </mesh>
          ))}
        </>
      )}
    </group>
  );
});

const NativeBatch = memo(function NativeBatch({
  bricks,
  model,
  buildArea,
  explode,
  onSelect,
}: {
  bricks: readonly Brick[];
  model: Group;
  buildArea: number;
  explode: boolean;
  onSelect: SceneProps['onSelect'];
}) {
  const batch = useMemo(
    () => createLDrawBatch(bricks, coloredLDrawModel(model, bricks[0].color), buildArea, explode),
    [bricks, model, buildArea, explode],
  );
  useEffect(() => () => disposeLDrawBatch(batch), [batch]);
  return (
    <primitive
      object={batch}
      dispose={null}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        const id =
          event.instanceId === undefined
            ? undefined
            : event.object.userData.brickIds?.[event.instanceId];
        if (typeof id === 'string') {
          event.stopPropagation();
          onSelect(id);
        }
      }}
    />
  );
});

export const Scene = memo(function Scene(props: SceneProps) {
  const buildArea = getBuildArea(props.assembly);
  const height = useMemo(
    () => getSceneHeight(props.assembly, props.explode),
    [props.assembly, props.explode],
  );
  const eligible = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(props.models).map(([id, model]) => [id, canBatchLDrawModel(model)]),
      ),
    [props.models],
  );
  const displays = useMemo(() => {
    const batches = new Map<string, Brick[]>();
    const separate: Brick[] = [];
    for (const brick of props.assembly.bricks) {
      if (brick.y >= props.layer) continue;
      if (
        !eligible[brick.partId] ||
        COLORS.find((color) => color.id === brick.color)?.alpha !== 255
      ) {
        separate.push(brick);
        continue;
      }
      const key = `${brick.partId}:${brick.color}`;
      const group = batches.get(key);
      if (group) group.push(brick);
      else batches.set(key, [brick]);
    }
    return { batches: [...batches.entries()], separate };
  }, [props.assembly, props.layer, eligible]);
  const selected = props.assembly.bricks.find(
    (brick) => brick.id === props.selectedId && brick.y < props.layer,
  );
  const selectedSize = selected && footprint(selected);
  return (
    <Canvas
      shadows
      frameloop="demand"
      camera={{ position: [21, 19, 24], fov: 38, near: 0.1, far: 500 }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      dpr={[1, 2]}
      onPointerMissed={() => props.onSelect(null)}
      aria-label="Interactive 3D brick model"
    >
      <color attach="background" args={['#eef0ee']} />
      <WorkshopEnvironment />
      <ambientLight intensity={1.1} />
      <hemisphereLight args={['#ffffff', '#a0ad9e', 1.2]} />
      <directionalLight
        position={[-8, 20, 12]}
        intensity={2.8}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-buildArea / 2 - 6}
        shadow-camera-right={buildArea / 2 + 6}
        shadow-camera-top={buildArea / 2 + 6}
        shadow-camera-bottom={-buildArea / 2 - 6}
        shadow-normalBias={0.04}
      />
      <directionalLight position={[12, 8, -8]} intensity={0.7} />
      <mesh position={[0, -0.16, 0]} receiveShadow>
        <boxGeometry args={[buildArea + 0.35, 0.3, buildArea + 0.35]} />
        <meshStandardMaterial color="#b6bfb6" roughness={0.8} />
      </mesh>
      <Grid
        position={[0, 0.003, 0]}
        args={[buildArea, buildArea]}
        cellSize={1}
        cellThickness={0.65}
        cellColor="#8f9d92"
        sectionSize={4}
        sectionThickness={1}
        sectionColor="#6f8274"
        fadeDistance={buildArea * 4.5}
        infiniteGrid={false}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.32, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color="#eef0ee" />
      </mesh>
      {displays.batches.map(([key, bricks]) => (
        <NativeBatch
          key={key}
          bricks={bricks}
          model={props.models[bricks[0].partId]}
          buildArea={buildArea}
          explode={props.explode}
          onSelect={props.onSelect}
        />
      ))}
      {displays.separate.map((brick) => (
        <BrickMesh
          key={brick.id}
          brick={brick}
          buildArea={buildArea}
          selected={props.selectedId === brick.id}
          onSelect={props.onSelect}
          explode={props.explode}
          model={props.models[brick.partId]}
        />
      ))}
      {selected &&
        selectedSize &&
        eligible[selected.partId] &&
        COLORS.find((color) => color.id === selected.color)?.alpha === 255 && (
          <mesh
            position={[
              selected.x + selectedSize.width / 2 - buildArea / 2,
              (selected.y + selectedSize.height / 2) * PLATE_HEIGHT +
                (props.explode ? selected.y * 0.18 : 0),
              selected.z + selectedSize.depth / 2 - buildArea / 2,
            ]}
          >
            <boxGeometry
              args={[selectedSize.width, selectedSize.height * PLATE_HEIGHT, selectedSize.depth]}
            />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            <Edges color="#156dff" linewidth={2} />
          </mesh>
        )}
      {props.ghost && (
        <BrickMesh
          brick={props.ghost}
          buildArea={buildArea}
          opacity={0.45}
          overrideColor={props.ghostValid ? '#228b65' : '#e14d4d'}
        />
      )}
      <OrbitControls
        makeDefault
        target={[0, height / 2, 0]}
        minDistance={8}
        maxDistance={500}
        maxPolarAngle={Math.PI / 2 - 0.02}
        enableDamping
      />
      <CameraRig
        view={props.view}
        revision={props.cameraRevision}
        height={height}
        buildArea={buildArea}
      />
      <SceneReady onReady={props.onReady} />
    </Canvas>
  );
});
