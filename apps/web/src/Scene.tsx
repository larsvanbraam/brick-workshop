import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { CameraControls, CameraControlsImpl, Edges, Environment, Grid } from '@react-three/drei';
import { Box3, Group, Line, LineSegments, Matrix4, Mesh, PerspectiveCamera, Vector3 } from 'three';
import type { Object3D } from 'three';
import { createFallbackGeometry } from './fallback-geometry';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { coloredLDrawModel } from './ldraw';
import { canBatchLDrawModel, createLDrawBatch, disposeLDrawBatch } from './ldraw-batches';
import type { ThreeEvent } from '@react-three/fiber';
import { colorMaterialProperties, displayHex } from './ldraw-materials';
import {
  getCinematicFrame,
  getLDrawModelOffset,
  getSceneFrame,
  getSceneHeight,
} from './scene-frame';
import { CinematicStage } from './cinematic';
import type { CinematicMood } from './cinematic';
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

/** Where the pointer rests on the board, in stud and plate units. */
export interface PointerTarget {
  face: 'ground' | 'top' | 'bottom' | 'x-' | 'x+' | 'z-' | 'z+';
  brick?: Brick;
  x: number;
  z: number;
}
export type SceneMode = 'select' | 'place' | 'erase';

interface SceneProps {
  assembly: Assembly;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  mode?: SceneMode;
  highlightId?: string | null;
  onHover?: (target: PointerTarget | null) => void;
  onActivate?: (target: PointerTarget, modifiers: { alt: boolean; shift: boolean }) => void;
  /** Two-finger scrolling orbits instead of zooming. */
  trackpad?: boolean;
  onPointerDevice?: (device: PointerDevice) => void;
  ghost: Brick | null;
  ghostValid: boolean;
  layer: number;
  explode: boolean;
  view: 'perspective' | 'top' | 'front';
  cameraRevision: number;
  models: Record<string, Group>;
  onReady: () => void;
  /** Swaps the workshop for a dark, dramatically lit stage meant for screenshots. */
  cinematic?: { mood: CinematicMood; turntable: boolean } | null;
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

const { ACTION } = CameraControlsImpl;

function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

export type PointerDevice = 'mouse' | 'trackpad';

/**
 * Infers the scrolling device from one wheel event, or null when it cannot tell. Only trackpads
 * (and touch mice) scroll sideways without Shift; wheels scroll by line in Firefox and by
 * 120-unit notches in the legacy wheelDelta elsewhere, where trackpads report three times their
 * pixel delta.
 */
function scrollDevice(event: WheelEvent): PointerDevice | null {
  if (event.deltaMode !== 0) return 'mouse';
  if (event.deltaX !== 0 && !event.shiftKey) return 'trackpad';
  const legacy = (event as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
  if (legacy && legacy % 120 === 0 && legacy !== -3 * event.deltaY) return 'mouse';
  return null;
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
/**
 * Pinch zoom relative to finger travel. camera-controls scales wheel deltas down tenfold on
 * macOS and thirtyfold elsewhere, so the factor restores roughly 1.5x the pinch distance.
 */
const PINCH_SPEED = IS_MAC ? 6 : 18;

/**
 * Camera navigation: drag to orbit, right/middle-drag or Space-drag to pan, wheel and pinch zoom
 * toward the cursor, trackpad two-finger scroll orbits (Shift pans), F frames the model and views
 * animate into place. The camera only moves on its own when the view or board changes.
 */
function CameraRig({
  view,
  revision,
  height,
  buildArea,
  bounds,
  controls,
  trackpad,
  onDevice,
  cinematic,
  turntable,
}: {
  controls: RefObject<CameraControls | null>;
  cinematic: boolean;
  turntable: boolean;
  trackpad: boolean;
  onDevice?: (device: PointerDevice) => void;
  view: SceneProps['view'];
  revision: number;
  height: number;
  buildArea: number;
  bounds: Box3 | null;
}) {
  const { camera, size, gl, invalidate } = useThree();
  const first = useRef(true);
  const latest = useRef({ height, aspect: size.width / size.height, bounds, trackpad, onDevice });
  useEffect(() => {
    latest.current = { height, aspect: size.width / size.height, bounds, trackpad, onDevice };
  });
  useEffect(() => {
    const rig = controls.current;
    if (!rig || !(camera instanceof PerspectiveCamera)) return;
    const { height, aspect } = latest.current;
    const frame = getSceneFrame(height, view, aspect, camera.fov, buildArea);
    void rig.setLookAt(...frame.position, ...frame.target, !first.current);
    first.current = false;
  }, [view, revision, buildArea, camera, controls]);
  useEffect(() => {
    // Refits when the stage opens and once the viewport has grown to fill the window.
    const rig = controls.current;
    const { bounds } = latest.current;
    if (!cinematic || !rig || !bounds || !(camera instanceof PerspectiveCamera)) return;
    const frame = getCinematicFrame(bounds, size.width / size.height, camera.fov);
    void rig.setLookAt(...frame.position, ...frame.target, true);
  }, [cinematic, size.width, size.height, camera, controls]);
  useEffect(() => {
    if (turntable) invalidate();
  }, [turntable, invalidate]);
  useFrame((_, delta) => {
    if (!turntable) return;
    void controls.current?.rotate(delta * 0.15, 0, false);
    invalidate();
  });
  useEffect(() => {
    // The pivot stays over the board, so the build cannot drift out of reach.
    const margin = buildArea * 0.25;
    const rig = controls.current;
    rig?.setBoundary(
      new Box3(
        new Vector3(-buildArea / 2 - margin, 0, -buildArea / 2 - margin),
        new Vector3(buildArea / 2 + margin, Math.max(height, 8) + margin, buildArea / 2 + margin),
      ),
    );
  }, [buildArea, height, controls]);
  useEffect(() => {
    const element = gl.domElement;
    const pan = (enabled: boolean) => {
      const rig = controls.current;
      if (!rig) return;
      rig.mouseButtons.left = enabled ? ACTION.TRUCK : ACTION.ROTATE;
      element.style.cursor = enabled ? 'grab' : '';
    };
    const keydown = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.code === 'Space') {
        event.preventDefault();
        pan(true);
      } else if (event.key.toLowerCase() === 'f' && !event.repeat) {
        const { bounds } = latest.current;
        if (bounds)
          void controls.current?.fitToBox(bounds, true, {
            paddingTop: 1,
            paddingBottom: 1,
            paddingLeft: 1,
            paddingRight: 1,
          });
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.code === 'Space') pan(false);
    };
    const blur = () => pan(false);
    // Pinches are replayed as plain wheel steps: camera-controls would otherwise treat them as a
    // slow lens zoom, while a dolly toward the cursor matches the mouse wheel.
    const replayed = new WeakSet<Event>();
    const zoom = (deltaY: number, clientX: number, clientY: number) => {
      const replay = new WheelEvent('wheel', {
        deltaY: deltaY * PINCH_SPEED,
        clientX,
        clientY,
        bubbles: true,
        cancelable: true,
      });
      replayed.add(replay);
      element.dispatchEvent(replay);
    };
    // Runs on the canvas, before camera-controls' handler on its container.
    const wheel = (event: WheelEvent) => {
      const rig = controls.current;
      if (!rig || replayed.has(event)) return;
      if (event.ctrlKey) {
        // macOS and Windows precision touchpads report a pinch as a Ctrl+wheel.
        event.preventDefault();
        event.stopPropagation();
        zoom(event.deltaY * (event.deltaMode === 1 ? 33 : 1), event.clientX, event.clientY);
        return;
      }
      const device = scrollDevice(event);
      if (device) latest.current.onDevice?.(device);
      if (!(latest.current.trackpad || device === 'trackpad') || device === 'mouse') return;
      event.preventDefault();
      event.stopPropagation();
      // Two fingers move the model like a drag would: orbit, or pan with Shift or Space.
      const unit = (2 * Math.PI) / element.clientHeight;
      if (event.shiftKey || rig.mouseButtons.left === ACTION.TRUCK) {
        const scale = (rig.distance * 1.4) / element.clientHeight;
        void rig.truck(event.deltaX * scale, event.deltaY * scale, false);
      } else void rig.rotate(event.deltaX * unit * 0.9, event.deltaY * unit * 0.9, false);
      invalidate();
    };
    // Safari reports pinches as gesture events with a running scale instead.
    let scale = 1;
    const gesturestart = (event: Event) => {
      event.preventDefault();
      scale = 1;
      latest.current.onDevice?.('trackpad');
    };
    const gesturechange = (event: Event) => {
      event.preventDefault();
      const gesture = event as Event & { scale: number; clientX: number; clientY: number };
      zoom(-100 * Math.log(gesture.scale / scale), gesture.clientX, gesture.clientY);
      scale = gesture.scale;
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    element.addEventListener('wheel', wheel, { passive: false });
    element.addEventListener('gesturestart', gesturestart);
    element.addEventListener('gesturechange', gesturechange);
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
      element.removeEventListener('wheel', wheel);
      element.removeEventListener('gesturestart', gesturestart);
      element.removeEventListener('gesturechange', gesturechange);
    };
  }, [gl, controls, invalidate]);
  return (
    <CameraControls
      ref={controls}
      makeDefault
      minDistance={2}
      maxDistance={buildArea * 6}
      maxPolarAngle={Math.PI / 2 - 0.03}
      smoothTime={0.18}
      draggingSmoothTime={0.06}
      dollyToCursor
      // Lower zooms gentler per wheel step; 1 is the library default. Pinch speed is PINCH_SPEED.
      dollySpeed={0.5}
      azimuthRotateSpeed={0.9}
      polarRotateSpeed={0.9}
      boundaryFriction={0.2}
      mouseButtons={{
        left: ACTION.ROTATE,
        middle: ACTION.TRUCK,
        right: ACTION.TRUCK,
        wheel: ACTION.DOLLY,
      }}
      touches={{
        one: ACTION.TOUCH_ROTATE,
        two: ACTION.TOUCH_DOLLY_TRUCK,
        three: ACTION.TOUCH_TRUCK,
      }}
    />
  );
}

export function LDrawMesh({
  model,
  color,
  rotation,
  matrix,
}: {
  model: Group;
  color: number;
  rotation: number;
  /** The full LDraw turn, row-major; pieces mounted on side studs need more than `rotation`. */
  matrix?: readonly number[];
}) {
  const key = matrix?.join(' ');
  const turn = useMemo(() => {
    if (!key) return undefined;
    const [a, b, c, d, e, f, g, h, i] = key.split(' ').map(Number);
    return new Matrix4()
      .set(a, b, c, 0, d, e, f, 0, g, h, i, 0, 0, 0, 0, 1)
      .premultiply(new Matrix4().makeScale(0.05, -0.05, 0.05));
  }, [key]);
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
  return turn ? (
    <group matrix={turn} matrixAutoUpdate={false} dispose={null}>
      <primitive object={instance} />
    </group>
  ) : (
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
  opacity = 1,
  overrideColor,
  explode = false,
  model,
}: {
  brick: Brick;
  buildArea?: number;
  opacity?: number;
  overrideColor?: string;
  explode?: boolean;
  model?: Group;
}) {
  const size = footprint(brick);
  const definition = COLORS.find((entry) => entry.id === brick.color)!;
  const material = colorMaterialProperties(definition);
  const color = overrideColor ?? displayHex(definition);
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
      userData={{ brickId: brick.id }}
    >
      {model ? (
        <group position={getLDrawModelOffset(brick)}>
          <LDrawMesh
            key={`${brick.partId}:${brick.color}`}
            model={model}
            color={brick.color}
            rotation={getLDrawTransform(brick).rotation}
            matrix={brick.facing ? getLDrawTransform(brick).matrix : undefined}
          />
        </group>
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
}: {
  bricks: readonly Brick[];
  model: Group;
  buildArea: number;
  explode: boolean;
}) {
  const batch = useMemo(
    () => createLDrawBatch(bricks, coloredLDrawModel(model, bricks[0].color), buildArea, explode),
    [bricks, model, buildArea, explode],
  );
  useEffect(() => () => disposeLDrawBatch(batch), [batch]);
  return <primitive object={batch} dispose={null} />;
});

function Outline({
  brick,
  buildArea,
  explode,
  color,
  fill,
}: {
  brick: Brick;
  buildArea: number;
  explode: boolean;
  color: string;
  /** Washes the piece out, so the outline reads on every brick color. */
  fill?: string;
}) {
  const size = footprint(brick);
  return (
    <mesh
      raycast={() => null}
      position={[
        brick.x + size.width / 2 - buildArea / 2,
        (brick.y + size.height / 2) * PLATE_HEIGHT + (explode ? brick.y * 0.18 : 0),
        brick.z + size.depth / 2 - buildArea / 2,
      ]}
    >
      <boxGeometry
        args={[size.width + 0.04, size.height * PLATE_HEIGHT + 0.04, size.depth + 0.04]}
      />
      <meshBasicMaterial transparent color={fill} opacity={fill ? 0.55 : 0} depthWrite={false} />
      <Edges color={color} linewidth={2} />
    </mesh>
  );
}

/** Finds the brick an intersection belongs to: batched instances or a separate brick group. */
function hitBrickId(object: Object3D, instanceId: number | undefined) {
  if (instanceId !== undefined && Array.isArray(object.userData.brickIds))
    return object.userData.brickIds[instanceId] as string | undefined;
  for (let current: Object3D | null = object; current; current = current.parent)
    if (typeof current.userData.brickId === 'string') return current.userData.brickId as string;
  return undefined;
}

/**
 * Turns a hit into the face it lands on, from the brick's footprint rather than the mesh normal,
 * so studs, slopes and LDraw's mirrored transforms all resolve the same way.
 */
function pointerTarget(
  event: ThreeEvent<PointerEvent | MouseEvent>,
  bricks: ReadonlyMap<string, Brick>,
  buildArea: number,
): PointerTarget | null | undefined {
  if (event.object instanceof Line) return undefined;
  const x = event.point.x + buildArea / 2;
  const z = event.point.z + buildArea / 2;
  if (event.object.userData.ground) return { face: 'ground', x, z };
  const id = hitBrickId(event.object, event.instanceId);
  const brick = id === undefined ? undefined : bricks.get(id);
  if (!brick) return undefined;
  const size = footprint(brick);
  const plates = event.point.y / PLATE_HEIGHT;
  if (plates >= brick.y + size.height - 0.3) return { face: 'top', brick, x, z };
  if (plates <= brick.y + 0.05) return { face: 'bottom', brick, x, z };
  const sides = [
    ['x-', x - brick.x],
    ['x+', brick.x + size.width - x],
    ['z-', z - brick.z],
    ['z+', brick.z + size.depth - z],
  ] as const;
  const [face] = sides.reduce((nearest, side) => (side[1] < nearest[1] ? side : nearest));
  return { face, brick, x, z };
}

function targetKey(target: PointerTarget | null) {
  return target
    ? `${target.face}:${target.brick?.id ?? ''}:${Math.floor(target.x * 2)}:${Math.floor(target.z * 2)}`
    : '';
}

/** The everyday light board: bright, even lighting over the baseplate and its stud grid. */
function WorkshopStage({ buildArea }: { buildArea: number }) {
  return (
    <>
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
    </>
  );
}

export const Scene = memo(function Scene(props: SceneProps) {
  const cinematic = props.cinematic ?? null;
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
  const visible = useMemo(
    () =>
      new Map(
        props.assembly.bricks
          .filter((brick) => brick.y < props.layer)
          .map((brick) => [brick.id, brick]),
      ),
    [props.assembly, props.layer],
  );
  const selected = props.selectedId ? visible.get(props.selectedId) : undefined;
  const highlighted = props.highlightId ? visible.get(props.highlightId) : undefined;
  const mode = props.mode ?? 'select';
  const bounds = useMemo(() => {
    if (!visible.size) return null;
    const box = new Box3();
    for (const brick of visible.values()) {
      const size = footprint(brick);
      const lift = props.explode ? brick.y * 0.18 : 0;
      box.expandByPoint(
        new Vector3(
          brick.x - buildArea / 2,
          brick.y * PLATE_HEIGHT + lift,
          brick.z - buildArea / 2,
        ),
      );
      box.expandByPoint(
        new Vector3(
          brick.x + size.width - buildArea / 2,
          (brick.y + size.height) * PLATE_HEIGHT + lift,
          brick.z + size.depth - buildArea / 2,
        ),
      );
    }
    return box;
  }, [visible, buildArea, props.explode]);
  const hoverKey = useRef('');
  const rig = useRef<CameraControls>(null);
  const { onHover } = props;
  function hover(target: PointerTarget | null) {
    const key = targetKey(target);
    if (key === hoverKey.current) return;
    hoverKey.current = key;
    onHover?.(target);
  }
  function resolve(event: ThreeEvent<PointerEvent | MouseEvent>) {
    // Explode spreads bricks apart, so hits no longer map onto build positions.
    if (props.explode) return null;
    const target = pointerTarget(event, visible, buildArea);
    if (target !== undefined) event.stopPropagation();
    return target;
  }
  return (
    <Canvas
      shadows
      frameloop="demand"
      camera={{ position: [21, 19, 24], fov: 38, near: 0.1, far: 500 }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      dpr={[1, 2]}
      onPointerMissed={(event) => {
        if (mode === 'select' && event.type === 'click') props.onSelect(null);
      }}
      onPointerLeave={() => hover(null)}
      style={{ cursor: mode === 'place' ? 'crosshair' : 'default' }}
      aria-label="Interactive 3D brick model"
    >
      {cinematic ? (
        <CinematicStage mood={cinematic.mood} bounds={bounds} />
      ) : (
        <WorkshopStage buildArea={buildArea} />
      )}
      <group
        onPointerMove={(event) => {
          const target = resolve(event);
          if (target !== undefined) hover(target);
        }}
        onClick={(event) => {
          // A drag orbits the camera; only a still click acts on the build.
          if (event.delta > 5) return;
          const target = resolve(event);
          if (target === undefined) return;
          if (mode === 'select') props.onSelect(target?.brick?.id ?? null);
          else if (target) props.onActivate?.(target, { alt: event.altKey, shift: event.shiftKey });
        }}
        onDoubleClick={(event) => {
          // Double-click recenters the orbit on that spot; while building, clicks place pieces.
          if (mode !== 'select' || event.object instanceof Line) return;
          event.stopPropagation();
          void rig.current?.moveTo(event.point.x, event.point.y, event.point.z, true);
        }}
      >
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} userData={{ ground: true }}>
          <planeGeometry args={[200, 200]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
        {displays.batches.map(([key, bricks]) => (
          <NativeBatch
            key={key}
            bricks={bricks}
            model={props.models[bricks[0].partId]}
            buildArea={buildArea}
            explode={props.explode}
          />
        ))}
        {displays.separate.map((brick) => (
          <BrickMesh
            key={brick.id}
            brick={brick}
            buildArea={buildArea}
            explode={props.explode}
            model={props.models[brick.partId]}
          />
        ))}
      </group>
      {selected && (
        <Outline brick={selected} buildArea={buildArea} explode={props.explode} color="#0a84ff" />
      )}
      {highlighted && highlighted !== selected && (
        <Outline
          brick={highlighted}
          buildArea={buildArea}
          explode={props.explode}
          color="#b0000f"
          fill="#ffffff"
        />
      )}
      {props.ghost && (
        <group raycast={() => null}>
          <BrickMesh
            brick={props.ghost}
            buildArea={buildArea}
            opacity={props.ghostValid ? 0.6 : 0.45}
            overrideColor={props.ghostValid ? undefined : '#ff453a'}
          />
          <Outline
            brick={props.ghost}
            buildArea={buildArea}
            explode={false}
            color={props.ghostValid ? '#ffffff' : '#ff453a'}
          />
        </group>
      )}
      <CameraRig
        view={props.view}
        revision={props.cameraRevision}
        height={height}
        buildArea={buildArea}
        bounds={bounds}
        controls={rig}
        trackpad={props.trackpad ?? false}
        onDevice={props.onPointerDevice}
        cinematic={cinematic !== null}
        turntable={cinematic?.turntable ?? false}
      />
      <SceneReady onReady={props.onReady} />
    </Canvas>
  );
});
