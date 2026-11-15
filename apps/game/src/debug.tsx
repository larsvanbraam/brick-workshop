import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments } from 'three';
import { PLATE_HEIGHT } from '@brick-workshop/engine';
import type { Brick } from '@brick-workshop/engine';
import { MINIFIG } from '@brick-workshop/walk/walk';
import type { WalkBox } from '@brick-workshop/walk/walk';
import type { WalkProbe } from '@brick-workshop/walk/walk-view';
import type { Aim } from './build.ts';
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
  clock: DayClock;
}) {
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
          {world.seed} · generator v{world.version} · {Math.round(world.generationMs)} ms
        </dd>
        <dt>Pieces</dt>
        <dd>
          {world.ground.toLocaleString('en-US')} ground · {world.trees.toLocaleString('en-US')}{' '}
          plants · {world.player} yours
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
      </fieldset>
    </>
  );
}
