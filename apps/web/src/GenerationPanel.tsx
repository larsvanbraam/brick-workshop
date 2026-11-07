import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Download,
  ImagePlus,
  LoaderCircle,
  Maximize,
  RefreshCw,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import {
  encodeVoxelModel,
  evaluateAssemblyPolicy,
  getBuildArea,
  MAX_BUILD_AREA,
  MAX_HEIGHT,
  MAX_PIECES,
  MAX_VOXEL_LAYERS,
} from "@lego-builder/brick-engine";
import type {
  Assembly,
  EditPolicy,
  EncodedVoxelModel,
} from "@lego-builder/brick-engine";
import { Scene } from "./Scene";
import { useLDrawLibrary } from "./ldraw";
import { captureCanvas, preparePhoto, streamGeneration } from "./generation";
import type { ModelTriangles } from "./model-reference";

// The model converter (openskp, three.js loaders) is loaded on first use.
const loadModelReference = () => import("./model-reference");
const MODEL_ACCEPT = ".skp,.dae,.glb";
/**
 * Pieces a model conversion may use. More pieces allow a wider, more detailed model, but a
 * revision sends the whole draft to Claude, so token use grows with it.
 */
const MODEL_PIECE_BUDGET = 5000;
const MODEL_PROMPT =
  "Make this brick model look like the reference building: use the attached preview and the model's layer maps. Rework the converted draft where that improves the look: put glass in the window frames and doors in the door frames, replace solid balcony walls with railings, add sills, a roof ridge, a chimney cap and timber accents in the reference's colors, and fill the gaps that can be built.";
/** Earlier default briefs, replaced when a model is converted again. */
const MODEL_PROMPTS = [
  MODEL_PROMPT,
  "Finish this brick model converted from the reference 3D model. Keep the walls, roof slopes and window and door frames that are already placed. Close gaps where the roof or walls are missing, add details the layer maps show but the build lacks (railings, chimney tops, ridge caps), and fix colors.",
  "Refine this shell converted from the reference 3D model: add sloped roof pieces where the roof layers were skipped, door and window frames where the model has openings, and fix colors. Keep the existing walls.",
  "Refine this shell converted from the reference 3D model: replace the stepped roof edges with sloped roof pieces, add door and window frames where the model has openings, and fix colors. Keep the existing walls.",
];
import type {
  DraftResult,
  GenerationEvent,
  PhotoReference,
} from "./generation";
import "./generation.css";

const ignore = () => {};

/** What each workshop tool call means, shown while Claude works. */
const TOOL_ACTIVITY: Record<string, string> = {
  brick_catalog: "Browsing the brick catalog",
  brick_techniques: "Looking up building techniques",
  brick_candidates: "Choosing parts",
  brick_color_status: "Checking colors",
  brick_board: "Reviewing the board",
  brick_inspect: "Inspecting the build",
  brick_connection: "Checking connections",
  brick_physics: "Testing stability",
  brick_preview_patch: "Trying out pieces",
  brick_apply_patch: "Placing bricks",
  brick_place: "Placing bricks",
  brick_remove: "Removing bricks",
  brick_export: "Finishing the draft",
};
function describeActivity(event: GenerationEvent | undefined) {
  if (!event) return "Reading the brief";
  if (event.type === "text") return "Planning the build";
  const activity = TOOL_ACTIVITY[event.tool ?? ""] ?? "Working";
  return event.ok === false ? `${activity} (retrying)` : activity;
}
function formatElapsed(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

interface ServerStatus {
  configured: boolean;
  backend?: "api" | "claude-code" | null;
  busy: boolean;
  model: string;
}
async function readServerStatus(
  signal?: AbortSignal,
): Promise<ServerStatus | null> {
  try {
    const response = await fetch("/api/workshop/status", { signal });
    if (!response.ok) return null;
    const value = await response.json();
    return typeof value.configured === "boolean" &&
      typeof value.busy === "boolean" &&
      typeof value.model === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}

export function GenerationPanel({
  assembly,
  policy,
  initialPrompt = "",
  onClose,
  onApply,
  onExport,
}: {
  assembly: Assembly;
  policy: EditPolicy;
  initialPrompt?: string;
  onClose: () => void;
  onApply: (draft: Assembly, original: Assembly) => boolean;
  onExport: (draft: Assembly) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [original] = useState(() => assembly);
  const upload = useRef<HTMLInputElement>(null);
  const modelUpload = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const scene = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [source, setSource] = useState<"new" | "current" | "draft">("new");
  const [maxPieces, setMaxPieces] = useState(600);
  const [maxTurns, setMaxTurns] = useState(24);
  const [observedOnly, setObservedOnly] = useState(true);
  const [photos, setPhotos] = useState<PhotoReference[]>([]);
  const [modelTriangles, setModelTriangles] = useState<ModelTriangles | null>(
    null,
  );
  const [modelWidth, setModelWidth] = useState(MAX_BUILD_AREA);
  // Minifig scale suits doors, windows and railings; off, the model grows to the piece budget.
  const [minifigScale, setMinifigScale] = useState(true);
  // The converted model, sent with refinement requests while the model fill is the draft. The
  // server keeps it behind tools, so it does not cost Claude tokens unless a layer is read.
  const [modelReference, setModelReference] = useState<
    (EncodedVoxelModel & { origin: { x: number; z: number } }) | null
  >(null);
  const [processing, setProcessing] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DraftResult | null>(null);
  const [events, setEvents] = useState<GenerationEvent[]>([]);
  const [turn, setTurn] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [usage, setUsage] = useState<DraftResult["usage"]>({
    inputTokens: 0,
    outputTokens: 0,
  });
  const [error, setError] = useState("");
  const [view, setView] = useState<"perspective" | "top" | "front">(
    "perspective",
  );
  const [cameraRevision, setCameraRevision] = useState(0);
  const [previewMode, setPreviewMode] = useState<"draft" | "reference">(
    "draft",
  );
  const [photoIndex, setPhotoIndex] = useState(0);
  const library = useLDrawLibrary(
    result?.assembly.bricks.map((brick) => brick.partId) ?? [],
  );
  const assessment = useMemo(
    () => (result ? evaluateAssemblyPolicy(result.assembly, policy) : null),
    [result, policy],
  );
  const stale = assembly !== original;
  const activity = describeActivity(events.at(-1));

  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    setElapsed(0);
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [busy]);

  async function refreshStatus() {
    setStatus(await readServerStatus());
  }
  useEffect(() => {
    const previous = document.activeElement;
    const modal = dialog.current;
    modal?.showModal();
    const controller = new AbortController();
    void readServerStatus(controller.signal).then((value) => {
      if (!controller.signal.aborted) setStatus(value);
    });
    return () => {
      controller.abort();
      abort.current?.abort();
      modal?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    setError("");
    if (photos.length + files.length > 4) {
      setError("Use at most four reference photos.");
      return;
    }
    setProcessing(true);
    try {
      const next: PhotoReference[] = [];
      for (const file of Array.from(files)) next.push(await preparePhoto(file));
      setPhotos((current) => [...current, ...next]);
      setConsent(false);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Photo could not be decoded.",
      );
    } finally {
      setProcessing(false);
    }
  }

  async function convertModel(
    triangles: ModelTriangles,
    maxWidth: number,
    observedColors = observedOnly,
  ) {
    setError("");
    try {
      const { MINIFIG_STUD_METERS, fitModel, modelColorPolicy } =
        await loadModelReference();
      const { palette, colorAllowed } = modelColorPolicy(
        policy.evidence,
        observedColors,
      );
      const { width, model, fill, limitedBy } = fitModel(triangles, {
        maxWidth,
        pieceBudget: MODEL_PIECE_BUDGET,
        palette,
        colorAllowed,
        buildArea: getBuildArea(original),
        studMeters: minifigScale ? MINIFIG_STUD_METERS : undefined,
      });
      const pieces = fill.assembly.bricks.length;
      const { slopes, windows, doors, railings } = fill.details;
      const { masonry, caps, ridges, inserts, floor } = fill.style;
      setResult({
        assembly: { ...fill.assembly, name: `${triangles.name} (model)` },
        complete: true,
        reason: "model-fill",
        text: [
          `Converted ${triangles.name} into ${pieces} pieces without AI, ${width} studs wide`,
          limitedBy === "support"
            ? " (smaller than the scale asked for: larger, too much of it overhangs with nothing under it)."
            : limitedBy === "scale"
            ? " (minifig scale, about 34 cm per stud, so doors and windows fit)."
            : limitedBy === "height"
            ? ` (the widest that stays within ${MAX_VOXEL_LAYERS} brick layers).`
            : limitedBy === "pieces"
              ? ` (the widest that fits ${MODEL_PIECE_BUDGET} pieces).`
              : ".",
          ` Details: ${slopes} roof slopes, ${windows} window and ${doors} door frames, ${inserts} windows and doors in them, ${railings} railings, ${masonry} masonry bricks, ${caps} wall caps, ${ridges} ridge pieces, ${floor} floor plates.`,
          triangles.omitted?.length &&
            ` Left out as separate from the model: ${triangles.omitted.join(", ")}.`,
          fill.skippedCells > 0 &&
            ` ${fill.skippedCells} of ${fill.filledCells} cells had no support or no part in their color and were left out.`,
          observedColors &&
            ` Observed colors only allows ${palette.length} colors; turn it off for greys, browns and tans.`,
        ]
          .filter(Boolean)
          .join(""),
        usage: { inputTokens: 0, outputTokens: 0 },
      });
      setModelReference({ ...encodeVoxelModel(model), origin: fill.origin });
      setSource("draft");
      setMaxPieces((current) => Math.min(MAX_PIECES, Math.max(current, pieces + 100)));
      setPrompt((current) =>
        !current || MODEL_PROMPTS.includes(current) ? MODEL_PROMPT : current,
      );
      setEvents([]);
      setPreviewMode("draft");
      setCameraRevision((current) => current + 1);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Model conversion failed.",
      );
    }
  }

  async function addModel(file: File | undefined) {
    if (!file) return;
    setError("");
    setProcessing(true);
    try {
      const { loadModelTriangles } = await loadModelReference();
      const triangles = await loadModelTriangles(file);
      setModelTriangles(triangles);
      // A model's own colors matter more than the six observed ones; the box stays editable.
      setObservedOnly(false);
      await convertModel(triangles, modelWidth, false);
      // The file's own preview shows Claude what the building should look like.
      if (triangles.preview && photos.length < 4) {
        const preview = await preparePhoto(triangles.preview).catch(() => null);
        if (preview) {
          setPhotos((current) => [...current.filter((photo) => !photo.name.endsWith(" preview")), preview]);
          setConsent(false);
        }
      }
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Model could not be read.",
      );
    } finally {
      setProcessing(false);
    }
  }

  async function generate() {
    if (busy || !consent || stale) return;
    const initial =
      source === "current"
        ? original
        : source === "draft" && result
          ? result.assembly
          : { name: "AI draft", buildArea: getBuildArea(original), bricks: [] };
    // The draft preview shows Claude what it is revising; large drafts are not listed in full.
    const canvas =
      source === "draft" && result && previewMode === "draft"
        ? scene.current?.querySelector("canvas")
        : null;
    const render = canvas ? captureCanvas(canvas) : null;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError("");
    setEvents([]);
    setTurn(0);
    setUsage({ inputTokens: 0, outputTokens: 0 });
    try {
      const next = await streamGeneration(
        {
          prompt,
          initial,
          images: photos.map(({ mediaType, data }) => ({ mediaType, data })),
          ...(render ? { render: { mediaType: "image/jpeg", data: render } } : {}),
          ...(source === "draft" && modelReference
            ? { model: modelReference }
            : {}),
          consent,
          maxPieces,
          maxTurns,
          policy: {
            evidence: policy.evidence,
            physical: policy.physical,
            rejectInfeasible: policy.rejectInfeasible,
            requireObservedColors: observedOnly,
          },
        },
        controller.signal,
        (event) => {
          if (event.type === "turn") setTurn(event.turn ?? 0);
          if (event.type === "usage")
            setUsage({
              inputTokens: event.inputTokens ?? 0,
              cachedInputTokens: event.cachedInputTokens ?? 0,
              outputTokens: event.outputTokens ?? 0,
            });
          if (event.type === "tool" || event.type === "text")
            setEvents((current) => [...current, event].slice(-12));
        },
      );
      setResult(next);
      setSource("draft");
      // Leave room for a revision to add pieces as well as rework them.
      setMaxPieces((current) =>
        Math.min(MAX_PIECES, Math.max(current, next.assembly.bricks.length + 300)),
      );
      setUsage(next.usage);
      setPreviewMode("draft");
      setCameraRevision((current) => current + 1);
    } catch (error) {
      setError(
        controller.signal.aborted
          ? "Generation cancelled. Any earlier draft is retained."
          : error instanceof Error
            ? error.message
            : "Generation failed.",
      );
    } finally {
      setBusy(false);
      abort.current = null;
      void refreshStatus();
    }
  }

  return (
    <dialog
      ref={dialog}
      className="generation-dialog"
      aria-labelledby="generation-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <header className="generation-heading">
        <div>
          <Sparkles size={18} />
          <h2 id="generation-title">Generate a Build</h2>
        </div>
        <div className="generation-server">
          <span>
            {!status
              ? "Server offline"
              : !status.configured
                ? "API key not configured"
                : status.busy && !busy
                  ? "Server busy"
                  : status.backend === "claude-code"
                    ? `${status.model} · Claude Code login`
                    : status.model}
          </span>
          <button
            type="button"
            className="icon-button small"
            title="Refresh server status"
            aria-label="Refresh server status"
            onClick={() => void refreshStatus()}
          >
            <RefreshCw size={15} />
          </button>
          <button
            type="button"
            className="icon-button small"
            title="Close generation"
            aria-label="Close generation"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
      </header>
      <div className="generation-body">
        <form
          className="generation-form"
          onSubmit={(event) => {
            event.preventDefault();
            void generate();
          }}
        >
          <fieldset disabled={busy || processing}>
            <legend>Starting Point</legend>
            <div className="generation-source">
              {(
                ["new", "current", ...(result ? ["draft"] : [])] as (
                  | "new"
                  | "current"
                  | "draft"
                )[]
              ).map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="generation-source"
                    value={value}
                    checked={source === value}
                    onChange={() => {
                      setSource(value);
                      if (value === "current")
                        setMaxPieces(Math.max(600, original.bricks.length));
                    }}
                  />
                  <span>
                    {value === "new"
                      ? "New"
                      : value === "current"
                        ? "Current"
                        : "Draft"}
                  </span>
                </label>
              ))}
            </div>
            <label className="generation-field">
              Build brief
              <textarea
                value={prompt}
                maxLength={20_000}
                rows={5}
                autoFocus
                placeholder="A small courtyard house with a tower and a red roof"
                onChange={(event) => setPrompt(event.target.value)}
                required
              />
            </label>
            <input
              ref={upload}
              type="file"
              multiple
              hidden
              accept="image/jpeg,image/png,image/webp"
              aria-label="Reference photos"
              onChange={(event) => {
                void addPhotos(event.target.files);
                event.target.value = "";
              }}
            />
            <input
              ref={modelUpload}
              type="file"
              hidden
              accept={MODEL_ACCEPT}
              aria-label="3D model"
              onChange={(event) => {
                void addModel(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <div className="generation-attachments">
              <button
                type="button"
                className="secondary"
                disabled={photos.length >= 4}
                title="Up to four reference photos"
                onClick={() => upload.current?.click()}
              >
                <ImagePlus size={16} />
                {processing ? "Processing" : `Photos${photos.length ? ` ${photos.length}/4` : ""}`}
              </button>
              <button
                type="button"
                className="secondary"
                title={`Convert a ${MODEL_ACCEPT.replaceAll(",", ", ")} model into bricks in your browser, without AI`}
                onClick={() => modelUpload.current?.click()}
              >
                <Box size={16} />
                {processing
                  ? "Processing"
                  : modelTriangles
                    ? "Replace model"
                    : "3D model"}
              </button>
            </div>
            {modelTriangles && (
              <p className="generation-hint" title={modelTriangles.name}>
                Model: {modelTriangles.name}
              </p>
            )}
            {photos.length > 0 && (
              <div className="generation-photos">
                {photos.map((photo, index) => (
                  <figure key={`${photo.name}-${index}`}>
                    <button
                      type="button"
                      className="generation-photo"
                      title={`View ${photo.name}`}
                      onClick={() => {
                        setPhotoIndex(index);
                        setPreviewMode("reference");
                      }}
                    >
                      <img
                        src={`data:${photo.mediaType};base64,${photo.data}`}
                        alt={photo.name}
                      />
                    </button>
                    <figcaption>
                      <span title={photo.name}>{photo.name}</span>
                      <button
                        type="button"
                        className="icon-button small"
                        aria-label={`Remove ${photo.name}`}
                        title="Remove photo"
                        onClick={() => {
                          setPhotos((current) =>
                            current.filter(
                              (_photo, position) => position !== index,
                            ),
                          );
                          setPhotoIndex(0);
                          setConsent(false);
                          if (photos.length === 1) setPreviewMode("draft");
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
            <details className="generation-advanced">
              <summary>Advanced options</summary>
              <div className="generation-numbers">
                <label className="generation-field">
                  Piece budget
                  <input
                    type="number"
                    min={1}
                    max={MAX_PIECES}
                    value={maxPieces}
                    onChange={(event) => setMaxPieces(Number(event.target.value))}
                  />
                </label>
                <label className="generation-field">
                  Turn limit
                  <input
                    type="number"
                    min={1}
                    max={32}
                    value={maxTurns}
                    onChange={(event) => setMaxTurns(Number(event.target.value))}
                  />
                </label>
              </div>
              <label className="generation-checkbox">
                <input
                  type="checkbox"
                  checked={observedOnly}
                  onChange={(event) => setObservedOnly(event.target.checked)}
                />
                Observed colors only
              </label>
              <h3 className="generation-subheading">3D model conversion</h3>
              <div className="generation-model">
                <label className="generation-field">
                  Max width in studs
                  <input
                    type="number"
                    min={4}
                    max={MAX_BUILD_AREA}
                    value={modelWidth}
                    onChange={(event) => setModelWidth(Number(event.target.value))}
                  />
                </label>
                {modelTriangles && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={
                      !Number.isInteger(modelWidth) ||
                      modelWidth < 4 ||
                      modelWidth > MAX_BUILD_AREA
                    }
                    onClick={() => void convertModel(modelTriangles, modelWidth)}
                  >
                    <RefreshCw size={14} />
                    Convert again
                  </button>
                )}
              </div>
              <label className="generation-checkbox generation-scale">
                <input
                  type="checkbox"
                  checked={minifigScale}
                  onChange={(event) => setMinifigScale(event.target.checked)}
                />
                <span>
                  Minifig scale: about 34 cm per stud, so doors and windows fit.
                  Off, the model grows to the piece budget.
                </span>
              </label>
              <p className="generation-hint">
                Converted in your browser without AI, finished like a set (roof
                slopes, windows and doors, railings, masonry, caps, ridge,
                plate floor), as wide as the piece budget allows. Revise the draft
                for specific additions.
              </p>
            </details>
          </fieldset>
          <label className="generation-checkbox generation-consent">
            <input
              type="checkbox"
              checked={consent}
              disabled={busy || processing}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              Send the brief, build, policy data and photos to Anthropic.{" "}
              {status?.backend === "claude-code"
                ? "Uses your Claude Code subscription limits."
                : "API usage is billed."}
            </span>
          </label>
          {(error || stale) && (
            <p className="generation-error" role="alert">
              {stale
                ? "The current build changed. Reopen generation before applying a draft."
                : error}
            </p>
          )}
          {busy ? (
            <button
              type="button"
              className="secondary"
              onClick={() => abort.current?.abort()}
            >
              <Square size={14} />
              Cancel generation
            </button>
          ) : (
            <button
              className="primary"
              type="submit"
              disabled={
                !status?.configured ||
                status.busy ||
                !consent ||
                processing ||
                !prompt.trim() ||
                stale ||
                !Number.isInteger(maxPieces) ||
                maxPieces < 1 ||
                maxPieces > MAX_PIECES ||
                !Number.isInteger(maxTurns) ||
                maxTurns < 1 ||
                maxTurns > 32
              }
            >
              <Sparkles size={16} />
              {result && source === "draft" ? "Revise draft" : "Generate draft"}
            </button>
          )}
          <div className="generation-progress" role="status">
            <span>
              {busy && (
                <LoaderCircle size={12} className="generation-spinner" />
              )}
              {busy
                ? `Turn ${turn} / ${maxTurns} · ${formatElapsed(elapsed)}`
                : result
                  ? result.complete
                    ? "Draft ready"
                    : "Partial draft"
                  : "Not started"}
            </span>
            <span>
              {usage.inputTokens.toLocaleString()} new input
              {usage.cachedInputTokens
                ? ` + ${usage.cachedInputTokens.toLocaleString()} cached`
                : ""}{" "}
              / {usage.outputTokens.toLocaleString()} output tokens
            </span>
          </div>
          {events.length > 0 && (
            <ol className="generation-events">
              {events.map((event, index) => (
                <li
                  key={index}
                  className={event.ok === false ? "rejected" : ""}
                >
                  {event.type === "tool"
                    ? `${event.tool} / ${event.ok ? "accepted" : "rejected"} / ${event.pieces} pieces`
                    : event.text}
                </li>
              ))}
            </ol>
          )}
        </form>
        <section className="generation-review" aria-label="Draft review">
          <div className="generation-preview-toolbar">
            <div role="tablist" aria-label="Preview content">
              <button
                type="button"
                role="tab"
                aria-selected={previewMode === "draft"}
                onClick={() => setPreviewMode("draft")}
              >
                Draft
              </button>
              {photos.length > 0 && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={previewMode === "reference"}
                  onClick={() => setPreviewMode("reference")}
                >
                  Reference
                </button>
              )}
            </div>
            {result && previewMode === "draft" && (
              <div className="generation-view-controls">
                <select
                  aria-label="Draft view"
                  value={view}
                  onChange={(event) =>
                    setView(event.target.value as typeof view)
                  }
                >
                  <option value="perspective">Perspective</option>
                  <option value="top">Top</option>
                  <option value="front">Front</option>
                </select>
                <button
                  type="button"
                  className="icon-button small"
                  title="Reset draft camera"
                  aria-label="Reset draft camera"
                  onClick={() => setCameraRevision((current) => current + 1)}
                >
                  <Maximize size={15} />
                </button>
              </div>
            )}
          </div>
          <div className="generation-scene" ref={scene}>
            {previewMode === "reference" && photos[photoIndex] ? (
              <img
                className="generation-reference"
                src={`data:image/jpeg;base64,${photos[photoIndex].data}`}
                alt={photos[photoIndex].name}
              />
            ) : result ? (
              <Scene
                assembly={result.assembly}
                selectedId={null}
                onSelect={ignore}
                ghost={null}
                ghostValid={false}
                layer={MAX_HEIGHT}
                explode={false}
                view={view}
                cameraRevision={cameraRevision}
                models={library.models}
                onReady={ignore}
              />
            ) : busy ? null : (
              <div className="generation-empty">
                <Sparkles size={28} />
                <span>No draft</span>
              </div>
            )}
            {busy && previewMode === "draft" && (
              <div
                className={`generation-working${result ? " over-draft" : ""}`}
                aria-hidden="true"
              >
                <div className="generation-bricks">
                  <span />
                  <span />
                  <span />
                </div>
                <strong>
                  {result ? "Claude is revising the draft" : "Claude is building a draft"}
                </strong>
                <span key={activity} className="generation-activity">
                  {activity}…
                </span>
                <div className="generation-meter">
                  <div
                    style={{
                      width: `${Math.min(100, (turn / maxTurns) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
          {result && (
            <div className="generation-report">
              <div className="generation-report-heading">
                <strong>{result.assembly.name}</strong>
                <span className="document-tag">UNVERIFIED DRAFT</span>
              </div>
              <dl>
                <div>
                  <dt>Pieces</dt>
                  <dd>{result.assembly.bricks.length}</dd>
                </div>
                <div>
                  <dt>Board</dt>
                  <dd>
                    {getBuildArea(result.assembly)} x{" "}
                    {getBuildArea(result.assembly)} studs
                  </dd>
                </div>
                <div>
                  <dt>Geometry</dt>
                  <dd>
                    {assessment?.geometry.length ? "Rejected" : "Validated"}
                  </dd>
                </div>
                <div>
                  <dt>Gravity</dt>
                  <dd>{assessment?.physical?.gravity ?? "Unknown"}</dd>
                </div>
              </dl>
              <p>{result.text || `Partial result: ${result.reason}.`}</p>
              <p>
                Construction sequence, strength and physical buildability are
                not certified.
              </p>
              {assessment && !assessment.allowed && (
                <p className="generation-error">
                  {assessment.issues[0].message}
                </p>
              )}
            </div>
          )}
        </section>
      </div>
      <footer className="generation-actions">
        <button
          type="button"
          className="secondary"
          disabled={!result || busy}
          onClick={() => result && onExport(result.assembly)}
        >
          <Download size={15} />
          Export draft
        </button>
        <button
          type="button"
          className="primary"
          disabled={
            !result?.assembly.bricks.length ||
            busy ||
            stale ||
            !assessment?.allowed
          }
          onClick={() => {
            if (result && onApply(result.assembly, original)) onClose();
            else
              setError("Draft could not be applied under the current policy.");
          }}
        >
          <Sparkles size={15} />
          Apply draft
        </button>
      </footer>
    </dialog>
  );
}
