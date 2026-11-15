import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { BoxGeometry, EdgesGeometry, Raycaster, Vector2 } from 'three';
import type { Color, Group, Object3D } from 'three';
import { PLATE_HEIGHT, footprint } from '@brick-workshop/engine';
import type { Brick } from '@brick-workshop/engine';
import { FallbackBatch } from '@brick-workshop/render/fallback-batch';
import { LDrawBatch, canBatchLDrawModel } from '@brick-workshop/render/ldraw-batches';
import { displayHex } from '@brick-workshop/render/ldraw-materials';
import { WalkMode } from '@brick-workshop/walk/walk-view';
import type { WalkWorld } from '@brick-workshop/walk/walk';
import type { Chunks } from './chunks.ts';
import type { WalkCamera, WalkProbe } from '@brick-workshop/walk/walk-view';
import { DebugHelpers, DebugProbe } from '@brick-workshop/render/scene-debug';
import type { DebugOptions, DebugStore } from '@brick-workshop/render/scene-debug';
import { CollisionBoxes, PlayerProbe } from './debug.tsx';
import type { PlayerStore } from './debug.tsx';
import { COLORS } from '@brick-workshop/engine';
import { aimAt, aimKey } from './build.ts';
import { GameStage } from './GameStage.tsx';
import { skyAt } from './sky.ts';
import type { DayClock } from './sky.ts';
import type { Volcano } from './world/terrain.ts';
import type { Aim } from './build.ts';

/** How far the crosshair reaches from the eye, in studs; further from the over-shoulder camera. */
const REACH = { first: 14, third: 22 } as const;

export type MouseAction = 'break' | 'place' | 'pick';

export interface GameSceneProps {
  /** The world's pieces by chunk; each chunk is drawn as a batch of its own. */
  chunks: Chunks;
  /** Every piece by ID, for what the crosshair hits. */
  bricks: ReadonlyMap<string, Brick>;
  /** The walker's collision world, kept up to date chunk by chunk. */
  walkWorld: WalkWorld;
  /** Bumped whenever the world changes. */
  revision: number;
  models: Record<string, Group>;
  buildArea: number;
  /** Where the minifigure starts, in build-grid studs. */
  spawn: { x: number; z: number };
  view: WalkCamera;
  flying: boolean;
  onFlyingChange: (flying: boolean) => void;
  onViewChange: (view: WalkCamera) => void;
  ghost: Brick | null;
  ghostValid: boolean;
  onAim: (aim: Aim | null) => void;
  onMouse: (action: MouseAction) => void;
  /** Off while the menu is up, so clicks there do not build. */
  playing: boolean;
  debug: GameSceneDebug;
  /** The time of day the sky and the light follow. */
  clock: DayClock;
  /** The island's volcano, whose crater glows. */
  volcano: Volcano | null;
}

/** The debug window's probes inside the canvas; drawn only while the window is open. */
export interface GameSceneDebug {
  options: DebugOptions;
  store: DebugStore;
  player: PlayerStore;
  collision: boolean;
}

/** What each chunk draws: its batches, for the crosshair to hit and the outlines to dim. */
interface ChunkDrawing {
  native: LDrawBatch | null;
  objects: Object3D[];
}

export function GameScene(props: GameSceneProps) {
  const { chunks, models, buildArea } = props;
  const half = buildArea / 2;
  const start = useMemo(
    () => ({ x: props.spawn.x - half, z: half - props.spawn.z }),
    [props.spawn, half],
  );
  // One map for the scene's lifetime: chunks register their batches in it as they mount.
  const [drawings] = useState(() => new Map<string, ChunkDrawing>());
  const batchRef = useRef<LDrawBatch | null>(null);
  const probe = useRef<WalkProbe | null>(null);
  const { debug } = props;
  return (
    <Canvas
      shadows
      frameloop="demand"
      camera={{ position: [0, 30, 60], fov: 70, near: 0.05, far: 600 }}
      gl={{ antialias: false }}
      dpr={[1, 2]}
      aria-label="Brick island"
    >
      <GameStage size={buildArea} clock={props.clock} volcano={props.volcano} />
      {[...chunks].map(([key, pieces]) => (
        <ChunkView
          key={key}
          chunk={key}
          pieces={pieces}
          models={models}
          buildArea={buildArea}
          drawings={drawings}
          batchRef={batchRef}
        />
      ))}
      <WalkMode
        bricks={EMPTY}
        world={props.walkWorld}
        revision={props.revision}
        buildArea={buildArea}
        view={props.view}
        flying={props.flying}
        onFlyingChange={props.onFlyingChange}
        onViewChange={props.onViewChange}
        start={start}
        probe={probe}
      />
      <EdgeDimmer drawings={drawings} clock={props.clock} />
      {debug.options.enabled && (
        <>
          <DebugProbe store={debug.store} options={debug.options} batch={batchRef} />
          <DebugHelpers
            options={debug.options}
            bounds={null}
            unbatched={[]}
            buildArea={buildArea}
          />
          <PlayerProbe probe={probe} store={debug.player} buildArea={buildArea} />
          {debug.collision && <CollisionBoxes probe={probe} />}
        </>
      )}
      <Aimer
        drawings={drawings}
        bricks={props.bricks}
        buildArea={buildArea}
        reach={REACH[props.view]}
        onAim={props.onAim}
      />
      <MouseButtons active={props.playing} onMouse={props.onMouse} />
      {props.ghost && <Ghost brick={props.ghost} valid={props.ghostValid} buildArea={buildArea} />}
    </Canvas>
  );
}

const EMPTY: readonly Brick[] = [];

/**
 * One chunk's pieces: those with an LDraw model in a batch of their own, the rest from simple
 * shapes. A change to the chunk redraws only this chunk.
 */
function ChunkView({
  chunk,
  pieces,
  models,
  buildArea,
  drawings,
  batchRef,
}: {
  chunk: string;
  pieces: readonly Brick[];
  models: Record<string, Group>;
  buildArea: number;
  drawings: Map<string, ChunkDrawing>;
  /** The debug window shows the statistics of one batch: the first chunk's. */
  batchRef: { current: LDrawBatch | null };
}) {
  const split = useMemo(() => {
    const batched: Brick[] = [];
    const fallback: Brick[] = [];
    for (const brick of pieces) {
      const model = models[brick.partId];
      (model && batchable(model) ? batched : fallback).push(brick);
    }
    return { batched, fallback };
  }, [pieces, models]);
  const [native] = useState(
    () => new LDrawBatch(undefined, { fadeEdges: true, solidGround: true }),
  );
  const [simple] = useState(() => new FallbackBatch());
  useEffect(() => {
    drawings.set(chunk, { native, objects: [native.object, simple.object] });
    if (!batchRef.current) batchRef.current = native;
    return () => {
      drawings.delete(chunk);
      if (batchRef.current === native) batchRef.current = null;
    };
  }, [chunk, drawings, native, simple, batchRef]);
  const invalidate = useThree((state) => state.invalidate);
  const shadows = useThree((state) => state.gl.shadowMap);
  useLayoutEffect(() => {
    const entries = split.batched.map((brick) => ({ brick, model: models[brick.partId] }));
    // Edits touch a piece or two and land in the same frame; a new chunk is placed in slices.
    if (native.changes(entries, buildArea) < 200) {
      native.update(entries, buildArea);
      shadows.needsUpdate = true;
      invalidate();
    } else
      void native.updateInSlices(entries, buildArea, false).then((complete) => {
        if (!complete) return;
        shadows.needsUpdate = true;
        invalidate();
      });
    if (simple.update(split.fallback, buildArea)) {
      shadows.needsUpdate = true;
      invalidate();
    }
  }, [native, simple, split, models, buildArea, invalidate, shadows]);
  useEffect(
    () => () => {
      native.dispose();
      simple.dispose();
    },
    [native, simple],
  );
  return (
    <>
      <primitive object={native.object} dispose={null} />
      <primitive object={simple.object} dispose={null} />
    </>
  );
}

/** Whether a part's model can go in a batch, remembered per model. */
const batchableModels = new WeakMap<Group, boolean>();
function batchable(model: Group) {
  let ok = batchableModels.get(model);
  if (ok === undefined) batchableModels.set(model, (ok = canBatchLDrawModel(model)));
  return ok;
}

/**
 * Brick outlines are drawn without lighting; dims them with the daylight so they do not glow at
 * night.
 */
function EdgeDimmer({
  drawings,
  clock,
}: {
  drawings: ReadonlyMap<string, ChunkDrawing>;
  clock: DayClock;
}) {
  useFrame(() => {
    const level = Math.round(skyAt(clock.time).unlit * 50) / 50;
    for (const { native } of drawings.values()) {
      // Checked per material: a batch makes new line meshes as it grows.
      for (const line of native?.lines ?? [])
        for (const material of Array.isArray(line.material) ? line.material : [line.material]) {
          const { color } = material as unknown as { color: Color };
          if (color.r !== level) color.setScalar(level);
        }
    }
  });
  return null;
}

/** The piece a batched hit belongs to. */
function hitBrickId(object: Object3D, index: number | undefined) {
  const ids = object.userData.brickIds;
  return index !== undefined && Array.isArray(ids) ? (ids[index] as string | undefined) : undefined;
}

/** Casts from the middle of the screen every frame and reports the aim when it moves. */
function Aimer({
  drawings,
  bricks,
  buildArea,
  reach,
  onAim,
}: {
  drawings: ReadonlyMap<string, ChunkDrawing>;
  bricks: ReadonlyMap<string, Brick>;
  buildArea: number;
  reach: number;
  onAim: (aim: Aim | null) => void;
}) {
  const raycaster = useMemo(() => new Raycaster(), []);
  const centre = useMemo(() => new Vector2(0, 0), []);
  const last = useRef('');
  useFrame(({ camera }) => {
    raycaster.setFromCamera(centre, camera);
    raycaster.far = reach;
    let aim: Aim | null = null;
    const targets: Object3D[] = [];
    for (const drawing of drawings.values()) targets.push(...drawing.objects);
    const hits = raycaster.intersectObjects(targets, true);
    for (const hit of hits) {
      const id = hitBrickId(hit.object, hit.batchId ?? hit.instanceId);
      const brick = id === undefined ? undefined : bricks.get(id);
      if (!brick) continue;
      aim = aimAt(hit.point, brick, buildArea);
      break;
    }
    const key = aimKey(aim);
    if (key === last.current) return;
    last.current = key;
    onAim(aim);
  });
  return null;
}

/**
 * Left click breaks, right click places, middle click picks. With the pointer locked a press acts
 * at once; where the page may not lock it (an embedded frame), dragging looks round, so only a
 * click that stays put acts.
 */
function MouseButtons({
  active,
  onMouse,
}: {
  active: boolean;
  onMouse: (action: MouseAction) => void;
}) {
  const element = useThree((state) => state.gl.domElement);
  const handler = useRef({ active, onMouse });
  useEffect(() => {
    handler.current = { active, onMouse };
  });
  useEffect(() => {
    const act = (button: number) => {
      const action = (['break', 'pick', 'place'] as const)[button];
      if (action && handler.current.active) handler.current.onMouse(action);
    };
    let pressed: { x: number; y: number; button: number } | null = null;
    const down = (event: MouseEvent) => {
      event.preventDefault();
      if (document.pointerLockElement === element) act(event.button);
      else pressed = { x: event.clientX, y: event.clientY, button: event.button };
    };
    const up = (event: MouseEvent) => {
      if (!pressed || document.pointerLockElement === element) return;
      const still = Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < 5;
      if (still && event.button === pressed.button) act(event.button);
      pressed = null;
    };
    const menu = (event: Event) => event.preventDefault();
    element.addEventListener('mousedown', down);
    window.addEventListener('mouseup', up);
    element.addEventListener('contextmenu', menu);
    return () => {
      element.removeEventListener('mousedown', down);
      window.removeEventListener('mouseup', up);
      element.removeEventListener('contextmenu', menu);
    };
  }, [element]);
  return null;
}

const unitBox = new BoxGeometry(1, 1, 1);
const unitEdges = new EdgesGeometry(unitBox);

/** Where the held piece would go: its box, see-through in its colour, red when it cannot. */
function Ghost({ brick, valid, buildArea }: { brick: Brick; valid: boolean; buildArea: number }) {
  const size = footprint(brick);
  const half = buildArea / 2;
  const color = COLORS.find((entry) => entry.id === brick.color);
  const fill = valid ? (color ? displayHex(color) : '#ffffff') : '#ff453a';
  const height = size.height * PLATE_HEIGHT;
  return (
    <group
      position={[
        brick.x + size.width / 2 - half,
        brick.y * PLATE_HEIGHT + height / 2,
        half - (brick.z + size.depth / 2),
      ]}
      scale={[size.width + 0.02, height + 0.02, size.depth + 0.02]}
      raycast={() => null}
    >
      <mesh geometry={unitBox} raycast={() => null}>
        <meshBasicMaterial color={fill} transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <lineSegments geometry={unitEdges} raycast={() => null}>
        <lineBasicMaterial color={valid ? '#ffffff' : '#ff453a'} />
      </lineSegments>
    </group>
  );
}
