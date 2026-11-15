import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { getPart } from '@brick-workshop/engine';
import type { Assembly, Brick } from '@brick-workshop/engine';
import { Loader } from '@brick-workshop/render/loader';
import { dismissSplash, setSplashMessage } from '@brick-workshop/render/splash';
import { useLDrawLibrary } from '@brick-workshop/render/ldraw';
import type { WalkCamera } from '@brick-workshop/walk/walk-view';
import { WalkWorld } from '@brick-workshop/walk/walk';
import { placementFor } from './build.ts';
import {
  ChunkLoader,
  DEFAULT_DISTANCE,
  DISTANCES,
  START_RADIUS,
  chunkAt,
  chunkDistance,
  chunksAround,
  farDrop,
  isDistanceName,
  plan,
  unloadRadius,
} from './streaming.ts';
import type { DistanceName } from './streaming.ts';
import { CHUNK, allBricks, applyToChunks, chunkOf, withEdits } from './chunks.ts';
import type { Chunks } from './chunks.ts';
import { WorldIndex } from './world-index.ts';
import type { Aim, Edit, Held } from './build.ts';
import { GameScene } from './GameScene.tsx';
import { Menu } from './Menu.tsx';
import type { MouseAction } from './GameScene.tsx';
import { PLAYER_PREFIX, isPlayerPiece } from './export.ts';
import { GameDebugPanel, PlayerStore } from './debug.tsx';
import type { EditTiming, StreamingInfo } from './debug.tsx';
import { DebugOverlay, DebugStore, useDebugOptions } from '@brick-workshop/render/scene-debug';
import { DayClock, START_TIME, clockTime, isDaytime } from './sky.ts';
import { STARTER_HOTBAR } from './hotbar.ts';
import { BrickBox, PART_DRAG, PartImage, colorHex, colorName } from './BrickBox.tsx';
import { colorsFor, getSnap, nextRotation } from './catalog.ts';
import { PadPresses, readPads } from './gamepad.ts';
import type { PadButton, PadState } from './gamepad.ts';
import { PAD_CLASS, moveFocus, pressFocused, scrollPanel, switchTab } from './pad-ui.ts';
import {
  WORLD_VERSION,
  loadEdits,
  loadDistance,
  loadHotbar,
  loadSeed,
  loadTime,
  saveEdits,
  saveDistance,
  saveHotbar,
  saveSeed,
  saveTime,
} from './save.ts';
import { WORLD_SIZE, findSpawn } from './world/generate.ts';
import { glowsNear } from './world/glows.ts';
import { isPlant } from './world/plants.ts';
import { REGION, Terrain, volcanoIn } from './world/terrain.ts';
import type { ChunkMessage, FarMessage } from './world/worker.ts';
import { FarStore } from './FarView.tsx';

/**
 * Counts per chunk, kept until the chunk changes: a chunk's list is replaced whenever its pieces
 * change, so its counts can be looked up by the list itself instead of counted afresh over the
 * whole world every time a chunk arrives.
 */
const kindCounts = new WeakMap<readonly Brick[], { trees: number; player: number }>();
function countKinds(pieces: readonly Brick[]) {
  let counts = kindCounts.get(pieces);
  if (!counts) {
    counts = { trees: 0, player: 0 };
    for (const brick of pieces)
      if (isPlant(brick)) counts.trees++;
      else if (isPlayerPiece(brick)) counts.player++;
    kindCounts.set(pieces, counts);
  }
  return counts;
}
const fallbackCounts = new WeakMap<readonly Brick[], { models: object; count: number }>();
/** Pieces of a chunk with no model loaded yet, drawn from simple shapes. */
function countFallback(pieces: readonly Brick[], models: Record<string, unknown>) {
  const cached = fallbackCounts.get(pieces);
  if (cached?.models === models) return cached.count;
  let count = 0;
  for (const brick of pieces) if (!models[brick.partId]) count++;
  fallbackCounts.set(pieces, { models, count });
  return count;
}

function newSeed() {
  return Math.floor(Math.random() * 1_000_000);
}

/**
 * The scene's frame: positions are shown centred on a board this size, wherever they are. The
 * scene's origin never moves with the walker. The GPU holds positions as 32-bit floats, which at
 * 16,000 studs from the start still place a piece to about 0.002 of a stud; jitter would only show
 * near a million studs, some 25 hours of running from the start, so re-centring the scene on the
 * walker is not worth what it would cost.
 */
const FRAME = WORLD_SIZE;

/** Keys typed into a field are text, not game controls. */
const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

/** Controller buttons that repeat while held: building while playing, moving round in a panel. */
const PLAY_REPEAT = new Set<PadButton>(['lt', 'rt']);
const PANEL_REPEAT = new Set<PadButton>(['up', 'down', 'left', 'right', 'lt', 'rt']);
const DIRECTIONS = ['up', 'down', 'left', 'right'] as const;

export function App() {
  const [seed, setSeed] = useState(() => loadSeed() ?? newSeed());
  // Bumped to open a world afresh from its saved edits, even the one being played.
  const [opened, setOpened] = useState(0);
  useEffect(() => saveSeed(seed), [seed]);
  const open = (next: number) => {
    setSeed(next);
    setOpened((current) => current + 1);
  };
  return (
    <Game
      key={`${seed}:${opened}`}
      seed={seed}
      onNewWorld={() => open(newSeed())}
      onOpenWorld={open}
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

function Game({
  seed,
  onNewWorld,
  onOpenWorld,
}: {
  seed: number;
  onNewWorld: () => void;
  onOpenWorld: (seed: number) => void;
}) {
  /** The terrain on the main thread: for the start, and for the debug window's chunk borders. */
  const [terrain] = useState(() => new Terrain(seed));
  const [spawn] = useState(() => findSpawn(terrain));
  /**
   * The live world, streamed in chunk by chunk round the walker: the pieces by chunk, an index for
   * placing and breaking, and the walker's collision world, all kept up to date together. Chunks
   * come from background threads with the player's saved edits laid over them, and go again once
   * the walker is far enough away.
   */
  const [{ index, walk }] = useState(() => ({
    index: new WorldIndex([]),
    walk: new WalkWorld([], FRAME, Infinity),
  }));
  const [edits, setEdits] = useState<Edit[]>(() => loadEdits(seed));
  const editsRef = useRef(edits);
  useEffect(() => {
    editsRef.current = edits;
    saveEdits(seed, edits);
  }, [seed, edits]);
  const [chunks, setChunks] = useState<Chunks>(() => new Map());
  /** The player's pieces still standing, from the edits: put down and not taken off again. */
  const placedCount = useMemo(() => {
    const standing = new Set<string>();
    for (const edit of edits)
      if (edit.op === 'add') standing.add(edit.brick.id);
      else standing.delete(edit.id);
    return standing.size;
  }, [edits]);
  const chunksRef = useRef<Chunks>(chunks);
  const [revision, setRevision] = useState(0);
  const [centre, setCentre] = useState(() => chunkAt(spawn.x, spawn.z));
  const centreRef = useRef(centre);
  /** How far the world reaches round the walker, as picked in the menu's settings. */
  const [distanceName, setDistanceName] = useState<DistanceName>(() => {
    const saved = loadDistance();
    return isDistanceName(saved) ? saved : DEFAULT_DISTANCE;
  });
  useEffect(() => saveDistance(distanceName), [distanceName]);
  const distance = DISTANCES[distanceName];
  const distanceRef = useRef(distance);
  /** How long the last few chunks took to build, for the debug window. */
  const [chunkTimes, setChunkTimes] = useState<number[]>([]);
  /**
   * What is in front: the menu, the game, or the brick box over the game. The mouse is locked
   * while playing where the page allows it; losing the lock (Esc in the browser) does not leave
   * the game, only M does.
   */
  const [screen, setScreen] = useState<'menu' | 'playing' | 'box'>('menu');
  const playing = screen === 'playing';
  // Every loaded piece in one list is only needed by the menu (its export) and the debug window.
  const [debugOptions, setDebugOptions] = useDebugOptions('brick-island-debug-v1');
  const getAssembly = (): Assembly => ({ name: `World ${seed}`, bricks: allBricks(chunks) });
  /** Parts of every chunk loaded so far, gathered as chunks arrive rather than counted afresh. */
  const [partsSeen, setPartsSeen] = useState<ReadonlySet<string>>(() => new Set());

  /**
   * Chunks from the loader wait here and go into the world one per frame, so a burst of them
   * arriving together is spread over several frames instead of landing in one.
   */
  const arrived = useRef<ChunkMessage[]>([]);
  const receive = useCallback((chunk: ChunkMessage) => {
    arrived.current.push(chunk);
  }, []);
  /** The ring of chunks past those loaded in full, drawn plainly from afar. */
  const [farStore] = useState(() => new FarStore());
  const farArrived = useRef<FarMessage[]>([]);
  const receiveFar = useCallback((chunk: FarMessage) => {
    farArrived.current.push(chunk);
  }, []);
  /** A far chunk put in the ring, unless the walker has gone on too far for it meanwhile. */
  const addFar = useCallback(
    (chunk: FarMessage) => {
      const [cx, cz] = centreRef.current;
      if (chunkDistance(chunk.key, cx, cz) > farDrop(distanceRef.current)) return;
      farStore.set(new Map(farStore.current).set(chunk.key, chunk));
    },
    [farStore],
  );
  /** A chunk from the loader, with the player's edits to it laid over, put into the world. */
  const addChunk = useCallback(
    (chunk: ChunkMessage) => {
      const [cx, cz] = centreRef.current;
      if (
        chunksRef.current.has(chunk.key) ||
        chunkDistance(chunk.key, cx, cz) > unloadRadius(distanceRef.current)
      )
        return;
      const bricks = withEdits(chunk.key, chunk.bricks, editsRef.current);
      for (const brick of bricks) index.add(brick);
      walk.setGroup(chunk.key, bricks);
      const next = new Map(chunksRef.current).set(chunk.key, bricks);
      chunksRef.current = next;
      setChunkTimes((current) => [...current.slice(-15), chunk.ms]);
      setPartsSeen((current) => {
        const fresh = bricks.filter((brick) => !current.has(brick.partId));
        if (!fresh.length) return current;
        const next = new Set(current);
        for (const brick of fresh) next.add(brick.partId);
        return next;
      });
      setChunks(next);
      setRevision((current) => current + 1);
    },
    [index, walk],
  );
  const dropChunk = useCallback(
    (key: string) => {
      for (const brick of chunksRef.current.get(key) ?? []) index.remove(brick.id);
      walk.removeGroup(key);
      const next = new Map(chunksRef.current);
      next.delete(key);
      chunksRef.current = next;
      setChunks(next);
      setRevision((current) => current + 1);
    },
    [index, walk],
  );
  // The loader lasts as long as the game; it is made before the planning below first runs.
  const loader = useRef<ChunkLoader | null>(null);
  useEffect(() => {
    // One arrival a frame: a full chunk if one is waiting, else a far one.
    let frame = requestAnimationFrame(function next() {
      const chunk = arrived.current.shift();
      if (chunk) addChunk(chunk);
      else {
        const far = farArrived.current.shift();
        if (far) addFar(far);
      }
      frame = requestAnimationFrame(next);
    });
    return () => cancelAnimationFrame(frame);
  }, [addChunk, addFar]);
  useEffect(() => {
    const created = new ChunkLoader(seed, receive, receiveFar);
    loader.current = created;
    return () => {
      created.dispose();
      loader.current = null;
    };
  }, [seed, receive, receiveFar]);
  // As the walker crosses into another chunk: build the chunks round it, nearest first, and drop
  // those now far away.
  useEffect(() => {
    if (!loader.current) return;
    centreRef.current = centre;
    // A new render distance takes effect at once: a shorter one drops all that is now past it.
    const changed = distanceRef.current !== distance;
    distanceRef.current = distance;
    const [cx, cz] = centre;
    const { request, unload, farRequest, farUnload } = plan(
      cx,
      cz,
      new Set(chunksRef.current.keys()),
      new Set(farStore.current.keys()),
      distance,
      changed,
    );
    for (const key of unload) dropChunk(key);
    if (farUnload.length) {
      const next = new Map(farStore.current);
      for (const key of farUnload) next.delete(key);
      farStore.set(next);
    }
    loader.current.want(request, farRequest);
  }, [centre, distance, dropChunk, farStore]);
  const onChunk = useCallback((cx: number, cz: number) => setCentre([cx, cz]), []);
  /** The chunks that must be there before the game starts: those round the start. */
  const startChunks = useMemo(
    () => chunksAround(...chunkAt(spawn.x, spawn.z), START_RADIUS),
    [spawn],
  );
  // Ready once the chunks round the start are in, and from then on: walking away later drops
  // them, which must not send the game back to the loading screen.
  const [ready, setReady] = useState(false);
  if (!ready && startChunks.every((key) => chunks.has(key))) setReady(true);
  /** The volcano of the region the walker is in, if it has one, for the glow over its crater. */
  const regionX = Math.floor((centre[0] * CHUNK) / REGION);
  const regionZ = Math.floor((centre[1] * CHUNK) / REGION);
  const volcano = useMemo(() => volcanoIn(seed, regionX, regionZ), [seed, regionX, regionZ]);
  /** The campfire and cave crystals nearest the walker's chunk, for their lights. */
  const glows = useMemo(() => glowsNear(terrain, centre[0], centre[1]), [terrain, centre]);
  /** The middle of the walker's chunk: near enough to where it stands for an area export. */
  const position = { x: centre[0] * CHUNK + CHUNK / 2, z: centre[1] * CHUNK + CHUNK / 2 };

  const [slots, setSlots] = useState<Held[]>(() => loadHotbar() ?? [...STARTER_HOTBAR]);
  useEffect(() => saveHotbar(slots), [slots]);
  const [selected, setSelected] = useState(0);
  const held = slots[selected];
  const [aim, setAim] = useState<Aim | null>(null);
  const [view, setView] = useState<WalkCamera>('first');
  const [flying, setFlying] = useState(false);
  /** Whether the game has been played yet, so the menu offers to resume rather than to play. */
  const [started, setStarted] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const nextId = useRef(0);

  // The debug window (` or ?debug): the renderer's figures, and the game's own below them.
  const [debugStore] = useState(() => new DebugStore());
  useEffect(() => () => debugStore.dispose(), [debugStore]);
  const [playerStore] = useState(() => new PlayerStore());
  const [collision, setCollision] = useState(false);
  const [borders, setBorders] = useState(false);
  const [lastEdit, setLastEdit] = useState<EditTiming | null>(null);

  // The world's day: carries on from the last visit, kept every few seconds.
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
    const ids = new Set(partsSeen);
    for (const slot of slots) ids.add(slot.partId);
    // Pieces the player put down that no chunk had yet.
    for (const edit of edits) if (edit.op === 'add') ids.add(edit.brick.partId);
    return [...ids];
  }, [partsSeen, slots, edits]);
  const library = useLDrawLibrary(required);

  const ghost = useMemo(
    () =>
      aim
        ? placementFor(
            aim,
            held,
            'ghost',
            Infinity,
            getSnap(held.partId, held.rotation) ?? undefined,
          )
        : null,
    [aim, held],
  );
  const ghostCheck = useMemo(() => {
    void revision; // The index changes in place; the revision says when.
    return ghost ? index.check(ghost) : null;
  }, [ghost, index, revision]);
  const ghostValid = ghostCheck?.ok ?? false;

  /** Adds and takes off pieces everywhere at once: the index, the chunks and the walker's world. */
  const commit = useCallback(
    (added: readonly Brick[], removedIds: readonly string[], made: readonly Edit[]) => {
      const removed = removedIds.flatMap((id) => index.bricks.get(id) ?? []);
      for (const id of removedIds) index.remove(id);
      for (const brick of added) index.add(brick);
      const { chunks: next, changed } = applyToChunks(chunksRef.current, added, removed);
      chunksRef.current = next;
      for (const key of changed) walk.setGroup(key, next.get(key) ?? []);
      setChunks(next);
      setRevision((current) => current + 1);
      setEdits((current) => [...current, ...made]);
    },
    [index, walk],
  );

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
        const result = index.breakAt(aim.brick.id);
        timed('break', result.ok, result.ok ? result.removed.length : 0);
        if (!result.ok) return say(result.reason);
        commit(
          [],
          result.removed,
          result.removed.map((id): Edit => {
            const brick = index.bricks.get(id)!;
            return { op: 'remove', id, chunk: chunkOf(brick) };
          }),
        );
        return;
      }
      if (!ghost) return;
      const brick: Brick = {
        ...ghost,
        id: `${PLAYER_PREFIX}${Date.now().toString(36)}-${nextId.current++}`,
      };
      const result = index.check(brick);
      timed('place', result.ok, 1);
      if (!result.ok) return say(result.reason);
      commit([brick], [], [{ op: 'add', brick }]);
    },
    [aim, commit, ghost, index, say, selected],
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
  const updateHeld = (change: (slot: Held) => Held) =>
    setSlots((current) =>
      current.map((slot, index) => (index === keys.current.selected ? change(slot) : slot)),
    );
  /** Steps the held part through the colours it comes in. */
  const stepColor = (step: number) =>
    updateHeld((slot) => {
      const colors = colorsFor(slot.partId);
      const at = colors.indexOf(slot.color);
      const next = (Math.max(0, at) + step + colors.length) % colors.length;
      return { ...slot, color: colors[next] };
    });
  const turnHeld = () =>
    updateHeld((slot) => ({ ...slot, rotation: nextRotation(slot.partId, slot.rotation) }));
  const stepSlot = (step: number) => setSelected((current) => (current + step + 9) % 9);
  useEffect(() => {
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
      else if (event.code === 'KeyQ' || event.code === 'KeyE')
        stepColor(event.code === 'KeyE' ? 1 : -1);
      else if (event.code === 'KeyR') turnHeld();
      else if (event.code === 'KeyV')
        setView((current) => (current === 'first' ? 'third' : 'first'));
      else if (event.code === 'KeyB') show('box');
      else if (event.code === 'KeyM') show('menu');
    };
    const wheel = (event: WheelEvent) => {
      // Over the brick box and the menu the wheel scrolls them instead.
      if (keys.current.screen !== 'playing') return;
      stepSlot(event.deltaY > 0 ? 1 : -1);
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('wheel', wheel, { passive: true });
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('wheel', wheel);
    };
    // play, show and the slot helpers only set state and touch the pointer, so the first ones
    // serve throughout.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A controller, read every frame (walking reads its own buttons in the scene; see `gamepad.ts`
  // for what each does here). The handler is replaced every render, so it always sees the latest
  // aim and screen.
  const onPad = (state: PadState, pressed: Set<PadButton>, seconds: number) => {
    if (screen === 'playing') {
      if (pressed.has('rt')) onMouse('place');
      if (pressed.has('lt')) onMouse('break');
      if (pressed.has('x')) onMouse('pick');
      if (pressed.has('lb')) stepSlot(-1);
      if (pressed.has('rb')) stepSlot(1);
      if (pressed.has('left')) stepColor(-1);
      if (pressed.has('right')) stepColor(1);
      if (pressed.has('up')) turnHeld();
      if (pressed.has('down')) show('box');
      if (pressed.has('menu')) show('menu');
      return;
    }
    const root = document.querySelector<HTMLElement>(screen === 'box' ? '.box' : '.menu .panel');
    if (!root) return;
    for (const direction of DIRECTIONS) if (pressed.has(direction)) moveFocus(root, direction);
    if (pressed.has('a')) pressFocused(root);
    if (pressed.has('lb')) switchTab(root, -1);
    if (pressed.has('rb')) switchTab(root, 1);
    if (screen === 'box') {
      if (pressed.has('lt')) stepSlot(-1);
      if (pressed.has('rt')) stepSlot(1);
    }
    scrollPanel(root, state.scroll.x, state.scroll.y, seconds);
    if (pressed.has('b') || (screen === 'menu' && pressed.has('menu'))) play();
  };
  const padHandler = useRef(onPad);
  useEffect(() => {
    padHandler.current = onPad;
  });
  useEffect(() => {
    const presses = new PadPresses();
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      frame = requestAnimationFrame(tick);
      const seconds = Math.min(0.1, (now - last) / 1000);
      last = now;
      const pads = navigator.getGamepads?.();
      const state = pads ? readPads(pads) : null;
      if (!state) return;
      const repeating = keys.current.screen === 'playing' ? PLAY_REPEAT : PANEL_REPEAT;
      padHandler.current(state, presses.update(state.down, now, repeating), seconds);
    });
    // The focus ring shows only while the controller is in use.
    const mouse = () => document.documentElement.classList.remove(PAD_CLASS);
    window.addEventListener('mousemove', mouse);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('mousemove', mouse);
    };
  }, []);

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

  /** Forgets every change and opens the world again as it was made. */
  const resetWorld = () => {
    saveEdits(seed, []);
    onOpenWorld(seed);
  };

  /** Pieces by kind over every loaded chunk, from counts kept per chunk. */
  const kinds = useMemo(() => {
    const sum = { total: 0, trees: 0, player: 0 };
    for (const pieces of chunks.values()) {
      const counts = countKinds(pieces);
      sum.total += pieces.length;
      sum.trees += counts.trees;
      sum.player += counts.player;
    }
    return sum;
  }, [chunks]);
  const worldInfo = useMemo(() => {
    const times = chunkTimes;
    return {
      seed,
      version: WORLD_VERSION,
      generationMs: times.length ? times.reduce((sum, ms) => sum + ms, 0) / times.length : 0,
      chunks: chunks.size,
      ground: kinds.total - kinds.trees - kinds.player,
      trees: kinds.trees,
      player: kinds.player,
      total: kinds.total,
    };
  }, [kinds, chunks, chunkTimes, seed]);
  /** How the world streams in, for the debug window, which reads it a couple of times a second. */
  const readStreaming = (): StreamingInfo => {
    let pieces = 0;
    for (const chunk of chunksRef.current.values()) pieces += chunk.length;
    const activity = loader.current?.activity;
    return {
      chunk: `${centreRef.current[0]},${centreRef.current[1]}`,
      loaded: chunksRef.current.size,
      far: farStore.current.size,
      waiting: activity?.waiting ?? 0,
      waitingFar: activity?.waitingFar ?? 0,
      building: activity?.building ?? 0,
      workers: activity?.workers ?? 0,
      times: chunkTimes,
      pieces,
    };
  };
  const debugCounts = useMemo(() => {
    let fallback = 0;
    if (debugOptions.enabled)
      for (const pieces of chunks.values()) fallback += countFallback(pieces, library.models);
    const total = kinds.total;
    return { visible: total, batched: total - fallback, separate: 0, fallback, total };
  }, [chunks, kinds, library.models, debugOptions.enabled]);

  // The boot splash (stacking bricks, from index.html) covers the first world and parts; the
  // loader card below it takes over for anything that loads later.
  const startDone = startChunks.filter((key) => chunks.has(key)).length;
  const booting = !ready || library.status === 'loading';
  useEffect(() => {
    if (!booting) dismissSplash();
    else if (!ready)
      setSplashMessage(`Shaping world ${seed}… ${startDone} of ${startChunks.length}`);
    else setSplashMessage('Loading parts…');
  }, [booting, ready, seed, startDone, startChunks.length]);

  // One loader, kept by its key from the first chunks through the parts to the open world, so
  // it fades out over the world instead of vanishing.
  const loading = (
    <Loader
      key="loader"
      label={
        !ready ? `Shaping world ${seed}…` : library.status === 'loading' ? 'Loading parts…' : null
      }
      progress={
        ready
          ? null
          : {
              done: startDone,
              total: startChunks.length,
            }
      }
    />
  );
  if (booting) return <div className="game">{loading}</div>;
  // Pieces of the player's still standing, not every one ever put down.
  const built = placedCount;
  let pieceCount = 0;
  for (const pieces of chunks.values()) pieceCount += pieces.length;
  return (
    <div className="game">
      <GameScene
        chunks={chunks}
        farChunks={farStore}
        bricks={index.bricks}
        walkWorld={walk}
        revision={revision}
        models={library.models}
        buildArea={FRAME}
        distance={distance}
        spawn={spawn}
        onChunk={onChunk}
        view={view}
        flying={flying}
        onFlyingChange={setFlying}
        onViewChange={setView}
        gamepad={playing ? 'build' : 'off'}
        ghost={playing ? ghost : null}
        ghostValid={ghostValid}
        onAim={onAim}
        onMouse={onMouse}
        playing={playing}
        clock={clock}
        volcano={volcano}
        glows={glows}
        debug={{
          options: debugOptions,
          store: debugStore,
          player: playerStore,
          collision,
          borders: borders ? terrain : null,
        }}
      />
      {debugOptions.enabled && (
        <DebugOverlay
          title="Studlands debug"
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
            borders={borders}
            onBorders={setBorders}
            streaming={readStreaming}
            clock={clock}
          />
        </DebugOverlay>
      )}
      <div className="crosshair" aria-hidden />
      {playing && ghostCheck && !ghostCheck.ok && <div className="hint">{ghostCheck.reason}</div>}
      <div className="status">
        <strong>
          World {seed}
          <ClockLabel clock={clock} />
        </strong>
        <span>
          {pieceCount.toLocaleString()} pieces · {built} placed
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
          seed={seed}
          edits={edits}
          getAssembly={getAssembly}
          hasBuild={kinds.player > 0}
          position={position}
          onPlay={play}
          onReset={resetWorld}
          onNewWorld={onNewWorld}
          onOpenWorld={onOpenWorld}
          distance={distanceName}
          onDistance={setDistanceName}
        />
      )}
      {loading}
    </div>
  );
}
