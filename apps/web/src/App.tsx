import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Boxes,
  Check,
  CheckCheck,
  Download,
  Layers3,
  LibraryBig,
  Maximize,
  Plus,
  Redo2,
  RotateCw,
  Search,
  Scale,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import {
  COLORS,
  DEFAULT_PART_COLOR_EVIDENCE,
  EXAMPLES,
  MAX_HEIGHT,
  PARTS,
  assessPhysicalFeasibility,
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
  placeBrick,
  removeBrick,
  validateAssembly,
} from '@lego-builder/brick-engine';
import type {
  Assembly,
  Brick,
  PartColorEvidence,
  PhysicalData,
  Part,
  Rotation,
} from '@lego-builder/brick-engine';
import { Scene } from './Scene';
import { useLDrawLibrary } from './ldraw';
import { PartBrowser } from './PartBrowser';
import { ColorPicker } from './ColorPicker';

type History = { past: Assembly[]; present: Assembly; future: Assembly[] };

const StableColorPicker = memo(ColorPicker);
const PartList = memo(function PartList({
  parts,
  partId,
  onSelect,
  onPreview,
}: {
  parts: readonly Part[];
  partId: string;
  onSelect: (id: string) => void;
  onPreview: (enabled: boolean) => void;
}) {
  return (
    <div className="part-list">
      {parts.map((part) => (
        <button
          key={part.id}
          className={`part-item ${partId === part.id ? 'active' : ''}`}
          aria-pressed={partId === part.id}
          onClick={() => {
            onSelect(part.id);
            onPreview(true);
          }}
        >
          <span className={`part-visual ${part.kind} ${part.family ?? ''}`}>
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
          <span className="part-copy">
            <strong>{part.name}</strong>
            <small>
              {part.id}{' '}
              <span>
                / {part.height} {part.height === 1 ? 'plate' : 'plates'} tall
              </span>
            </small>
          </span>
          {partId === part.id && <Check size={14} className="part-check" />}
        </button>
      ))}
      {parts.length === 0 && <p className="empty-text">No matching parts</p>}
    </div>
  );
});

function download(contents: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const library = useLDrawLibrary();
  const [sceneReady, setSceneReady] = useState(false);
  const onSceneReady = useCallback(() => setSceneReady(true), []);
  const loading = library.status === 'loading' || !sceneReady;
  useEffect(() => {
    const overlay = document.getElementById('workshop-loading');
    if (!overlay) return;
    if (!loading) {
      overlay.remove();
      return;
    }
    const label = overlay.querySelector('[data-loading-message]');
    if (label)
      label.textContent = library.status === 'loading' ? 'Loading parts...' : 'Preparing scene...';
  }, [loading, library.status]);
  const evidenceFile = useRef<HTMLInputElement>(null);
  const physicalFile = useRef<HTMLInputElement>(null);
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
    present: createDemoAssembly(),
    future: [],
  }));
  const [partId, setPartId] = useState('3001');
  const [color, setColor] = useState<number>(4);
  const [position, setPosition] = useState({ x: 1, y: 0, z: 1 });
  const [rotation, setRotation] = useState<Rotation>(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [preview, setPreview] = useState(false);
  const [explode, setExplode] = useState(false);
  const [layer, setLayer] = useState(MAX_HEIGHT);
  const [view, setView] = useState<'perspective' | 'top' | 'front'>('perspective');
  const [cameraRevision, setCameraRevision] = useState(0);
  const [panel, setPanel] = useState<'inspect' | 'parts'>('inspect');
  const [exportFormat, setExportFormat] = useState('ldr');
  const [message, setMessage] = useState('');
  const [browserOpen, setBrowserOpen] = useState(false);
  const assembly = history.present;
  const buildArea = getBuildArea(assembly);
  const physical = useMemo(
    () =>
      assessPhysicalFeasibility(assembly, {
        data: physicalData,
        estimateMissingMasses,
        useCatalogMasses,
      }),
    [assembly, physicalData, estimateMissingMasses, useCatalogMasses],
  );
  const selected = assembly.bricks.find((brick) => brick.id === selectedId);
  const buildability = useMemo(() => getBuildabilityReport(physical), [physical]);
  const selectedMass = physical.masses.find((entry) => entry.brickId === selectedId)?.mass;
  const issues = useMemo(() => validateAssembly(assembly), [assembly]);
  const bill = useMemo(() => getBillOfMaterials(assembly), [assembly]);
  const height = useMemo(
    () => Math.max(1, ...assembly.bricks.map((brick) => brick.y + footprint(brick).height)),
    [assembly],
  );
  const visibleLayer = Math.min(layer, height);
  const ghost: Brick = useMemo(
    () => ({
      id: 'placement-preview',
      partId,
      color,
      ...position,
      rotation,
    }),
    [partId, color, position, rotation],
  );
  const candidate = useMemo(() => placeBrick(assembly, ghost), [assembly, ghost]);
  const colorStatus = useMemo(
    () => getPartColorStatus(partId, color, evidence),
    [partId, color, evidence],
  );
  const parts = useMemo(
    () =>
      PARTS.filter(
        (part) =>
          (category === 'all' || category === part.kind || category === part.family) &&
          `${part.name} ${part.id}`.toLowerCase().includes(search.toLowerCase()),
      ),
    [category, search],
  );
  const selectColor = useCallback((id: number) => {
    setColor(id);
    setPreview(true);
  }, []);

  function commit(next: Assembly) {
    setHistory({
      past: [...history.past.slice(-49), assembly],
      present: next,
      future: [],
    });
    setMessage('');
  }
  function addBrick() {
    if (!PARTS.some((part) => part.id === partId)) return;
    const result = placeBrick(assembly, { ...ghost, id: crypto.randomUUID() });
    if (result.ok) {
      const assessment = assessPhysicalFeasibility(result.assembly, {
        data: physicalData,
        estimateMissingMasses,
        useCatalogMasses,
      });
      if (rejectInfeasible && assessment.status === 'infeasible') {
        setMessage(`Physical model rejected placement. ${assessment.reasons[0]}`);
        return;
      }
      commit(result.assembly);
      setSelectedId(result.assembly.bricks.at(-1)!.id);
      setLayer(MAX_HEIGHT);
      setPreview(false);
      setMessage(`Piece added. Geometry passed; physical feasibility ${assessment.status}.`);
    } else setMessage(result.issues[0].message);
  }
  function deleteSelected() {
    if (!selected) return;
    const result = removeBrick(assembly, selected.id);
    if (result.ok) {
      const assessment = assessPhysicalFeasibility(result.assembly, {
        data: physicalData,
        estimateMissingMasses,
        useCatalogMasses,
      });
      if (rejectInfeasible && assessment.status === 'infeasible') {
        setMessage(`Physical model rejected removal. ${assessment.reasons[0]}`);
        return;
      }
      commit(result.assembly);
      setSelectedId(null);
    } else setMessage(`Cannot remove support. ${result.issues[0].message}`);
  }
  function undo() {
    const previous = history.past.at(-1);
    if (previous)
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
    if (next)
      setHistory({
        past: [...history.past, assembly],
        present: next,
        future: history.future.slice(1),
      });
    setSelectedId(null);
    setMessage('');
  }
  function exportAssembly() {
    const filename = assembly.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (exportFormat === 'ldr') download(exportLDraw(assembly), `${filename}.ldr`, 'text/plain');
    else
      download(
        JSON.stringify(
          {
            version: 1,
            assembly,
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
          },
          null,
          2,
        ),
        `${filename}.json`,
        'application/json',
      );
    setMessage('Unverified draft exported. Not approved for construction.');
  }
  function resetAssembly(next: Assembly) {
    commit(next);
    setSelectedId(null);
    setLayer(MAX_HEIGHT);
  }
  function loadExample(id: string) {
    resetAssembly(createExampleAssembly(id));
    setPreview(false);
    setExplode(false);
    setView('perspective');
    setCameraRevision((revision) => revision + 1);
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

  return (
    <div className="app-shell" inert={loading} aria-busy={loading}>
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">
            <Boxes size={23} />
          </span>
          <h1>
            Brick Workshop<span> / </span>
          </h1>
          <span className="workspace-label">Engine playground</span>
        </div>
        <div className="header-actions">
          <span className="local-status">
            <span />
            Local workspace
          </span>
          <select
            aria-label="Export format"
            value={exportFormat}
            onChange={(event) => setExportFormat(event.target.value)}
          >
            <option value="ldr">LDraw .ldr</option>
            <option value="json">Assembly .json</option>
          </select>
          <button
            className="primary compact"
            onClick={exportAssembly}
            disabled={!assembly.bricks.length || issues.length > 0}
            aria-label="Export assembly"
          >
            <Download size={15} />
            <span>Export</span>
          </button>
        </div>
      </header>
      <div className="document-bar">
        <div className="document-title">
          <Box size={16} />
          <span>{assembly.name}</span>
          <span className="document-tag">STUDY 01</span>
        </div>
        <div className="document-actions">
          <button
            className="quiet"
            onClick={() => resetAssembly({ name: 'Untitled build', bricks: [] })}
          >
            New build
          </button>
          <select
            className="example-select"
            aria-label="Load example"
            value=""
            onChange={(event) => loadExample(event.target.value)}
          >
            <option value="" disabled>
              Load example
            </option>
            {EXAMPLES.map((example) => (
              <option key={example.id} value={example.id}>
                {example.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <main className="workspace">
        <aside className="parts-sidebar">
          <div className="section-heading">
            <h2>Parts library</h2>
            <span className="count">{PARTS.length}</span>
          </div>
          <button className="secondary browse-library-button" onClick={() => setBrowserOpen(true)}>
            <LibraryBig size={15} />
            Browse full library
          </button>
          <label className="search-field">
            <Search size={15} />
            <input
              aria-label="Search parts"
              placeholder="Search name or part ID"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div className="segmented categories" aria-label="Part category">
            {[
              ['all', 'All'],
              ['brick', 'Bricks'],
              ['plate', 'Plates'],
              ['tile', 'Tiles'],
              ['tall', 'Tall'],
              ['slope', 'Slopes'],
              ['round', 'Round'],
              ['arch', 'Arches'],
              ['baseplate', 'Baseplates'],
              ['cone', 'Cones'],
              ['door', 'Doors'],
              ['window', 'Windows'],
            ].map(([value, label]) => (
              <button
                key={value}
                aria-pressed={category === value}
                onClick={() => setCategory(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <PartList parts={parts} partId={partId} onSelect={setPartId} onPreview={setPreview} />
          <section className="color-section">
            <div className="section-heading">
              <h2>Color</h2>
              <span className="muted">{COLORS.find((entry) => entry.id === color)?.name}</span>
            </div>
            <StableColorPicker color={color} onChange={selectColor} />
            <dl className="measurements color-availability" aria-label="Selected part color status">
              <div>
                <dt>Rendering</dt>
                <dd>{colorStatus.rendering}</dd>
              </div>
              <div>
                <dt>Manufacturing</dt>
                <dd title={colorStatus.reason}>
                  {colorStatus.manufactured === 'observed' ? 'Inventory observed' : 'Unknown'}
                </dd>
              </div>
              <div>
                <dt>Current stock</dt>
                <dd>Unknown</dd>
              </div>
            </dl>
          </section>
          <section className="placement-section">
            <div className="section-heading">
              <h2>Placement</h2>
              <button
                className="icon-button small"
                title="Rotate piece 90 degrees"
                aria-label="Rotate piece 90 degrees"
                onClick={() => {
                  setRotation(((rotation + 90) % 360) as Rotation);
                  setPreview(true);
                }}
              >
                <RotateCw size={15} />
              </button>
            </div>
            <div className="coordinate-inputs">
              {(['x', 'y', 'z'] as const).map((axis) => (
                <label key={axis}>
                  <span>
                    {axis.toUpperCase()}
                    {axis === 'y' && <small> / plates</small>}
                  </span>
                  <input
                    aria-label={`${axis.toUpperCase()} position`}
                    type="number"
                    min={0}
                    max={
                      axis === 'y'
                        ? MAX_HEIGHT - getPart(partId).height
                        : buildArea -
                          (axis === 'x' ? footprint(ghost).width : footprint(ghost).depth)
                    }
                    step={0.5}
                    value={position[axis]}
                    onChange={(event) => {
                      setPosition({
                        ...position,
                        [axis]: Number(event.target.value),
                      });
                      setPreview(true);
                    }}
                  />
                </label>
              ))}
            </div>
            <div className="placement-options">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={preview}
                  onChange={(event) => setPreview(event.target.checked)}
                />
                Preview
              </label>
              <span className="mono muted">{rotation} deg</span>
            </div>
            <button className="primary add-button" onClick={addBrick}>
              <Plus size={16} />
              Place piece
            </button>
            {preview && (
              <div className={`placement-status ${candidate.ok ? 'valid' : 'invalid'}`}>
                <span className="status-dot" />
                {candidate.ok
                  ? 'Placement available'
                  : candidate.issues[0].code === 'collision'
                    ? 'Collision detected'
                    : candidate.issues[0].code === 'unsupported'
                      ? 'No support below'
                      : 'Outside placement rules'}
              </div>
            )}
          </section>
          <div className="catalog-label">
            <span className="status-dot" />
            Prototype catalog <span>{String(PARTS.length).padStart(2, '0')} parts</span>
          </div>
        </aside>
        <section className="viewport-section" aria-label="3D brick assembly">
          <div className="viewport-toolbar">
            <div className="tool-group">
              <button
                className="icon-button"
                title="Undo"
                aria-label="Undo"
                disabled={!history.past.length}
                onClick={undo}
              >
                <Undo2 size={17} />
              </button>
              <button
                className="icon-button"
                title="Redo"
                aria-label="Redo"
                disabled={!history.future.length}
                onClick={redo}
              >
                <Redo2 size={17} />
              </button>
              <span className="tool-divider" />
              <button
                className="icon-button"
                title="Reset camera"
                aria-label="Reset camera"
                onClick={() => {
                  setView('perspective');
                  setCameraRevision(cameraRevision + 1);
                }}
              >
                <Maximize size={16} />
              </button>
            </div>
            <div className="segmented view-switcher">
              {(['perspective', 'top', 'front'] as const).map((entry) => (
                <button key={entry} aria-pressed={view === entry} onClick={() => setView(entry)}>
                  {entry === 'perspective' ? '3D' : entry === 'top' ? 'Top' : 'Front'}
                </button>
              ))}
            </div>
            <label className="checkbox-label explode-control">
              <input
                type="checkbox"
                checked={explode}
                onChange={(event) => setExplode(event.target.checked)}
              />
              <Layers3 size={15} />
              Explode
            </label>
          </div>
          <div className="scene-wrap">
            {library.status !== 'loading' && (
              <Scene
                assembly={assembly}
                selectedId={selectedId}
                onSelect={setSelectedId}
                ghost={preview ? ghost : null}
                ghostValid={candidate.ok}
                layer={visibleLayer}
                explode={explode}
                view={view}
                cameraRevision={cameraRevision}
                models={library.models}
                onReady={onSceneReady}
              />
            )}
            <div className="viewport-label" data-geometry={library.status} title={library.message}>
              <span className="status-dot" />
              {library.status === 'fallback'
                ? 'Prototype geometry / LDraw unavailable'
                : library.message}
              {library.status === 'ready' && (
                <a href="/ldraw/CAreadme.txt" target="_blank" rel="noreferrer">
                  Attribution
                </a>
              )}
            </div>
            <div className="viewport-axis">
              <span className="axis-x">X</span>
              <span className="axis-y">Y</span>
              <span className="axis-z">Z</span>
            </div>
          </div>
          <div className="layer-bar">
            <Layers3 size={16} />
            <label htmlFor="layer-slider">Layers</label>
            <input
              id="layer-slider"
              type="range"
              step={0.5}
              min={0}
              max={height}
              value={visibleLayer}
              onChange={(event) => setLayer(Number(event.target.value))}
            />
            <span className="mono">
              {visibleLayer}
              <span className="muted"> / {height}</span>
            </span>
            <button className="quiet" onClick={() => setLayer(MAX_HEIGHT)}>
              Show all
            </button>
          </div>
        </section>
        <aside className="inspector-sidebar">
          <div className="inspector-tabs">
            <button aria-pressed={panel === 'inspect'} onClick={() => setPanel('inspect')}>
              Inspector
            </button>
            <button aria-pressed={panel === 'parts'} onClick={() => setPanel('parts')}>
              Parts list<span>{bill.length}</span>
            </button>
          </div>
          {panel === 'inspect' ? (
            <>
              <section className="assembly-section">
                <div className="section-heading">
                  <h2>Assembly overview</h2>
                  <Boxes size={16} className="muted" />
                </div>
                <div className="assembly-stats">
                  <div>
                    <strong>{assembly.bricks.length}</strong>
                    <span>Pieces</span>
                  </div>
                  <div>
                    <strong>{new Set(assembly.bricks.map((brick) => brick.partId)).size}</strong>
                    <span>Part types</span>
                  </div>
                  <div>
                    <strong>{new Set(assembly.bricks.map((brick) => brick.color)).size}</strong>
                    <span>Colors</span>
                  </div>
                </div>
                <dl className="measurements">
                  <div>
                    <dt>Build area</dt>
                    <dd>
                      {buildArea} x {buildArea} studs
                    </dd>
                  </div>
                  <div>
                    <dt>Model height</dt>
                    <dd>{assembly.bricks.length ? (height * 3.2).toFixed(1) : '0'} mm</dd>
                  </div>
                  <div>
                    <dt>Orientation</dt>
                    <dd>Studs up</dd>
                  </div>
                </dl>
              </section>
              <section className="validation-section">
                <div className="section-heading">
                  <h2>Engine validation</h2>
                  <span className="live-label">LIVE</span>
                </div>
                <div className={`validation-banner ${issues.length ? 'failed' : ''}`}>
                  <CheckCheck size={18} />
                  <span>{issues.length ? 'Check failed' : 'Geometry checks passed'}</span>
                </div>
                <div className="check-list">
                  {[
                    'Supported prototype parts',
                    'No body collisions',
                    'Grounded stud connections',
                    'Half-unit grid alignment',
                  ].map((label) => (
                    <div key={label}>
                      <Check size={14} />
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
                <button
                  className="secondary validate-button"
                  onClick={() =>
                    setMessage(
                      issues.length
                        ? issues[0].message
                        : `Geometry passed. Gravity: ${physical.gravity}; physical feasibility: ${physical.status}. Strength and availability are not certified.`,
                    )
                  }
                >
                  <CheckCheck size={15} />
                  Run validation
                </button>
              </section>
              <section
                className="selection-section physical-section"
                aria-label="Physical feasibility"
              >
                <div className="section-heading">
                  <h2>Physical feasibility</h2>
                  <Scale size={16} className="muted" />
                </div>
                <div
                  className={`validation-banner ${buildability.status === 'failed' ? 'failed' : 'physical-warning'}`}
                >
                  <Scale size={18} />
                  <span>{buildability.label}</span>
                </div>
                <dl className="buildability-checks" aria-label="Required buildability checks">
                  {buildability.checks.map((check) => (
                    <div
                      key={check.id}
                      data-check={check.id}
                      data-check-status={check.status}
                      title={check.detail}
                    >
                      <dt>{check.label}</dt>
                      <dd>
                        {check.status === 'passed'
                          ? 'Passed (model)'
                          : check.status === 'estimated'
                            ? 'Estimated'
                            : check.status === 'reported'
                              ? 'Catalogue-reported'
                              : check.status === 'failed'
                                ? 'Failed'
                                : 'Unknown'}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="physical-note">
                  No 100% buildability guarantee. Physical validation and all required evidence are
                  still needed.
                </p>
                <dl className="measurements">
                  <div>
                    <dt>Total mass</dt>
                    <dd>
                      {physical.totalMassGrams === null
                        ? 'Unknown'
                        : `${physical.massBasis === 'measured' ? '' : '~ '}${physical.totalMassGrams.toFixed(2)} g`}
                    </dd>
                  </div>
                  <div>
                    <dt>Mass basis</dt>
                    <dd>
                      {physical.massBasis === 'catalog' ? 'Catalogue-reported' : physical.massBasis}
                    </dd>
                  </div>
                  <div>
                    <dt>Gravity</dt>
                    <dd>
                      {
                        {
                          'not-assessed': 'Unknown',
                          balanced: 'Static balance',
                          'requires-clutch': 'Needs stud tension',
                          unstable: 'No equilibrium',
                        }[physical.gravity]
                      }
                    </dd>
                  </div>
                  <div>
                    <dt>Stud tension</dt>
                    <dd>
                      {physical.minimumStudTensionNewtons === null
                        ? 'Unknown'
                        : `${physical.minimumStudTensionNewtons.toFixed(4)} N`}
                    </dd>
                  </div>
                  <div>
                    <dt>Tensile limit</dt>
                    <dd>
                      {
                        {
                          unknown: 'Unknown',
                          'within-supplied-limit': 'Within supplied limit',
                          'exceeds-supplied-limit': 'Exceeded',
                        }[physical.connectionStrength]
                      }
                    </dd>
                  </div>
                  <div>
                    <dt>Assembly access</dt>
                    <dd>Unverified</dd>
                  </div>
                </dl>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={useCatalogMasses}
                    onChange={(event) => setUseCatalogMasses(event.target.checked)}
                  />
                  Use catalogue weights
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={estimateMissingMasses}
                    onChange={(event) => setEstimateMissingMasses(event.target.checked)}
                  />
                  Estimate missing masses
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={rejectInfeasible}
                    onChange={(event) => setRejectInfeasible(event.target.checked)}
                  />
                  Reject infeasible edits
                </label>
                <p className="physical-note">
                  {physical.masses.some(({ mass }) => mass.kind === 'estimated')
                    ? 'Solid-envelope mass estimates are not actual part weights.'
                    : physical.masses.some(({ mass }) => mass.kind === 'catalog')
                      ? 'Catalogue weights are nominal; colour and mould differences are not measured.'
                      : (physical.reasons[0] ??
                        'Static model only; physical strength is not certified.')}
                </p>
                <details>
                  <summary>Assumptions and provenance</summary>
                  <ul>
                    {[...physical.reasons, ...physical.assumptions].map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                  {[
                    ...new Map(physical.masses.map(({ partId, mass }) => [partId, mass])).entries(),
                  ].map(([id, mass]) => (
                    <p key={id}>
                      {id}: {mass.massGrams} g / {mass.kind} / {mass.source}
                      {mass.catalog && (
                        <>
                          <br />
                          <a href={mass.catalog.url} target="_blank" rel="noreferrer">
                            BrickLink {mass.catalog.partId}
                          </a>{' '}
                          / {mass.catalog.retrievedAt}
                          <br />
                          {mass.catalog.mappingNote}
                        </>
                      )}
                    </p>
                  ))}
                  {physicalData.studConnection && (
                    <p>
                      Stud tension source: {physicalData.studConnection.source};{' '}
                      {physicalData.studConnection.maxTensionPerStudNewtons} N per stud / safety
                      factor {physicalData.studConnection.safetyFactor}.
                    </p>
                  )}
                </details>
                <input
                  ref={physicalFile}
                  type="file"
                  accept=".json,application/json"
                  hidden
                  aria-label="Import physical data"
                  onChange={(event) => {
                    void importPhysics(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                />
                <button className="secondary" onClick={() => physicalFile.current?.click()}>
                  <Upload size={15} />
                  Import physical data
                </button>
                {(Object.keys(physicalData.parts).length > 0 || physicalData.studConnection) && (
                  <button
                    className="quiet"
                    onClick={() => {
                      setPhysicalData({ version: 1, parts: {} });
                      try {
                        localStorage.removeItem('brick-workshop-physical-data-v1');
                      } catch {
                        setMessage(
                          'Physical data cleared for this session; browser storage is unavailable.',
                        );
                      }
                    }}
                  >
                    <Trash2 size={14} />
                    Clear physical data
                  </button>
                )}
              </section>
              <section className="selection-section">
                <div className="section-heading">
                  <h2>Inventory evidence</h2>
                </div>
                <dl className="measurements">
                  <div>
                    <dt>Observed combinations</dt>
                    <dd>{evidence.observations.length}</dd>
                  </div>
                  <div>
                    <dt>Mapped colors</dt>
                    <dd>
                      {Object.keys(evidence.mappings.colors).length} / {COLORS.length}
                    </dd>
                  </div>
                  <div>
                    <dt>Retrieved</dt>
                    <dd>{evidence.source.retrievedAt.slice(0, 10)}</dd>
                  </div>
                </dl>
                <a
                  href={evidence.source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="evidence-source"
                  title={evidence.source.mappingNote}
                >
                  Rebrickable source
                </a>
                <input
                  ref={evidenceFile}
                  type="file"
                  accept=".json,application/json"
                  hidden
                  aria-label="Import part color evidence"
                  onChange={(event) => {
                    void importEvidence(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                />
                <button className="secondary" onClick={() => evidenceFile.current?.click()}>
                  <Upload size={15} />
                  Import evidence
                </button>
              </section>
              <section className="selection-section">
                <div className="section-heading">
                  <h2>Selected piece</h2>
                  {selected && (
                    <button
                      className="icon-button small"
                      title="Clear selection"
                      aria-label="Clear selection"
                      onClick={() => setSelectedId(null)}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                {selected ? (
                  <>
                    <div className="selected-part">
                      <span
                        className="selected-color"
                        style={{
                          backgroundColor: COLORS.find((entry) => entry.id === selected.color)?.hex,
                        }}
                      />
                      <div>
                        <strong>{getPart(selected.partId).name}</strong>
                        <span className="mono">#{selected.partId}</span>
                      </div>
                    </div>
                    <dl className="measurements">
                      <div>
                        <dt>Position X / Y / Z</dt>
                        <dd className="mono">
                          {selected.x} / {selected.y} / {selected.z}
                        </dd>
                      </div>
                      <div>
                        <dt>Rotation</dt>
                        <dd>{selected.rotation} deg</dd>
                      </div>
                      <div>
                        <dt>Mass</dt>
                        <dd title={selectedMass?.source}>
                          {selectedMass
                            ? `${selectedMass.kind === 'estimated' ? '~ ' : ''}${selectedMass.massGrams.toFixed(2)} g`
                            : 'Unknown'}
                        </dd>
                      </div>
                      <div>
                        <dt>Color</dt>
                        <dd>{COLORS.find((entry) => entry.id === selected.color)?.name}</dd>
                      </div>
                    </dl>
                    <button className="secondary delete-button" onClick={deleteSelected}>
                      <Trash2 size={14} />
                      Remove piece
                    </button>
                  </>
                ) : (
                  <div className="empty-selection">
                    <Box size={26} strokeWidth={1.3} />
                    <span>No piece selected</span>
                  </div>
                )}
              </section>
            </>
          ) : (
            <section className="bom-section">
              <div className="section-heading">
                <h2>Bill of materials</h2>
                <span className="muted">{assembly.bricks.length} pcs</span>
              </div>
              <div className="bom-list">
                {bill.map((entry) => (
                  <div className="bom-row" key={`${entry.partId}:${entry.color}`}>
                    <span
                      className="bom-color"
                      style={{
                        backgroundColor: COLORS.find((item) => item.id === entry.color)?.hex,
                      }}
                    />
                    <div>
                      <strong>{getPart(entry.partId).name}</strong>
                      <small>
                        {entry.partId} / {COLORS.find((item) => item.id === entry.color)?.name}
                      </small>
                      <small
                        className="bom-availability"
                        title={getPartColorStatus(entry.partId, entry.color, evidence).reason}
                      >
                        {getPartColorStatus(entry.partId, entry.color, evidence).manufactured ===
                        'observed'
                          ? 'Inventory observed'
                          : 'Manufacturing unknown'}{' '}
                        / stock unknown
                      </small>
                    </div>
                    <span className="mono">{entry.quantity}</span>
                  </div>
                ))}
              </div>
              <button
                className="secondary"
                onClick={() =>
                  download(
                    JSON.stringify(
                      {
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
                      },
                      null,
                      2,
                    ),
                    'parts-list.json',
                    'application/json',
                  )
                }
              >
                <Download size={15} />
                Export parts list
              </button>
            </section>
          )}
          <div className="inspector-bottom">
            <Box size={15} />
            <span>Upright parts engine</span>
          </div>
        </aside>
      </main>
      <footer className="status-bar">
        <span>
          <span className="status-dot" />
          Engine ready
        </span>
        <span>{buildability.label}</span>
        <span className="mono">
          {assembly.bricks.length} pieces / {issues.length} geometry issues
        </span>
      </footer>
      {browserOpen && (
        <PartBrowser
          onClose={() => setBrowserOpen(false)}
          onUse={(id) => {
            if (!PARTS.some((part) => part.id === id)) return;
            setPartId(id);
            setCategory('all');
            setSearch('');
            setPreview(true);
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
