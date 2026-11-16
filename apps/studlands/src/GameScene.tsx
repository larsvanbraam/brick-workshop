import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { BoxGeometry, EdgesGeometry, Frustum, Matrix4, Raycaster, Vector2, Vector3 } from 'three';
import type { Camera, Color, Group, Object3D } from 'three';
import { PLATE_HEIGHT, footprint } from '@brick-workshop/engine';
import type { Brick } from '@brick-workshop/engine';
import { getCinematicDpr } from '@brick-workshop/render/cinematic-look';
import { FallbackBatch } from '@brick-workshop/render/fallback-batch';
import { LDrawBatch, LookCache, canBatchLDrawModel } from '@brick-workshop/render/ldraw-batches';
import type { BatchEntry, BatchLayerStats, BatchStats } from '@brick-workshop/render/ldraw-batches';
import { displayHex } from '@brick-workshop/render/ldraw-materials';
import { WalkMode } from '@brick-workshop/walk/walk-view';
import { Wanderers } from '@brick-workshop/npc/wanderers';
import type { WandererSpec } from '@brick-workshop/npc/wanderers';
import type { TalkLink } from '@brick-workshop/npc/talk';
import { NPC_RADIUS, residentsOf, wanderRules } from './npcs.ts';
import { animalRules, farmAnimals, wildlifeOf } from './animals.ts';
import type { Animal } from './animals.ts';
import { FARM } from './world/island/map.ts';
import { QUESTS, giverId, takerId } from './quests.ts';
import type { Helper, QuestEvent } from './quests.ts';
import { QuestMarks } from './QuestScene.tsx';
import type { Positions, QuestView } from './QuestScene.tsx';
import { hash2 } from './world/noise.ts';
import { Vehicles } from '@brick-workshop/vehicles/drive-view';
import type { Vehicle, VehicleKind } from '@brick-workshop/vehicles/vehicle';
import { MINIFIG } from '@brick-workshop/walk/walk';
import type { WalkWorld } from '@brick-workshop/walk/walk';
import type { MinifigOutfit } from '@brick-workshop/walk/minifig';
import type { Tide } from './tide.ts';
import type { Chunks } from './chunks.ts';
import { chunkAt } from './streaming.ts';
import type { RenderDistance } from './streaming.ts';
import { FarLayer, ShownChunks } from './FarView.tsx';
import type { FarStore } from './FarView.tsx';
import { CHUNK, chunkKey } from './chunks.ts';
import type { WalkCamera, WalkProbe, WalkStart } from '@brick-workshop/walk/walk-view';
import { DebugHelpers, DebugProbe } from '@brick-workshop/render/scene-debug';
import type { DebugOptions, DebugStore } from '@brick-workshop/render/scene-debug';
import { CollisionBoxes, PlayerProbe } from './debug.tsx';
import { MapProbe } from './Minimap.tsx';
import type { MapStore } from './Minimap.tsx';
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
import { game } from './game.ts';
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
  /**
   * Where the minifigure starts, in build-grid studs; a resumed game adds the height it stood at
   * and the way it looked (see `WalkStart`).
   */
  spawn: WalkStart;
  /** Filled with the live walker and its look, for saving where it is. */
  probe?: { current: WalkProbe | null };
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
  /** Where to tell the minimap the walker is, for a game that has one. */
  map?: MapStore;
  /** The volcano, whose crater glows. */
  volcano: Volcano | null;
  /** The campfire and cave crystals nearest the walker. */
  glows: Glows;
  /** The terrain on the main thread, for where people live and walk. */
  terrain: Terrain;
  /** The walker's chunk: people live in the chunks round it. */
  centre: readonly [number, number];
  /** The vehicles round the world, which the scene moves (see `Vehicles`). */
  vehicles: readonly Vehicle[];
  /** The one being driven, by ID. */
  driving: string | null;
  onDrive: (id: string | null, flying?: boolean) => void;
  /** The vehicle the walker could get in. */
  onNear: (kind: VehicleKind | null) => void;
  /** Who the walker can talk to and who is speaking. */
  talk: TalkLink;
  /** Brick Island's tide, whose bubble over the player's head the scene places. */
  tide?: Tide | null;
  /** What the player's minifigure wears: the hats won for finished jobs. */
  outfit?: MinifigOutfit;
  /** Brick Island's little jobs: their helpers, what to find and where to go (see `quests.ts`). */
  quests?: {
    view: QuestView;
    onEvent: (event: QuestEvent) => void;
    /** Filled with where the helpers stand. */
    positions: Positions;
  };
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
    () => ({ ...props.spawn, x: props.spawn.x - half, z: half - props.spawn.z }),
    [props.spawn, half],
  );
  // One map for the scene's lifetime: chunks register their batches in it as they mount.
  const [drawings] = useState(() => new Map<string, ChunkDrawing>());
  // Which chunks are built and drawn in full, so their far look can give way.
  const [shown] = useState(() => new ShownChunks());
  // The debug window's batch figures, summed over every chunk's batch.
  const [summed] = useState(() => ({ current: new SummedBatches(drawings) }));
  const ownProbe = useRef<WalkProbe | null>(null);
  const probe = props.probe ?? ownProbe;
  const { debug } = props;
  const dpr = useCappedDpr();
  const focus = useMemo(() => new Vector3(start.x, GROUND_TOP, start.z), [start]);
  return (
    <Canvas
      shadows
      frameloop="demand"
      camera={{ position: [0, 30, 60], fov: 70, near: 0.05, far: 600 }}
      gl={{ antialias: false }}
      dpr={dpr}
      aria-label={game().title}
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
          shown={shown}
          focus={focus}
        />
      ))}
      <FarLayer store={props.farChunks} shown={shown} />
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
        riding={props.driving !== null}
        active={props.playing}
        outfit={props.outfit}
      />
      <People
        chunks={chunks}
        terrain={props.terrain}
        centre={props.centre}
        world={props.walkWorld}
        buildArea={buildArea}
        probe={probe}
        talk={props.driving === null ? props.talk : undefined}
        positions={props.quests?.positions}
      />
      {props.quests && (
        <QuestMarks
          view={props.quests.view}
          world={props.walkWorld}
          terrain={props.terrain}
          buildArea={buildArea}
          probe={probe}
          positions={props.quests.positions}
          onEvent={props.quests.onEvent}
        />
      )}
      {props.vehicles.length > 0 && (
        <Vehicles
          vehicles={props.vehicles}
          world={props.walkWorld}
          probe={probe}
          driving={props.driving}
          onDrive={props.onDrive}
          onNear={props.onNear}
          view={props.view}
          onViewChange={props.onViewChange}
          active={props.playing}
        />
      )}
      <EdgeDimmer drawings={drawings} clock={props.clock} />
      <ChunkWatcher probe={probe} buildArea={buildArea} onChunk={props.onChunk} />
      {props.tide && <HeadAnchor probe={probe} tide={props.tide} />}
      {props.map && <MapProbe probe={probe} store={props.map} buildArea={buildArea} />}
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
 * Levels of detail by studs from the camera. A full chunk is about 85,000 triangles and 160,000
 * edge segments; without studs it is a fifth of the triangles and half the edges, and edges
 * and studs are a pixel or two across well before the world's reach.
 */
const STUDS = { low: 20, tiny: 44, none: 90, margin: 5 } as const;
type StudLevel = 'full' | 'low' | 'tiny' | 'none';
const STUD_LEVELS: readonly StudLevel[] = ['full', 'low', 'tiny', 'none'];
const STUD_LINES = [STUDS.low, STUDS.tiny, STUDS.none];
/** The stud level for a distance, holding on to `was` for a margin so a chunk on the line doesn't flip. */
function studLevel(distance: number, was: StudLevel): StudLevel {
  const held = STUD_LEVELS.indexOf(was);
  let level = 0;
  STUD_LINES.forEach((line, index) => {
    // A line is crossed outwards at the line and back inwards a margin before it.
    if (distance > line - (held > index ? STUDS.margin : 0)) level = index + 1;
  });
  return STUD_LEVELS[level];
}
/** Conditional edges go first, then every edge. */
const EDGES = { all: 14, plain: 28 } as const;

/** Studs from the camera within which a chunk can cast into the shadows (they cover about 48). */
const SHADOW_REACH = 56;

/** The camera's view as a frustum, worked out once a frame however many chunks ask. */
const sharedFrustum = { time: -1, frustum: new Frustum(), matrix: new Matrix4() };
function viewFrustum(camera: Camera, time: number) {
  if (sharedFrustum.time !== time) {
    sharedFrustum.time = time;
    sharedFrustum.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    sharedFrustum.frustum.setFromProjectionMatrix(sharedFrustum.matrix);
  }
  return sharedFrustum.frustum;
}

/** The height the ground mostly stays under, in scene units: above it, height adds distance. */
const GROUND_TOP = 12;
/** The canvas camera's height before anything moves it (see `camera` on the Canvas). */
const DEFAULT_CAMERA_HEIGHT = 30;

/**
 * How far the camera is from the nearest point of a chunk, in studs: along the ground, plus how
 * high it flies above the land, so everything shrinks to a few pixels from up in the air.
 */
function chunkDistance(chunk: string, buildArea: number, camera: Vector3) {
  const [cx, cz] = chunk.split(',').map(Number);
  const half = buildArea / 2;
  const x0 = cx * CHUNK - half;
  const z1 = half - cz * CHUNK;
  const dx = Math.max(x0 - camera.x, 0, camera.x - (x0 + CHUNK));
  const dz = Math.max(z1 - CHUNK - camera.z, 0, camera.z - z1);
  return Math.hypot(dx, dz, Math.max(camera.y - GROUND_TOP, 0));
}

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
  shown,
  focus,
}: {
  chunk: string;
  pieces: readonly Brick[];
  models: Record<string, Group>;
  buildArea: number;
  drawings: Map<string, ChunkDrawing>;
  shown: ShownChunks;
  /** Where the walk starts, in scene units, for chunks that mount before the camera is placed. */
  focus: Vector3;
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
  // Distance levels of detail: a chunk away from the camera loses its studs (rebuilt, so only
  // when it crosses the line) and then its edges (a visibility switch every frame).
  const camera = useThree((state) => state.camera);
  // The first chunks mount before the walker has moved the camera off r3f's default, so they
  // judge from where the walk starts: judging from the default would build every chunk wrongly
  // and rebuild it a moment later.
  const [far, setFar] = useState<StudLevel>(() => {
    const here = camera.position.y === DEFAULT_CAMERA_HEIGHT ? focus : camera.position;
    return studLevel(chunkDistance(chunk, buildArea, here), 'full');
  });
  useFrame((state) => {
    native.cullPartially(viewFrustum(state.camera, state.clock.elapsedTime));
    const distance = chunkDistance(chunk, buildArea, camera.position);
    native.setEdges(distance < EDGES.all ? 'all' : distance < EDGES.plain ? 'plain' : 'none');
    setFar((was) => studLevel(distance, was));
  });
  useEffect(() => {
    drawings.set(chunk, { native, objects: [native.object, simple.object] });
    return () => {
      drawings.delete(chunk);
    };
  }, [chunk, drawings, native, simple]);
  const invalidate = useThree((state) => state.invalidate);
  /** Whether the batch has been filled once: a new chunk is built later, edits at once. */
  const filled = useRef(false);
  // A new chunk stays hidden while it is built a slice a frame, its far look standing in, and
  // shows whole in the frame the far look goes: no hole, and no chunk filling in piece by piece.
  const [ready, setReady] = useState(false);
  useEffect(() => () => shown.delete(chunk), [shown, chunk]);
  useLayoutEffect(() => {
    const entries = split.batched;
    native.setStudLevel(far);
    const redraw = () => {
      // A chunk past the reach of the shadows changes nothing in them: asking for them would
      // draw every caster again, a frame of twice the work, for each chunk that arrives.
      if (chunkDistance(chunk, buildArea, camera.position) < SHADOW_REACH) requestShadows();
      invalidate();
    };
    const done = (complete: boolean) => {
      if (!complete) return;
      setReady(true);
      shown.add(chunk);
      redraw();
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
    } else if (native.likelyChanges(entries, buildArea) < 200) {
      // An edit touches a piece or two and shows in the same frame.
      native.update(entries, buildArea);
      done(true);
    } else void build();
    if (simple.update(split.fallback, buildArea)) redraw();
    return () => {
      cancelled = true;
    };
  }, [native, simple, split, buildArea, invalidate, shown, chunk, far, camera]);
  useEffect(
    () => () => {
      native.dispose();
      simple.dispose();
    },
    [native, simple],
  );
  return (
    <>
      <primitive object={native.object} visible={ready} dispose={null} />
      <primitive object={simple.object} visible={ready} dispose={null} />
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

/** Keeps a screen point over the player's head each frame, for a speech bubble of their own. */
function HeadAnchor({ probe, tide }: { probe: { current: WalkProbe | null }; tide: Tide }) {
  const { camera, size } = useThree();
  const [head] = useState(() => new Vector3());
  useFrame(() => {
    const walker = probe.current?.walker;
    if (!walker) return;
    head.set(walker.x, walker.y + MINIFIG.height + 0.6, walker.z).project(camera);
    // Behind the camera, the projection lands mirrored on screen.
    tide.placeHead(((head.x + 1) / 2) * size.width, ((1 - head.y) / 2) * size.height, head.z < 1);
  });
  return null;
}

/** A brick layer of ground, in scene units: three plates. */
const LAYER = 3 * PLATE_HEIGHT;
/** How far a job helper strays from their spot, in studs. */
const HELPER_LEASH = 2.5;

/**
 * The people and animals living in the loaded chunks round the walker, strolling about their
 * homes, and on Brick Island the farm's animals in its pastures.
 */
function People({
  chunks,
  terrain,
  centre,
  world,
  buildArea,
  probe,
  talk,
  positions,
}: {
  chunks: Chunks;
  terrain: Terrain;
  centre: readonly [number, number];
  world: WalkWorld;
  buildArea: number;
  probe: { current: WalkProbe | null };
  talk?: TalkLink;
  /** Where the job helpers stand, kept for their markers; on Brick Island only. */
  positions?: Positions;
}) {
  const half = buildArea / 2;
  const [cx, cz] = centre;
  // Which chunks are loaded, for the rules to check: kept up to date in place, so everyone's
  // rules see the latest without being remade.
  const [loaded] = useState(() => new Set<string>());
  useEffect(() => {
    loaded.clear();
    for (const key of chunks.keys()) loaded.add(key);
  }, [loaded, chunks]);
  // Only which chunks are in counts, not their pieces: an edit keeps everyone where they are.
  // A chunk's people move in once the chunks round it are in too: a house or barn reaching over
  // from a neighbour would otherwise land on top of whoever stands there.
  const settled = (x: number, z: number) => {
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) if (!chunks.has(chunkKey(x + dx, z + dz))) return false;
    return true;
  };
  const near: string[] = [];
  for (let dz = -NPC_RADIUS; dz <= NPC_RADIUS; dz++)
    for (let dx = -NPC_RADIUS; dx <= NPC_RADIUS; dx++)
      if (settled(cx + dx, cz + dz)) near.push(chunkKey(cx + dx, cz + dz));
  const nearKey = near.join(';');
  const isLoaded = useCallback((x: number, z: number) => loaded.has(chunkKey(x, z)), [loaded]);
  const farm = useMemo(
    () => (game().world === 'island' ? farmAnimals(terrain, FARM) : []),
    [terrain],
  );
  const specs = useMemo<WandererSpec[]>(() => {
    const keys = new Set(nearKey ? nearKey.split(';') : []);
    /** Scene x and z, and the height to look for ground from: inside the top brick, so it
     * climbs onto the ground, not out of a cave below. */
    const at = (spot: { x: number; z: number; ground: number }) => ({
      x: spot.x - half,
      z: half - spot.z,
      y: spot.ground * LAYER - LAYER / 2,
    });
    const animal = (beast: Animal): WandererSpec => ({
      id: beast.id,
      ...at(beast),
      look: { kind: 'animal', parts: beast.species.parts, gait: beast.species.gait },
      temper: beast.species.temper,
      pace: beast.species.pace,
      seed: beast.seed,
      rules: animalRules(terrain, buildArea, isLoaded, beast.pasture),
    });
    const specs = [...keys].flatMap((key) => {
      const [x, z] = key.split(',').map(Number);
      return [
        ...residentsOf(terrain, x, z).map((resident): WandererSpec => ({
          id: resident.id,
          ...at(resident),
          look: { kind: 'minifig', outfit: resident.outfit },
          seed: resident.seed,
        })),
        ...wildlifeOf(terrain, x, z).map(animal),
      ];
    });
    for (const beast of farm)
      if (keys.has(chunkKey(Math.floor(beast.x / CHUNK), Math.floor(beast.z / CHUNK))))
        specs.push(animal(beast));
    // The job helpers stay close to where they stand, so they are easy to find again.
    const helper = (id: string, person: Helper): WandererSpec | null => {
      if (!keys.has(chunkKey(Math.floor(person.x / CHUNK), Math.floor(person.z / CHUNK))))
        return null;
      const ground = terrain.column(Math.floor(person.x), Math.floor(person.z)).height;
      const shared = wanderRules(terrain, buildArea, isLoaded);
      return {
        id,
        ...at({ ...person, ground }),
        look: { kind: 'minifig', outfit: person.outfit },
        seed: Math.floor(hash2(911, Math.floor(person.x), Math.floor(person.z)) * 2 ** 31),
        temper: 'friendly',
        pace: 0.25,
        rules: { leash: HELPER_LEASH, canWalk: shared.canWalk },
      };
    };
    if (positions)
      for (const quest of QUESTS) {
        const giver = helper(giverId(quest), quest.giver);
        if (giver) specs.push(giver);
        const { goal } = quest;
        const taker =
          goal.kind === 'take' && 'outfit' in goal.to ? helper(takerId(quest), goal.to) : null;
        if (taker) specs.push(taker);
      }
    return specs;
  }, [nearKey, terrain, half, farm, buildArea, isLoaded, positions]);
  const rules = useMemo(
    () => wanderRules(terrain, buildArea, isLoaded),
    [terrain, buildArea, isLoaded],
  );
  const player = () => probe.current?.walker ?? null;
  return (
    <Wanderers
      world={world}
      specs={specs}
      rules={rules}
      player={player}
      talk={talk}
      positions={positions}
    />
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
