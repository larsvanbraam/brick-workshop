import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  Boxes,
  Camera,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Copy,
  Download,
  Eraser,
  FilePlus2,
  Hammer,
  Layers3,
  Leaf,
  LibraryBig,
  Maximize,
  MousePointer2,
  Orbit,
  PanelRight,
  Redo2,
  RotateCcw,
  RotateCw,
  Rotate3d,
  Save,
  Search,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import {
  COLORS,
  DEFAULT_PART_COLOR_EVIDENCE,
  EXAMPLES,
  INSERT_FRAME_PARTS,
  MAX_HEIGHT,
  PARTS,
  MAX_PHYSICS_PIECES,
  assessPhysicalFeasibility,
  previewPatch,
  evaluateAssemblyPolicy,
  createDemoAssembly,
  createExampleAssembly,
  exportLDraw,
  FACINGS,
  footprint,
  getBillOfMaterials,
  getBuildArea,
  getBuildabilityReport,
  getPart,
  getPartColorStatus,
  importPartColorEvidence,
  importPhysicalData,
  importAssembly,
  isMatchingInsertFrame,
  isRuntimePart,
  registerPart,
  resizeBuildArea,
  seatOnSideStuds,
  validateAddition,
  validateAssembly,
} from '@brick-workshop/engine';
import type {
  Assembly,
  AssemblyPatch,
  Brick,
  PartColorEvidence,
  PatchResult,
  PhysicalAssessment,
  PhysicalData,
  PhysicalOptions,
  Part,
  PolicyAssessment,
  Rotation,
  EditPolicy,
  Facing,
} from '@brick-workshop/engine';
import { PhysicsClient } from './physics-client';
import { Scene, captureScene } from './Scene';
import { MOODS } from './cinematic';
import type { CinematicMood } from './cinematic';
import type {
  BuildProgress,
  PointerDevice,
  PointerTarget,
  SceneMode,
  SceneStability,
} from './Scene';
import { ViewportLoader } from './ViewportLoader';
import { useLDrawLibrary } from './ldraw';
import { displayHex } from './ldraw-materials';
import { PartBrowser } from './PartBrowser';
import { usePartThumbnail } from './part-thumbnails';
import { ColorPicker } from './ColorPicker';
import { GenerationPanel } from './GenerationPanel';
import { GENERATION_ENABLED } from './generation';
import { BOARD_SIZES, DetailsPanel } from './DetailsPanel';
import { Menu } from './Menu';
import {
  createBuildDocument,
  listSavedBuilds,
  loadSavedBuild,
  openBuildDocument,
  readAutosave,
  saveBuild,
  SAVED_BUILDS_ENABLED,
  writeAutosave,
} from './saved-builds';
import type { SavedBuildSummary } from './saved-builds';
import brickLogo from './assets/brick-logo.svg';

type History = { past: Assembly[]; present: Assembly; future: Assembly[] };

const CATEGORIES = [
  ['all', 'All'],
  ['brick', 'Bricks'],
  ['plate', 'Plates'],
  ['tile', 'Tiles'],
  ['slope', 'Slopes'],
  ['round', 'Round'],
  ['tall', 'Tall'],
  ['arch', 'Arches'],
  ['window', 'Windows'],
  ['door', 'Doors'],
  ['baseplate', 'Baseplates'],
  ['cone', 'Cones'],
  ['detail', 'Details'],
  ['foliage', 'Foliage'],
] as const;
/** Everyday colors shown up front; the full LDraw catalogue sits behind "More colors". */
const QUICK_COLORS = [15, 0, 71, 72, 4, 25, 14, 2, 1, 70, 19, 28].filter((id) =>
  COLORS.some((entry) => entry.id === id),
);
const TOOLS = [
  { id: 'select', label: 'Select', key: 'V', icon: MousePointer2 },
  { id: 'place', label: 'Build', key: 'B', icon: Hammer },
  { id: 'erase', label: 'Erase', key: 'E', icon: Eraser },
] as const;

const StableColorPicker = memo(ColorPicker);
function PartTile({
  part,
  active,
  onSelect,
}: {
  part: Part;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const [element, setElement] = useState<HTMLButtonElement | null>(null);
  const thumbnail = usePartThumbnail(part.id, element);
  return (
    <button
      ref={setElement}
      className={`part-tile ${active ? 'active' : ''}`}
      aria-pressed={active}
      title={`${part.name} (${part.id})`}
      onClick={() => onSelect(part.id)}
    >
      {thumbnail ? (
        <img className="part-thumbnail" src={thumbnail} alt="" draggable={false} />
      ) : (
        <span className={`part-visual ${part.kind} ${part.family ?? ''}`}>
          {part.family === 'foliage' && <Leaf size={22} aria-hidden="true" />}
          <span
            className="mini-studs"
            style={{
              gridTemplateColumns: `repeat(${part.depth * 2}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${part.width * 2}, minmax(0, 1fr))`,
            }}
          >
            {part.connections.topStuds.map((site) => (
              <i
                key={`${site.x}:${site.z}`}
                style={{
                  gridRow: `${site.x * 2 + 1} / span 2`,
                  gridColumn: `${site.z * 2 + 1} / span 2`,
                }}
              />
            ))}
          </span>
        </span>
      )}
      <span className="part-name">{part.name}</span>
    </button>
  );
}

const PartGrid = memo(function PartGrid({
  parts,
  partId,
  onSelect,
}: {
  parts: readonly Part[];
  partId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="part-grid">
      {parts.map((part) => (
        <PartTile key={part.id} part={part} active={partId === part.id} onSelect={onSelect} />
      ))}
      {parts.length === 0 && <p className="empty-text">No matching parts</p>}
    </div>
  );
});

function download(contents: string | Blob, name: string, type: string) {
  const url = URL.createObjectURL(
    contents instanceof Blob ? contents : new Blob([contents], { type }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * A door or pane seated in the frame under the pointer, turned as chosen when that fits and
 * otherwise half or a quarter turn round (which picks the hinge end of a door). A casement goes
 * in the half of the frame nearest the pointer, upside down when that is the far end.
 */
function seatInFrame(
  frame: Brick,
  insert: Brick,
  pointer?: { x: number; z: number },
): Brick | null {
  const flips = getPart(insert.partId).flippable ? [false, true] : [false];
  const seats: Brick[] = [];
  for (const turn of [0, 180, 90, 270]) {
    const rotation = ((insert.rotation + turn) % 360) as Rotation;
    for (const upsideDown of flips)
      for (const dx of [0, -0.5, 0.5, -2, 2])
        for (const dz of [0, -0.5, 0.5, -2, 2]) {
          const { upsideDown: _, ...upright } = insert;
          const seated: Brick = {
            ...upright,
            rotation,
            x: frame.x + dx,
            y: frame.y,
            z: frame.z + dz,
            ...(upsideDown ? { upsideDown: true as const } : {}),
          };
          if (isMatchingInsertFrame(seated, frame)) seats.push(seated);
        }
    if (seats.length) break;
  }
  if (!pointer) return seats[0] ?? null;
  const distance = (brick: Brick) => {
    const size = footprint(brick);
    return Math.hypot(brick.x + size.width / 2 - pointer.x, brick.z + size.depth / 2 - pointer.z);
  };
  return seats.sort((first, second) => distance(first) - distance(second))[0] ?? null;
}

/**
 * How a piece of `size` sits around the pointer before any nudge: centered on it and kept on the
 * board, with studs lined up with the brick that was hit. `along` is the axis [ and ] slide it
 * on (its long side, or the side it is set against), and `min`/`max` how far it can slide there
 * before it would leave the board.
 */
function centeredAround(
  target: PointerTarget,
  size: { width: number; depth: number },
  area: number,
) {
  const hit = target.brick;
  const offsetX = hit ? hit.x % 1 : 0;
  const offsetZ = hit ? hit.z % 1 : 0;
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);
  const start = (pointer: number, length: number, offset: number) =>
    clamp(Math.round(pointer - length / 2 - offset) + offset, area - length);
  const x = start(target.x, size.width, offsetX);
  const z = start(target.z, size.depth, offsetZ);
  // Against a side the piece's place across that side is fixed, so it slides along it.
  const along =
    target.face === 'x-' || target.face === 'x+'
      ? 'z'
      : target.face === 'z-' || target.face === 'z+'
        ? 'x'
        : size.width >= size.depth
          ? 'x'
          : 'z';
  const [from, length] = along === 'x' ? [x, size.width] : [z, size.depth];
  return { x, z, along, min: -from, max: area - length - from } as const;
}

/** How the piece in hand is turned: spun about the vertical and, tipped over, on its side. */
interface Pose {
  rotation: Rotation;
  facing?: Facing;
}

/** Upright, then tipped onto its side facing each level direction in turn. */
const TIPS: readonly (Facing | undefined)[] = [undefined, ...FACINGS];
const nextTip = (facing: Facing | undefined, direction: 1 | -1) =>
  TIPS[(TIPS.indexOf(facing) + direction + TIPS.length) % TIPS.length];
/** The way a piece's top points when it is mounted on the side of a brick facing out. */
const SIDE_FACES: Partial<Record<PointerTarget['face'], Facing>> = {
  'x-': '-x',
  'x+': '+x',
  'z-': '-z',
  'z+': '+z',
};
/** Plates ↑ and ↓ lift a piece by: the finest height a clip can hold a bar at. */
const LIFT_STEP = 0.5;

/** The nudge [ or ] leads to from `nudge`, held to what keeps the piece on the board. */
function nextNudge(
  target: PointerTarget,
  partId: string,
  pose: Pose,
  area: number,
  nudge: number,
  step: number,
) {
  const size = footprint({ id: '', partId, color: 0, x: 0, y: 0, z: 0, ...pose });
  const { min, max } = centeredAround(target, size, area);
  const clamp = (value: number) => Math.min(Math.max(value, min), max);
  return clamp(clamp(nudge) + step);
}

/**
 * Where a piece lands for the face under the pointer: on top of a brick, against one of its
 * sides at the same level, below it, or on the board. Studs line up with the brick that was hit.
 * `nudge` slides it that many studs along its long side (or along the side it is set against),
 * so it can sit anywhere along a wall, not only centered on the pointer, and `lift` raises or
 * lowers it that many plates, such as a bar slid up or down through a clip.
 */
function placementFor(
  target: PointerTarget,
  partId: string,
  color: number,
  pose: Pose,
  area: number,
  nudge = 0,
  lift = 0,
): Brick | null {
  const upright: Brick = {
    id: 'placement-preview',
    partId,
    color,
    x: 0,
    y: 0,
    z: 0,
    rotation: pose.rotation,
  };
  const hit = target.brick;
  if (hit && INSERT_FRAME_PARTS[partId] === hit.partId) return seatInFrame(hit, upright, target);
  const brick: Brick = pose.facing ? { ...upright, facing: pose.facing } : upright;
  let size = footprint(brick);
  if (!hit && (target.x < 0 || target.z < 0 || target.x > area || target.z > area)) return null;
  const centered = centeredAround(target, size, area);
  const shift = Math.min(Math.max(nudge, centered.min), centered.max);
  let x = centered.x + (centered.along === 'x' ? shift : 0);
  let z = centered.z + (centered.along === 'z' ? shift : 0);
  let y = 0;
  if (hit) {
    const hitSize = footprint(hit);
    y =
      target.face === 'top'
        ? hit.y + hitSize.height
        : target.face === 'bottom'
          ? hit.y - size.height
          : hit.y;
    if (target.face === 'x-') x = hit.x - size.width;
    if (target.face === 'x+') x = hit.x + hitSize.width;
    if (target.face === 'z-') z = hit.z - size.depth;
    if (target.face === 'z+') z = hit.z + hitSize.depth;
    // Tipped and pointed at a wall, it turns to face out from it and seats on its side studs:
    // those on the face pointed at first, else on a side next to it (a recessed face, such as
    // the one behind a side stud, reads as its neighbour).
    const outward = SIDE_FACES[target.face];
    if (pose.facing && outward) {
      const turn = FACINGS.indexOf(outward);
      for (const side of [outward, FACINGS[(turn + 1) % 4], FACINGS[(turn + 3) % 4]]) {
        const seated = seatOnSideStuds({ ...brick, facing: side, x, y, z }, hit);
        if (!seated) continue;
        ({ x, y, z } = seated);
        brick.facing = side;
        size = footprint(brick);
        break;
      }
    }
  }
  y += lift;
  if (
    y < 0 ||
    y + size.height > MAX_HEIGHT ||
    x < 0 ||
    z < 0 ||
    x + size.width > area ||
    z + size.depth > area
  )
    return null;
  return { ...brick, x, y, z };
}

/** A short, plain reason a placement or removal was refused. */
const PLACEMENT_KEYS = ['partId', 'color', 'x', 'y', 'z', 'rotation', 'facing'] as const;

/** How long the pointer rests on a spot before the ghost's physical check runs. */
const PREVIEW_REST_MS = 120;
/** What the Details panel shows before the first physical check of a session returns. */
const UNCHECKED = assessPhysicalFeasibility({ name: '', bricks: [] });

/** The library parts an assembly uses, which the physics worker must register too. */
function runtimePartsOf(assembly: Assembly): Part[] {
  const ids = new Set(assembly.bricks.map((brick) => brick.partId).filter(isRuntimePart));
  return [...ids].map(getPart);
}

function refusal(result: Extract<PatchResult, { ok: false }>) {
  const code = result.assessment?.geometry[0]?.code;
  if (code === 'collision') return 'That spot is already taken.';
  if (code === 'unsupported') return 'Nothing underneath to hold it.';
  if (result.error.code === 'physical_rejected')
    return result.assessment?.physical?.connectionStrength === 'exceeds-supplied-limit'
      ? 'Too much would hang off its studs: they would pull apart.'
      : 'It would tip over: its weight falls outside what it stands on.';
  return result.error.message;
}

function readSetting<T extends string>(key: string, values: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return values.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeSetting(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Settings then last for this session only.
  }
}

function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

export default function App() {
  // Restored once: the last session's build, with the library parts it needs registered.
  const [autosave] = useState(readAutosave);
  const [runtimeParts, setRuntimeParts] = useState<Part[]>(() => autosave?.parts ?? []);
  const [sceneReady, setSceneReady] = useState(false);
  const onSceneReady = useCallback(() => setSceneReady(true), []);
  const assemblyFile = useRef<HTMLInputElement>(null);
  const partSearch = useRef<HTMLInputElement>(null);
  const [physicalData, setPhysicalData] = useState<PhysicalData>(() => {
    try {
      const saved = localStorage.getItem('brick-workshop-physical-data-v1');
      return importPhysicalData(saved ? JSON.parse(saved) : { version: 1, parts: {} });
    } catch {
      return { version: 1, parts: {} };
    }
  });
  const [estimateMissingMasses, setEstimateMissingMasses] = useState(true);
  const [useCatalogMasses, setUseCatalogMasses] = useState(true);
  const [useDefaultStudConnection, setUseDefaultStudConnection] = useState(true);
  const [rejectInfeasible, setRejectInfeasible] = useState(true);
  const [evidence, setEvidence] = useState<PartColorEvidence>(() => {
    try {
      const saved = localStorage.getItem('brick-workshop-part-color-evidence-v1');
      return saved ? importPartColorEvidence(JSON.parse(saved)) : DEFAULT_PART_COLOR_EVIDENCE;
    } catch {
      return DEFAULT_PART_COLOR_EVIDENCE;
    }
  });
  const [history, setHistory] = useState<History>(() => ({
    past: [],
    present: autosave?.assembly ?? createDemoAssembly(),
    future: [],
  }));
  /** The file in the builds folder this build saves to; null until it is first saved. */
  const [savedId, setSavedId] = useState<string | null>(() => autosave?.savedId ?? null);
  const [savedBuilds, setSavedBuilds] = useState<SavedBuildSummary[]>([]);
  const [partId, setPartId] = useState('3001');
  const [color, setColor] = useState<number>(4);
  const [rotation, setRotation] = useState<Rotation>(0);
  /** How many studs [ and ] have moved the piece along its long side, away from the pointer. */
  const [nudged, setNudged] = useState({ partId, steps: 0 });
  const nudge = nudged.partId === partId ? nudged.steps : 0;
  /** Whether the piece is tipped onto its side, and which way its top then points. */
  const [facing, setFacing] = useState<Facing | undefined>(undefined);
  const pose = useMemo<Pose>(
    () => (facing ? { rotation, facing } : { rotation }),
    [rotation, facing],
  );
  /** How many plates ↑ and ↓ have raised (or lowered) the piece from where the pointer puts it. */
  const [lifted, setLifted] = useState({ partId, plates: 0 });
  const lift = lifted.partId === partId ? lifted.plates : 0;
  const [tool, setTool] = useState<SceneMode>('select');
  const [target, setTarget] = useState<PointerTarget | null>(null);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [moreColors, setMoreColors] = useState(false);
  const [selectionColorsOpen, setSelectionColorsOpen] = useState(false);
  const [explode, setExplode] = useState(false);
  const [showBalance, setShowBalance] = useState(false);
  const [layer, setLayer] = useState(MAX_HEIGHT);
  const [layersOpen, setLayersOpen] = useState(false);
  const [scrollSetting, setScrollSetting] = useState<'auto' | PointerDevice>(() =>
    readSetting('brick-workshop-scroll-v1', ['auto', 'mouse', 'trackpad'] as const, 'auto'),
  );
  const [detectedDevice, setDetectedDevice] = useState<PointerDevice>(() =>
    readSetting('brick-workshop-device-v1', ['mouse', 'trackpad'] as const, 'mouse'),
  );
  const trackpad =
    scrollSetting === 'trackpad' || (scrollSetting === 'auto' && detectedDevice === 'trackpad');
  const [view, setView] = useState<'perspective' | 'top' | 'front'>('perspective');
  const [cameraRevision, setCameraRevision] = useState(0);
  const [cinematic, setCinematic] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [buildProgress, setBuildProgress] = useState<BuildProgress | null>(null);
  const [mood, setMood] = useState<CinematicMood>('studio');
  const [turntable, setTurntable] = useState(false);
  const cinematicStage = useMemo(
    () => (cinematic ? { mood, turntable } : null),
    [cinematic, mood, turntable],
  );
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [browserOpen, setBrowserOpen] = useState(false);
  const [generation, setGeneration] = useState<{ prompt: string } | null>(null);
  const [brief, setBrief] = useState('');
  const assembly = history.present;
  const assemblyRef = useRef(assembly);
  useLayoutEffect(() => {
    assemblyRef.current = assembly;
  }, [assembly]);
  useEffect(() => {
    writeAutosave(createBuildDocument(assembly, runtimeParts), savedId);
  }, [assembly, runtimeParts, savedId]);
  useEffect(() => {
    // Without the dev or preview server there is no builds folder; the list stays empty.
    listSavedBuilds().then(setSavedBuilds, () => {});
  }, []);
  const library = useLDrawLibrary([...assembly.bricks.map((brick) => brick.partId), partId]);
  const loading = library.status === 'loading' || !sceneReady;
  const hasNativeModels = Object.keys(library.models).length > 0;
  useEffect(() => {
    const overlay = document.getElementById('workshop-loading');
    if (!overlay) return;
    if (!loading) {
      overlay.dataset.done = '';
      overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
      // Fallback for when the transition never runs (reduced motion, hidden tab).
      setTimeout(() => overlay.remove(), 400);
      return;
    }
    const label = overlay.querySelector('[data-loading-message]');
    if (label)
      label.textContent = library.status === 'loading' ? 'Loading parts...' : 'Preparing scene...';
  }, [loading, library.status]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 5000);
    return () => clearTimeout(timer);
  }, [message]);
  const buildArea = getBuildArea(assembly);
  const physicalOptions = useMemo<PhysicalOptions>(
    () => ({
      data: physicalData,
      estimateMissingMasses,
      useCatalogMasses,
      useDefaultStudConnection,
    }),
    [physicalData, estimateMissingMasses, useCatalogMasses, useDefaultStudConnection],
  );
  // The static solve runs in a worker. Its client is made on first use, so React's development
  // double mount, which disposes it, simply makes another.
  const physicsRef = useRef<PhysicsClient | null>(null);
  const physics = () => (physicsRef.current ??= new PhysicsClient());
  const fullCheckRef = useRef<PhysicsClient | null>(null);
  useEffect(
    () => () => {
      physicsRef.current?.dispose();
      physicsRef.current = null;
      fullCheckRef.current?.dispose();
      fullCheckRef.current = null;
    },
    [],
  );
  const [assessed, setAssessed] = useState<{
    assembly: Assembly;
    options: PhysicalOptions;
    report: PhysicalAssessment;
  } | null>(null);
  useEffect(() => {
    let live = true;
    physics()
      .assess(assembly, physicalOptions, runtimePartsOf(assembly), 'display')
      .then((report) => live && setAssessed({ assembly, options: physicalOptions, report }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [assembly, physicalOptions]);
  // Past MAX_PHYSICS_PIECES only tipping is checked; a full check runs on request, on its own
  // worker so edits are not held up, and stops when the build changes.
  const [fullCheck, setFullCheck] = useState<{
    assembly: Assembly;
    report: PhysicalAssessment | null;
  } | null>(null);
  function cancelFullCheck() {
    fullCheckRef.current?.dispose();
    fullCheckRef.current = null;
    setFullCheck(null);
  }
  function runFullCheck() {
    fullCheckRef.current?.dispose();
    const client = (fullCheckRef.current = new PhysicsClient());
    const target = assembly;
    setFullCheck({ assembly: target, report: null });
    client
      .assess(target, { ...physicalOptions, fullCheck: true }, runtimePartsOf(target))
      .then((report) =>
        setFullCheck((state) =>
          state?.assembly === target ? { assembly: target, report } : state,
        ),
      )
      .catch((error: unknown) => {
        if (fullCheckRef.current === client) {
          setFullCheck(null);
          setMessage(`Full check failed. ${error instanceof Error ? error.message : ''}`.trim());
        }
      })
      .finally(() => {
        client.dispose();
        if (fullCheckRef.current === client) fullCheckRef.current = null;
      });
  }
  useEffect(() => {
    // A full check is of one build; an edit stops it.
    if (fullCheck && fullCheck.assembly !== assembly) cancelFullCheck();
  }, [assembly, fullCheck]);
  const physicsCurrent = assessed?.assembly === assembly && assessed.options === physicalOptions;
  const fullReport = fullCheck?.assembly === assembly ? fullCheck.report : null;
  // Until this build's check returns, the last one stays up, marked as checking.
  const physical = fullReport ?? assessed?.report ?? UNCHECKED;
  const fullCheckState = fullReport
    ? 'done'
    : fullCheck?.assembly === assembly
      ? 'running'
      : physicsCurrent &&
          physical.gravity === 'not-assessed' &&
          physical.groundedGroups.length > 0 &&
          assembly.bricks.length > MAX_PHYSICS_PIECES
        ? 'available'
        : 'none';
  const selected = assembly.bricks.find((brick) => brick.id === selectedId);
  useEffect(() => setSelectionColorsOpen(false), [selectedId, tool]);
  const buildability = useMemo(() => getBuildabilityReport(physical), [physical]);
  const issues = useMemo(() => validateAssembly(assembly), [assembly]);
  const hasEnvelopeOnlyParts = assembly.bricks.some((brick) => isRuntimePart(brick.partId));
  const bill = useMemo(() => getBillOfMaterials(assembly), [assembly]);
  const height = useMemo(
    () => Math.max(1, ...assembly.bricks.map((brick) => brick.y + footprint(brick).height)),
    [assembly],
  );
  const visibleLayer = Math.min(layer, height);
  const removing = tool === 'erase' || (tool === 'place' && shiftHeld);
  // The ghost keeps its identity while the pointer stays on one spot, and gets an ID of its own
  // so that its preview can be committed as is.
  const ghostRef = useRef<{ assembly: Assembly; ghost: Brick | null }>({ assembly, ghost: null });
  const ghost = useMemo(() => {
    const brick =
      tool === 'place' && !shiftHeld && target
        ? placementFor(target, partId, color, pose, buildArea, nudge, lift)
        : null;
    const previous = ghostRef.current;
    if (
      brick &&
      previous.ghost &&
      previous.assembly === assembly &&
      PLACEMENT_KEYS.every((key) => brick[key] === previous.ghost![key])
    )
      return previous.ghost;
    return brick && { ...brick, id: crypto.randomUUID() };
  }, [assembly, tool, shiftHeld, target, partId, color, pose, buildArea, nudge, lift]);
  useLayoutEffect(() => {
    ghostRef.current = { assembly, ghost };
  }, [assembly, ghost]);
  const editPolicy = useMemo<EditPolicy>(
    () => ({
      evidence,
      requireObservedColors: false,
      rejectInfeasible,
      physical: physicalOptions,
    }),
    [evidence, rejectInfeasible, physicalOptions],
  );
  const policyRef = useRef(editPolicy);
  useLayoutEffect(() => {
    policyRef.current = editPolicy;
  }, [editPolicy]);
  const [settled, setSettled] = useState<{
    assembly: Assembly;
    ghost: Brick;
    policy: EditPolicy;
    result: PatchResult;
  } | null>(null);
  const preview = useMemo(() => {
    if (!ghost) return null;
    if (settled?.assembly === assembly && settled.ghost === ghost && settled.policy === editPolicy)
      return settled.result;
    // Shape and support are checked at once. The physical check covers the whole build, so on
    // a spot that fits it waits until the pointer rests.
    const added = validateAddition(assembly, ghost);
    if (added && !added.issues.length) return 'pending';
    return previewPatch(
      assembly,
      { operations: [{ type: 'add', brick: ghost }] },
      { policy: { ...editPolicy, assessPhysics: false } },
    );
  }, [assembly, ghost, editPolicy, settled]);
  useEffect(() => {
    if (preview !== 'pending' || !ghost) return;
    let live = true;
    const timer = setTimeout(
      () =>
        void checkPatch(
          assembly,
          { operations: [{ type: 'add', brick: ghost }] },
          editPolicy,
          'preview',
        )
          .then((result) => live && setSettled({ assembly, ghost, policy: editPolicy, result }))
          .catch(() => {}),
      PREVIEW_REST_MS,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // checkPatch only reads refs and the arguments given.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, assembly, ghost, editPolicy]);
  const candidate = preview === 'pending' ? null : preview;
  // A placement the physical check refuses shows why on its own; otherwise on request.
  const rejectedPhysical =
    candidate && !candidate.ok && candidate.error.code === 'physical_rejected'
      ? (candidate.assessment?.physical ?? null)
      : null;
  const balanceShown = rejectedPhysical ?? (showBalance ? physical : null);
  const stability = useMemo<SceneStability | null>(
    () =>
      balanceShown && {
        groups: balanceShown.groundedGroups,
        overloaded: balanceShown.overloadedConnections,
      },
    [balanceShown],
  );
  // With a piece selected, the color controls recolor that piece instead of the brush.
  const editingSelection = tool === 'select' && selected !== undefined;
  const activeColor = editingSelection ? selected.color : color;
  const activePartId = editingSelection ? selected.partId : partId;
  const colorStatus = useMemo(
    () => getPartColorStatus(activePartId, activeColor, evidence),
    [activePartId, activeColor, evidence],
  );
  const parts = useMemo(
    () =>
      [...PARTS, ...runtimeParts].filter(
        (part) =>
          (category === 'all' || category === part.kind || category === part.family) &&
          `${part.name} ${part.id}`.toLowerCase().includes(search.toLowerCase()),
      ),
    [category, search, runtimeParts],
  );
  const choosePart = useCallback((id: string) => {
    setPartId(id);
    setTool('place');
    setExplode(false);
    setSelectedId(null);
    setTrayOpen(false);
  }, []);
  const selectColor = useCallback((id: number) => setColor(id), []);
  const colorName = (id: number) => COLORS.find((entry) => entry.id === id)?.name;

  function chooseTool(next: SceneMode) {
    setTool(next);
    if (next !== 'select') {
      setExplode(false);
      setSelectedId(null);
    }
  }
  function commit(next: Assembly) {
    setHistory((current) => ({
      past: [...current.past.slice(-49), current.present],
      present: next,
      future: [],
    }));
    setMessage('');
  }
  /** The policy check of a build, with its physical part run in the worker first. */
  async function checkAssembly(
    next: Assembly,
    policy = policyRef.current,
    key?: string,
  ): Promise<PolicyAssessment> {
    if (policy.physical)
      // On failure the policy check below assesses it here instead.
      await physics()
        .assess(next, policy.physical, runtimePartsOf(next), key)
        .catch(() => {});
    return evaluateAssemblyPolicy(next, policy);
  }
  /** A patch's result, like applyPatch's, with the physical check run in the worker. */
  async function checkPatch(
    base: Assembly,
    patch: AssemblyPatch,
    policy = policyRef.current,
    key?: string,
  ): Promise<PatchResult> {
    const draft = previewPatch(base, patch, { policy: { ...policy, assessPhysics: false } });
    if (!draft.ok) return draft;
    const assessment = await checkAssembly(draft.assembly, policy, key);
    if (assessment.allowed) return { ok: true, revision: 0, assembly: draft.assembly, assessment };
    const issue = assessment.issues[0];
    return {
      ok: false,
      revision: 0,
      error: { code: issue.code, message: issue.message, issues: issue.details },
      assessment,
    };
  }
  // One edit is checked at a time, and only lands if the build is still the one it started from.
  const editing = useRef(false);
  async function exclusively(task: (base: Assembly) => Promise<void>) {
    if (editing.current) return;
    editing.current = true;
    try {
      await task(assemblyRef.current);
    } finally {
      editing.current = false;
    }
  }
  function edit(patch: AssemblyPatch, done: (result: PatchResult) => void) {
    return exclusively(async (base) => {
      const result = await checkPatch(base, patch);
      if (assemblyRef.current === base) done(result);
    });
  }
  function addBrick(brick: Brick) {
    void edit(
      { operations: [{ type: 'add', brick: { ...brick, id: crypto.randomUUID() } }] },
      (result) => {
        if (result.ok) {
          commit(result.assembly);
          setLayer(MAX_HEIGHT);
        } else setMessage(refusal(result));
      },
    );
  }
  function removeBrick(id: string) {
    void edit({ operations: [{ type: 'remove', id }] }, (result) => {
      if (result.ok) {
        commit(result.assembly);
        setSelectedId((current) => (current === id ? null : current));
      } else
        setMessage(
          result.error.code === 'physical_rejected'
            ? 'Removing it would make the build fall: the physical check rejects it.'
            : 'Other pieces rest on this one. Remove those first.',
        );
    });
  }
  function rotateSelected(direction: 1 | -1 = 1) {
    if (!selected) return;
    void edit(
      {
        operations: [
          {
            type: 'update',
            id: selected.id,
            changes: { rotation: ((selected.rotation + 360 + direction * 90) % 360) as Rotation },
          },
        ],
      },
      (result) => {
        if (result.ok) commit(result.assembly);
        else setMessage(`Can't rotate here. ${refusal(result)}`);
      },
    );
  }
  function tipSelected(direction: 1 | -1 = 1) {
    if (!selected) return;
    void edit(
      {
        operations: [
          {
            type: 'update',
            id: selected.id,
            changes: { facing: nextTip(selected.facing, direction) ?? null },
          },
        ],
      },
      (result) => {
        if (result.ok) commit(result.assembly);
        else setMessage(`Can't tip it here. ${refusal(result)}`);
      },
    );
  }
  /** Raises or lowers the selected piece, such as a bar slid up or down through a clip. */
  function liftSelected(plates: number) {
    if (!selected) return;
    const y = selected.y + plates;
    if (y < 0) return;
    void edit({ operations: [{ type: 'update', id: selected.id, changes: { y } }] }, (result) => {
      if (result.ok) commit(result.assembly);
      else setMessage(`Can't move it ${plates > 0 ? 'up' : 'down'} here. ${refusal(result)}`);
    });
  }
  function recolorSelected(id: number) {
    if (!selected || selected.color === id) return;
    void edit(
      { operations: [{ type: 'update', id: selected.id, changes: { color: id } }] },
      (result) => {
        if (result.ok) commit(result.assembly);
        else setMessage(`Can't recolor this piece. ${refusal(result)}`);
      },
    );
  }
  const pickColor = editingSelection ? recolorSelected : selectColor;
  function pickUp(brick: Brick) {
    setPartId(brick.partId);
    setColor(brick.color);
    setRotation(brick.rotation);
    setFacing(brick.facing);
    chooseTool('place');
  }
  function activate(hit: PointerTarget, modifiers: { alt: boolean; shift: boolean }) {
    if (tool === 'erase' || (tool === 'place' && modifiers.shift)) {
      if (hit.brick) removeBrick(hit.brick.id);
      return;
    }
    if (modifiers.alt) {
      if (hit.brick) pickUp(hit.brick);
      return;
    }
    const brick = placementFor(hit, partId, color, pose, buildArea, nudge, lift);
    const previewed =
      ghost !== null &&
      brick !== null &&
      (['x', 'y', 'z', 'rotation', 'facing'] as const).every((key) => ghost[key] === brick[key]);
    // On the previewed spot the preview already holds the checked build, or the refusal that the
    // hint above the dock explains.
    if (previewed && candidate) {
      if (candidate.ok && !editing.current) {
        commit(candidate.assembly);
        setLayer(MAX_HEIGHT);
      }
      return;
    }
    // Clicked before the preview settled: no hint explains a refusal yet.
    if (brick) addBrick(brick);
  }
  function undo() {
    const previous = history.past.at(-1);
    if (!previous) return;
    void exclusively(async (base) => {
      const assessment = await checkAssembly(previous);
      if (assemblyRef.current !== base) return;
      if (!assessment.allowed) {
        setMessage(`Undo rejected by current policy. ${assessment.issues[0].message}`);
        return;
      }
      setHistory((current) =>
        current.present !== base || current.past.at(-1) !== previous
          ? current
          : {
              past: current.past.slice(0, -1),
              present: previous,
              future: [base, ...current.future],
            },
      );
      setSelectedId(null);
      setMessage('');
    });
  }
  function redo() {
    const next = history.future[0];
    if (!next) return;
    void exclusively(async (base) => {
      const assessment = await checkAssembly(next);
      if (assemblyRef.current !== base) return;
      if (!assessment.allowed) {
        setMessage(`Redo rejected by current policy. ${assessment.issues[0].message}`);
        return;
      }
      setHistory((current) =>
        current.present !== base || current.future[0] !== next
          ? current
          : { past: [...current.past, base], present: next, future: current.future.slice(1) },
      );
      setSelectedId(null);
      setMessage('');
    });
  }
  function report() {
    return {
      billOfMaterials: bill,
      physicalAssessment: physical,
      buildability,
      exportPurpose: 'unverified-draft',
      physicalData,
      physicalPolicy: {
        rejectInfeasible,
        estimateMissingMasses,
        useCatalogMasses,
        useDefaultStudConnection,
      },
      partColorEvidence: evidence,
      partColorStatuses: bill.map((entry) => ({
        partId: entry.partId,
        color: entry.color,
        ...getPartColorStatus(entry.partId, entry.color, evidence),
      })),
    };
  }
  function exportAssembly(format: 'ldr' | 'json') {
    const filename = assembly.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (format === 'ldr') download(exportLDraw(assembly), `${filename}.ldr`, 'text/plain');
    else
      download(
        JSON.stringify({ version: 1, assembly, ...report() }, null, 2),
        `${filename}.json`,
        'application/json',
      );
    setMessage('Exported as an unverified draft, not approved for construction.');
  }
  function exportParts() {
    download(JSON.stringify(report(), null, 2), 'parts-list.json', 'application/json');
  }
  function resetAssembly(next: Assembly) {
    commit(next);
    setSelectedId(null);
    setLayer(MAX_HEIGHT);
  }
  function resetView() {
    setExplode(false);
    setView('perspective');
    setCameraRevision((revision) => revision + 1);
  }
  function enterCinematic() {
    setTool('select');
    setSelectedId(null);
    setLayersOpen(false);
    setCinematic(true);
  }
  function exitCinematic() {
    setCinematic(false);
    setTurntable(false);
    resetView();
  }
  function captureScreenshot() {
    const canvas = document.querySelector<HTMLCanvasElement>('.viewport canvas');
    const filename = assembly.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (!canvas) return;
    void captureScene(canvas).then((blob) => {
      if (blob) download(blob, `${filename}.png`, 'image/png');
    });
  }
  function loadExample(id: string) {
    // Building and checking a big example takes a moment; the loader paints first.
    setPreparing(true);
    requestAnimationFrame(() =>
      setTimeout(() => {
        resetAssembly(createExampleAssembly(id));
        setSavedId(null);
        setTool('select');
        resetView();
        setPreparing(false);
      }, 0),
    );
  }
  function resizeBoard(size: number) {
    if (size === buildArea) return;
    const next = resizeBuildArea(assembly, size);
    if (next) commit(next);
    else setMessage(`The build doesn't fit on a ${size} × ${size} board.`);
  }
  function rename(name: string) {
    const trimmed = name.trim();
    if (trimmed && trimmed !== assembly.name) commit({ ...assembly, name: trimmed });
  }

  async function applyImportedAssembly(next: Assembly, original: Assembly, label: string) {
    if (assemblyRef.current !== original) {
      setMessage('Current build changed. Try again with the latest build.');
      return false;
    }
    const assessment = await checkAssembly(next);
    if (assemblyRef.current !== original) {
      setMessage('Current build changed. Try again with the latest build.');
      return false;
    }
    if (!assessment.allowed) {
      setMessage(`${label} rejected. ${assessment.issues[0].message}`);
      return false;
    }
    resetAssembly(next);
    setTool('select');
    resetView();
    setMessage(`${label} applied. Not approved for construction.`);
    return true;
  }

  async function importAssemblyFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error('Assembly JSON must be smaller than 2 MB.');
      const next = importAssembly(JSON.parse(await file.text()));
      if (await applyImportedAssembly(next, assembly, 'Imported assembly')) setSavedId(null);
    } catch (error) {
      setMessage(
        `Import failed. ${error instanceof Error ? error.message : 'Invalid assembly JSON.'}`,
      );
    }
  }

  async function saveCurrent() {
    if (assembly.bricks.length === 0 || issues.length > 0) return;
    try {
      const saved = await saveBuild(createBuildDocument(assembly, runtimeParts), savedId);
      setSavedId(saved.id);
      setMessage(`Saved to ${saved.path}`);
      listSavedBuilds().then(setSavedBuilds, () => {});
    } catch (error) {
      setMessage(`Save failed. ${error instanceof Error ? error.message : ''}`.trim());
    }
  }

  async function openSaved(id: string) {
    const original = assembly;
    try {
      const { assembly: next, parts } = openBuildDocument(await loadSavedBuild(id));
      setRuntimeParts((current) => [
        ...current,
        ...parts.filter((part) => !current.some((entry) => entry.id === part.id)),
      ]);
      if (await applyImportedAssembly(next, original, `Saved build “${next.name}”`)) setSavedId(id);
    } catch (error) {
      setMessage(`Open failed. ${error instanceof Error ? error.message : 'Invalid saved build.'}`);
    }
  }

  async function importPhysics(file?: File) {
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error('Physical data must be smaller than 2 MB.');
      const next = importPhysicalData(JSON.parse(await file.text()));
      setPhysicalData(next);
      try {
        localStorage.setItem('brick-workshop-physical-data-v1', JSON.stringify(next));
        setMessage(
          'Physical data imported. Provenance is supplied by the data owner, not independently verified.',
        );
      } catch {
        setMessage('Physical data imported for this session; browser storage is unavailable.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Invalid physical data.');
    }
  }

  function clearPhysics() {
    setPhysicalData({ version: 1, parts: {} });
    try {
      localStorage.removeItem('brick-workshop-physical-data-v1');
    } catch {
      setMessage('Physical data cleared for this session; browser storage is unavailable.');
    }
  }

  async function importEvidence(file?: File) {
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error('Evidence JSON must be smaller than 2 MB.');
      const next = importPartColorEvidence(JSON.parse(await file.text()));
      setEvidence(next);
      let saved = true;
      try {
        localStorage.setItem('brick-workshop-part-color-evidence-v1', JSON.stringify(next));
      } catch {
        saved = false;
      }
      setMessage(
        `Imported ${next.observations.length} observed combinations.${saved ? '' : ' Available for this session only.'}`,
      );
    } catch (error) {
      setMessage(
        `Evidence import failed: ${error instanceof Error ? error.message : 'Invalid JSON'}`,
      );
    }
  }

  function chooseScrollSetting(value: 'auto' | PointerDevice) {
    setScrollSetting(value);
    writeSetting('brick-workshop-scroll-v1', value);
  }
  function detectDevice(device: PointerDevice) {
    if (scrollSetting !== 'auto' || device === detectedDevice) return;
    setDetectedDevice(device);
    writeSetting('brick-workshop-device-v1', device);
    if (device === 'trackpad')
      setMessage('Trackpad detected: scroll to orbit, ⇧ scroll to pan, pinch to zoom.');
  }

  function openGeneration(prompt = '') {
    setGeneration({ prompt });
  }

  // Shortcuts resubscribe every render so they always act on the latest build.
  useEffect(() => {
    const modal = generation !== null || browserOpen;
    const keydown = (event: KeyboardEvent) => {
      setShiftHeld(event.shiftKey);
      if (modal || isTyping(event.target)) return;
      if (cinematic) {
        if (event.key === 'Escape') exitCinematic();
        return;
      }
      const key = event.key.toLowerCase();
      const command = event.metaKey || event.ctrlKey;
      if (command && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (command && key === 'y') {
        event.preventDefault();
        redo();
      } else if (command && key === 's') {
        event.preventDefault();
        if (SAVED_BUILDS_ENABLED) void saveCurrent();
      } else if (command || event.altKey) return;
      else if (key === 'v') chooseTool('select');
      else if (key === 'b') chooseTool('place');
      else if (key === 'e') chooseTool('erase');
      else if (key === 'r') {
        const direction = event.shiftKey ? -1 : 1;
        if (tool === 'select' && selected) rotateSelected(direction);
        else setRotation(((rotation + 360 + direction * 90) % 360) as Rotation);
      } else if (key === 't') {
        const direction = event.shiftKey ? -1 : 1;
        if (tool === 'select' && selected) tipSelected(direction);
        else setFacing(nextTip(facing, direction));
      } else if ((key === 'arrowup' || key === 'arrowdown') && (tool === 'place' || selected)) {
        event.preventDefault();
        const plates = (key === 'arrowup' ? 1 : -1) * LIFT_STEP * (event.shiftKey ? 6 : 1);
        if (tool === 'select') liftSelected(plates);
        else if (tool === 'place') {
          // Held above the board, so a press below it is not counted and stepping back shows.
          const base = target && placementFor(target, partId, color, pose, buildArea, nudge);
          setLifted({ partId, plates: Math.max(lift + plates, base ? -base.y : -Infinity) });
        }
      } else if ((key === '[' || key === ']') && tool === 'place') {
        // Held to the board, so a press past its edge is not counted and stepping back shows.
        const step = key === ']' ? 1 : -1;
        const steps = target
          ? nextNudge(target, partId, pose, buildArea, nudge, step)
          : nudge + step;
        setNudged({ partId, steps });
      } else if ((key === 'delete' || key === 'backspace') && selected) {
        event.preventDefault();
        removeBrick(selected.id);
      } else if (key === 'escape') {
        if (selectionColorsOpen) setSelectionColorsOpen(false);
        else if (tool !== 'select') chooseTool('select');
        else setSelectedId(null);
      } else if (key === '/') {
        event.preventDefault();
        setTrayOpen(true);
        partSearch.current?.focus();
      }
    };
    const keyup = (event: KeyboardEvent) => setShiftHeld(event.shiftKey);
    const blur = () => setShiftHeld(false);
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
    };
  });

  const healthy = !issues.length && buildability.status !== 'failed';
  const hint = !ghost
    ? tool === 'place'
      ? shiftHeld
        ? 'Click a piece to remove it'
        : 'Point at the board or a piece'
      : tool === 'erase'
        ? 'Click a piece to remove it'
        : null
    : candidate?.ok
      ? null
      : candidate && refusal(candidate);
  const empty = assembly.bricks.length === 0;
  const savedBuildsSection = savedBuilds.length
    ? [
        {
          title: 'Saved builds',
          items: savedBuilds.map((build) => ({
            key: build.id,
            label: build.name,
            hint: build.id === savedId ? 'current' : `${build.pieces} pcs`,
            onSelect: () => void openSaved(build.id),
          })),
        },
      ]
    : [];

  return (
    <div className="app-shell" inert={loading} aria-busy={loading}>
      <header className="app-header">
        <div className="brand">
          <img className="brand-logo" src={brickLogo} alt="" width={30} height={30} />
          <h1 className="visually-hidden">Brick Workshop</h1>
          <input
            key={assembly.name}
            className="build-name"
            aria-label="Build name"
            defaultValue={assembly.name}
            onBlur={(event) => rename(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') {
                event.currentTarget.value = assembly.name;
                event.currentTarget.blur();
              }
            }}
          />
          <Menu
            label="File"
            className="icon-button"
            align="start"
            trigger={<ChevronDown size={16} />}
            sections={[
              {
                items: [
                  {
                    label: 'New build',
                    icon: <FilePlus2 size={15} />,
                    onSelect: () => {
                      resetAssembly({ name: 'Untitled build', bricks: [] });
                      setSavedId(null);
                      setTool('select');
                      resetView();
                    },
                  },
                  ...(SAVED_BUILDS_ENABLED
                    ? [
                        {
                          label: 'Save',
                          icon: <Save size={15} />,
                          hint: '⌘S',
                          disabled: empty || issues.length > 0,
                          onSelect: () => void saveCurrent(),
                        },
                      ]
                    : []),
                  {
                    label: 'Import JSON…',
                    icon: <Upload size={15} />,
                    onSelect: () => assemblyFile.current?.click(),
                  },
                ],
              },
              ...savedBuildsSection,
              {
                title: 'Examples',
                items: EXAMPLES.map((example) => ({
                  label: example.name,
                  onSelect: () => loadExample(example.id),
                })),
              },
            ]}
          />
          <input
            ref={assemblyFile}
            type="file"
            accept=".json,application/json"
            hidden
            aria-label="Import assembly JSON"
            onChange={(event) => {
              void importAssemblyFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </div>
        <div className="header-actions">
          <div className="button-group">
            <button
              className="icon-button"
              title="Undo (⌘Z)"
              aria-label="Undo"
              disabled={!history.past.length}
              onClick={undo}
            >
              <Undo2 size={17} />
            </button>
            <button
              className="icon-button"
              title="Redo (⇧⌘Z)"
              aria-label="Redo"
              disabled={!history.future.length}
              onClick={redo}
            >
              <Redo2 size={17} />
            </button>
          </div>
          <button
            className="icon-button"
            title="Details"
            aria-label="Details"
            aria-pressed={detailsOpen}
            onClick={() => setDetailsOpen(!detailsOpen)}
          >
            <PanelRight size={17} />
          </button>
          <Menu
            label="Export"
            className="secondary compact"
            trigger={
              <>
                <Download size={15} />
                <span className="wide-only">Export</span>
              </>
            }
            sections={[
              {
                items: [
                  {
                    label: 'LDraw model',
                    hint: '.ldr',
                    disabled: empty || issues.length > 0,
                    onSelect: () => exportAssembly('ldr'),
                  },
                  {
                    label: 'Assembly',
                    hint: '.json',
                    disabled: empty || issues.length > 0,
                    onSelect: () => exportAssembly('json'),
                  },
                  {
                    label: 'Parts list',
                    hint: '.json',
                    disabled: empty,
                    onSelect: exportParts,
                  },
                ],
              },
              {
                items: [
                  {
                    label: 'Building instructions…',
                    hint: '.pdf',
                    disabled: empty || issues.length > 0,
                    // The autosave already holds the current build, so the new tab reads it.
                    onSelect: () => window.open('/instructions.html?build=current', '_blank'),
                  },
                ],
              },
            ]}
          />
          {GENERATION_ENABLED && (
            <button className="primary compact generate-button" onClick={() => openGeneration()}>
              <Sparkles size={15} />
              Generate
            </button>
          )}
        </div>
      </header>
      <main
        className={`workspace ${detailsOpen ? 'with-details' : ''} ${cinematic ? 'cinematic' : ''}`}
      >
        <aside className={`tray ${trayOpen ? 'open' : ''}`} aria-label="Parts">
          <div className="tray-header">
            <label className="search-field">
              <Search size={15} />
              <input
                ref={partSearch}
                aria-label="Search parts"
                placeholder="Search parts"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <kbd>/</kbd>
            </label>
            <div className="chips" aria-label="Part category">
              {CATEGORIES.map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={category === value}
                  onClick={() => setCategory(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <PartGrid parts={parts} partId={partId} onSelect={choosePart} />
          <button className="quiet browse-library-button" onClick={() => setBrowserOpen(true)}>
            <LibraryBig size={15} />
            Browse full library
          </button>
          <section className="color-section" aria-label="Color">
            <div className="section-heading">
              <h2>{editingSelection ? 'Selected piece color' : 'Color'}</h2>
              <span
                className="muted"
                title={`Manufacturing: ${colorStatus.manufactured === 'observed' ? 'inventory observed' : 'unknown'}. ${colorStatus.reason}`}
              >
                {colorName(activeColor)}
                {colorStatus.manufactured !== 'observed' && ' · unverified'}
              </span>
            </div>
            <div className="quick-colors" role="group" aria-label="Common colors">
              {QUICK_COLORS.map((id) => {
                const entry = COLORS.find((item) => item.id === id)!;
                return (
                  <button
                    key={id}
                    className="swatch"
                    aria-label={entry.name}
                    aria-pressed={activeColor === id}
                    title={entry.name}
                    style={{ backgroundColor: displayHex(entry) }}
                    onClick={() => pickColor(id)}
                  />
                );
              })}
            </div>
            <button
              className="quiet more-colors"
              aria-expanded={moreColors}
              onClick={() => setMoreColors(!moreColors)}
            >
              {moreColors ? 'Fewer colors' : 'More colors'}
              <ChevronDown size={14} className={moreColors ? 'flipped' : ''} />
            </button>
            {moreColors && <StableColorPicker color={activeColor} onChange={pickColor} />}
          </section>
        </aside>
        <section className="viewport" aria-label="3D brick assembly">
          {library.status !== 'loading' && (
            <Scene
              assembly={assembly}
              selectedId={cinematic ? null : selectedId}
              onSelect={setSelectedId}
              mode={tool}
              highlightId={removing && !cinematic ? target?.brick?.id : null}
              onHover={setTarget}
              trackpad={trackpad}
              onPointerDevice={detectDevice}
              onActivate={activate}
              ghost={cinematic ? null : ghost}
              ghostValid={preview === 'pending' || (candidate?.ok ?? false)}
              layer={visibleLayer}
              explode={explode}
              view={view}
              cameraRevision={cameraRevision}
              models={library.models}
              onReady={onSceneReady}
              cinematic={cinematicStage}
              pendingParts={library.pending}
              onBuildProgress={setBuildProgress}
              stability={cinematic ? null : stability}
            />
          )}
          <ViewportLoader
            stage={
              preparing
                ? 'preparing'
                : library.pending.length
                  ? 'parts'
                  : buildProgress
                    ? 'placing'
                    : null
            }
            progress={buildProgress}
          />

          {cinematic && (
            <div className="cinematic-bar" role="toolbar" aria-label="Cinematic view">
              <div className="segmented" role="group" aria-label="Lighting">
                {(Object.keys(MOODS) as CinematicMood[]).map((entry) => (
                  <button key={entry} aria-pressed={mood === entry} onClick={() => setMood(entry)}>
                    {MOODS[entry].label}
                  </button>
                ))}
              </div>
              <span className="divider" />
              <button
                className="icon-button"
                title="Turntable"
                aria-label="Turntable"
                aria-pressed={turntable}
                onClick={() => setTurntable(!turntable)}
              >
                <Orbit size={16} />
              </button>
              <button
                className="icon-button"
                title="Save screenshot"
                aria-label="Save screenshot"
                onClick={captureScreenshot}
              >
                <Camera size={16} />
              </button>
              <button
                className="icon-button"
                title="Exit cinematic view (Esc)"
                aria-label="Exit cinematic view"
                onClick={exitCinematic}
              >
                <X size={16} />
              </button>
            </div>
          )}

          <button
            className={`status-chip ${healthy ? 'ok' : issues.length ? 'failed' : 'warning'}`}
            title={buildability.label}
            onClick={() => setDetailsOpen(true)}
          >
            <span className="status-dot" />
            {assembly.bricks.length} {assembly.bricks.length === 1 ? 'piece' : 'pieces'}
            <span className="status-chip-detail">
              {issues.length
                ? `${issues.length} ${issues.length === 1 ? 'issue' : 'issues'}`
                : buildability.status === 'failed'
                  ? 'Unstable'
                  : 'Valid'}
            </span>
          </button>

          <div className="view-controls floating">
            <div className="segmented" role="group" aria-label="Camera view">
              {(['perspective', 'top', 'front'] as const).map((entry) => (
                <button
                  key={entry}
                  aria-pressed={view === entry}
                  onClick={() => {
                    setView(entry);
                    setCameraRevision((revision) => revision + 1);
                  }}
                >
                  {entry === 'perspective' ? '3D' : entry === 'top' ? 'Top' : 'Front'}
                </button>
              ))}
            </div>
            <span className="divider" />
            <div className="layers">
              <button
                className="icon-button"
                title="Layers"
                aria-label="Layers"
                aria-expanded={layersOpen}
                aria-pressed={visibleLayer < height}
                onClick={() => setLayersOpen(!layersOpen)}
              >
                <Layers3 size={16} />
              </button>
              {layersOpen && (
                <div className="layers-popover floating">
                  <label htmlFor="layer-slider">
                    Show up to layer <strong>{visibleLayer}</strong> of {height}
                  </label>
                  <input
                    id="layer-slider"
                    type="range"
                    step={0.5}
                    min={0}
                    max={height}
                    value={visibleLayer}
                    onChange={(event) => setLayer(Number(event.target.value))}
                  />
                  <div className="button-row">
                    <label className="switch">
                      <span>Explode</span>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={explode}
                        onChange={(event) => {
                          setExplode(event.target.checked);
                          if (event.target.checked) setTool('select');
                        }}
                      />
                    </label>
                    <label
                      className="switch"
                      title="Where the build's weight sits over what it stands on"
                    >
                      <span>Balance</span>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={showBalance}
                        onChange={(event) => setShowBalance(event.target.checked)}
                      />
                    </label>
                    <button className="quiet" onClick={() => setLayer(MAX_HEIGHT)}>
                      Show all
                    </button>
                  </div>
                  <div className="scroll-setting">
                    <span>Two-finger scroll</span>
                    <div className="segmented" role="group" aria-label="Scrolling">
                      {(['auto', 'mouse', 'trackpad'] as const).map((value) => (
                        <button
                          key={value}
                          aria-pressed={scrollSetting === value}
                          onClick={() => chooseScrollSetting(value)}
                        >
                          {value === 'auto' ? 'Auto' : value === 'mouse' ? 'Zooms' : 'Orbits'}
                        </button>
                      ))}
                    </div>
                    <small>
                      {trackpad
                        ? 'Scroll orbits, ⇧ scroll pans, pinch zooms.'
                        : 'Scroll and pinch zoom toward the pointer.'}
                    </small>
                  </div>
                </div>
              )}
            </div>
            <button
              className="icon-button"
              title="Reset camera"
              aria-label="Reset camera"
              onClick={resetView}
            >
              <Maximize size={16} />
            </button>
            <button
              className="icon-button"
              title="Cinematic view"
              aria-label="Cinematic view"
              disabled={empty}
              onClick={enterCinematic}
            >
              <Clapperboard size={16} />
            </button>
          </div>

          {empty && tool === 'select' && (
            <div className="empty-state floating">
              <Sparkles size={22} className="empty-icon" />
              <h2>What do you want to build?</h2>
              <p>
                {GENERATION_ENABLED
                  ? 'Describe it and Claude drafts it, or build it yourself brick by brick.'
                  : 'Build it yourself brick by brick, or start from an example.'}
              </p>
              {GENERATION_ENABLED && (
                <form
                  className="prompt-field"
                  onSubmit={(event) => {
                    event.preventDefault();
                    openGeneration(brief);
                  }}
                >
                  <input
                    aria-label="Describe a build"
                    placeholder="A small cottage with a red roof"
                    value={brief}
                    onChange={(event) => setBrief(event.target.value)}
                  />
                  <button
                    className="primary icon-button"
                    type="submit"
                    aria-label="Generate"
                    title="Generate"
                  >
                    <ArrowUp size={17} />
                  </button>
                </form>
              )}
              <div className="board-setting">
                <span>Board</span>
                <div className="segmented" role="group" aria-label="Board size">
                  {BOARD_SIZES.map((size) => (
                    <button
                      key={size}
                      aria-pressed={buildArea === size}
                      title={`${size} × ${size} studs`}
                      onClick={() => resizeBoard(size)}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
              <div className="empty-actions">
                <button className="secondary" onClick={() => chooseTool('place')}>
                  <Hammer size={15} />
                  Build by hand
                </button>
                <Menu
                  label="Open an example"
                  className="secondary"
                  align="start"
                  trigger={
                    <>
                      Open an example
                      <ChevronDown size={14} />
                    </>
                  }
                  sections={[
                    ...savedBuildsSection,
                    {
                      title: savedBuilds.length ? 'Examples' : undefined,
                      items: EXAMPLES.map((example) => ({
                        label: example.name,
                        onSelect: () => loadExample(example.id),
                      })),
                    },
                  ]}
                />
              </div>
            </div>
          )}

          <div className="bottom-stack">
            {tool === 'select' && selected && (
              <div className="selection-card floating" aria-label="Selected piece">
                {selectionColorsOpen && (
                  <div className="selection-colors floating" aria-label="Recolor piece">
                    <div className="quick-colors" role="group" aria-label="Common colors">
                      {QUICK_COLORS.map((id) => {
                        const entry = COLORS.find((item) => item.id === id)!;
                        return (
                          <button
                            key={id}
                            className="swatch"
                            aria-label={entry.name}
                            aria-pressed={selected.color === id}
                            title={entry.name}
                            style={{ backgroundColor: displayHex(entry) }}
                            onClick={() => recolorSelected(id)}
                          />
                        );
                      })}
                    </div>
                    <StableColorPicker color={selected.color} onChange={recolorSelected} />
                  </div>
                )}
                <button
                  className="selection-color"
                  title="Change color"
                  aria-label={`Change color, currently ${colorName(selected.color)}`}
                  aria-expanded={selectionColorsOpen}
                  style={{
                    backgroundColor: displayHex(
                      COLORS.find((entry) => entry.id === selected.color)!,
                    ),
                  }}
                  onClick={() => setSelectionColorsOpen(!selectionColorsOpen)}
                />
                <div className="selection-copy">
                  <strong>{getPart(selected.partId).name}</strong>
                  <small>
                    {colorName(selected.color)} · #{selected.partId}
                  </small>
                </div>
                <button
                  className="icon-button"
                  title="Rotate left (⇧R)"
                  aria-label="Rotate piece counter-clockwise"
                  onClick={() => rotateSelected(-1)}
                >
                  <RotateCcw size={16} />
                </button>
                <button
                  className="icon-button"
                  title="Rotate right (R)"
                  aria-label="Rotate piece clockwise"
                  onClick={() => rotateSelected(1)}
                >
                  <RotateCw size={16} />
                </button>
                <button
                  className="icon-button"
                  title="Tip onto its side (T)"
                  aria-label="Tip piece onto its side"
                  onClick={() => tipSelected(1)}
                >
                  <Rotate3d size={16} />
                </button>
                <button
                  className="icon-button"
                  title="Move up half a plate (↑)"
                  aria-label="Move piece up"
                  onClick={() => liftSelected(LIFT_STEP)}
                >
                  <ChevronUp size={16} />
                </button>
                <button
                  className="icon-button"
                  title="Move down half a plate (↓)"
                  aria-label="Move piece down"
                  onClick={() => liftSelected(-LIFT_STEP)}
                >
                  <ChevronDown size={16} />
                </button>
                <button
                  className="icon-button"
                  title="Build with this part and color"
                  aria-label="Build with this part and color"
                  onClick={() => pickUp(selected)}
                >
                  <Copy size={16} />
                </button>
                <button
                  className="icon-button danger"
                  title="Remove (Delete)"
                  aria-label="Remove piece"
                  onClick={() => removeBrick(selected.id)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            )}
            {hint && (
              <div className={`hint ${ghost ? 'invalid' : ''}`} role="status">
                {hint}
              </div>
            )}
            <div className="dock floating" role="toolbar" aria-label="Tools">
              <button
                className="dock-button narrow-only"
                aria-label="Parts"
                aria-pressed={trayOpen}
                onClick={() => setTrayOpen(!trayOpen)}
              >
                <Boxes size={18} />
              </button>
              {TOOLS.map(({ id, label, key, icon: Icon }) => (
                <button
                  key={id}
                  className="dock-button"
                  aria-pressed={tool === id}
                  title={`${label} (${key})`}
                  onClick={() => chooseTool(id)}
                >
                  <Icon size={18} />
                  <span>{label}</span>
                </button>
              ))}
              <span className="divider" />
              <button
                className="dock-brush"
                title="Current part, click to change"
                onClick={() => {
                  setTrayOpen(true);
                  partSearch.current?.focus();
                }}
              >
                <span
                  className="brush-color"
                  style={{
                    backgroundColor: displayHex(COLORS.find((entry) => entry.id === color)!),
                  }}
                />
                <span className="brush-name">{getPart(partId).name}</span>
              </button>
              <button
                className="dock-button"
                title="Rotate piece (R)"
                aria-label={`Rotate piece, currently ${rotation} degrees`}
                onClick={() => setRotation(((rotation + 90) % 360) as Rotation)}
              >
                <RotateCw size={18} />
                <span className="mono">{rotation}°</span>
              </button>
              <button
                className="dock-button"
                title="Tip piece onto its side (T)"
                aria-label={`Tip piece, currently ${facing ? `on its side, top facing ${facing}` : 'upright'}`}
                aria-pressed={!!facing}
                onClick={() => setFacing(nextTip(facing, 1))}
              >
                <Rotate3d size={18} />
                <span className="mono">{facing ?? 'up'}</span>
              </button>
            </div>
            {tool === 'place' && (
              <p className="shortcut-hint">
                <kbd>Click</kbd> place · <kbd>R</kbd> rotate · <kbd>T</kbd> tip · <kbd>[</kbd>{' '}
                <kbd>]</kbd> slide · <kbd>↑</kbd> <kbd>↓</kbd> lift · <kbd>⇧</kbd> remove ·{' '}
                <kbd>⌥</kbd> pick · <kbd>Esc</kbd> done
              </p>
            )}
            {tool === 'select' && !selected && !empty && (
              <p className="shortcut-hint">
                {trackpad ? (
                  <>
                    <kbd>Scroll</kbd> orbit · <kbd>⇧ Scroll</kbd> pan · <kbd>Pinch</kbd> zoom ·{' '}
                    <kbd>Double-tap</kbd> focus · <kbd>F</kbd> fit
                  </>
                ) : (
                  <>
                    <kbd>Drag</kbd> orbit · <kbd>Right-drag</kbd> or <kbd>Space</kbd> pan ·{' '}
                    <kbd>Scroll</kbd> zoom · <kbd>Double-click</kbd> focus · <kbd>F</kbd> fit
                  </>
                )}
              </p>
            )}
          </div>

          <div className="viewport-credit" title={library.message}>
            {library.status === 'fallback' && !hasNativeModels
              ? 'Prototype geometry, LDraw unavailable'
              : hasNativeModels && (
                  <a href="/ldraw/CAreadme.txt" target="_blank" rel="noreferrer">
                    LDraw parts
                  </a>
                )}
          </div>
        </section>
        {detailsOpen && (
          <DetailsPanel
            assembly={assembly}
            bill={bill}
            issues={issues}
            physical={physical}
            buildability={buildability}
            checking={!physicsCurrent && !fullReport}
            fullCheck={fullCheckState}
            onFullCheck={runFullCheck}
            onCancelFullCheck={cancelFullCheck}
            hasEnvelopeOnlyParts={hasEnvelopeOnlyParts}
            height={height}
            buildArea={buildArea}
            evidence={evidence}
            physicalData={physicalData}
            settings={{
              useCatalogMasses,
              estimateMissingMasses,
              useDefaultStudConnection,
              rejectInfeasible,
            }}
            onSettings={(next) => {
              setUseCatalogMasses(next.useCatalogMasses);
              setUseDefaultStudConnection(next.useDefaultStudConnection);
              setEstimateMissingMasses(next.estimateMissingMasses);
              setRejectInfeasible(next.rejectInfeasible);
            }}
            onImportPhysics={(file) => void importPhysics(file)}
            onClearPhysics={clearPhysics}
            onImportEvidence={(file) => void importEvidence(file)}
            onExportParts={exportParts}
            onResize={resizeBoard}
            onClose={() => setDetailsOpen(false)}
          />
        )}
      </main>
      {GENERATION_ENABLED && generation && (
        <GenerationPanel
          assembly={assembly}
          policy={editPolicy}
          checkAssembly={(next) => checkAssembly(next)}
          initialPrompt={generation.prompt}
          onClose={() => setGeneration(null)}
          onApply={(next, original) => applyImportedAssembly(next, original, 'AI draft')}
          onExport={(next) =>
            download(
              JSON.stringify(
                {
                  version: 1,
                  assembly: next,
                  exportPurpose: 'unverified-draft',
                },
                null,
                2,
              ),
              'ai-draft.json',
              'application/json',
            )
          }
        />
      )}
      {browserOpen && (
        <PartBrowser
          onClose={() => setBrowserOpen(false)}
          onUse={(part) => {
            if (!PARTS.some((entry) => entry.id === part.id)) {
              registerPart(part);
              setRuntimeParts((current) =>
                current.some((entry) => entry.id === part.id) ? current : [...current, part],
              );
            }
            setCategory('all');
            setSearch('');
            choosePart(part.id);
            setBrowserOpen(false);
          }}
        />
      )}
      {message && (
        <div className="toast" role="status">
          <span>{message}</span>
          <button
            className="icon-button small"
            title="Dismiss notification"
            aria-label="Dismiss notification"
            onClick={() => setMessage('')}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
