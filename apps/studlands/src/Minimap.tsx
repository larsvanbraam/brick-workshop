import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Vector3 } from 'three';
import type { WalkProbe } from '@brick-workshop/walk/walk-view';
import { LANDMARKS } from './world/island/map.ts';
import { Key } from './input-hint.tsx';
import {
  MAP_BOUNDS,
  MAP_HEIGHT,
  MAP_STEP,
  MAP_WIDTH,
  drawIslandMap,
} from './world/island/minimap.ts';

/**
 * The map of Brick Island: a small one in the corner that follows the walker, north up, with
 * the landmarks near it; and the whole island with every landmark named, opened with `N`.
 */

/** A pin of the game's own: a job's helper, or where to go next for it (kept on the map's edge). */
export interface MapPin {
  x: number;
  z: number;
  icon: string;
  name?: string;
  target?: boolean;
}

/** Where the walker is, in world studs, and which way it looks: 0 faces south, +x is east. */
export interface MapPosition {
  x: number;
  z: number;
  /** The camera's heading, as the walk view keeps it: 0 looks toward world +z, positive turns left. */
  yaw: number;
  /**
   * Where the camera looks on the map, as an angle with x east and y south (so a turn to the
   * right is clockwise), taken from its real direction: the yaw alone is unreliable past a
   * quarter turn.
   */
  heading: number;
}

/** The walker's position for the map, a few times a second. */
export class MapStore {
  position: MapPosition | null = null;
  private readonly listeners = new Set<() => void>();
  private last = 0;

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(position: MapPosition) {
    const now = performance.now();
    if (now - this.last < 80) return;
    this.last = now;
    this.position = position;
    for (const listener of this.listeners) listener();
  }
}

/** Reads the walker and the camera's heading each frame, inside the canvas. */
export function MapProbe({
  probe,
  store,
  buildArea,
}: {
  probe: { current: WalkProbe | null };
  store: MapStore;
  buildArea: number;
}) {
  const [direction] = useState(() => new Vector3());
  useFrame((state) => {
    const walker = probe.current?.walker;
    if (!walker) return;
    // The scene's z runs the other way to the world's.
    state.camera.getWorldDirection(direction);
    store.publish({
      heading: Math.atan2(-direction.z, direction.x),
      x: walker.x + buildArea / 2,
      z: buildArea / 2 - walker.z,
      yaw: state.camera.rotation.y,
    });
  });
  return null;
}

/** The island's picture, drawn once and shared by both maps. */
let picture: HTMLCanvasElement | null = null;
function islandPicture(seed: number) {
  if (picture) return picture;
  picture = document.createElement('canvas');
  picture.width = MAP_WIDTH;
  picture.height = MAP_HEIGHT;
  const context = picture.getContext('2d')!;
  context.putImageData(
    new ImageData(drawIslandMap(seed) as Uint8ClampedArray<ArrayBuffer>, MAP_WIDTH, MAP_HEIGHT),
    0,
    0,
  );
  return picture;
}

/** The walker's arrow, pointing the way it looks. */
function drawArrow(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  yaw: number,
  size: number,
) {
  // Facing world (−sin yaw, cos yaw); on the map x runs east and y south, like world z.
  const angle = Math.atan2(Math.cos(yaw), -Math.sin(yaw));
  context.save();
  context.translate(x, y);
  context.rotate(angle);
  context.beginPath();
  context.moveTo(size, 0);
  context.lineTo(-size * 0.7, size * 0.65);
  context.lineTo(-size * 0.35, 0);
  context.lineTo(-size * 0.7, -size * 0.65);
  context.closePath();
  context.fillStyle = '#ffd23f';
  context.strokeStyle = '#3a2a00';
  context.lineWidth = Math.max(1.5, size * 0.18);
  context.lineJoin = 'round';
  context.fill();
  context.stroke();
  context.restore();
}

function drawPin(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  icon: string,
  size: number,
  label?: string,
  ring?: string,
) {
  if (ring) {
    context.beginPath();
    context.arc(x, y, size * 1.05, 0, Math.PI * 2);
    context.fillStyle = ring;
    context.fill();
  }
  context.beginPath();
  context.arc(x, y, size * 0.75, 0, Math.PI * 2);
  context.fillStyle = 'rgb(255 255 255 / 0.92)';
  context.strokeStyle = 'rgb(0 0 0 / 0.35)';
  context.lineWidth = 1.5;
  context.fill();
  context.stroke();
  context.font = `${size}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(icon, x, y + size * 0.05);
  if (!label) return;
  context.font = `600 ${Math.round(size * 0.62)}px system-ui, sans-serif`;
  context.lineWidth = 3.5;
  context.strokeStyle = 'rgb(20 20 20 / 0.75)';
  context.fillStyle = '#ffffff';
  context.strokeText(label, x, y + size * 1.35);
  context.fillText(label, x, y + size * 1.35);
}

/** The compass hides once the goal is this close, in studs, and with no job on it only points at a helper this near. */
const COMPASS_STOP = 14;
const COMPASS_RANGE = 90;

/**
 * A gold arrow that circles the corner map and points the way the job in hand sends the walker,
 * as seen from where the walker looks (up is straight ahead), whatever way the map is turned.
 * With no job on it points at the nearest helper with a job, within range. It hides once the
 * goal is close.
 */
function Compass({ store, pins }: { store: MapStore; pins?: readonly MapPin[] }) {
  const ring = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const update = () => {
      const element = ring.current;
      const position = store.position;
      if (!element || !position) return;
      // With a job on, the arrow leads to where it sends the walker; otherwise to the nearest
      // helper with a job to give, if one is within range.
      const all = pins ?? [];
      const goals = all.some((each) => each.target)
        ? all.filter((each) => each.target)
        : all.filter(
            (each) => Math.hypot(each.x - position.x, each.z - position.z) <= COMPASS_RANGE,
          );
      let nearest: { dx: number; dz: number; studs: number } | null = null;
      for (const each of goals) {
        const studs = Math.hypot(each.x - position.x, each.z - position.z);
        if (!nearest || studs < nearest.studs)
          nearest = { dx: each.x - position.x, dz: each.z - position.z, studs };
      }
      if (!nearest || nearest.studs < COMPASS_STOP) {
        element.style.opacity = '0';
        return;
      }
      // Up is the way the walker looks. The scene is the world mirrored in z, so a turn to the
      // right on screen is a turn counterclockwise on the map: the arrow turns by the angle from
      // the goal back to the heading, and a goal to the right points right.
      const bearing = Math.atan2(nearest.dz, nearest.dx);
      element.style.opacity = '1';
      element.style.transform = `rotate(${((position.heading - bearing) * 180) / Math.PI}deg)`;
    };
    update();
    return store.subscribe(update);
  }, [store, pins]);
  return (
    <div className="minimap-compass" aria-hidden>
      <div className="minimap-compass-ring" ref={ring}>
        <svg viewBox="0 0 24 24" className="minimap-compass-arrow">
          <path
            d="M12 1.5 L22 21 L12 15.5 L2 21 Z"
            fill="#ffd23f"
            stroke="#3a2a00"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}

/** Studs across the corner map. */
const NEAR = 220;
/** The corner map's size in CSS pixels. */
const CORNER = 188;

export function Minimap({
  seed,
  store,
  open,
  onClose,
  pins,
}: {
  seed: number;
  store: MapStore;
  open: boolean;
  onClose: () => void;
  /** The game's own pins, over the landmarks. */
  pins?: readonly MapPin[];
}) {
  const corner = useRef<HTMLCanvasElement>(null);
  const full = useRef<HTMLCanvasElement>(null);
  // The picture takes a moment to draw, so it waits for the first quiet moment.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      islandPicture(seed);
      setReady(true);
    }, 50);
    return () => clearTimeout(timer);
  }, [seed]);

  useEffect(() => {
    if (!ready) return;
    const draw = () => {
      const position = store.position;
      const canvas = open ? full.current : corner.current;
      if (!canvas || !position) return;
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== Math.round(width * ratio)) canvas.width = Math.round(width * ratio);
      if (canvas.height !== Math.round(height * ratio)) canvas.height = Math.round(height * ratio);
      const context = canvas.getContext('2d')!;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.imageSmoothingEnabled = false;
      const image = islandPicture(seed);
      // World studs to canvas pixels: the island whole, or the walker's surroundings.
      const scale = open
        ? Math.min(
            width / (MAP_BOUNDS.x1 - MAP_BOUNDS.x0),
            height / (MAP_BOUNDS.z1 - MAP_BOUNDS.z0),
          )
        : width / NEAR;
      const originX = open
        ? MAP_BOUNDS.x0 - (width / scale - (MAP_BOUNDS.x1 - MAP_BOUNDS.x0)) / 2
        : position.x - NEAR / 2;
      const originZ = open
        ? MAP_BOUNDS.z0 - (height / scale - (MAP_BOUNDS.z1 - MAP_BOUNDS.z0)) / 2
        : position.z - height / scale / 2;
      const toX = (x: number) => (x - originX) * scale;
      const toY = (z: number) => (z - originZ) * scale;
      context.fillStyle = '#3a78bd';
      context.fillRect(0, 0, width, height);
      context.drawImage(
        image,
        toX(MAP_BOUNDS.x0),
        toY(MAP_BOUNDS.z0),
        MAP_WIDTH * MAP_STEP * scale,
        MAP_HEIGHT * MAP_STEP * scale,
      );
      const pin = open ? Math.max(18, Math.min(28, width / 40)) : 15;
      for (const landmark of LANDMARKS) {
        const x = toX(landmark.x);
        const y = toY(landmark.z);
        if (x < -pin || y < -pin || x > width + pin || y > height + pin) continue;
        drawPin(context, x, y, landmark.icon, pin, open ? landmark.name : undefined);
      }
      for (const each of pins ?? []) {
        let x = toX(each.x);
        let y = toY(each.z);
        if (each.target && !open) {
          // Kept inside the round corner map, so the way to go always shows.
          const middle = width / 2;
          const room = middle - pin;
          const away = Math.hypot(x - middle, y - middle);
          if (away > room) {
            x = middle + ((x - middle) / away) * room;
            y = middle + ((y - middle) / away) * room;
          }
        } else if (x < -pin || y < -pin || x > width + pin || y > height + pin) continue;
        const label = open && !each.target ? each.name : undefined;
        drawPin(context, x, y, each.icon, pin, label, each.target ? '#3ee06a' : undefined);
      }
      drawArrow(context, toX(position.x), toY(position.z), position.yaw, open ? 14 : 10);
    };
    draw();
    return store.subscribe(draw);
  }, [ready, open, seed, store, pins]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', close, { capture: true });
    return () => window.removeEventListener('keydown', close, { capture: true });
  }, [open, onClose]);

  return (
    <>
      {!open && <Compass store={store} pins={pins} />}
      <canvas
        ref={corner}
        className="minimap"
        style={{ width: CORNER, height: CORNER, visibility: open ? 'hidden' : 'visible' }}
        aria-label="Map of the area round you"
        role="img"
      />
      {open && (
        <div className="island-map" role="dialog" aria-label="Island map" onClick={onClose}>
          <div className="island-map-panel">
            <h2>Brick Island</h2>
            <canvas ref={full} className="island-map-canvas" />
            <p>
              <Key k="N" pad="D-pad ↓" /> or <Key k="Esc" pad="B" /> to close
            </p>
          </div>
        </div>
      )}
    </>
  );
}
