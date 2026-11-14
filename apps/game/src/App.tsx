import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { getPart } from '@brick-workshop/engine';
import type { Assembly, Brick } from '@brick-workshop/engine';
import { useLDrawLibrary } from '@brick-workshop/render/ldraw';
import type { WalkCamera } from '@brick-workshop/walk/walk-view';
import { placementFor, replayEdits, tryPlace, tryRemove } from './build.ts';
import type { Aim, Edit, Held } from './build.ts';
import { GameScene } from './GameScene.tsx';
import { Menu } from './Menu.tsx';
import type { MouseAction } from './GameScene.tsx';
import { PLAYER_PREFIX, isPlayerPiece } from './export.ts';
import { GameDebugPanel, PlayerStore } from './debug.tsx';
import type { EditTiming } from './debug.tsx';
import { DebugOverlay, DebugStore, useDebugOptions } from '@brick-workshop/render/scene-debug';
import { DayClock, START_TIME, clockTime, isDaytime } from './sky.ts';
import { STARTER_HOTBAR } from './hotbar.ts';
import { BrickBox, PART_DRAG, PartImage, colorHex, colorName } from './BrickBox.tsx';
import { colorsFor, getSnap, nextRotation } from './catalog.ts';
import {
  WORLD_VERSION,
  loadEdits,
  loadHotbar,
  loadSeed,
  loadTime,
  saveEdits,
  saveHotbar,
  saveSeed,
  saveTime,
} from './save.ts';
import { WORLD_SIZE } from './world/generate.ts';
import { isPlant } from './world/plants.ts';
import type { WorldMessage } from './world/worker.ts';
import type { Volcano } from './world/map.ts';

interface Loaded {
  seed: number;
  assembly: Assembly;
  spawn: { x: number; z: number };
  terrain: ReadonlySet<string>;
  generationMs: number;
  volcano: Volcano | null;
}

function newSeed() {
  return Math.floor(Math.random() * 1_000_000);
}

/** Generates a world off the main thread, so the page keeps drawing while it does. */
function useWorld(seed: number): Loaded | null {
  const [world, setWorld] = useState<Loaded | null>(null);
  useEffect(() => {
    const worker = new Worker(new URL('./world/worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorldMessage>) => {
      const { assembly, spawn, terrain, generationMs, volcano } = event.data;
      setWorld({ seed, assembly, spawn, terrain: new Set(terrain), generationMs, volcano });
      worker.terminate();
    };
    worker.postMessage({ seed });
    return () => worker.terminate();
  }, [seed]);
  return world;
}

/** Keys typed into a field are text, not game controls. */
const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

export function App() {
  const [seed, setSeed] = useState(() => loadSeed() ?? newSeed());
  // Bumped to open an island afresh from its saved edits, even the one being played.
  const [opened, setOpened] = useState(0);
  useEffect(() => saveSeed(seed), [seed]);
  const world = useWorld(seed);
  if (!world || world.seed !== seed) return <Splash message={`Shaping island ${seed}…`} />;
  const open = (next: number) => {
    setSeed(next);
    setOpened((current) => current + 1);
  };
  return (
    <Game
      key={`${seed}:${opened}`}
      world={world}
      onNewWorld={() => open(newSeed())}
      onOpenIsland={open}
    />
  );
}

/** The time of day in the corner; only this updates as the minutes pass. */
function ClockLabel({ clock }: { clock: DayClock }) {
  useSyncExternalStore(clock.subscribe, clock.getSnapshot);
  return (
    <span className="clock" title="Time of day">
      {isDaytime(clock.time) ? '☀' : '☾'} {clockTime(clock.time)}
    </span>
  );
}

function Splash({ message }: { message: string }) {
  return (
    <div className="splash" role="status">
      <h1>Brick Island</h1>
      <div className="splash-bricks" aria-hidden>
        <span style={{ background: '#c91a09' }} />
        <span style={{ background: '#0055bf' }} />
        <span style={{ background: '#f2cd37' }} />
      </div>
      <p>{message}</p>
    </div>
  );
}

function Game({
  world,
  onNewWorld,
  onOpenIsland,
}: {
  world: Loaded;
  onNewWorld: () => void;
  onOpenIsland: (seed: number) => void;
}) {
  const [edits, setEdits] = useState<Edit[]>(() => loadEdits(world.seed));
  const [assembly, setAssembly] = useState(() => replayEdits(world.assembly, edits));
  useEffect(() => saveEdits(world.seed, edits), [world.seed, edits]);
  const [slots, setSlots] = useState<Held[]>(() => loadHotbar() ?? [...STARTER_HOTBAR]);
  useEffect(() => saveHotbar(slots), [slots]);
  const [selected, setSelected] = useState(0);
  const held = slots[selected];
  const [aim, setAim] = useState<Aim | null>(null);
  const [view, setView] = useState<WalkCamera>('first');
  const [flying, setFlying] = useState(false);
  /**
   * What is in front: the menu, the game, or the brick box over the game. The mouse is locked
   * while playing where the page allows it; losing the lock (Esc in the browser) does not leave
   * the game, only M does.
   */
  const [screen, setScreen] = useState<'menu' | 'playing' | 'box'>('menu');
  const playing = screen === 'playing';
  /** Whether the game has been played yet, so the menu offers to resume rather than to play. */
  const [started, setStarted] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const nextId = useRef(0);

  // The debug window (` or ?debug): the renderer's figures, and the game's own below them.
  const [debugOptions, setDebugOptions] = useDebugOptions('brick-island-debug-v1');
  const [debugStore] = useState(() => new DebugStore());
  useEffect(() => () => debugStore.dispose(), [debugStore]);
  const [playerStore] = useState(() => new PlayerStore());
  const [collision, setCollision] = useState(false);
  const [lastEdit, setLastEdit] = useState<EditTiming | null>(null);

  // The island's day: carries on from the last visit, kept every few seconds.
  const [clock] = useState(() => new DayClock(loadTime() ?? START_TIME));
  useEffect(() => {
    let saved = 0;
    return clock.subscribe(() => {
      if (Date.now() - saved < 5000) return;
      saved = Date.now();
      saveTime(clock.time);
    });
  }, [clock]);
  const onAim = useCallback(
    (next: Aim | null) => {
      setAim(next);
      debugStore.hover(next ? { face: next.face, brick: next.brick, x: next.x, z: next.z } : null);
    },
    [debugStore],
  );

  const required = useMemo(() => {
    const ids = new Set(assembly.bricks.map((brick) => brick.partId));
    for (const slot of slots) ids.add(slot.partId);
    return [...ids];
  }, [assembly, slots]);
  const library = useLDrawLibrary(required);

  const ghost = useMemo(
    () =>
      aim
        ? placementFor(
            aim,
            held,
            'ghost',
            WORLD_SIZE,
            getSnap(held.partId, held.rotation) ?? undefined,
          )
        : null,
    [aim, held],
  );
  const ghostCheck = useMemo(() => (ghost ? tryPlace(assembly, ghost) : null), [assembly, ghost]);
  const ghostValid = ghostCheck?.ok ?? false;

  const commit = useCallback((next: Assembly, ...made: Edit[]) => {
    setEdits((current) => [...current, ...made]);
    setAssembly(next);
  }, []);

  const say = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(timer);
  }, [toast]);

  const onMouse = useCallback(
    (action: MouseAction) => {
      if (!aim) return;
      if (action === 'pick') {
        const { partId, color, rotation } = aim.brick;
        setSlots((current) =>
          current.map((slot, index) => (index === selected ? { partId, color, rotation } : slot)),
        );
        return;
      }
      const start = performance.now();
      const timed = (action: EditTiming['action'], ok: boolean, pieces: number) =>
        setLastEdit({ action, ok, pieces, ms: performance.now() - start });
      if (action === 'break') {
        const result = tryRemove(assembly, aim.brick.id);
        timed('break', result.ok, result.ok ? result.removed.length : 0);
        if (!result.ok) return say(result.reason);
        commit(result.assembly, ...result.removed.map((id): Edit => ({ op: 'remove', id })));
        return;
      }
      if (!ghost) return;
      const brick: Brick = {
        ...ghost,
        id: `${PLAYER_PREFIX}${Date.now().toString(36)}-${nextId.current++}`,
      };
      const result = tryPlace(assembly, brick);
      timed('place', result.ok, 1);
      if (!result.ok) return say(result.reason);
      commit(result.assembly, { op: 'add', brick });
    },
    [aim, assembly, commit, ghost, say, selected],
  );

  const lockPointer = () =>
    // An embedded page may refuse the lock; dragging then looks round instead.
    Promise.resolve(document.querySelector('canvas')?.requestPointerLock()).catch(() => {});
  const unlockPointer = () => {
    if (document.pointerLockElement) document.exitPointerLock();
  };
  const play = () => {
    setScreen('playing');
    setStarted(true);
    void lockPointer();
  };
  /** The menu or the brick box, with the mouse let go so their buttons can be clicked. */
  const show = (next: 'menu' | 'box') => {
    setScreen(next);
    unlockPointer();
  };

  // Every key goes through here, by what is in front. Playing: 1 to 9 and the wheel pick a slot,
  // Q and E step through its part's colours, R turns it, V swaps the camera, B opens the brick
  // box and M the menu. In the brick box Esc or B closes it; in the menu Esc resumes.
  const keys = useRef({ screen, selected });
  useEffect(() => {
    keys.current = { screen, selected };
  });
  useEffect(() => {
    const updateHeld = (change: (slot: Held) => Held) =>
      setSlots((current) =>
        current.map((slot, index) => (index === keys.current.selected ? change(slot) : slot)),
      );
    const keydown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const { screen } = keys.current;
      const typing = isTyping(event.target);
      if (screen === 'box') {
        if (event.code === 'Escape' || (event.code === 'KeyB' && !typing)) {
          event.preventDefault();
          play();
        }
        return;
      }
      if (screen === 'menu') {
        if (event.code === 'Escape') {
          event.preventDefault();
          play();
        }
        return;
      }
      if (typing) return;
      if (/^Digit[1-9]$/.test(event.code)) setSelected(Number(event.code.slice(5)) - 1);
      else if (event.code === 'KeyQ' || event.code === 'KeyE') {
        const step = event.code === 'KeyE' ? 1 : -1;
        updateHeld((slot) => {
          const colors = colorsFor(slot.partId);
          const at = colors.indexOf(slot.color);
          const next = (Math.max(0, at) + step + colors.length) % colors.length;
          return { ...slot, color: colors[next] };
        });
      } else if (event.code === 'KeyR')
        updateHeld((slot) => ({ ...slot, rotation: nextRotation(slot.partId, slot.rotation) }));
      else if (event.code === 'KeyV')
        setView((current) => (current === 'first' ? 'third' : 'first'));
      else if (event.code === 'KeyB') show('box');
      else if (event.code === 'KeyM') show('menu');
    };
    const wheel = (event: WheelEvent) => {
      // Over the brick box and the menu the wheel scrolls them instead.
      if (keys.current.screen !== 'playing') return;
      setSelected((current) => (current + (event.deltaY > 0 ? 1 : -1) + 9) % 9);
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('wheel', wheel, { passive: true });
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('wheel', wheel);
    };
    // play and show only set state and touch the pointer, so the first ones serve throughout.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Puts a part in a slot, keeping its colour and turn where the part allows them. */
  const assign = (slot: number, partId: string) => {
    setSlots((current) =>
      current.map((held, index) => {
        if (index !== slot) return held;
        const colors = colorsFor(partId);
        const rotation = getSnap(partId, held.rotation)
          ? held.rotation
          : nextRotation(partId, held.rotation);
        return {
          partId,
          color: colors.includes(held.color) ? held.color : colors[0],
          rotation,
        };
      }),
    );
    setSelected(slot);
  };

  const resetWorld = () => {
    setEdits([]);
    setAssembly(world.assembly);
  };

  const worldInfo = useMemo(() => {
    let trees = 0;
    let player = 0;
    for (const brick of assembly.bricks)
      if (isPlant(brick)) trees++;
      else if (isPlayerPiece(brick)) player++;
    return {
      seed: world.seed,
      version: WORLD_VERSION,
      generationMs: world.generationMs,
      ground: assembly.bricks.length - trees - player,
      trees,
      player,
      total: assembly.bricks.length,
    };
  }, [assembly, world]);
  const debugCounts = useMemo(() => {
    let fallback = 0;
    for (const brick of assembly.bricks) if (!library.models[brick.partId]) fallback++;
    const total = assembly.bricks.length;
    return { visible: total, batched: total - fallback, separate: 0, fallback, total };
  }, [assembly, library.models]);

  if (library.status === 'loading') return <Splash message="Loading parts…" />;
  const built = edits.filter((edit) => edit.op === 'add').length;
  return (
    <div className="game">
      <GameScene
        bricks={assembly.bricks}
        models={library.models}
        buildArea={WORLD_SIZE}
        spawn={world.spawn}
        view={view}
        flying={flying}
        onFlyingChange={setFlying}
        onViewChange={setView}
        ghost={playing ? ghost : null}
        ghostValid={ghostValid}
        onAim={onAim}
        onMouse={onMouse}
        playing={playing}
        clock={clock}
        volcano={world.volcano}
        debug={{
          options: debugOptions,
          store: debugStore,
          player: playerStore,
          collision,
        }}
      />
      {debugOptions.enabled && (
        <DebugOverlay
          title="Brick Island debug"
          store={debugStore}
          options={debugOptions}
          onChange={setDebugOptions}
          switches={['wireframe', 'hideEdges', 'axes']}
          counts={debugCounts}
        >
          <GameDebugPanel
            player={playerStore}
            aim={aim}
            ghost={ghost}
            ghostReason={ghostCheck && !ghostCheck.ok ? ghostCheck.reason : null}
            edit={lastEdit}
            world={worldInfo}
            collision={collision}
            onCollision={setCollision}
            clock={clock}
          />
        </DebugOverlay>
      )}
      <div className="crosshair" aria-hidden />
      {playing && ghostCheck && !ghostCheck.ok && <div className="hint">{ghostCheck.reason}</div>}
      <div className="status">
        <strong>
          Island {world.seed}
          <ClockLabel clock={clock} />
        </strong>
        <span>
          {assembly.bricks.length.toLocaleString()} pieces · {built} placed
          {flying ? ' · flying' : ''}
        </span>
      </div>
      {toast && <div className="toast">{toast}</div>}
      {playing && (
        <div className="top-buttons">
          <button type="button" onClick={() => show('box')}>
            Bricks <kbd>B</kbd>
          </button>
          <button type="button" onClick={() => show('menu')}>
            Menu <kbd>M</kbd>
          </button>
        </div>
      )}
      {screen === 'box' && (
        <BrickBox
          slots={slots}
          selected={selected}
          onAssign={assign}
          onColor={(color) =>
            setSlots((current) =>
              current.map((held, index) => (index === selected ? { ...held, color } : held)),
            )
          }
          onClose={play}
        />
      )}
      <div className="hotbar" role="toolbar" aria-label="Pieces">
        {slots.map((slot, index) => (
          <button
            key={index}
            type="button"
            className={index === selected ? 'slot selected' : 'slot'}
            onClick={() => setSelected(index)}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes(PART_DRAG)) event.preventDefault();
            }}
            onDrop={(event) => {
              const partId = event.dataTransfer.getData(PART_DRAG);
              if (partId) assign(index, partId);
            }}
            title={`${getPart(slot.partId).name}, ${colorName(slot.color)}`}
          >
            <span className="key">{index + 1}</span>
            <PartImage partId={slot.partId} />
            <span className="swatch" style={{ background: colorHex(slot.color) }} />
          </button>
        ))}
      </div>
      {screen === 'menu' && (
        <Menu
          started={started}
          seed={world.seed}
          edits={edits}
          assembly={assembly}
          onPlay={play}
          onReset={resetWorld}
          onNewIsland={onNewWorld}
          onOpenIsland={onOpenIsland}
        />
      )}
    </div>
  );
}
