import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  Boxes,
  Camera,
  ChevronDown,
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
  applyPatch,
  previewPatch,
  evaluateAssemblyPolicy,
  createDemoAssembly,
  createExampleAssembly,
  exportLDraw,
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
  sharedPhysicalAssessment,
  validateAddition,
  validateAssembly,
} from '@brick-workshop/engine';
import type {
  Assembly,
  Brick,
  PartColorEvidence,
  PatchResult,
  PhysicalData,
  Part,
  Rotation,
  EditPolicy,
} from '@brick-workshop/engine';
import { Scene, captureScene } from './Scene';
import { MOODS } from './cinematic';
import type { CinematicMood } from './cinematic';
import type { BuildProgress, PointerDevice, PointerTarget, SceneMode } from './Scene';
import { ViewportLoader } from './ViewportLoader';
import { useLDrawLibrary } from './ldraw';
import { displayHex } from './ldraw-materials';
import { PartBrowser } from './PartBrowser';
import { usePartThumbnail } from './part-thumbnails';
import { ColorPicker } from './ColorPicker';
import { GenerationPanel } from './GenerationPanel';
import { BOARD_SIZES, DetailsPanel } from './DetailsPanel';
import { Menu } from './Menu';
import {
  createBuildDocument,
  listSavedBuilds,
  loadSavedBuild,
  openBuildDocument,
  readAutosave,
  saveBuild,
  writeAutosave,
} from './saved-builds';
import type { SavedBuildSummary } from './saved-builds';

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
 * Where a piece lands for the face under the pointer: on top of a brick, against one of its
 * sides at the same level, below it, or on the board. Studs line up with the brick that was hit.
 */
function placementFor(
  target: PointerTarget,
  partId: string,
  color: number,
  rotation: Rotation,
  area: number,
): Brick | null {
  const brick: Brick = { id: 'placement-preview', partId, color, x: 0, y: 0, z: 0, rotation };
  const size = footprint(brick);
  const hit = target.brick;
  if (hit && INSERT_FRAME_PARTS[partId] === hit.partId) return seatInFrame(hit, brick, target);
  if (!hit && (target.x < 0 || target.z < 0 || target.x > area || target.z > area)) return null;
  const offsetX = hit ? hit.x % 1 : 0;
  const offsetZ = hit ? hit.z % 1 : 0;
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);
  let x = clamp(Math.round(target.x - size.width / 2 - offsetX) + offsetX, area - size.width);
  let z = clamp(Math.round(target.z - size.depth / 2 - offsetZ) + offsetZ, area - size.depth);
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
  }
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

function refusal(result: Extract<PatchResult, { ok: false }>) {
  const code = result.assessment?.geometry[0]?.code;
  if (code === 'collision') return 'That spot is already taken.';
  if (code === 'unsupported') return 'Nothing underneath to hold it.';
  if (result.error.code === 'physical_rejected')
    return 'It would not stay up: the physical check rejects it.';
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
  const [tool, setTool] = useState<SceneMode>('select');
  const [target, setTarget] = useState<PointerTarget | null>(null);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [moreColors, setMoreColors] = useState(false);
  const [selectionColorsOpen, setSelectionColorsOpen] = useState(false);
  const [explode, setExplode] = useState(false);
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
  // Shared with the preview that checked this build, so read only.
  const physical = useMemo(
    () =>
      sharedPhysicalAssessment(assembly, {
        data: physicalData,
        estimateMissingMasses,
        useCatalogMasses,
      }),
    [assembly, physicalData, estimateMissingMasses, useCatalogMasses],
  );
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
        ? placementFor(target, partId, color, rotation, buildArea)
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
  }, [assembly, tool, shiftHeld, target, partId, color, rotation, buildArea]);
  useLayoutEffect(() => {
    ghostRef.current = { assembly, ghost };
  }, [assembly, ghost]);
  const editPolicy = useMemo<EditPolicy>(
    () => ({
      evidence,
      requireObservedColors: false,
      rejectInfeasible,
      physical: { data: physicalData, estimateMissingMasses, useCatalogMasses },
    }),
    [evidence, rejectInfeasible, physicalData, estimateMissingMasses, useCatalogMasses],
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
      { policy: editPolicy },
    );
  }, [assembly, ghost, editPolicy, settled]);
  useEffect(() => {
    if (preview !== 'pending' || !ghost) return;
    const timer = setTimeout(
      () =>
        setSettled({
          assembly,
          ghost,
          policy: editPolicy,
          result: previewPatch(
            assembly,
            { operations: [{ type: 'add', brick: ghost }] },
            { policy: editPolicy },
          ),
        }),
      PREVIEW_REST_MS,
    );
    return () => clearTimeout(timer);
  }, [preview, assembly, ghost, editPolicy]);
  const candidate = preview === 'pending' ? null : preview;
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
    setHistory({
      past: [...history.past.slice(-49), assembly],
      present: next,
      future: [],
    });
    setMessage('');
  }
  function addBrick(brick: Brick) {
    const result = applyPatch(
      assembly,
      { operations: [{ type: 'add', brick: { ...brick, id: crypto.randomUUID() } }] },
      { policy: editPolicy },
    );
    if (result.ok) {
      commit(result.assembly);
      setLayer(MAX_HEIGHT);
    } else setMessage(refusal(result));
  }
  function removeBrick(id: string) {
    const result = applyPatch(
      assembly,
      { operations: [{ type: 'remove', id }] },
      { policy: editPolicy },
    );
    if (result.ok) {
      commit(result.assembly);
      if (selectedId === id) setSelectedId(null);
    } else
      setMessage(
        result.error.code === 'physical_rejected'
          ? 'Removing it would make the build fall: the physical check rejects it.'
          : 'Other pieces rest on this one. Remove those first.',
      );
  }
  function rotateSelected(direction: 1 | -1 = 1) {
    if (!selected) return;
    const result = applyPatch(
      assembly,
      {
        operations: [
          {
            type: 'update',
            id: selected.id,
            changes: { rotation: ((selected.rotation + 360 + direction * 90) % 360) as Rotation },
          },
        ],
      },
      { policy: editPolicy },
    );
    if (result.ok) commit(result.assembly);
    else setMessage(`Can't rotate here. ${refusal(result)}`);
  }
  function recolorSelected(id: number) {
    if (!selected || selected.color === id) return;
    const result = applyPatch(
      assembly,
      { operations: [{ type: 'update', id: selected.id, changes: { color: id } }] },
      { policy: editPolicy },
    );
    if (result.ok) commit(result.assembly);
    else setMessage(`Can't recolor this piece. ${refusal(result)}`);
  }
  const pickColor = editingSelection ? recolorSelected : selectColor;
  function pickUp(brick: Brick) {
    setPartId(brick.partId);
    setColor(brick.color);
    setRotation(brick.rotation);
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
    const brick = placementFor(hit, partId, color, rotation, buildArea);
    const previewed =
      ghost !== null &&
      brick !== null &&
      (['x', 'y', 'z', 'rotation'] as const).every((key) => ghost[key] === brick[key]);
    // On the previewed spot the preview already holds the checked build, or the refusal that the
    // hint above the dock explains.
    if (previewed && candidate) {
      if (candidate.ok) {
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
    const assessment = evaluateAssemblyPolicy(previous, editPolicy);
    if (!assessment.allowed) {
      setMessage(`Undo rejected by current policy. ${assessment.issues[0].message}`);
      return;
    }
    setHistory({
      past: history.past.slice(0, -1),
      present: previous,
      future: [assembly, ...history.future],
    });
    setSelectedId(null);
    setMessage('');
  }
  function redo() {
    const next = history.future[0];
    if (!next) return;
    const assessment = evaluateAssemblyPolicy(next, editPolicy);
    if (!assessment.allowed) {
      setMessage(`Redo rejected by current policy. ${assessment.issues[0].message}`);
      return;
    }
    setHistory({
      past: [...history.past, assembly],
      present: next,
      future: history.future.slice(1),
    });
    setSelectedId(null);
    setMessage('');
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

  function applyImportedAssembly(next: Assembly, original: Assembly, label: string) {
    if (assemblyRef.current !== original) {
      setMessage('Current build changed. Try again with the latest build.');
      return false;
    }
    const assessment = evaluateAssemblyPolicy(next, policyRef.current);
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
      if (applyImportedAssembly(next, assembly, 'Imported assembly')) setSavedId(null);
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
      if (applyImportedAssembly(next, original, `Saved build “${next.name}”`)) setSavedId(id);
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
        void saveCurrent();
      } else if (command || event.altKey) return;
      else if (key === 'v') chooseTool('select');
      else if (key === 'b') chooseTool('place');
      else if (key === 'e') chooseTool('erase');
      else if (key === 'r') {
        const direction = event.shiftKey ? -1 : 1;
        if (tool === 'select' && selected) rotateSelected(direction);
        else setRotation(((rotation + 360 + direction * 90) % 360) as Rotation);
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
          <span className="brand-mark" aria-hidden="true">
            <Boxes size={18} />
          </span>
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
                  {
                    label: 'Save',
                    icon: <Save size={15} />,
                    hint: '⌘S',
                    disabled: empty || issues.length > 0,
                    onSelect: () => void saveCurrent(),
                  },
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
          <button className="primary compact generate-button" onClick={() => openGeneration()}>
            <Sparkles size={15} />
            Generate
          </button>
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
              <p>Describe it and Claude drafts it, or build it yourself brick by brick.</p>
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
            </div>
            {tool === 'place' && (
              <p className="shortcut-hint">
                <kbd>Click</kbd> place · <kbd>R</kbd> rotate · <kbd>⇧</kbd> remove · <kbd>⌥</kbd>{' '}
                pick · <kbd>Esc</kbd> done
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
            hasEnvelopeOnlyParts={hasEnvelopeOnlyParts}
            height={height}
            buildArea={buildArea}
            evidence={evidence}
            physicalData={physicalData}
            settings={{ useCatalogMasses, estimateMissingMasses, rejectInfeasible }}
            onSettings={(next) => {
              setUseCatalogMasses(next.useCatalogMasses);
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
      {generation && (
        <GenerationPanel
          assembly={assembly}
          policy={editPolicy}
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
