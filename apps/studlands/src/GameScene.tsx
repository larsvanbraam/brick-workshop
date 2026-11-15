import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { BoxGeometry, EdgesGeometry, Raycaster, Vector2 } from 'three';
import type { Color, Group, Object3D } from 'three';
import { PLATE_HEIGHT, footprint } from '@brick-workshop/engine';
import type { Brick } from '@brick-workshop/engine';
import { getCinematicDpr } from '@brick-workshop/render/cinematic-look';
import { FallbackBatch } from '@brick-workshop/render/fallback-batch';
import { LDrawBatch, LookCache, canBatchLDrawModel } from '@brick-workshop/render/ldraw-batches';
import type { BatchEntry, BatchLayerStats, BatchStats } from '@brick-workshop/render/ldraw-batches';
import { displayHex } from '@brick-workshop/render/ldraw-materials';
import { WalkMode } from '@brick-workshop/walk/walk-view';
import type { WalkWorld } from '@brick-workshop/walk/walk';
import type { Chunks } from './chunks.ts';
import { chunkAt } from './streaming.ts';
import type { RenderDistance } from './streaming.ts';
import { FarLayer } from './FarView.tsx';
import type { FarStore } from './FarView.tsx';
import { CHUNK, chunkKey } from './chunks.ts';
import type { WalkCamera, WalkProbe } from '@brick-workshop/walk/walk-view';
import { DebugHelpers, DebugProbe } from '@brick-workshop/render/scene-debug';
import type { DebugOptions, DebugStore } from '@brick-workshop/render/scene-debug';
import { CollisionBoxes, PlayerProbe } from './debug.tsx';
import type { PlayerStore } from './debug.tsx';
import { COLORS } from '@brick-workshop/engine';
import { aimAt, aimKey } from './build.ts';
import { buriedPieces } from './buried.ts';
import { requestShadows } from './shadows.ts';
import { GameStage } from './GameStage.tsx';
import type { Glows } from './GameStage.tsx';
import { skyAt } from './sky.ts';
import type { DayClock } from './sky.ts';
import type { Terrain } from './world/terrain.ts';
import { ChunkBorders } from './debug.tsx';
import type { Volcano } from './world/terrain.ts';
import type { Aim } from './build.ts';

/** How far the crosshair reaches from the eye, in studs; further from the over-shoulder camera. */
const REACH = { first: 14, third: 22 } as const;

export type MouseAction = 'break' | 'place' | 'pick';

export interface GameSceneProps {
  /** The world's pieces by chunk; each chunk is drawn as a batch of its own. */
  chunks: Chunks;
  /** The ring past them, drawn plainly from afar until a chunk is loaded in full. */
  farChunks: FarStore;
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
  /** Told the walker's chunk whenever it walks into another. */
  onChunk: (cx: number, cz: number) => void;
  view: WalkCamera;
  flying: boolean;
  onFlyingChange: (flying: boolean) => void;
  onViewChange: (view: WalkCamera) => void;
  /** Which controller buttons walking takes: off while a panel is open over the game. */
  gamepad: 'build' | 'off';
  ghost: Brick | null;
  ghostValid: boolean;
  onAim: (aim: Aim | null) => void;
  onMouse: (action: MouseAction) => void;
  /** How far the world reaches: the fog closes in at its edge and the shadows cover the near part. */
  distance: RenderDistance;
  /** Off while the menu is up, so clicks there do not build. */
  playing: boolean;
  debug: GameSceneDebug;
  /** The time of day the sky and the light follow. */
  clock: DayClock;
  /** The volcano, whose crater glows. */
  volcano: Volcano | null;
  /** The campfire and cave crystals nearest the walker. */
  glows: Glows;
}

/** The debug window's probes inside the canvas; drawn only while the window is open. */
export interface GameSceneDebug {
  options: DebugOptions;
  store: DebugStore;
  player: PlayerStore;
  collision: boolean;
  /** The terrain to outline the loaded chunks' edges on, or null to leave them out. */
  borders: Terrain | null;
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
  // The debug window's batch figures, summed over every chunk's batch.
  const [summed] = useState(() => ({ current: new SummedBatches(drawings) }));
  const probe = useRef<WalkProbe | null>(null);
  const { debug } = props;
  const dpr = useCappedDpr();
  return (
    <Canvas
      shadows
      frameloop="demand"
      camera={{ position: [0, 30, 60], fov: 70, near: 0.05, far: 600 }}
      gl={{ antialias: false }}
      dpr={dpr}
      aria-label="Studlands"
    >
      <GameStage
        size={buildArea}
        view={(props.distance.far + 0.5) * CHUNK}
        // Shadows stop two chunks out whatever the reach: wider, the same shadow map blurs.
        shadowView={(Math.min(props.distance.load, 2) + 0.5) * CHUNK}
        clock={props.clock}
        volcano={props.volcano}
        glows={props.glows}
      />
      {[...chunks].map(([key, pieces]) => (
        <ChunkView
          key={key}
          chunk={key}
          pieces={pieces}
          models={models}
          buildArea={buildArea}
          drawings={drawings}
        />
      ))}
      <FarLayer store={props.farChunks} loaded={chunks} />
      <WalkMode
        bricks={EMPTY}
        world={props.walkWorld}
        revision={props.revision}
        buildArea={buildArea}
        view={props.view}
        flying={props.flying}
        onFlyingChange={props.onFlyingChange}
        onViewChange={props.onViewChange}
        gamepad={props.gamepad}
        start={start}
        probe={probe}
      />
      <EdgeDimmer drawings={drawings} clock={props.clock} />
      <ChunkWatcher probe={probe} buildArea={buildArea} onChunk={props.onChunk} />
      {debug.options.enabled && (
        <>
          <DebugProbe store={debug.store} options={debug.options} batch={summed} />
          <DebugHelpers
            options={debug.options}
            bounds={null}
            unbatched={[]}
            buildArea={buildArea}
          />
          <PlayerProbe probe={probe} store={debug.player} buildArea={buildArea} />
          {debug.collision && <CollisionBoxes probe={probe} />}
          {debug.borders && (
            <ChunkBorders terrain={debug.borders} chunks={chunks} buildArea={buildArea} />
          )}
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
      <Ghost brick={props.ghost} valid={props.ghostValid} buildArea={buildArea} />
    </Canvas>
  );
}

const EMPTY: readonly Brick[] = [];
/** The most pixels the canvas draws: about a 1080p screen's worth. */
const MAX_PIXELS = 2_000_000;

/**
 * The canvas's pixel ratio: the screen's, but capped. At a high-density screen's full ratio the
 * canvas holds millions of pixels, each lit, shadowed and shaded for ambient occlusion every
 * frame; capping them keeps walking smooth.
 */
function useCappedDpr() {
  const measure = () =>
    getCinematicDpr(
      window.innerWidth,
      window.innerHeight,
      window.devicePixelRatio || 1,
      MAX_PIXELS,
    );
  const [dpr, setDpr] = useState(measure);
  useEffect(() => {
    const resize = () => setDpr(measure());
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  return dpr;
}

/**
 * Chunks are built one at a time, nearest first as they arrive, a few milliseconds a frame: a
 * burst of arrivals (crossing into a new chunk, a longer render distance) then costs a steady
 * slice of each frame rather than a run of long ones.
 */
let buildQueue: Promise<unknown> = Promise.resolve();
function queueBuild<T>(job: () => Promise<T>): Promise<T> {
  const next = buildQueue.then(job, job);
  buildQueue = next.catch(() => {});
  return next;
}
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const BUILD_SLICES = { budget: 6, pause: nextFrame };
/** Room for a typical chunk, about a thousand pieces and 110,000 vertices, so it seldom grows. */
const CHUNK_RESERVE = { instances: 2048, vertices: 131_072, indices: 262_144 };
/** Parts baked once for every chunk: the same few dozen parts and colors fill them all. */
const CHUNK_LOOKS = new LookCache();

/**
 * One chunk's pieces: those with an LDraw model in a batch of their own, the rest from simple
 * shapes. A change to the chunk redraws only this chunk.
 */
const ChunkView = memo(function ChunkView({
  chunk,
  pieces,
  models,
  buildArea,
  drawings,
}: {
  chunk: string;
  pieces: readonly Brick[];
  models: Record<string, Group>;
  buildArea: number;
  drawings: Map<string, ChunkDrawing>;
}) {
  // The library hands over a new set of models whenever any part loads; the chunk is redrawn
  // only when one of the models its own pieces use has changed, not on every load elsewhere.
  const own = useMemo(() => {
    const used: Record<string, Group> = {};
    for (const brick of pieces) {
      const model = models[brick.partId];
      if (model) used[brick.partId] = model;
    }
    return used;
  }, [pieces, models]);
  const ownKey = Object.keys(own).sort().join(',');
  // Pieces buried in the ground are never seen, so they are left out of the drawing (and the
  // shadows) but still cover the studs of the pieces round them. They stay in the world for
  // walking and breaking, and an edit that uncovers one draws it.
  const buried = useMemo(() => buriedPieces(pieces), [pieces]);
  const split = useMemo(() => {
    const used = own;
    const batched: BatchEntry[] = [];
    const fallback: Brick[] = [];
    for (const brick of pieces) {
      const model = used[brick.partId];
      const hidden = buried.has(brick);
      if (model && batchable(model))
        batched.push(hidden ? { brick, model, hidden } : { brick, model });
      else if (!hidden) fallback.push(brick);
    }
    return { batched, fallback };
    // A part's model never changes once loaded, so the loaded parts' IDs stand for the models:
    // the key changes exactly when a model this chunk uses arrives.
  }, [pieces, buried, ownKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [native] = useState(
    () =>
      new LDrawBatch(undefined, {
        fadeEdges: true,
        solidGround: true,
        cullEach: false,
        reserve: CHUNK_RESERVE,
        cache: CHUNK_LOOKS,
      }),
  );
  const [simple] = useState(() => new FallbackBatch());
  useEffect(() => {
    drawings.set(chunk, { native, objects: [native.object, simple.object] });
    return () => {
      drawings.delete(chunk);
    };
  }, [chunk, drawings, native, simple]);
  const invalidate = useThree((state) => state.invalidate);
  /** Whether the batch has been filled once: a new chunk is built later, edits at once. */
  const filled = useRef(false);
  useLayoutEffect(() => {
    const entries = split.batched;
    const done = (complete: boolean) => {
      if (!complete) return;
      requestShadows();
      invalidate();
    };
    let cancelled = false;
    const build = () =>
      queueBuild(() =>
        cancelled
          ? Promise.resolve(false)
          : native.updateInSlices(entries, buildArea, false, BUILD_SLICES),
      ).then(done);
    if (!filled.current) {
      // A chunk just arrived: it waits its turn and is built a slice a frame, so building it
      // never lands in the frame that adds it to the world, nor alongside other chunks.
      filled.current = true;
      void build();
    } else if (native.changes(entries, buildArea) < 200) {
      // An edit touches a piece or two and shows in the same frame.
      native.update(entries, buildArea);
      done(true);
    } else void build();
    if (simple.update(split.fallback, buildArea)) done(true);
    return () => {
      cancelled = true;
    };
  }, [native, simple, split, buildArea, invalidate]);
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
});

/**
 * The batch figures of every chunk added up, for the debug window. Worked out at most twice a
 * second: the window reads them every frame, and summing a few dozen batches each time would cost
 * more than what it measures.
 */
class SummedBatches {
  private readonly drawings: ReadonlyMap<string, ChunkDrawing>;
  private last = 0;
  private cached: BatchStats | null = null;

  constructor(drawings: ReadonlyMap<string, ChunkDrawing>) {
    this.drawings = drawings;
  }

  stats(): BatchStats {
    const now = performance.now();
    if (this.cached && now - this.last < 500) return this.cached;
    this.last = now;
    const sum: BatchStats = {
      bricks: 0,
      looks: 0,
      coveredStuds: 0,
      closedUndersides: 0,
      edgeSegments: 0,
      conditionalSegments: 0,
      layers: [],
    };
    const layers = new Map<string, BatchLayerStats>();
    for (const { native } of this.drawings.values()) {
      if (!native) continue;
      const stats = native.stats();
      sum.bricks += stats.bricks;
      sum.looks += stats.looks;
      sum.coveredStuds += stats.coveredStuds;
      sum.closedUndersides += stats.closedUndersides;
      sum.edgeSegments += stats.edgeSegments;
      sum.conditionalSegments += stats.conditionalSegments;
      for (const layer of stats.layers) {
        const total = layers.get(layer.finish);
        if (!total) layers.set(layer.finish, { ...layer });
        else
          for (const field of [
            'instances',
            'free',
            'maxInstances',
            'geometries',
            'vertices',
            'maxVertices',
            'indices',
            'maxIndices',
          ] as const)
            total[field] += layer[field];
      }
    }
    sum.layers = [...layers.values()];
    this.cached = sum;
    return sum;
  }
}

/** Watches the walker each frame and says when it crosses into another chunk. */
function ChunkWatcher({
  probe,
  buildArea,
  onChunk,
}: {
  probe: { current: WalkProbe | null };
  buildArea: number;
  onChunk: (cx: number, cz: number) => void;
}) {
  const last = useRef('');
  useFrame(() => {
    const walker = probe.current?.walker;
    if (!walker) return;
    // Scene to world studs: the scene centres the frame and runs z the other way.
    const [cx, cz] = chunkAt(walker.x + buildArea / 2, buildArea / 2 - walker.z);
    const key = `${cx},${cz}`;
    if (key === last.current) return;
    last.current = key;
    onChunk(cx, cz);
  });
  return null;
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
    // Only the chunks the ray can reach: the camera's and those within reach of it, rather than
    // every piece loaded.
    const x = camera.position.x + buildArea / 2;
    const z = buildArea / 2 - camera.position.z;
    const [x0, z0] = chunkAt(x - reach, z - reach);
    const [x1, z1] = chunkAt(x + reach, z + reach);
    const targets: Object3D[] = [];
    for (let cz = z0; cz <= z1; cz++)
      for (let cx = x0; cx <= x1; cx++) {
        const drawing = drawings.get(chunkKey(cx, cz));
        if (drawing) targets.push(...drawing.objects);
      }
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
/** What the hidden ghost is sized by while nothing is aimed at. */
const HIDDEN_GHOST: Brick = {
  id: 'ghost',
  partId: '3005',
  color: 15,
  x: 0,
  y: 0,
  z: 0,
  rotation: 0,
};

/**
 * Where the held piece would go: its box, see-through in its colour, red when it cannot. It stays
 * in the scene, hidden while nothing is aimed at: taking it out disposes its materials, and three
 * would then compile their shaders afresh every time the aim came back, stalling the game for
 * a moment each time.
 */
function Ghost({
  brick,
  valid,
  buildArea,
}: {
  brick: Brick | null;
  valid: boolean;
  buildArea: number;
}) {
  const shown = brick ?? HIDDEN_GHOST;
  const size = footprint(shown);
  const half = buildArea / 2;
  const color = COLORS.find((entry) => entry.id === shown.color);
  const fill = valid ? (color ? displayHex(color) : '#ffffff') : '#ff453a';
  const height = size.height * PLATE_HEIGHT;
  return (
    <group
      visible={brick !== null}
      position={[
        shown.x + size.width / 2 - half,
        shown.y * PLATE_HEIGHT + height / 2,
        half - (shown.z + size.depth / 2),
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
