import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments } from 'three';
import { PLATE_HEIGHT } from '@brick-workshop/engine';
import type { Brick } from '@brick-workshop/engine';
import { MINIFIG } from '@brick-workshop/walk/walk';
import type { WalkBox } from '@brick-workshop/walk/walk';
import type { WalkProbe } from '@brick-workshop/walk/walk-view';
import type { Aim } from './build.ts';
import { CHUNK } from './chunks.ts';
import type { Terrain } from './world/terrain.ts';
import { DAY_SECONDS, clockTime } from './sky.ts';
import type { DayClock } from './sky.ts';

/** Where the walker is, in build-grid studs and plates, published a few times a second. */
export interface PlayerSnapshot {
  x: number;
  y: number;
  z: number;
  grounded: boolean;
  flying: boolean;
  /** Collision boxes in the walker's world. */
  boxes: number;
}

export class PlayerStore {
  private snapshot: PlayerSnapshot | null = null;
  private readonly listeners = new Set<() => void>();
  private last = 0;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;

  publish(snapshot: PlayerSnapshot) {
    const now = performance.now();
    if (now - this.last < 200) return;
    this.last = now;
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}

/** Reads the walker each frame inside the canvas and hands it to the store. */
export function PlayerProbe({
  probe,
  store,
  buildArea,
}: {
  probe: { current: WalkProbe | null };
  store: PlayerStore;
  buildArea: number;
}) {
  useFrame(() => {
    const live = probe.current;
    if (!live) return;
    const { walker, world } = live;
    store.publish({
      x: walker.x + buildArea / 2,
      y: walker.y / PLATE_HEIGHT,
      z: buildArea / 2 - walker.z,
      grounded: walker.grounded,
      flying: walker.flying ?? false,
      boxes: world.count,
    });
  });
  return null;
}

/** How far round the walker its collision boxes are drawn, in studs. */
const COLLISION_REACH = 6;

/** Twelve edges of a box as line segment end points. */
function pushEdges(out: number[], box: WalkBox) {
  const { minX: a, maxX: b, minY: c, maxY: d, minZ: e, maxZ: f } = box;
  const corners = [
    [a, c, e],
    [b, c, e],
    [b, c, f],
    [a, c, f],
    [a, d, e],
    [b, d, e],
    [b, d, f],
    [a, d, f],
  ];
  const edges = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
  for (const index of edges) out.push(...corners[index]);
}

/**
 * The boxes the walker bumps into round it, in orange, and its own box in yellow: what decides
 * whether it walks on, steps up or stops. Redrawn a few times a second.
 */
export function CollisionBoxes({ probe }: { probe: { current: WalkProbe | null } }) {
  const lines = useMemo(() => {
    const make = (color: string) => {
      const segments = new LineSegments(
        new BufferGeometry(),
        new LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.85 }),
      );
      segments.renderOrder = 10;
      segments.frustumCulled = false;
      segments.userData.debug = true;
      segments.raycast = () => {};
      return segments;
    };
    return { world: make('#ff9f0a'), walker: make('#ffd60a') };
  }, []);
  useEffect(
    () => () => {
      for (const segments of [lines.world, lines.walker]) {
        segments.geometry.dispose();
        (segments.material as LineBasicMaterial).dispose();
      }
    },
    [lines],
  );
  const last = useRef(0);
  useFrame(({ clock }) => {
    const live = probe.current;
    if (!live || clock.elapsedTime - last.current < 0.12) return;
    last.current = clock.elapsedTime;
    const { walker, world } = live;
    const near: number[] = [];
    for (const box of world.query({
      minX: walker.x - COLLISION_REACH,
      maxX: walker.x + COLLISION_REACH,
      minY: walker.y - COLLISION_REACH,
      maxY: walker.y + MINIFIG.height + COLLISION_REACH,
      minZ: walker.z - COLLISION_REACH,
      maxZ: walker.z + COLLISION_REACH,
    }))
      pushEdges(near, box);
    const own: number[] = [];
    pushEdges(own, {
      minX: walker.x - MINIFIG.radius,
      maxX: walker.x + MINIFIG.radius,
      minY: walker.y,
      maxY: walker.y + MINIFIG.height,
      minZ: walker.z - MINIFIG.radius,
      maxZ: walker.z + MINIFIG.radius,
    });
    lines.world.geometry.setAttribute('position', new BufferAttribute(new Float32Array(near), 3));
    lines.walker.geometry.setAttribute('position', new BufferAttribute(new Float32Array(own), 3));
  });
  return (
    <>
      <primitive object={lines.world} />
      <primitive object={lines.walker} />
    </>
  );
}

export interface EditTiming {
  action: 'place' | 'break';
  ms: number;
  /** Pieces added or taken off; a break can bring loose pieces with it. */
  pieces: number;
  ok: boolean;
}

/** How the world is streaming in round the walker, read a couple of times a second. */
export interface StreamingInfo {
  /** The walker's chunk. */
  chunk: string;
  loaded: number;
  far: number;
  waiting: number;
  waitingFar: number;
  building: number;
  workers: number;
  /** Build times of the last few chunks, in ms. */
  times: readonly number[];
  pieces: number;
}

function useStreaming(read: () => StreamingInfo) {
  const reader = useRef(read);
  useEffect(() => {
    reader.current = read;
  });
  const [info, setInfo] = useState(read);
  useEffect(() => {
    const timer = setInterval(() => setInfo(reader.current()), 500);
    return () => clearInterval(timer);
  }, []);
  return info;
}

export interface WorldInfo {
  seed: number;
  version: number;
  generationMs: number;
  ground: number;
  trees: number;
  player: number;
  total: number;
}

const fixed = (value: number, digits = 1) => value.toFixed(digits);

/** The game's own readouts in the debug window, and the switch for collision boxes. */
export function GameDebugPanel({
  player,
  aim,
  ghost,
  ghostReason,
  edit,
  world,
  collision,
  onCollision,
  borders,
  onBorders,
  streaming,
  clock,
}: {
  player: PlayerStore;
  aim: Aim | null;
  ghost: Brick | null;
  ghostReason: string | null;
  edit: EditTiming | null;
  world: WorldInfo;
  collision: boolean;
  onCollision: (on: boolean) => void;
  /** Whether chunk edges are outlined on the ground. */
  borders: boolean;
  onBorders: (on: boolean) => void;
  streaming: () => StreamingInfo;
  clock: DayClock;
}) {
  const stream = useStreaming(streaming);
  const average = stream.times.length
    ? stream.times.reduce((sum, ms) => sum + ms, 0) / stream.times.length
    : 0;
  const slowest = stream.times.length ? Math.max(...stream.times) : 0;
  const live = useSyncExternalStore(player.subscribe, player.getSnapshot);
  useSyncExternalStore(clock.subscribe, clock.getSnapshot);
  const speeds: [string, number][] = [
    ['Pause', 0],
    ['1×', 1],
    ['10×', 10],
    ['60×', 60],
  ];
  const current = clock.paused ? 0 : Math.round(clock.speed * DAY_SECONDS);
  return (
    <>
      <dl>
        <dt>Player</dt>
        <dd>
          {live
            ? `${fixed(live.x)}, ${fixed(live.y)}p, ${fixed(live.z)} · ${
                live.flying ? 'flying' : live.grounded ? 'grounded' : 'airborne'
              }`
            : '—'}
        </dd>
        <dt>Aim</dt>
        <dd>
          {aim
            ? `${aim.face} ${aim.brick.partId} @ ${fixed(aim.x)}, ${fixed(aim.y)}p, ${fixed(aim.z)}`
            : '—'}
        </dd>
        <dt>Aimed piece</dt>
        <dd>{aim ? aim.brick.id : '—'}</dd>
        <dt>Ghost</dt>
        <dd>
          {ghost
            ? `${ghost.partId} r${ghost.rotation} @ ${ghost.x}, ${ghost.y}p, ${ghost.z} · ${
                ghostReason ?? 'fits'
              }`
            : '—'}
        </dd>
        <dt>Last edit</dt>
        <dd>
          {edit
            ? `${edit.action} ${edit.ok ? `${edit.pieces} piece${edit.pieces === 1 ? '' : 's'}` : 'refused'} · ${fixed(edit.ms)} ms`
            : '—'}
        </dd>
        <dt>Island</dt>
        <dd>
          {world.seed} · generator v{world.version}
        </dd>
        <dt>Pieces</dt>
        <dd>
          {world.ground.toLocaleString('en-US')} ground · {world.trees.toLocaleString('en-US')}{' '}
          plants · {world.player} yours
        </dd>
        <dt>Chunk</dt>
        <dd>{stream.chunk}</dd>
        <dt>Loaded</dt>
        <dd>
          {stream.loaded} full · {stream.far} far · {stream.pieces.toLocaleString('en-US')} pieces
        </dd>
        <dt>Streaming</dt>
        <dd>
          {stream.building} building on {stream.workers} · {stream.waiting} waiting ·{' '}
          {stream.waitingFar} far waiting
        </dd>
        <dt>Chunk build</dt>
        <dd>
          {stream.times.length ? `${fixed(average, 0)} ms · slowest ${fixed(slowest, 0)}` : '—'}
        </dd>
        <dt>Collision</dt>
        <dd>{live ? `${live.boxes.toLocaleString('en-US')} boxes` : '—'}</dd>
      </dl>
      <fieldset className="time">
        <label>
          Time {clockTime(clock.time)}
          <input
            type="range"
            min={0}
            max={1}
            step={1 / 288}
            value={clock.time}
            onChange={(event) => clock.set(Number(event.target.value))}
          />
        </label>
        <span>
          {speeds.map(([label, speed]) => (
            <button
              key={label}
              type="button"
              aria-pressed={current === speed}
              onClick={() => {
                clock.paused = speed === 0;
                if (speed) clock.speed = speed / DAY_SECONDS;
                clock.changed();
              }}
            >
              {label}
            </button>
          ))}
        </span>
      </fieldset>
      <fieldset>
        <label>
          <input
            type="checkbox"
            checked={collision}
            onChange={(event) => onCollision(event.target.checked)}
          />
          Collision boxes
        </label>
        <label>
          <input
            type="checkbox"
            checked={borders}
            onChange={(event) => onBorders(event.target.checked)}
          />
          Chunk borders
        </label>
      </fieldset>
    </>
  );
}

/** A stud's surface in scene units: three plates a layer. */
const LAYER = 3 * PLATE_HEIGHT;

/**
 * The loaded chunks' edges, traced along the ground a little above it, so seams between chunks
 * are easy to find. Follows the terrain's surface, water included, stud by stud.
 */
export function ChunkBorders({
  terrain,
  chunks,
  buildArea,
}: {
  terrain: Terrain;
  chunks: ReadonlyMap<string, unknown>;
  buildArea: number;
}) {
  const keys = [...chunks.keys()].sort().join(' ');
  const lines = useMemo(() => {
    const half = buildArea / 2;
    const points: number[] = [];
    const surface = (x: number, z: number) => {
      const column = terrain.column(Math.floor(x), Math.floor(z));
      return Math.max(column.height, column.water) * LAYER + 0.15;
    };
    // Each chunk's west and north edges, and the east and south edges where no chunk is next door.
    const edge = (ax: number, az: number, bx: number, bz: number) => {
      const steps = Math.max(Math.abs(bx - ax), Math.abs(bz - az));
      for (let step = 0; step < steps; step++) {
        const x0 = ax + ((bx - ax) * step) / steps;
        const z0 = az + ((bz - az) * step) / steps;
        const x1 = ax + ((bx - ax) * (step + 1)) / steps;
        const z1 = az + ((bz - az) * (step + 1)) / steps;
        // The higher of the two sides, so the line shows on a step.
        const y = Math.max(
          surface(x0, z0),
          surface(x0 - (bz - az ? 1 : 0), z0 - (bx - ax ? 1 : 0)),
        );
        points.push(x0 - half, y, half - z0, x1 - half, y, half - z1);
      }
    };
    for (const key of keys ? keys.split(' ') : []) {
      const [cx, cz] = key.split(',').map(Number);
      const x0 = cx * CHUNK;
      const z0 = cz * CHUNK;
      edge(x0, z0, x0 + CHUNK, z0);
      edge(x0, z0, x0, z0 + CHUNK);
      if (!chunks.has(`${cx + 1},${cz}`)) edge(x0 + CHUNK, z0, x0 + CHUNK, z0 + CHUNK);
      if (!chunks.has(`${cx},${cz + 1}`)) edge(x0, z0 + CHUNK, x0 + CHUNK, z0 + CHUNK);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(points), 3));
    const segments = new LineSegments(
      geometry,
      new LineBasicMaterial({
        color: '#ff375f',
        depthTest: false,
        transparent: true,
        opacity: 0.9,
      }),
    );
    segments.renderOrder = 11;
    segments.userData.debug = true;
    segments.raycast = () => {};
    return segments;
    // keys stands for the chunks: it changes exactly when one comes or goes.
  }, [keys, terrain, buildArea]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      lines.geometry.dispose();
      (lines.material as LineBasicMaterial).dispose();
    },
    [lines],
  );
  return <primitive object={lines} />;
}
