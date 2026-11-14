import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { BoxGeometry, EdgesGeometry, Raycaster, Vector2 } from 'three';
import type { Group, Object3D } from 'three';
import { PLATE_HEIGHT, footprint } from '@brick-workshop/engine';
import type { Brick } from '@brick-workshop/engine';
import { FallbackBatch } from '@brick-workshop/render/fallback-batch';
import { LDrawBatch, canBatchLDrawModel } from '@brick-workshop/render/ldraw-batches';
import { displayHex } from '@brick-workshop/render/ldraw-materials';
import { WalkMode } from '@brick-workshop/walk/walk-view';
import type { WalkCamera, WalkProbe } from '@brick-workshop/walk/walk-view';
import { DebugHelpers, DebugProbe } from '@brick-workshop/render/scene-debug';
import type { DebugOptions, DebugStore } from '@brick-workshop/render/scene-debug';
import { CollisionBoxes, PlayerProbe } from './debug.tsx';
import type { PlayerStore } from './debug.tsx';
import { COLORS } from '@brick-workshop/engine';
import { aimAt, aimKey } from './build.ts';
import { GameStage } from './GameStage.tsx';
import type { Aim } from './build.ts';

/** How far the crosshair reaches from the eye, in studs; further from the over-shoulder camera. */
const REACH = { first: 14, third: 22 } as const;

export type MouseAction = 'break' | 'place' | 'pick';

export interface GameSceneProps {
  bricks: readonly Brick[];
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
}

/** The debug window's probes inside the canvas; drawn only while the window is open. */
export interface GameSceneDebug {
  options: DebugOptions;
  store: DebugStore;
  player: PlayerStore;
  collision: boolean;
}

export function GameScene(props: GameSceneProps) {
  const { bricks, models, buildArea } = props;
  const half = buildArea / 2;
  const split = useMemo(() => {
    const batched: Brick[] = [];
    const fallback: Brick[] = [];
    const batchable = new Map<string, boolean>();
    for (const brick of bricks) {
      const model = models[brick.partId];
      let ok = batchable.get(brick.partId);
      if (ok === undefined)
        batchable.set(brick.partId, (ok = !!model && canBatchLDrawModel(model)));
      (ok ? batched : fallback).push(brick);
    }
    return { batched, fallback };
  }, [bricks, models]);
  const start = useMemo(
    () => ({ x: props.spawn.x - half, z: half - props.spawn.z }),
    [props.spawn, half],
  );
  const targets = useRef<Object3D[]>([]);
  const batchRef = useRef<LDrawBatch | null>(null);
  const probe = useRef<WalkProbe | null>(null);
  const { debug } = props;
  const byId = useMemo(() => new Map(bricks.map((brick) => [brick.id, brick])), [bricks]);
  return (
    <Canvas
      shadows
      frameloop="demand"
      camera={{ position: [0, 30, 60], fov: 70, near: 0.05, far: 600 }}
      gl={{ antialias: false }}
      dpr={[1, 2]}
      aria-label="Brick island"
    >
      <GameStage size={buildArea} />
      <NativeBatch
        bricks={split.batched}
        models={models}
        buildArea={buildArea}
        batchRef={batchRef}
        onObject={(object) => {
          targets.current[0] = object;
        }}
      />
      <FallbackBatchView
        bricks={split.fallback}
        buildArea={buildArea}
        onObject={(object) => {
          targets.current[1] = object;
        }}
      />
      <WalkMode
        bricks={bricks}
        buildArea={buildArea}
        view={props.view}
        flying={props.flying}
        onFlyingChange={props.onFlyingChange}
        onViewChange={props.onViewChange}
        start={start}
        probe={probe}
      />
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
        targets={targets}
        bricks={byId}
        buildArea={buildArea}
        reach={REACH[props.view]}
        onAim={props.onAim}
      />
      <MouseButtons active={props.playing} onMouse={props.onMouse} />
      {props.ghost && <Ghost brick={props.ghost} valid={props.ghostValid} buildArea={buildArea} />}
    </Canvas>
  );
}

function NativeBatch({
  bricks,
  models,
  buildArea,
  batchRef,
  onObject,
}: {
  bricks: readonly Brick[];
  models: Record<string, Group>;
  buildArea: number;
  /** Hands the batch to the debug window for its statistics. */
  batchRef: { current: LDrawBatch | null };
  onObject: (object: Object3D) => void;
}) {
  const [batch] = useState(() => new LDrawBatch(undefined, { fadeEdges: true, solidGround: true }));
  useEffect(() => {
    batchRef.current = batch;
    return () => {
      batchRef.current = null;
    };
  }, [batch, batchRef]);
  const invalidate = useThree((state) => state.invalidate);
  const shadows = useThree((state) => state.gl.shadowMap);
  useEffect(() => {
    onObject(batch.object);
  }, [batch, onObject]);
  useLayoutEffect(() => {
    const entries = bricks.map((brick) => ({ brick, model: models[brick.partId] }));
    // Edits touch a piece or two and land in the same frame; a new world is placed in slices.
    if (batch.changes(entries, buildArea) < 200) {
      batch.update(entries, buildArea);
      shadows.needsUpdate = true;
      invalidate();
      return;
    }
    void batch.updateInSlices(entries, buildArea, false).then((complete) => {
      if (!complete) return;
      shadows.needsUpdate = true;
      invalidate();
    });
  }, [batch, bricks, models, buildArea, invalidate, shadows]);
  useEffect(() => () => batch.dispose(), [batch]);
  return <primitive object={batch.object} dispose={null} />;
}

function FallbackBatchView({
  bricks,
  buildArea,
  onObject,
}: {
  bricks: readonly Brick[];
  buildArea: number;
  onObject: (object: Object3D) => void;
}) {
  const [batch] = useState(() => new FallbackBatch());
  const invalidate = useThree((state) => state.invalidate);
  const shadows = useThree((state) => state.gl.shadowMap);
  useEffect(() => {
    onObject(batch.object);
  }, [batch, onObject]);
  useLayoutEffect(() => {
    if (!batch.update(bricks, buildArea)) return;
    shadows.needsUpdate = true;
    invalidate();
  }, [batch, bricks, buildArea, invalidate, shadows]);
  useEffect(() => () => batch.dispose(), [batch]);
  return <primitive object={batch.object} dispose={null} />;
}

/** The piece a batched hit belongs to. */
function hitBrickId(object: Object3D, index: number | undefined) {
  const ids = object.userData.brickIds;
  return index !== undefined && Array.isArray(ids) ? (ids[index] as string | undefined) : undefined;
}

/** Casts from the middle of the screen every frame and reports the aim when it moves. */
function Aimer({
  targets,
  bricks,
  buildArea,
  reach,
  onAim,
}: {
  targets: { current: Object3D[] };
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
    const hits = raycaster.intersectObjects(targets.current.filter(Boolean), true);
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
