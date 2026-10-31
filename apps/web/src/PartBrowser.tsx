import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Bounds, Center, OrbitControls } from '@react-three/drei';
import { Box3, Group, LineSegments, Mesh } from 'three';
import {
  Box,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  LibraryBig,
  LoaderCircle,
  Maximize,
  Plus,
  RotateCw,
  Search,
  X,
} from 'lucide-react';
import { ColorPicker } from './ColorPicker';
import { getPart } from '@lego-builder/brick-engine';
import type { Part } from '@lego-builder/brick-engine';
import type { CatalogPart, LibraryCatalog } from '../tooling/ldraw-library';
import { loadLDrawCatalog, loadLDrawPart } from './ldraw';
import { LDrawMesh, WorkshopEnvironment } from './Scene';
import { inferLDrawPartDefinition, searchCatalog } from './catalog';
import './part-browser.css';

function disposeModel(model: Group) {
  const geometries = new Set();
  const materials = new Set();
  model.traverse((object) => {
    if (object instanceof Mesh || object instanceof LineSegments) {
      if (!geometries.has(object.geometry)) {
        object.geometry.dispose();
        geometries.add(object.geometry);
      }
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!materials.has(material)) {
          material.dispose();
          materials.add(material);
        }
      }
    }
  });
}

function PartPreview({ part, onUse }: { part: CatalogPart; onUse: (part: Part) => void }) {
  const [preview, setPreview] = useState<{
    id: string;
    model: Group | null;
    error: string;
  }>({
    id: '',
    model: null,
    error: '',
  });
  const [retry, setRetry] = useState(0);
  const [cameraRevision, setCameraRevision] = useState(0);
  const [color, setColor] = useState<number>(4);
  useEffect(() => {
    let cancelled = false;
    let loaded: Group | undefined;
    loadLDrawPart(part.id)
      .then((model) => {
        if (cancelled) {
          disposeModel(model);
          return;
        }
        loaded = model;
        setPreview({ id: part.id, model, error: '' });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setPreview({
            id: part.id,
            model: null,
            error: error instanceof Error ? error.message : 'Part preview failed.',
          });
      });
    return () => {
      cancelled = true;
      if (loaded) disposeModel(loaded);
    };
  }, [part.id, retry]);
  const model = preview.id === part.id ? preview.model : null;
  const error = preview.id === part.id ? preview.error : '';
  const dimensions = model ? new Box3().setFromObject(model) : null;
  const inferredPart =
    !part.supported && dimensions
      ? inferLDrawPartDefinition(part, { min: dimensions.min, max: dimensions.max })
      : null;

  return (
    <section
      className="catalog-preview"
      aria-label="Part preview"
      data-preview-state={error ? 'error' : model ? 'ready' : 'loading'}
      data-part-id={part.id}
    >
      <div className="catalog-preview-toolbar">
        <span className="mono">#{part.id}</span>
        <span
          className={`support-badge ${part.supported ? 'supported' : ''}`}
          title={
            part.supported
              ? 'Curated connection and placement rules'
              : 'Bounding envelope only; connections are unknown'
          }
        >
          {part.supported ? <Check size={12} /> : <Eye size={12} />}
          {part.supported ? 'Grid rules' : 'Envelope only'}
        </span>
        <button
          className="icon-button"
          title="Reset part camera"
          aria-label="Reset part camera"
          onClick={() => setCameraRevision(cameraRevision + 1)}
        >
          <Maximize size={16} />
        </button>
      </div>
      <div className="catalog-canvas">
        <Canvas
          camera={{ position: [8, 6, 9], fov: 40 }}
          dpr={[1, 2]}
          gl={{ antialias: true, preserveDrawingBuffer: true }}
          aria-label="Interactive LDraw part preview"
        >
          <color attach="background" args={['#eef0ee']} />
          <WorkshopEnvironment />
          <ambientLight intensity={1.1} />
          <directionalLight position={[-8, 12, 10]} intensity={2.5} />
          <directionalLight position={[10, 3, -8]} intensity={0.7} />
          <OrbitControls makeDefault enableDamping />
          {model && (
            <Bounds key={`${part.id}:${retry}:${cameraRevision}`} fit clip observe margin={1.5}>
              <Center>
                <LDrawMesh
                  key={`${part.id}:${retry}:${color}`}
                  model={model}
                  color={color}
                  rotation={0}
                />
              </Center>
            </Bounds>
          )}
        </Canvas>
        {!model && (
          <div className="preview-overlay" role={error ? 'alert' : 'status'}>
            {error ? (
              <>
                <Box size={28} />
                <strong>Preview unavailable</strong>
                <span>{error}</span>
                <button
                  className="secondary"
                  onClick={() => {
                    setPreview({ id: part.id, model: null, error: '' });
                    setRetry(retry + 1);
                  }}
                >
                  <RotateCw size={14} />
                  Retry
                </button>
              </>
            ) : (
              <>
                <LoaderCircle size={24} className="spin" />
                <span>Loading part geometry</span>
              </>
            )}
          </div>
        )}
      </div>
      <div className="catalog-preview-details">
        <h3>{part.name}</h3>
        <div className="catalog-part-meta">
          <span>{part.category}</span>
          {dimensions && (
            <span className="mono">
              {((dimensions.max.x - dimensions.min.x) * 0.4).toFixed(1)} x{' '}
              {((dimensions.max.y - dimensions.min.y) * 0.4).toFixed(1)} x{' '}
              {((dimensions.max.z - dimensions.min.z) * 0.4).toFixed(1)} mm
            </span>
          )}
        </div>
        <div className="catalog-preview-actions">
          <ColorPicker color={color} onChange={setColor} />
          <button
            className="primary"
            disabled={!part.supported && !inferredPart}
            onClick={() => onUse(part.supported ? getPart(part.id) : inferredPart!)}
          >
            <Plus size={14} />
            Use in assembly
          </button>
        </div>
        <a
          href={`/ldraw/parts/${encodeURIComponent(part.id)}.dat`}
          target="_blank"
          rel="noreferrer"
          className="part-source-link"
        >
          Part source and attribution
        </a>
      </div>
    </section>
  );
}

export function PartBrowser({
  onClose,
  onUse,
}: {
  onClose: () => void;
  onUse: (part: Part) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [catalog, setCatalog] = useState<LibraryCatalog | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [category, setCategory] = useState('');
  const [supportedOnly, setSupportedOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState('3001');
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    loadLDrawCatalog()
      .then((result) => {
        if (cancelled) return;
        if (!result.available) {
          setError('Local LDraw library is unavailable.');
          return;
        }
        setCatalog(result);
        if (!result.parts.some((part) => part.id === '3001'))
          setSelectedId(result.parts[0]?.id || '');
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : 'Catalog loading failed.');
      });
    return () => {
      cancelled = true;
    };
  }, [retry]);
  const results = catalog
    ? searchCatalog(catalog.parts, deferredQuery, category, supportedOnly)
    : [];
  const totalPages = Math.max(1, Math.ceil(results.length / 40));
  const currentPage = Math.min(page, totalPages - 1);
  const selected = catalog?.parts.find((part) => part.id === selectedId);
  const visible = results.slice(currentPage * 40, (currentPage + 1) * 40);

  return (
    <dialog
      ref={dialog}
      className="part-browser"
      aria-labelledby="library-title"
      onCancel={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <div className="catalog-shell">
        <header className="catalog-header">
          <div>
            <LibraryBig size={20} />
            <h2 id="library-title">LDraw library</h2>
            {catalog && (
              <span className="catalog-total mono">
                {catalog.parts.length.toLocaleString()} parts
              </span>
            )}
          </div>
          <button
            className="icon-button"
            title="Close parts library"
            aria-label="Close parts library"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="catalog-layout">
          <section className="catalog-search-pane" aria-label="Library search">
            <label className="search-field">
              <Search size={15} />
              <input
                autoFocus
                aria-label="Search full library"
                placeholder="Part ID, name, or keyword"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                }}
              />
              {query && (
                <button
                  className="icon-button small"
                  title="Clear library search"
                  aria-label="Clear library search"
                  onClick={() => {
                    setQuery('');
                    setPage(0);
                  }}
                >
                  <X size={13} />
                </button>
              )}
            </label>
            <select
              aria-label="Library category"
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setPage(0);
              }}
            >
              <option value="">All categories</option>
              {catalog?.categories.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
            <label className="checkbox-label catalog-supported-filter">
              <input
                type="checkbox"
                checked={supportedOnly}
                onChange={(event) => {
                  setSupportedOnly(event.target.checked);
                  setPage(0);
                }}
              />
              Curated grid rules only
            </label>
            <div className="catalog-result-count">
              <span>{results.length.toLocaleString()} results</span>
              <span>
                {catalog?.parts.filter((part) => part.supported).length || 0} curated with grid
                rules
              </span>
            </div>
            <div className="catalog-results">
              {error ? (
                <div className="catalog-empty" role="alert">
                  <Box size={25} />
                  <span>{error}</span>
                  <button
                    className="secondary"
                    onClick={() => {
                      setError('');
                      setRetry(retry + 1);
                    }}
                  >
                    <RotateCw size={14} />
                    Retry
                  </button>
                </div>
              ) : !catalog ? (
                <div className="catalog-empty" role="status">
                  <LoaderCircle className="spin" size={24} />
                  <span>Indexing local library</span>
                </div>
              ) : results.length === 0 ? (
                <div className="catalog-empty">
                  <Search size={24} />
                  <span>No matching parts</span>
                  <button
                    className="secondary"
                    onClick={() => {
                      setQuery('');
                      setCategory('');
                      setSupportedOnly(false);
                      setPage(0);
                    }}
                  >
                    Clear filters
                  </button>
                </div>
              ) : (
                visible.map((part) => (
                  <button
                    className={`catalog-result ${selectedId === part.id ? 'active' : ''}`}
                    key={part.id}
                    aria-pressed={selectedId === part.id}
                    aria-label={`${part.id} ${part.name}`}
                    onClick={() => setSelectedId(part.id)}
                  >
                    <Box size={17} />
                    <span>
                      <strong>{part.name}</strong>
                      <small className="mono">
                        {part.id} <span>/ {part.category}</span>
                      </small>
                    </span>
                    {part.supported ? (
                      <Check size={14} className="supported-icon" aria-label="Curated grid rules" />
                    ) : (
                      <Eye size={14} className="muted" aria-label="Envelope only" />
                    )}
                  </button>
                ))
              )}
            </div>
            <footer className="catalog-pagination">
              <button
                className="icon-button"
                title="Previous results page"
                aria-label="Previous results page"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                <ChevronLeft size={16} />
              </button>
              <span className="mono">
                {currentPage + 1} / {totalPages}
              </span>
              <button
                className="icon-button"
                title="Next results page"
                aria-label="Next results page"
                disabled={currentPage + 1 >= totalPages}
                onClick={() => setPage(currentPage + 1)}
              >
                <ChevronRight size={16} />
              </button>
            </footer>
          </section>
          {selected ? (
            <PartPreview key={selected.id} part={selected} onUse={onUse} />
          ) : (
            <section className="catalog-preview catalog-empty">
              <Box size={32} />
              <span>No part selected</span>
            </section>
          )}
        </div>
      </div>
    </dialog>
  );
}
