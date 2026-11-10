import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { LineSegments, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import type { Box3, Object3D } from 'three';
import type { CameraControls } from '@react-three/drei';
import type { BatchStats, LDrawBatch } from './ldraw-batches';
import type { PointerTarget } from './Scene';
import './scene-debug.css';

/**
 * Renderer debugging: an overlay with frame, GPU and batch statistics plus a few visual helpers.
 * Toggle it with the backtick key (`), or open the app with `?debug` in the URL. The chosen
 * options are remembered per browser.
 */
export interface DebugOptions {
  enabled: boolean;
  /** Draws every lit surface as wireframe. */
  wireframe: boolean;
  /** Hides LDraw edge and conditional lines. */
  hideEdges: boolean;
  /** Boxes around bricks drawn outside the batch: fallbacks, translucent colors, mirrored parts. */
  unbatched: boolean;
  /** The box the camera frames, around every visible brick. */
  bounds: boolean;
  axes: boolean;
}

const STORAGE_KEY = 'brick-workshop-debug-v1';
const DEFAULTS: DebugOptions = {
  enabled: false,
  wireframe: false,
  hideEdges: false,
  unbatched: false,
  bounds: false,
  axes: false,
};

function loadOptions(): DebugOptions {
  let saved: Partial<DebugOptions> = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<DebugOptions>;
  } catch {
    // Storage may be blocked; debugging still works for this visit.
  }
  const forced =
    typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');
  return { ...DEFAULTS, ...saved, ...(forced ? { enabled: true } : {}) };
}

function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

export function useDebugOptions() {
  const [options, setOptions] = useState(loadOptions);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
    } catch {
      // Not remembered, which is fine.
    }
  }, [options]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.code !== 'Backquote' || event.repeat || isTyping(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      setOptions((current) => ({ ...current, enabled: !current.enabled }));
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, []);
  return [options, setOptions] as const;
}

export interface DebugSnapshot {
  /** Frames rendered over the last second; the canvas only renders on demand. */
  fps: number;
  /** CPU time of the last frame: frame callbacks, scene render and post-processing. */
  frameMs: number;
  frames: number;
  calls: number;
  triangles: number;
  lines: number;
  points: number;
  geometries: number;
  textures: number;
  programs: number;
  width: number;
  height: number;
  dpr: number;
  camera: [number, number, number];
  target: [number, number, number] | null;
  distance: number | null;
  batch: BatchStats | null;
}

/** Frame statistics, published from inside the canvas a few times a second. */
export class DebugStore {
  private snapshot: DebugSnapshot | null = null;
  private hoverTarget: PointerTarget | null = null;
  private readonly listeners = new Set<() => void>();
  private lastPublish = 0;
  private trailing: ReturnType<typeof setTimeout> | undefined;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  getHover = () => this.hoverTarget;

  publish(snapshot: DebugSnapshot) {
    this.snapshot = snapshot;
    clearTimeout(this.trailing);
    const now = performance.now();
    // At most five updates a second, but the last frame always lands.
    if (now - this.lastPublish >= 200) this.emit(now);
    else this.trailing = setTimeout(() => this.emit(performance.now()), 200);
  }

  hover(target: PointerTarget | null) {
    this.hoverTarget = target;
    this.emit(performance.now());
  }

  dispose() {
    clearTimeout(this.trailing);
    this.listeners.clear();
  }

  private emit(now: number) {
    this.lastPublish = now;
    // A fresh object, so useSyncExternalStore sees a change even if the numbers did not.
    if (this.snapshot) this.snapshot = { ...this.snapshot };
    for (const listener of this.listeners) listener();
  }
}

const round = (vector: Vector3) =>
  vector.toArray().map((value) => Math.round(value * 100) / 100) as [number, number, number];

/**
 * Lives inside the canvas: reads the renderer's counters each frame and applies the wireframe
 * and edge switches. `gl.info` is reset by hand so totals cover the whole frame, shadow maps and
 * post-processing passes included, instead of only the last render call.
 */
export function DebugProbe({
  store,
  options,
  batch,
}: {
  store: DebugStore;
  options: DebugOptions;
  batch: RefObject<LDrawBatch | null>;
}) {
  const get = useThree((state) => state.get);
  const invalidate = useThree((state) => state.invalidate);
  const frames = useRef(0);
  const stamps = useRef<number[]>([]);
  const frameMs = useRef(0);
  const wired = useRef(new Set<MeshStandardMaterial>());
  const hidden = useRef(new Set<Object3D>());

  useEffect(() => {
    const { info } = get().gl;
    const previous = info.autoReset;
    info.autoReset = false;
    info.reset();
    invalidate();
    return () => {
      info.autoReset = previous;
    };
  }, [get, invalidate]);

  useEffect(() => {
    // Draw a frame so switches take effect right away, and undo them when they turn off.
    const wiredNow = wired.current;
    const hiddenNow = hidden.current;
    if (!options.wireframe) {
      for (const material of wiredNow) material.wireframe = false;
      wiredNow.clear();
    }
    if (!options.hideEdges) {
      for (const object of hiddenNow) object.visible = true;
      hiddenNow.clear();
    }
    invalidate();
  }, [options.wireframe, options.hideEdges, invalidate]);

  useEffect(
    () => () => {
      for (const material of wired.current) material.wireframe = false;
      for (const object of hidden.current) object.visible = true;
      wired.current.clear();
      hidden.current.clear();
    },
    [],
  );

  useFrame((state) => {
    const { info } = state.gl;
    // The counters still hold the previous frame, since nothing has rendered yet this frame.
    const render = { ...info.render };
    info.reset();
    info.autoReset = false;

    const start = performance.now();
    // Microtasks run once the whole animation frame callback, render included, has returned.
    queueMicrotask(() => {
      frameMs.current = performance.now() - start;
    });
    frames.current++;
    stamps.current.push(start);
    while (stamps.current[0] < start - 1000) stamps.current.shift();

    if (options.wireframe || options.hideEdges)
      state.scene.traverse((object) => {
        if (object.userData.debug) return;
        if (options.hideEdges && object instanceof LineSegments && object.visible) {
          object.visible = false;
          hidden.current.add(object);
        }
        if (options.wireframe && object instanceof Mesh)
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material])
            if (material instanceof MeshStandardMaterial && !material.wireframe) {
              material.wireframe = true;
              wired.current.add(material);
            }
      });

    const controls = state.controls as unknown as CameraControls | null;
    const target = controls?.getTarget ? controls.getTarget(new Vector3()) : null;
    store.publish({
      fps: stamps.current.length,
      frameMs: frameMs.current,
      frames: frames.current,
      calls: render.calls,
      triangles: render.triangles,
      lines: render.lines,
      points: render.points,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      width: state.size.width,
      height: state.size.height,
      dpr: state.viewport.dpr,
      camera: round(state.camera.position),
      target: target ? round(target) : null,
      distance: controls?.distance !== undefined ? Math.round(controls.distance * 100) / 100 : null,
      batch: batch.current?.stats() ?? null,
    });
  }, -1000);

  return null;
}

/** Wireframe boxes for the helpers; tagged so the edge switch leaves them alone. */
export function DebugHelpers({
  options,
  bounds,
  unbatched,
  buildArea,
}: {
  options: DebugOptions;
  bounds: Box3 | null;
  unbatched: Box3[];
  buildArea: number;
}) {
  return (
    <group raycast={() => null} userData={{ debug: true }}>
      {options.bounds && bounds && (
        <box3Helper args={[bounds, 0x0a84ff]} userData={{ debug: true }} />
      )}
      {options.unbatched &&
        unbatched.map((box, index) => (
          <box3Helper key={index} args={[box, 0xff9f0a]} userData={{ debug: true }} />
        ))}
      {options.axes && (
        <axesHelper args={[buildArea / 2]} position={[0, 0.02, 0]} userData={{ debug: true }} />
      )}
    </group>
  );
}

const number = (value: number) => value.toLocaleString('en-US');
const compact = (value: number) =>
  value.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const vector = (value: readonly number[]) => value.map((entry) => entry.toFixed(2)).join(', ');

const SWITCHES: {
  key: Exclude<keyof DebugOptions, 'enabled'>;
  label: string;
}[] = [
  { key: 'wireframe', label: 'Wireframe' },
  { key: 'hideEdges', label: 'Hide edges' },
  { key: 'unbatched', label: 'Unbatched boxes' },
  { key: 'bounds', label: 'Scene bounds' },
  { key: 'axes', label: 'Axes' },
];

export interface DebugCounts {
  visible: number;
  batched: number;
  separate: number;
  /** Separate bricks without an LDraw model, drawn as simple boxes and studs. */
  fallback: number;
  total: number;
}

export function DebugOverlay({
  store,
  options,
  onChange,
  counts,
}: {
  store: DebugStore;
  options: DebugOptions;
  onChange: (options: DebugOptions) => void;
  counts: DebugCounts;
}) {
  const stats = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const hover = useSyncExternalStore(store.subscribe, store.getHover);
  const [layersOpen, setLayersOpen] = useState(false);
  return (
    <aside className="scene-debug" aria-label="Renderer debug information">
      <header>
        <strong>Renderer debug</strong>
        <button
          type="button"
          onClick={() => onChange({ ...options, enabled: false })}
          aria-label="Close debug overlay"
          title="Close (`)"
        >
          ×
        </button>
      </header>
      {stats ? (
        <dl>
          <dt>Frame</dt>
          <dd>
            {stats.frameMs.toFixed(2)} ms · {stats.fps}/s · #{number(stats.frames)}
          </dd>
          <dt>Draw calls</dt>
          <dd>{number(stats.calls)}</dd>
          <dt>Triangles</dt>
          <dd>{number(stats.triangles)}</dd>
          <dt title="Wireframe surfaces count as lines">Lines</dt>
          <dd>{number(stats.lines)}</dd>
          <dt>GPU memory</dt>
          <dd>
            {number(stats.geometries)} geo · {number(stats.textures)} tex · {stats.programs} prog
          </dd>
          <dt>Canvas</dt>
          <dd>
            {stats.width}×{stats.height} @ {stats.dpr}x
          </dd>
          <dt>Camera</dt>
          <dd>{vector(stats.camera)}</dd>
          {stats.target && (
            <>
              <dt>Target</dt>
              <dd>
                {vector(stats.target)}
                {stats.distance !== null && ` · d ${stats.distance.toFixed(2)}`}
              </dd>
            </>
          )}
        </dl>
      ) : (
        <p className="scene-debug-muted">Waiting for a frame…</p>
      )}
      <dl>
        <dt>Bricks</dt>
        <dd>
          {number(counts.visible)} / {number(counts.total)} visible
        </dd>
        <dt>Batched</dt>
        <dd>{number(counts.batched)}</dd>
        <dt>Separate</dt>
        <dd>
          {number(counts.separate)}
          {counts.fallback > 0 && ` (${number(counts.fallback)} fallback)`}
        </dd>
        {stats?.batch && (
          <>
            <dt>Batch</dt>
            <dd>
              {stats.batch.layers.length} finishes · {number(stats.batch.looks)} looks
            </dd>
            <dt>Hidden</dt>
            <dd>
              {number(stats.batch.coveredStuds)} studs · {number(stats.batch.closedUndersides)}{' '}
              undersides
            </dd>
            <dt>Batch edges</dt>
            <dd>
              {number(stats.batch.edgeSegments)} + {number(stats.batch.conditionalSegments)} cond.
            </dd>
          </>
        )}
        <dt>Hover</dt>
        <dd>
          {hover
            ? `${hover.face} ${hover.brick ? hover.brick.partId : ''} @ ${hover.x.toFixed(1)}, ${hover.z.toFixed(1)}`
            : '—'}
        </dd>
      </dl>
      {stats?.batch && stats.batch.layers.length > 0 && (
        <details open={layersOpen} onToggle={(event) => setLayersOpen(event.currentTarget.open)}>
          <summary>Batch layers</summary>
          <table>
            <thead>
              <tr>
                <th>Finish</th>
                <th>Inst.</th>
                <th>Geo</th>
                <th>Vertices</th>
              </tr>
            </thead>
            <tbody>
              {stats.batch.layers.map((layer) => (
                <tr key={layer.finish}>
                  <td>{layer.finish}</td>
                  <td title={`${layer.free} free slots, ${layer.maxInstances} allocated`}>
                    {number(layer.instances)}
                    {layer.free > 0 && `+${layer.free}`}
                  </td>
                  <td>{layer.geometries}</td>
                  <td title={`${number(layer.indices)} / ${number(layer.maxIndices)} indices used`}>
                    {Math.round((layer.vertices / Math.max(layer.maxVertices, 1)) * 100)}% of{' '}
                    {compact(layer.maxVertices)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      <fieldset>
        {SWITCHES.map(({ key, label }) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={options[key]}
              onChange={(event) => onChange({ ...options, [key]: event.target.checked })}
            />
            {label}
          </label>
        ))}
      </fieldset>
    </aside>
  );
}
