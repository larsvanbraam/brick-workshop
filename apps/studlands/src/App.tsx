import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { getPart } from '@brick-workshop/engine';
import type { Assembly, Brick } from '@brick-workshop/engine';
import { Loader } from '@brick-workshop/render/loader';
import { FullscreenButton, useFullscreen } from '@brick-workshop/render/fullscreen';
import { dismissSplash, setSplashMessage } from '@brick-workshop/render/splash';
import { useLDrawLibrary } from '@brick-workshop/render/ldraw';
import { MINIFIG_BODY } from '@brick-workshop/render/minifig-parts';
import type { WalkCamera, WalkProbe } from '@brick-workshop/walk/walk-view';
import { WalkWorld } from '@brick-workshop/walk/walk';
import { VEHICLES } from '@brick-workshop/vehicles/vehicle';
import type { VehicleKind } from '@brick-workshop/vehicles/vehicle';
import { AmbientMusic } from '@brick-workshop/audio/music';
import { Voices, voiceFor } from '@brick-workshop/audio/voice';
import type { VoiceMode, VoiceTraits } from '@brick-workshop/audio/voice';
import { TalkLink } from '@brick-workshop/npc/talk';
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
import { TitleScreen } from './TitleScreen.tsx';
import type { MouseAction } from './GameScene.tsx';
import { PLAYER_PREFIX, isPlayerPiece } from './export.ts';
import { GameDebugPanel, PlayerStore } from './debug.tsx';
import type { EditTiming, StreamingInfo } from './debug.tsx';
import { DebugOverlay, DebugStore, useDebugOptions } from '@brick-workshop/render/scene-debug';
import { DayClock, START_TIME, clockTime, isDaytime } from './sky.ts';
import { STARTER_HOTBAR } from './hotbar.ts';
import { BrickBox, PART_DRAG, PartImage, colorHex, colorName } from './BrickBox.tsx';
import { colorsFor, getSnap, nextRotation } from './catalog.ts';
import { PadPresses, isPadActive, readPads } from './gamepad.ts';
import type { PadButton, PadState } from './gamepad.ts';
import { PAD_CLASS, moveFocus, pressFocused, scrollPanel, switchTab } from './pad-ui.ts';
import {
  WORLD_VERSION,
  loadEdits,
  loadDistance,
  loadHotbar,
  loadMusic,
  loadLocale,
  loadVoices,
  loadSave,
  loadSeed,
  loadSlot,
  loadTime,
  saveEdits,
  saveDistance,
  saveHotbar,
  saveMusic,
  saveLocale,
  saveVoices,
  saveSeed,
  saveSlot,
  saveTime,
  storeSave,
} from './save.ts';
import type { SaveGame } from './save.ts';
import { WORLD_SIZE, findSpawn } from './world/generate.ts';
import { glowsNear } from './world/glows.ts';
import { isPlant } from './world/plants.ts';
import { REGION } from './world/terrain.ts';
import { createTerrain } from './world/worlds.ts';
import { game } from './game.ts';
import type { ChunkMessage, FarMessage } from './world/worker.ts';
import { FarStore } from './FarView.tsx';
import { MapStore, Minimap } from './Minimap.tsx';
import { createVehicles, parkedVehicles, returnVehicles, vehicleAction } from './vehicles.ts';
import { DEFAULT_MUSIC, MENU_SHARE, MUSIC_LEVELS, isMusicLevel } from './music.ts';
import type { MusicLevel } from './music.ts';
import { lineFor, personality } from './dialogue.ts';
import { LOCALES, defaultLocale, isLocale } from './locale.ts';
import type { Locale } from './locale.ts';
import { residentById } from './npcs.ts';
import { SpeechBubble } from './SpeechBubble.tsx';
import { TIDE_LINES, Tide } from './tide.ts';
import {
  QUESTS,
  advance,
  giverId,
  isQuestProgress,
  questById,
  helperLine,
  questWords,
  reminder,
  startQuest,
  takerId,
  targets,
  taskLine,
} from './quests.ts';
import type { Quest, QuestEvent, QuestProgress } from './quests.ts';
import type { Positions, QuestView } from './QuestScene.tsx';
import type { MapPin } from './Minimap.tsx';
import { chime } from './chime.ts';

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
/** How fast the camera turns behind the title screen, in radians a second, and its ease in. */
const TITLE_TURN = 0.04;
const TITLE_EASE = 3;

export function App() {
  // F or the corner button toggles fullscreen.
  const fullscreen = useFullscreen();
  const { toggle } = fullscreen;
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.code !== 'KeyF' || event.repeat || event.metaKey || event.ctrlKey) return;
      if (
        event.target instanceof HTMLElement &&
        /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)
      )
        return;
      toggle();
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [toggle]);
  const fixed = game().seed;
  const [seed, setSeed] = useState(() => fixed ?? loadSeed() ?? newSeed());
  /** The save game being played, in a game with save slots. */
  const [slot, setSlot] = useState(() => (game().saveSlots ? loadSlot() : 0));
  // Bumped to open a world afresh from its saved edits, even the one being played.
  const [opened, setOpened] = useState(0);
  useEffect(() => {
    if (fixed === undefined) saveSeed(seed);
  }, [fixed, seed]);
  // The music lasts across worlds, so opening another one does not cut it off.
  const [music] = useState(() => new AmbientMusic());
  useEffect(() => () => music.dispose(), [music]);
  const [voices] = useState(() => new Voices());
  useEffect(() => () => voices.dispose(), [voices]);
  const open = (next: number) => {
    setSeed(next);
    setOpened((current) => current + 1);
  };
  /** Opens a save game, or starts a new one in an empty slot. */
  const openSlot = (next: number) => {
    saveSlot(next);
    setSlot(next);
    setOpened((current) => current + 1);
  };
  return (
    <>
      <Game
        key={`${seed}:${opened}`}
        seed={seed}
        slot={slot}
        music={music}
        voices={voices}
        onNewWorld={() => open(newSeed())}
        onOpenWorld={open}
        onOpenSlot={openSlot}
      />
      {fullscreen.supported && <FullscreenButton {...fullscreen} />}
    </>
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
  slot,
  music,
  voices,
  onNewWorld,
  onOpenWorld,
  onOpenSlot,
}: {
  seed: number;
  slot: number;
  music: AmbientMusic;
  voices: Voices;
  onNewWorld: () => void;
  onOpenWorld: (seed: number) => void;
  onOpenSlot: (slot: number) => void;
}) {
  /** The terrain on the main thread: for the start, and for the debug window's chunk borders. */
  const [terrain] = useState(() => createTerrain(seed, game().world));
  /** The save game this picks up from, in a game with save slots; null for a new one. */
  const [saved] = useState(() => (game().saveSlots ? loadSave(slot) : null));
  /** Where the walker starts: where the save left it, or the world's own start. */
  const [spawn] = useState(() => {
    if (!saved) return findSpawn(terrain);
    const { x, y, z, yaw, pitch } = saved.place;
    return { x, y, z, yaw, pitch };
  });
  /**
   * The live world, streamed in chunk by chunk round the walker: the pieces by chunk, an index for
   * placing and breaking, and the walker's collision world, all kept up to date together. Chunks
   * come from background threads with the player's saved edits laid over them, and go again once
   * the walker is far enough away.
   */
  const [{ index, walk, tide }] = useState(() => {
    const walk = new WalkWorld([], FRAME, Infinity);
    // On Brick Island, the tide walks the player back from the open sea.
    const tide = game().world === 'island' ? new Tide(seed, FRAME) : null;
    if (tide) walk.drift = tide.push;
    return { index: new WorldIndex([]), walk, tide };
  });
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
   * What is in front: the title screen (until the first Play), the menu, the game, or the brick
   * box over the game. The mouse is locked
   * while playing where the page allows it; losing the lock (Esc in the browser) does not leave
   * the game, only M does.
   */
  const [screen, setScreen] = useState<'title' | 'menu' | 'playing' | 'box'>('title');
  /** Whether the title screen is still up, which it stays while it animates away after Play. */
  const [titleShown, setTitleShown] = useState(true);
  const hideTitle = useCallback(() => setTitleShown(false), []);
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
  /**
   * Work on the world index waits here and is done a few milliseconds a frame: filing or
   * unfiling the pieces of a whole chunk is thousands of engine lookups, and in one go it is a
   * frame of its own. A job returns whether it finished before the deadline it is given.
   */
  const jobs = useRef<Array<(deadline: number) => boolean>>([]);
  const dropChunk = useCallback(
    (key: string) => {
      const bricks = chunksRef.current.get(key) ?? [];
      let next = 0;
      jobs.current.push((deadline) => {
        while (next < bricks.length) {
          index.remove(bricks[next++].id);
          if (next % 32 === 0 && performance.now() > deadline) return false;
        }
        walk.removeGroup(key);
        const chunks = new Map(chunksRef.current);
        chunks.delete(key);
        chunksRef.current = chunks;
        setChunks(chunks);
        setRevision((current) => current + 1);
        return true;
      });
    },
    [index, walk],
  );
  /** The ring of chunks past those loaded in full, drawn plainly from afar. */
  const [farStore] = useState(() => new FarStore());
  const farArrived = useRef<FarMessage[]>([]);
  const receiveFar = useCallback((chunk: FarMessage) => {
    farArrived.current.push(chunk);
  }, []);
  /**
   * A far chunk put in the ring, unless the walker has gone on too far for it meanwhile. A full
   * chunk past the margin that was kept only until this far look arrived goes now.
   */
  const addFar = useCallback(
    (chunk: FarMessage) => {
      const [cx, cz] = centreRef.current;
      const away = chunkDistance(chunk.key, cx, cz);
      if (away > farDrop(distanceRef.current)) return;
      farStore.set(new Map(farStore.current).set(chunk.key, chunk));
      if (chunksRef.current.has(chunk.key) && away > unloadRadius(distanceRef.current))
        dropChunk(chunk.key);
    },
    [farStore, dropChunk],
  );
  /** A chunk from the loader, with the player's edits to it laid over, put into the world. */
  const addChunk = useCallback(
    (chunk: ChunkMessage) => {
      let bricks: readonly Brick[] | undefined;
      let filed = 0;
      jobs.current.push((deadline) => {
        if (!bricks) {
          const [cx, cz] = centreRef.current;
          if (
            chunksRef.current.has(chunk.key) ||
            chunkDistance(chunk.key, cx, cz) > unloadRadius(distanceRef.current)
          )
            return true;
          bricks = withEdits(chunk.key, chunk.bricks, editsRef.current);
        }
        while (filed < bricks.length) {
          index.add(bricks[filed++]);
          if (filed % 32 === 0 && performance.now() > deadline) return false;
        }
        walk.setGroup(chunk.key, bricks);
        const next = new Map(chunksRef.current).set(chunk.key, bricks);
        chunksRef.current = next;
        setChunkTimes((current) => [...current.slice(-15), chunk.ms]);
        setPartsSeen((current) => {
          const fresh = bricks!.filter((brick) => !current.has(brick.partId));
          if (!fresh.length) return current;
          const seen = new Set(current);
          for (const brick of fresh) seen.add(brick.partId);
          return seen;
        });
        setChunks(next);
        setRevision((current) => current + 1);
        return true;
      });
    },
    [index, walk],
  );
  // The loader lasts as long as the game; it is made before the planning below first runs.
  const loader = useRef<ChunkLoader | null>(null);
  useEffect(() => {
    // One arrival a frame: a full chunk if one is waiting, else a far one.
    let frame = requestAnimationFrame(function next() {
      // Not more than a job or two ahead: arrivals wait in their own lists until the index has
      // caught up.
      if (jobs.current.length < 2) {
        const chunk = arrived.current.shift();
        if (chunk) addChunk(chunk);
        else {
          const far = farArrived.current.shift();
          if (far) addFar(far);
        }
      }
      const deadline = performance.now() + 4;
      while (jobs.current.length) {
        if (!jobs.current[0](deadline)) break;
        jobs.current.shift();
        if (performance.now() > deadline) break;
      }
      frame = requestAnimationFrame(next);
    });
    return () => cancelAnimationFrame(frame);
  }, [addChunk, addFar]);
  useEffect(() => {
    const created = new ChunkLoader(seed, receive, receiveFar, game().world);
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
  const volcano = useMemo(() => terrain.volcanoIn(regionX, regionZ), [terrain, regionX, regionZ]);
  /** The campfire and cave crystals nearest the walker's chunk, for their lights. */
  const glows = useMemo(() => glowsNear(terrain, centre[0], centre[1]), [terrain, centre]);
  /** The middle of the walker's chunk: near enough to where it stands for an area export. */
  const position = { x: centre[0] * CHUNK + CHUNK / 2, z: centre[1] * CHUNK + CHUNK / 2 };

  const [slots, setSlots] = useState<Held[]>(() => loadHotbar() ?? [...STARTER_HOTBAR]);
  useEffect(() => saveHotbar(slots), [slots]);
  const [selected, setSelected] = useState(0);
  const held = slots[selected];
  const [aim, setAim] = useState<Aim | null>(null);
  const [view, setView] = useState<WalkCamera>(() => saved?.place.view ?? 'first');
  const [flying, setFlying] = useState(() => saved?.place.flying ?? false);
  /** The vehicles round the world, where they were parked or where the save left them. */
  const [vehicles] = useState(() => createVehicles(game().vehicles, FRAME, saved));
  /** The vehicle being driven, by ID, and the one the walker stands beside. */
  const [driving, setDriving] = useState<string | null>(() => {
    const id = saved?.driving ?? null;
    return vehicles.some((vehicle) => vehicle.id === id) ? id : null;
  });
  const [nearVehicle, setNearVehicle] = useState<VehicleKind | null>(null);
  const drivingRef = useRef(driving);
  useEffect(() => {
    drivingRef.current = driving;
  }, [driving]);
  const onDrive = useCallback((id: string | null, out?: boolean) => {
    setDriving(id);
    if (id === null) setFlying(Boolean(out));
  }, []);
  /** Whether the game has been played yet, so the menu offers to resume rather than to play. */
  const [started, setStarted] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const nextId = useRef(0);

  // Brick Island's little jobs (see `quests.ts`): talking to a helper starts one, and the save
  // game keeps those finished and the one being done.
  const questsOn = game().world === 'island';
  const [questDone, setQuestDone] = useState<ReadonlySet<string>>(
    () => new Set((saved?.quests?.done ?? []).filter((id) => questById(id))),
  );
  const [activeQuest, setActiveQuest] = useState<QuestProgress | null>(() => {
    const active = saved?.quests?.active;
    return isQuestProgress(active) ? active : null;
  });
  /** The latest of both, for handlers that outlive a render, and kept ahead of it by them. */
  const questRef = useRef({ done: questDone, active: activeQuest });
  useEffect(() => {
    questRef.current = { done: questDone, active: activeQuest };
  }, [questDone, activeQuest]);
  /** Where the helpers stand, written by the scene. */
  const [helperPositions] = useState<Positions>(() => new Map());
  /** How far through asking each helper has got, so each press says the next line. */
  const [askCounts] = useState(() => new Map<string, number>());
  /** The cheer when a job is done. */
  const [cheer, setCheer] = useState<{ icon: string; name: string; text: string } | null>(null);
  // The language people speak: the saved choice, else the browser's own where we have it.
  const [locale, setLocale] = useState<Locale>(() => {
    const saved = loadLocale();
    return isLocale(saved) ? saved : defaultLocale();
  });
  useEffect(() => saveLocale(locale), [locale]);
  const mapPins = useMemo(
    () => questPins(questDone, activeQuest, locale),
    [questDone, activeQuest, locale],
  );
  useEffect(() => {
    if (!cheer) return;
    const timer = setTimeout(() => setCheer(null), 5000);
    return () => clearTimeout(timer);
  }, [cheer]);

  // The debug window (` or ?debug): the renderer's figures, and the game's own below them.
  const [debugStore] = useState(() => new DebugStore());
  useEffect(() => () => debugStore.dispose(), [debugStore]);
  const [playerStore] = useState(() => new PlayerStore());
  const [mapStore] = useState(() => new MapStore());
  const [mapOpen, setMapOpen] = useState(false);
  const closeMap = useCallback(() => setMapOpen(false), []);
  const [collision, setCollision] = useState(false);
  const [borders, setBorders] = useState(false);
  const [lastEdit, setLastEdit] = useState<EditTiming | null>(null);

  // The world's day: carries on from the last visit, kept every few seconds.
  const [clock] = useState(() => {
    const fixed = game().fixedTime;
    const created = new DayClock(fixed ?? loadTime() ?? START_TIME);
    created.paused = fixed !== undefined;
    return created;
  });
  useEffect(() => {
    let saved = 0;
    return clock.subscribe(() => {
      if (Date.now() - saved < 5000) return;
      saved = Date.now();
      saveTime(clock.time);
    });
  }, [clock]);
  /**
   * The save game, in a game with save slots: where the walker stands and looks, kept every few
   * seconds while playing, when the menu opens and when the page is left, so the next visit
   * picks up there. A slot gets a save only once it has been played.
   */
  const probe = useRef<WalkProbe | null>(null);
  const lastSave = useRef<SaveGame | null>(saved);
  /** When the play time was last counted, while playing. */
  const playClock = useRef<number | null>(null);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  const keepSave = useCallback(() => {
    const live = probe.current;
    if (!game().saveSlots || !live) return;
    const now = Date.now();
    const played = playClock.current === null ? 0 : (now - playClock.current) / 1000;
    if (playClock.current !== null) playClock.current = now;
    const previous = lastSave.current;
    if (!previous && !played) return;
    const { walker, look } = live;
    const next: SaveGame = {
      place: {
        x: walker.x + FRAME / 2,
        z: FRAME / 2 - walker.z,
        y: walker.y,
        yaw: look.yaw,
        pitch: look.pitch,
        flying: walker.flying ?? false,
        view: viewRef.current,
      },
      ...(vehicles.length
        ? { vehicles: parkedVehicles(vehicles, FRAME), driving: drivingRef.current }
        : {}),
      ...(questsOn
        ? { quests: { done: [...questRef.current.done], active: questRef.current.active } }
        : {}),
      playSeconds: (previous?.playSeconds ?? 0) + played,
      startedAt: previous?.startedAt ?? new Date(now).toISOString(),
      playedAt: new Date(now).toISOString(),
    };
    lastSave.current = next;
    storeSave(slot, next);
  }, [slot, vehicles, questsOn]);
  useEffect(() => {
    if (!playing || !game().saveSlots) return;
    playClock.current = Date.now();
    const timer = setInterval(keepSave, 5000);
    const leave = () => {
      if (document.visibilityState === 'hidden') keepSave();
    };
    window.addEventListener('pagehide', keepSave);
    document.addEventListener('visibilitychange', leave);
    return () => {
      clearInterval(timer);
      window.removeEventListener('pagehide', keepSave);
      document.removeEventListener('visibilitychange', leave);
      keepSave();
      playClock.current = null;
    };
  }, [playing, keepSave]);
  // Ambient piano: starts with the first Play (browsers need a click or key for sound), softer
  // in the menu, and turns to its night loop after sunset.
  const [musicLevel, setMusicLevel] = useState<MusicLevel>(() => {
    const saved = loadMusic();
    return isMusicLevel(saved) ? saved : DEFAULT_MUSIC;
  });
  useEffect(() => saveMusic(musicLevel), [musicLevel]);
  // Behind the title screen the camera looks slowly round, and turns back as the title leaves,
  // so play starts facing the way the save (or the start) did. Applied as a change each frame,
  // so a mouse moved while it turns back still counts.
  const onTitle = useRef(true);
  useEffect(() => {
    onTitle.current = screen === 'title';
  }, [screen]);
  useEffect(() => {
    if (!titleShown) return;
    let turned = 0;
    let frame = 0;
    let last = performance.now();
    let spent = 0;
    /** The camera's look, kept so the cleanup can still put it back. */
    let look: { yaw: number } | undefined;
    frame = requestAnimationFrame(function tick(now) {
      frame = requestAnimationFrame(tick);
      const seconds = Math.min(0.1, (now - last) / 1000);
      last = now;
      look = probe.current?.look ?? look;
      if (!look) return;
      spent += seconds;
      // Eases in over the first seconds rather than starting at full speed.
      const target = onTitle.current
        ? TITLE_TURN * (spent - TITLE_EASE * (1 - Math.exp(-spent / TITLE_EASE)))
        : turned * Math.max(0, 1 - seconds * 6);
      look.yaw += target - turned;
      turned = target;
    });
    return () => {
      cancelAnimationFrame(frame);
      if (look) look.yaw -= turned;
    };
  }, [titleShown]);
  useEffect(
    () =>
      music.setVolume(
        MUSIC_LEVELS[musicLevel] * (screen === 'menu' || screen === 'title' ? MENU_SHARE : 1),
      ),
    [music, musicLevel, screen],
  );
  useEffect(() => {
    const mood = () => music.setMood(isDaytime(clock.time) ? 'day' : 'night');
    mood();
    return clock.subscribe(mood);
  }, [music, clock]);

  // Talking to people: T (B on a controller) beside someone has them say their next line, shown
  // in a bubble over their head and voiced in Simlish or the device's speech.
  const [voiceMode, setVoiceMode] = useState<VoiceMode>(() => {
    const saved = loadVoices();
    return isVoiceMode(saved) ? saved : 'simlish';
  });
  useEffect(() => saveVoices(voiceMode), [voiceMode]);
  const [talk] = useState(() => new TalkLink());
  const nearbyPerson = useSyncExternalStore(talk.subscribe, () => talk.nearby);
  const speaker = useSyncExternalStore(talk.subscribe, () => talk.speaker);
  const [speech, setSpeech] = useState<{ id: string; name: string; text: string } | null>(null);
  /** How many lines each person has said, so they carry on from where they left off. */
  const [talkCounts] = useState(() => new Map<string, number>());
  const lineNumber = useRef(0);
  const nearbyName = useMemo(() => {
    if (nearbyPerson && isHelper(nearbyPerson)) return helperName(nearbyPerson, locale);
    const resident = nearbyPerson ? residentById(terrain, nearbyPerson) : null;
    return resident ? personality(resident).name : null;
  }, [nearbyPerson, terrain, locale]);
  /** Has someone say a line: in a bubble over their head and out loud, till said and read. */
  const speak = (id: string, name: string, text: string, voice: VoiceTraits) => {
    const line = ++lineNumber.current;
    setSpeech({ id, name, text });
    talk.say(id);
    // The bubble stays while the line is said, and long enough to read it.
    const reading = new Promise((resolve) => setTimeout(resolve, 1600 + text.length * 50));
    void Promise.all([voices.speak(text, voice, voiceMode, LOCALES[locale].tag), reading]).then(
      () => {
        if (lineNumber.current === line) talk.say(null);
      },
    );
  };
  /** A job is done: a cheer, a star, and thanks from whoever it was for. */
  const finishQuest = (quest: Quest) => {
    questRef.current = {
      done: new Set(questRef.current.done).add(quest.id),
      active: null,
    };
    setActiveQuest(null);
    setQuestDone(questRef.current.done);
    const { goal } = quest;
    const who = goal.kind === 'take' && 'outfit' in goal.to ? takerId(quest) : giverId(quest);
    const name = helperName(who, locale) ?? quest.giver.name;
    const { thanks } = questWords(quest, locale);
    setCheer({ icon: quest.icon, name, text: thanks });
    chime('done');
    speak(who, name, thanks, helperVoice(who));
  };
  /** Something happened on a job: picked up, back with it all, arrived, a brick put on. */
  const onQuestEvent = (event: QuestEvent) => {
    const active = questRef.current.active;
    const quest = active ? questById(active.id) : null;
    if (!quest || !active) return;
    const next = advance(quest, active, event);
    if (next === active) return;
    if (next === 'done') return finishQuest(quest);
    questRef.current = { ...questRef.current, active: next };
    setActiveQuest(next);
    if (next.step === 'go') return chime('pick');
    if (next.step === 'back' && active.step === 'go') return chime('all');
    if (next.step === 'build' && active.step === 'back') {
      chime('all');
      return speak(
        giverId(quest),
        questWords(quest, locale).giver,
        helperLine('build', locale),
        helperVoice(giverId(quest)),
      );
    }
    chime('place');
  };
  const questEventRef = useRef(onQuestEvent);
  useEffect(() => {
    questEventRef.current = onQuestEvent;
  });
  const questEvents = useCallback((event: QuestEvent) => questEventRef.current(event), []);
  /** Talking to a job's helper: they ask, a line a press, and the job starts with the last. */
  const talkToHelper = (id: string) => {
    const [, questId, role] = id.split(':');
    const quest = questById(questId);
    if (!quest) return;
    const { active, done } = questRef.current;
    const mine = active?.id === quest.id ? active : null;
    const name = helperName(id, locale) ?? quest.giver.name;
    if (role === 'to') {
      // Someone to take a thing to: arriving hands it over (see the scene), so this is a hello.
      const text = helperLine(done.has(quest.id) ? 'thanksAgain' : 'hello', locale);
      return speak(id, name, text, helperVoice(id));
    }
    if (mine?.step === 'build') return onQuestEvent({ kind: 'place' });
    if (mine?.step === 'back') return onQuestEvent({ kind: 'giver' });
    if (mine) return speak(id, name, reminder(quest, mine, locale), helperVoice(id));
    const count = askCounts.get(quest.id) ?? 0;
    const last = count >= quest.ask.length - 1;
    askCounts.set(quest.id, last ? 0 : count + 1);
    const { ask } = questWords(quest, locale);
    speak(id, name, ask[Math.min(count, ask.length - 1)], helperVoice(id));
    if (!last) return;
    const started = startQuest(quest);
    questRef.current = { ...questRef.current, active: started };
    setActiveQuest(started);
    chime('start');
  };
  const talkTo = () => {
    const id = talk.nearby;
    if (!id || drivingRef.current) return;
    if (isHelper(id)) return talkToHelper(id);
    const resident = residentById(terrain, id);
    if (!resident) return;
    const count = talkCounts.get(id) ?? 0;
    talkCounts.set(id, count + 1);
    const context = { daytime: isDaytime(clock.time), island: game().world === 'island' };
    const voice = voiceFor(resident.seed, resident.figure === 'woman' ? 'high' : 'low');
    speak(id, personality(resident).name, lineFor(resident, context, count, locale), voice);
  };
  const talkRef = useRef(talkTo);
  useEffect(() => {
    talkRef.current = talkTo;
  });
  // The talk ends when the speaker stops (walked off, finished), the menu opens or a drive starts.
  useEffect(() => {
    if (!playing || driving) talk.say(null);
  }, [playing, driving, talk]);
  useEffect(() => {
    if (speaker) return;
    lineNumber.current++;
    voices.stop();
  }, [speaker, voices]);
  /** What is being said: the last line, while its speaker still speaks. */
  const saying = speech && speech.id === speaker ? speech : null;
  /** What the player says when the tide turns them round, while it is said. */
  const [tideLine, setTideLine] = useState<string | null>(null);
  /** How many lines the tide has drawn, and until when the player keeps quiet after the last. */
  const tideTalk = useRef({ count: 0, quietUntil: 0 });
  const sayingRef = useRef(saying);
  useEffect(() => {
    sayingRef.current = saying;
  });
  useEffect(() => {
    if (!tide || !playing) return;
    const said = tideTalk.current;
    const timer = setInterval(() => {
      const now = performance.now();
      // Once the push is felt, and not over someone else talking or straight after the last one.
      if (tide.strength < 2 || now < said.quietUntil || sayingRef.current) return;
      const text = TIDE_LINES[said.count++ % TIDE_LINES.length];
      const reading = 1600 + text.length * 50;
      said.quietUntil = now + reading + 8000;
      setTideLine(text);
      setTimeout(() => setTideLine((current) => (current === text ? null : current)), reading);
    }, 200);
    return () => {
      clearInterval(timer);
      setTideLine(null);
    };
  }, [tide, playing]);
  const onAim = useCallback(
    (next: Aim | null) => {
      setAim(next);
      debugStore.hover(next ? { face: next.face, brick: next.brick, x: next.x, z: next.z } : null);
    },
    [debugStore],
  );

  const required = useMemo(() => {
    // The walker's own body too, so the start doesn't show a stand-in figure.
    const ids = new Set([...MINIFIG_BODY, ...partsSeen]);
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
  /**
   * Puts every vehicle back at its spot, for one that got stuck. Whoever is driving gets out where
   * they are first, flying if it was up in the air.
   */
  const onReturnVehicles = useCallback(() => {
    const current = vehicles.find((vehicle) => vehicle.id === drivingRef.current);
    if (current) {
      current.driven = false;
      onDrive(null, !current.grounded && VEHICLES[current.kind].handling !== 'ground');
    }
    returnVehicles(vehicles, game().vehicles, FRAME);
    say('The vehicles are back in their spots');
  }, [vehicles, onDrive, say]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(timer);
  }, [toast]);

  const onMouse = useCallback(
    (action: MouseAction) => {
      if (!aim || !game().building) return;
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
    music.start();
    void lockPointer();
  };
  /** The menu or the brick box, with the mouse let go so their buttons can be clicked. */
  const show = (next: 'menu' | 'box') => {
    // Saved before the menu shows, so its list of save games has this one as it is now.
    if (playing) keepSave();
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
      // The title screen's buttons take Enter themselves; Esc there only closes its pages.
      if (screen === 'title') return;
      if (screen === 'menu') {
        if (event.code === 'Escape') {
          event.preventDefault();
          play();
        }
        return;
      }
      if (typing) return;
      if (event.code === 'KeyT') {
        if (!event.repeat) talkRef.current();
        return;
      }
      if (event.code === 'KeyN' && game().minimap) {
        setMapOpen((current) => !current);
        return;
      }
      if (!game().building) {
        if (event.code === 'KeyV') setView((current) => (current === 'first' ? 'third' : 'first'));
        else if (event.code === 'KeyM') show('menu');
        return;
      }
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
      if (keys.current.screen !== 'playing' || !game().building) return;
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
    if (screen === 'playing' && !game().building) {
      if (pressed.has('menu')) show('menu');
      if (game().minimap && pressed.has('down')) setMapOpen((current) => !current);
      if (game().minimap && pressed.has('b') && mapOpen) setMapOpen(false);
      else if (pressed.has('b')) talkRef.current();
      return;
    }
    if (screen === 'playing') {
      if (pressed.has('rt')) onMouse('place');
      if (pressed.has('lt')) onMouse('break');
      if (pressed.has('x')) onMouse('pick');
      if (pressed.has('b')) talkRef.current();
      if (pressed.has('lb')) stepSlot(-1);
      if (pressed.has('rb')) stepSlot(1);
      if (pressed.has('left')) stepColor(-1);
      if (pressed.has('right')) stepColor(1);
      if (pressed.has('up')) turnHeld();
      if (pressed.has('down')) show('box');
      if (pressed.has('menu')) show('menu');
      return;
    }
    const root = document.querySelector<HTMLElement>(
      screen === 'box' ? '.box' : screen === 'title' ? '.title-screen' : '.menu .panel',
    );
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
    if (screen === 'title') {
      if (pressed.has('b')) root.querySelector<HTMLElement>('[data-pad-back]')?.click();
      if (pressed.has('menu')) play();
      return;
    }
    if (pressed.has('b') || (screen === 'menu' && pressed.has('menu'))) play();
  };
  const padHandler = useRef(onPad);
  useEffect(() => {
    padHandler.current = onPad;
  });
  // The prompts name the controller's buttons while it is the last thing used, else the keys.
  const [padInUse, setPadInUse] = useState(false);
  useEffect(() => {
    const presses = new PadPresses();
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      frame = requestAnimationFrame(tick);
      const seconds = Math.min(0.1, (now - last) / 1000);
      last = now;
      const pads = navigator.getGamepads?.();
      if (pads && isPadActive(pads)) setPadInUse(true);
      const playing = keys.current.screen === 'playing';
      // While playing the left stick walks, so it must not press the d-pad's actions.
      const state = pads ? readPads(pads, !playing) : null;
      if (!state) return;
      const repeating = playing ? PLAY_REPEAT : PANEL_REPEAT;
      padHandler.current(state, presses.update(state.down, now, repeating), seconds);
    });
    // The focus ring shows only while the controller is in use.
    const mouse = () => {
      document.documentElement.classList.remove(PAD_CLASS);
      setPadInUse(false);
    };
    const key = () => setPadInUse(false);
    window.addEventListener('mousemove', mouse);
    window.addEventListener('keydown', key);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('mousemove', mouse);
      window.removeEventListener('keydown', key);
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
  const worldName = game().seed === undefined ? `world ${seed}` : game().title;
  const startDone = startChunks.filter((key) => chunks.has(key)).length;
  // The first parts request goes out before any chunk has arrived, so booting also waits for the
  // parts the start chunks asked for since. Latched like `ready`: parts of chunks streamed in later
  // load behind the loader card rather than the splash.
  const [partsReady, setPartsReady] = useState(false);
  if (!partsReady && ready && library.status !== 'loading' && !library.pending.length)
    setPartsReady(true);
  const booting = !ready || !partsReady;
  useEffect(() => {
    if (!booting) dismissSplash();
    else if (!ready)
      setSplashMessage(`Shaping ${worldName}… ${startDone} of ${startChunks.length}`);
    else setSplashMessage('Loading parts…');
  }, [booting, ready, worldName, startDone, startChunks.length]);

  // One loader, kept by its key from the first chunks through the parts to the open world, so
  // it fades out over the world instead of vanishing.
  const loading = (
    <Loader
      key="loader"
      label={!ready ? `Shaping ${worldName}…` : !partsReady ? 'Loading parts…' : null}
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
  const questView: QuestView = { active: activeQuest, done: questDone };
  const shownQuest = activeQuest ? questById(activeQuest.id) : null;
  /** Whether the press beside the nearby helper puts a brick on. */
  const building =
    shownQuest !== null && activeQuest?.step === 'build' && nearbyPerson === giverId(shownQuest);
  const talkKey = padInUse ? 'B' : 'T';
  const drivingKind = vehicles.find((vehicle) => vehicle.id === driving)?.kind ?? null;
  // Pieces of the player's still standing, not every one ever put down.
  const built = placedCount;
  let pieceCount = 0;
  for (const pieces of chunks.values()) pieceCount += pieces.length;
  const menuProps = {
    started,
    seed,
    slot,
    resumable: saved !== null,
    onOpenSlot,
    edits,
    getAssembly,
    hasBuild: kinds.player > 0,
    position,
    onPlay: play,
    onReset: resetWorld,
    onReturnVehicles,
    onNewWorld,
    onOpenWorld,
    distance: distanceName,
    onDistance: setDistanceName,
    music: musicLevel,
    onMusic: setMusicLevel,
    voices: voiceMode,
    onVoices: setVoiceMode,
    locale,
    onLocale: setLocale,
  };
  return (
    <div className="game" data-screen={screen}>
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
        probe={probe}
        onChunk={onChunk}
        view={view}
        flying={flying}
        onFlyingChange={setFlying}
        onViewChange={setView}
        gamepad={playing ? 'build' : 'off'}
        ghost={playing && game().building ? ghost : null}
        ghostValid={ghostValid}
        onAim={onAim}
        onMouse={onMouse}
        map={game().minimap ? mapStore : undefined}
        playing={playing}
        clock={clock}
        volcano={volcano}
        glows={glows}
        terrain={terrain}
        centre={centre}
        vehicles={vehicles}
        driving={driving}
        onDrive={onDrive}
        onNear={setNearVehicle}
        talk={talk}
        tide={tide}
        quests={
          questsOn
            ? { view: questView, onEvent: questEvents, positions: helperPositions }
            : undefined
        }
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
          title={`${game().title} debug`}
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
      {game().building && <div className="crosshair" aria-hidden />}
      {playing && game().building && ghostCheck && !ghostCheck.ok && (
        <div className="hint">{ghostCheck.reason}</div>
      )}
      {playing && !driving && (nearVehicle || nearbyName) && (
        <div className="vehicle-hint">
          {nearVehicle && (
            <span>
              <kbd>{padInUse ? 'X' : 'E'}</kbd> {vehicleAction(nearVehicle)}
            </span>
          )}
          {nearbyName && (
            <span>
              <kbd>{talkKey}</kbd>{' '}
              {building
                ? 'Put on a brick'
                : saying?.id === nearbyPerson
                  ? 'Carry on'
                  : `Talk to ${nearbyName}`}
            </span>
          )}
        </div>
      )}
      {playing && saying && (
        <SpeechBubble
          key={`${saying.id}:${saying.text}`}
          anchor={talk.anchor}
          name={saying.name}
          text={saying.text}
        />
      )}
      {playing && tide && tideLine && !saying && (
        <SpeechBubble key={tideLine} anchor={tide.anchor} name="You" text={tideLine} />
      )}
      {playing && drivingKind && <DriveHint kind={drivingKind} pad={padInUse} />}
      {playing && shownQuest && activeQuest && (
        <QuestCard quest={shownQuest} progress={activeQuest} talkKey={talkKey} locale={locale} />
      )}
      {playing && cheer && (
        <div className="cheer" role="status">
          <div className="cheer-star" aria-hidden>
            ⭐
          </div>
          <strong>
            {cheer.icon} Well done! {cheer.icon}
          </strong>
          <span>
            {cheer.name}: {cheer.text}
          </span>
        </div>
      )}
      <div className="status">
        <strong>
          {game().seed === undefined ? `World ${seed}` : game().title}
          {game().fixedTime === undefined && <ClockLabel clock={clock} />}
        </strong>
        <span>
          {pieceCount.toLocaleString()} pieces{game().building ? ` · ${built} placed` : ''}
          {drivingKind ? ` · ${vehicleAction(drivingKind, true)}` : flying ? ' · flying' : ''}
        </span>
        {questsOn && (
          <span className="stars" title="Jobs done">
            ⭐ {questDone.size} of {QUESTS.length}
          </span>
        )}
      </div>
      {toast && <div className="toast">{toast}</div>}
      {playing && (
        <div className="top-buttons">
          {game().building && (
            <button type="button" onClick={() => show('box')}>
              Bricks <kbd>{padInUse ? 'D-pad ↓' : 'B'}</kbd>
            </button>
          )}
          <button type="button" onClick={() => show('menu')}>
            Menu <kbd>{padInUse ? '≡' : 'M'}</kbd>
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
      {game().building && (
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
      )}
      {game().minimap && playing && (
        <Minimap
          seed={seed}
          store={mapStore}
          open={mapOpen}
          onClose={closeMap}
          pins={questsOn ? mapPins : undefined}
        />
      )}
      {screen === 'menu' && <Menu {...menuProps} />}
      {titleShown && (
        <TitleScreen {...menuProps} save={saved} leaving={screen !== 'title'} onGone={hideTitle} />
      )}
      {loading}
    </div>
  );
}

/** Whether a wanderer is one of the jobs' helpers rather than someone living there. */
const isHelper = (id: string) => id.startsWith('quest:');

/** A helper's name from their wanderer ID (see `giverId`, `takerId`). */
function helperName(id: string, locale: Locale) {
  const [, questId, role] = id.split(':');
  const quest = questById(questId);
  if (!quest) return null;
  const words = questWords(quest, locale);
  if (role !== 'to') return words.giver;
  return quest.goal.kind === 'take' ? (words.to ?? quest.goal.to.name) : null;
}

/** A helper's voice, the same every time, high or low as the helper says. */
function helperVoice(id: string) {
  let hash = 7;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  const [, questId, role] = id.split(':');
  const quest = questById(questId);
  const goal = quest?.goal;
  const helper =
    role === 'to' ? (goal?.kind === 'take' && 'outfit' in goal.to ? goal.to : null) : quest?.giver;
  return voiceFor(Math.abs(hash), helper?.voice);
}

/**
 * Pins for the map: a ❗ on each helper with a job to give, and where to go for the job being
 * done.
 */
function questPins(
  done: ReadonlySet<string>,
  active: QuestProgress | null,
  locale: Locale,
): MapPin[] {
  const pins: MapPin[] = QUESTS.filter(
    (quest) => !done.has(quest.id) && quest.id !== active?.id,
  ).map((quest) => ({
    x: quest.giver.x,
    z: quest.giver.z,
    icon: '❗',
    name: questWords(quest, locale).giver,
  }));
  const quest = active ? questById(active.id) : null;
  if (quest && active)
    for (const spot of targets(quest, active))
      pins.push({ x: spot.x, z: spot.z, icon: quest.icon, target: true });
  return pins;
}

/**
 * The job being done, at the top of the screen: its picture, what to do in a few words, and a
 * picture for each thing to find, filled in as they are found.
 */
function QuestCard({
  quest,
  progress,
  talkKey,
  locale,
}: {
  quest: Quest;
  progress: QuestProgress;
  talkKey: string;
  locale: Locale;
}) {
  const { goal } = quest;
  const things =
    goal.kind === 'find' && progress.step === 'go' && goal.spots.length > 1
      ? goal.spots.map((_, index) => progress.found.includes(index))
      : goal.kind === 'find' && progress.step === 'build' && goal.build
        ? goal.build.pieces.map((_, index) => index < progress.built)
        : null;
  return (
    <div className="quest-card" role="status">
      <span className="quest-icon" aria-hidden>
        {quest.icon}
      </span>
      <div>
        <strong>
          {progress.step === 'build' ? (
            <>
              Press <kbd>{talkKey}</kbd> to build!
            </>
          ) : (
            `${taskLine(quest, progress, locale)}!`
          )}
        </strong>
        {things && (
          <span
            className="quest-things"
            aria-label={`${things.filter(Boolean).length} of ${things.length}`}
          >
            {things.map((got, index) => (
              <span key={index} className={got ? 'got' : undefined}>
                {progress.step === 'build' ? '🧱' : quest.icon}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

const isVoiceMode = (name: unknown): name is VoiceMode =>
  name === 'simlish' || name === 'device' || name === 'off';

/**
 * The controls for the vehicle being driven, along the bottom of the screen: the keys, or with
 * `pad` the controller's buttons (see `drive-view.tsx`).
 */
function DriveHint({ kind, pad }: { kind: VehicleKind; pad: boolean }) {
  const air = kind === 'helicopter' || kind === 'airplane';
  if (pad)
    return (
      <div className="vehicle-hint driving">
        <span>
          <kbd>Left stick</kbd>{' '}
          {kind === 'airplane' ? 'steer, faster, slower' : air ? 'fly, turn' : 'steer, go'}
        </span>
        {air ? (
          <span>
            <kbd>A</kbd>
            <kbd>B</kbd> {kind === 'airplane' ? 'climb, dive' : 'up, down'}
          </span>
        ) : (
          <span>
            <kbd>RT</kbd>
            <kbd>LT</kbd> go, brake
          </span>
        )}
        {kind !== 'bike' && (
          <span>
            <kbd>Y</kbd> horn
          </span>
        )}
        <span>
          <kbd>X</kbd> get out
        </span>
      </div>
    );
  return (
    <div className="vehicle-hint driving">
      <span>
        <kbd>W</kbd>
        <kbd>S</kbd> {kind === 'airplane' ? 'faster, slower' : air ? 'forward, back' : 'go, brake'}
      </span>
      <span>
        <kbd>A</kbd>
        <kbd>D</kbd> {kind === 'helicopter' ? 'turn' : 'steer'}
      </span>
      {air ? (
        <span>
          <kbd>Space</kbd>
          <kbd>Shift</kbd> {kind === 'airplane' ? 'climb, dive' : 'up, down'}
        </span>
      ) : (
        <span>
          <kbd>Space</kbd> handbrake
        </span>
      )}
      {kind !== 'bike' && (
        <span>
          <kbd>H</kbd> horn
        </span>
      )}
      <span>
        <kbd>E</kbd> get out
      </span>
    </div>
  );
}
