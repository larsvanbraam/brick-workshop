import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Download, FileText, LoaderCircle, Package, X } from 'lucide-react';
import {
  EXAMPLES,
  createExampleAssembly,
  getBillOfMaterials,
  planInstructionSteps,
} from '@brick-workshop/engine';
import type { Assembly } from '@brick-workshop/engine';
import { listSavedBuilds, loadSavedBuild, openBuildDocument, readAutosave } from '../saved-builds';
import type { SavedBuildSummary } from '../saved-builds';
import { PAGE_SIZES, STEP_SIZES, countPages, deriveManualTheme, rgbCss } from './layout';
import type { Orientation, PageSize, StepSize } from './layout';
import brickLogo from '../assets/brick-logo.svg';
import { MOODS } from '../cinematic-look';
import type { CinematicMood } from '../cinematic-look';
import { createBoxArt, setNumberFor } from './box';
import type { BoxArt } from './box';
import { createManual } from './manual';
import type { Manual, ManualProgress } from './manual';

const SETTINGS_KEY = 'brick-workshop-instructions-settings-v1';

type CoverStyle = 'classic' | CinematicMood;

interface Settings {
  pageSize: PageSize;
  orientation: Orientation;
  stepSize: StepSize;
  cover: CoverStyle;
  output: 'manual' | 'box';
  boxMood: CinematicMood;
}

const DEFAULT_SETTINGS: Settings = {
  pageSize: 'a4',
  orientation: 'landscape',
  stepSize: 'standard',
  cover: 'studio',
  output: 'manual',
  boxMood: 'studio',
};

function readSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>;
    return {
      pageSize:
        saved.pageSize && saved.pageSize in PAGE_SIZES ? saved.pageSize : DEFAULT_SETTINGS.pageSize,
      orientation: saved.orientation === 'portrait' ? 'portrait' : DEFAULT_SETTINGS.orientation,
      stepSize:
        saved.stepSize && saved.stepSize in STEP_SIZES ? saved.stepSize : DEFAULT_SETTINGS.stepSize,
      cover:
        saved.cover === 'classic' || (saved.cover && saved.cover in MOODS)
          ? saved.cover
          : DEFAULT_SETTINGS.cover,
      output: saved.output === 'box' ? 'box' : DEFAULT_SETTINGS.output,
      boxMood: saved.boxMood && saved.boxMood in MOODS ? saved.boxMood : DEFAULT_SETTINGS.boxMood,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** `current` (the workshop's autosave), `saved:<id>` or `example:<id>`. */
type Source = string;

async function openSource(source: Source): Promise<Assembly> {
  if (source === 'current') {
    const autosave = readAutosave();
    if (!autosave) throw new Error('The workshop has no current build yet.');
    return autosave.assembly;
  }
  const [kind, id] = [source.slice(0, source.indexOf(':')), source.slice(source.indexOf(':') + 1)];
  if (kind === 'example') return createExampleAssembly(id);
  if (kind === 'saved') return openBuildDocument(await loadSavedBuild(id)).assembly;
  throw new Error('Unknown build.');
}

function slug(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'build'
  );
}

export function InstructionsApp() {
  const [settings, setSettings] = useState(readSettings);
  const [source, setSource] = useState<Source>(
    () =>
      new URLSearchParams(location.search).get('build') ??
      (readAutosave()?.assembly.bricks.length ? 'current' : `example:${EXAMPLES[0].id}`),
  );
  const [saved, setSaved] = useState<SavedBuildSummary[]>([]);
  /** The opened build, kept with the source it came from so a new choice shows as loading. */
  const [opened, setOpened] = useState<{ source: Source; assembly?: Assembly; error?: string }>();
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ManualProgress | null>(null);
  const [manual, setManual] = useState<(Manual & { url: string; name: string }) | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [box, setBox] = useState<(BoxArt & { name: string }) | null>(null);
  const [boxStatus, setBoxStatus] = useState<string | null>(null);
  /** Box copy the reader typed; blank fields fall back to what the build suggests. */
  const [boxText, setBoxText] = useState({ subtitle: '', age: '', description: '' });

  useEffect(() => {
    listSavedBuilds()
      .then(setSaved)
      .catch(() => setSaved([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const url = new URL(location.href);
    url.searchParams.set('build', source);
    history.replaceState(null, '', url);
    openSource(source)
      .then((assembly) => !cancelled && setOpened({ source, assembly }))
      .catch((reason: unknown) => {
        if (!cancelled)
          setOpened({
            source,
            error: reason instanceof Error ? reason.message : 'The build could not be opened.',
          });
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Settings then last for this visit only.
    }
  }, [settings]);

  useEffect(
    () => () => {
      if (manual) URL.revokeObjectURL(manual.url);
    },
    [manual],
  );
  const current = opened?.source === source ? opened : undefined;
  const assembly = current?.assembly ?? null;

  const plan = useMemo(() => {
    if (!assembly?.bricks.length) return null;
    try {
      const steps = planInstructionSteps(assembly, STEP_SIZES[settings.stepSize]);
      const kinds = getBillOfMaterials(assembly).length;
      return {
        steps,
        kinds,
        pages: countPages(steps.length, kinds, settings.pageSize, settings.orientation),
        theme: deriveManualTheme(assembly),
      };
    } catch (reason) {
      return { error: reason instanceof Error ? reason.message : 'Steps could not be planned.' };
    }
  }, [assembly, settings]);

  async function generate() {
    if (!assembly || !plan || 'error' in plan) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setError(null);
    setManual(null);
    try {
      const result = await createManual(
        assembly,
        plan.steps,
        { pageSize: settings.pageSize, orientation: settings.orientation, cover: settings.cover },
        setProgress,
        controller.signal,
      );
      setManual({ ...result, url: URL.createObjectURL(result.blob), name: assembly.name });
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : 'The manual could not be created.');
    } finally {
      if (abort.current === controller) abort.current = null;
      setProgress(null);
    }
  }

  const update = (patch: Partial<Settings>) => {
    setSettings((current) => ({ ...current, ...patch }));
    setManual(null);
  };
  async function generateBox() {
    if (!assembly?.bricks.length) return;
    setError(null);
    setBox(null);
    try {
      const art = await createBoxArt(
        assembly,
        {
          title: assembly.name,
          subtitle: boxText.subtitle.trim(),
          age: boxText.age.trim() || '18+',
          setNumber: setNumberFor(assembly.name),
          description: boxText.description.trim() || boxDescription,
          mood: settings.boxMood,
        },
        setBoxStatus,
      );
      setBox({ ...art, name: assembly.name });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The box could not be created.');
    } finally {
      setBoxStatus(null);
    }
  }

  const boxDescription = assembly
    ? `${assembly.name} in ${assembly.bricks.length} pieces${
        plan && !('error' in plan) ? `, built in ${plan.steps.length} steps` : ''
      }. Designed in Brick Workshop.`
    : '';
  const busy = progress !== null || boxStatus !== null;
  const autosave = useMemo(() => readAutosave(), []);

  return (
    <div className="instructions-shell">
      <header className="app-header">
        <div className="brand">
          <img className="brand-logo" src={brickLogo} alt="" width={30} height={30} />
          <h1>Building instructions</h1>
        </div>
        <a className="secondary compact back-link" href="/">
          <ArrowLeft size={15} />
          Workshop
        </a>
      </header>
      <div className="instructions-body">
        <aside className="instructions-form" inert={busy}>
          <label>
            <span>Build</span>
            <select
              value={source}
              onChange={(event) => {
                setSource(event.target.value);
                setManual(null);
                setBox(null);
                setError(null);
              }}
            >
              {autosave?.assembly.bricks.length ? (
                <option value="current">Current build: {autosave.assembly.name}</option>
              ) : null}
              {saved.length > 0 && (
                <optgroup label="Saved builds">
                  {saved.map((build) => (
                    <option key={build.id} value={`saved:${build.id}`}>
                      {build.name} ({build.pieces} pcs)
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Examples">
                {EXAMPLES.map((example) => (
                  <option key={example.id} value={`example:${example.id}`}>
                    {example.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <fieldset>
            <legend>Create</legend>
            <div className="segmented">
              {(['manual', 'box'] as const).map((output) => (
                <button
                  key={output}
                  className={settings.output === output ? 'active' : ''}
                  aria-pressed={settings.output === output}
                  onClick={() => update({ output })}
                >
                  {output === 'manual' ? 'Instructions' : 'Box'}
                </button>
              ))}
            </div>
          </fieldset>
          {settings.output === 'manual' ? (
            <>
              <label>
                <span>Page size</span>
                <select
                  value={settings.pageSize}
                  onChange={(event) => update({ pageSize: event.target.value as PageSize })}
                >
                  {Object.entries(PAGE_SIZES).map(([id, size]) => (
                    <option key={id} value={id}>
                      {size.label} ({size.width} × {size.height} mm)
                    </option>
                  ))}
                </select>
              </label>
              <fieldset>
                <legend>Orientation</legend>
                <div className="segmented">
                  {(['portrait', 'landscape'] as const).map((orientation) => (
                    <button
                      key={orientation}
                      className={settings.orientation === orientation ? 'active' : ''}
                      aria-pressed={settings.orientation === orientation}
                      onClick={() => update({ orientation })}
                    >
                      {orientation === 'portrait' ? 'Portrait' : 'Landscape'}
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>Step size</legend>
                <div className="segmented">
                  {Object.entries(STEP_SIZES).map(([id, size]) => (
                    <button
                      key={id}
                      className={settings.stepSize === id ? 'active' : ''}
                      aria-pressed={settings.stepSize === id}
                      title={`Up to ${size.maxPiecesPerStep} pieces per step`}
                      onClick={() => update({ stepSize: id as StepSize })}
                    >
                      {size.label}
                    </button>
                  ))}
                </div>
                <small>
                  Up to {STEP_SIZES[settings.stepSize].maxPiecesPerStep} pieces per step.
                </small>
              </fieldset>
              <label>
                <span>Cover</span>
                <select
                  value={settings.cover}
                  onChange={(event) => update({ cover: event.target.value as CoverStyle })}
                >
                  <option value="classic">Classic: bright sky</option>
                  {(Object.keys(MOODS) as CinematicMood[]).map((mood) => (
                    <option key={mood} value={mood}>
                      Cinematic: {MOODS[mood].label}
                    </option>
                  ))}
                </select>
              </label>
              {plan && !('error' in plan) && (
                <dl className="instructions-summary">
                  <div>
                    <dt>Pieces</dt>
                    <dd>{assembly!.bricks.length}</dd>
                  </div>
                  <div>
                    <dt>Steps</dt>
                    <dd>{plan.steps.length}</dd>
                  </div>
                  <div>
                    <dt>Pages</dt>
                    <dd>{plan.pages}</dd>
                  </div>
                  <div className="instructions-swatches" aria-label="Manual colors">
                    {[plan.theme.frame, plan.theme.callout, plan.theme.page].map((color, index) => (
                      <span key={index} style={{ background: rgbCss(color) }} />
                    ))}
                  </div>
                </dl>
              )}
            </>
          ) : (
            <>
              <label>
                <span>Subtitle</span>
                <input
                  value={boxText.subtitle}
                  placeholder="Stockholm"
                  onChange={(event) => setBoxText({ ...boxText, subtitle: event.target.value })}
                />
              </label>
              <label>
                <span>Age</span>
                <input
                  value={boxText.age}
                  placeholder="18+"
                  onChange={(event) => setBoxText({ ...boxText, age: event.target.value })}
                />
              </label>
              <label>
                <span>Description</span>
                <textarea
                  rows={4}
                  value={boxText.description}
                  placeholder={boxDescription}
                  onChange={(event) => setBoxText({ ...boxText, description: event.target.value })}
                />
              </label>
              <label>
                <span>Lighting</span>
                <select
                  value={settings.boxMood}
                  onChange={(event) => update({ boxMood: event.target.value as CinematicMood })}
                >
                  {(Object.keys(MOODS) as CinematicMood[]).map((mood) => (
                    <option key={mood} value={mood}>
                      {MOODS[mood].label}
                    </option>
                  ))}
                </select>
              </label>
              {assembly && (
                <small>
                  Set {setNumberFor(assembly.name)} · {assembly.bricks.length} pcs
                </small>
              )}
            </>
          )}
          {assembly && !assembly.bricks.length && (
            <p className="form-note">This build has no pieces yet.</p>
          )}
          {plan && 'error' in plan && <p className="form-error">{plan.error}</p>}
          {(current?.error ?? error) && <p className="form-error">{current?.error ?? error}</p>}
          {settings.output === 'box' ? (
            <>
              <button
                className="primary"
                disabled={!assembly?.bricks.length || busy}
                onClick={() => void generateBox()}
              >
                <Package size={15} />
                Create box
              </button>
              {box && (
                <>
                  <a
                    className="secondary download-link"
                    href={box.box}
                    download={`${slug(box.name)}-box.png`}
                  >
                    <Download size={15} />
                    Download box
                  </a>
                  <a
                    className="secondary download-link"
                    href={box.front}
                    download={`${slug(box.name)}-box-front.png`}
                  >
                    <Download size={15} />
                    Download front panel
                  </a>
                </>
              )}
            </>
          ) : (
            <>
              <button
                className="primary"
                disabled={!plan || 'error' in plan || busy}
                onClick={() => void generate()}
              >
                <FileText size={15} />
                Create PDF
              </button>
              {manual && (
                <a
                  className="secondary download-link"
                  href={manual.url}
                  download={`${slug(manual.name)}-instructions.pdf`}
                >
                  <Download size={15} />
                  Download PDF
                </a>
              )}
              {manual?.missingParts.length ? (
                <p className="form-note">
                  Drawn as simple shapes, because their LDraw geometry is missing:{' '}
                  {manual.missingParts.join(', ')}.
                </p>
              ) : null}
            </>
          )}
        </aside>
        <main className="instructions-preview">
          {boxStatus !== null ? (
            <div className="instructions-progress" role="status">
              <LoaderCircle className="spin" size={22} />
              <p>{boxStatus}</p>
            </div>
          ) : settings.output === 'box' ? (
            box ? (
              <img className="box-preview" src={box.box} alt={`Box for ${box.name}`} />
            ) : (
              <div className="instructions-empty">
                <Package size={28} />
                <p>
                  Fill in the box copy, then create the box. The front, side and lid are shot on the
                  cinematic stage.
                </p>
              </div>
            )
          ) : progress ? (
            <div className="instructions-progress" role="status">
              <LoaderCircle className="spin" size={22} />
              <p>{progress.label}</p>
              <progress value={progress.done} max={progress.total} />
              <button className="secondary compact" onClick={() => abort.current?.abort()}>
                <X size={15} />
                Cancel
              </button>
            </div>
          ) : manual ? (
            <iframe title="Instructions preview" src={manual.url} />
          ) : (
            <div className="instructions-empty">
              <BookOpen size={28} />
              <p>
                Choose a build and a page size, then create the PDF. Every step is rendered from the
                build's own parts.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
