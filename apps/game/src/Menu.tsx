import { useMemo, useRef, useState } from 'react';
import type { Assembly } from '@brick-workshop/engine';
import type { Edit } from './build.ts';
import {
  cutOutArea,
  cutOutBuild,
  download,
  isPlayerPiece,
  ldrawDocument,
  workshopDocument,
} from './export.ts';
import {
  createSaveFile,
  deleteIsland,
  importSaveFile,
  listIslands,
  loadEdits,
  readSaveFile,
} from './save.ts';
import type { SaveFile } from './save.ts';

type Tab = 'play' | 'islands' | 'export';

export interface MenuProps {
  /** Where the walker stands, in world studs: the area export is centred on it. */
  position: { x: number; z: number };
  seed: number;
  /** Whether the game has been played since it loaded: the button then resumes it. */
  started: boolean;
  edits: readonly Edit[];
  assembly: Assembly;
  onPlay: () => void;
  onReset: () => void;
  onNewIsland: () => void;
  /** Opens an island, again from its saved edits even when it is the one being played. */
  onOpenIsland: (seed: number) => void;
}

const ago = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

function playedAgo(date: string) {
  const seconds = (new Date(date).getTime() - Date.now()) / 1000;
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unit, size] of steps)
    if (Math.abs(seconds) >= size) return ago.format(Math.round(seconds / size), unit);
  return 'just now';
}

export function Menu(props: MenuProps) {
  const [tab, setTab] = useState<Tab>('play');
  return (
    <div className="menu">
      <div className="panel">
        <h1>Brick Island</h1>
        <p>Island {props.seed}</p>
        <button type="button" className="play" onClick={props.onPlay}>
          {props.started ? 'Resume' : 'Play'} <kbd>Esc</kbd>
        </button>
        <div className="tabs" role="tablist">
          {(['play', 'islands', 'export'] as const).map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              className={tab === name ? 'tab selected' : 'tab'}
              onClick={() => setTab(name)}
            >
              {{ play: 'Controls', islands: 'Islands', export: 'Export' }[name]}
            </button>
          ))}
        </div>
        {tab === 'play' && <Controls {...props} />}
        {tab === 'islands' && <Islands {...props} />}
        {tab === 'export' && <Export {...props} />}
      </div>
    </div>
  );
}

function Controls({ edits, onReset, onNewIsland }: MenuProps) {
  return (
    <>
      <dl>
        <dt>Move</dt>
        <dd>WASD, Space to jump, Shift to run</dd>
        <dt>Fly</dt>
        <dd>F or double Space; Space up, C down</dd>
        <dt>Build</dt>
        <dd>Right click places, left click takes a piece off</dd>
        <dt>Pieces</dt>
        <dd>1–9 or wheel; Q/E colour, R turn, middle click copies</dd>
        <dt>Bricks</dt>
        <dd>B opens the brick box to fill the bar; B or Esc closes it</dd>
        <dt>Camera</dt>
        <dd>V for over the shoulder</dd>
        <dt>Menu</dt>
        <dd>M opens this menu, Esc closes it</dd>
      </dl>
      <div className="actions">
        <button type="button" onClick={onReset} disabled={!edits.length}>
          Reset island
        </button>
        <button type="button" onClick={onNewIsland}>
          New island
        </button>
      </div>
    </>
  );
}

function Islands({ seed, onOpenIsland }: MenuProps) {
  // Read when the menu opens, and again after a delete.
  const [islands, setIslands] = useState(listIslands);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [goTo, setGoTo] = useState('');
  const target = Number(goTo);
  const valid = goTo !== '' && Number.isInteger(target) && target >= 0 && target < 2 ** 31;
  return (
    <>
      <form
        className="seed"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) onOpenIsland(target);
        }}
      >
        <label htmlFor="seed">Island number</label>
        <input
          id="seed"
          inputMode="numeric"
          placeholder="e.g. 938112"
          value={goTo}
          onChange={(event) => setGoTo(event.target.value.replace(/\D/g, ''))}
        />
        <button type="submit" disabled={!valid}>
          Go
        </button>
      </form>
      {islands.length ? (
        <ul className="islands">
          {islands.map((island) => (
            <li key={island.seed} className={island.seed === seed ? 'current' : undefined}>
              <div>
                <strong>Island {island.seed}</strong>
                <span>
                  {island.placed} placed
                  {island.placed && island.chunks
                    ? ` in ${island.chunks} chunk${island.chunks === 1 ? '' : 's'}`
                    : ''}
                  {island.removed ? ` · ${island.removed} taken off` : ''} ·{' '}
                  {playedAgo(island.playedAt)}
                </span>
              </div>
              {island.seed === seed ? (
                <em>Playing</em>
              ) : confirming === island.seed ? (
                <span className="confirm">
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      deleteIsland(island.seed);
                      setConfirming(null);
                      setIslands(listIslands());
                    }}
                  >
                    Delete
                  </button>
                  <button type="button" onClick={() => setConfirming(null)}>
                    Keep
                  </button>
                </span>
              ) : (
                <span className="confirm">
                  <button type="button" onClick={() => onOpenIsland(island.seed)}>
                    Open
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete island ${island.seed}`}
                    onClick={() => setConfirming(island.seed)}
                  >
                    Delete
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">Islands you play show up here.</p>
      )}
      {confirming !== null && (
        <p className="note">
          Deleting forgets everything built on that island. It can’t be undone.
        </p>
      )}
    </>
  );
}

type Scope = 'island' | 'build';
type Format = 'ldr' | 'workshop';

function Export({ seed, edits, assembly, position, onOpenIsland }: MenuProps) {
  const hasBuild = useMemo(() => assembly.bricks.some(isPlayerPiece), [assembly]);
  const [scope, setScope] = useState<Scope>(hasBuild ? 'build' : 'island');
  const [format, setFormat] = useState<Format>('ldr');
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null);
  const [pending, setPending] = useState<SaveFile | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const exportModel = () => {
    const name = scope === 'build' ? `My build on island ${seed}` : `Island ${seed}`;
    const model =
      scope === 'build' ? cutOutBuild(assembly, name) : cutOutArea(assembly, position, name);
    if (!model) return setMessage({ text: 'Nothing built yet to export.', bad: true });
    const base = `brick-island-${seed}${scope === 'build' ? '-build' : ''}`;
    try {
      if (format === 'ldr') download(ldrawDocument(model), `${base}.ldr`, 'text/plain');
      else download(workshopDocument(model), `${base}.json`, 'application/json');
      setMessage({ text: `Exported ${model.bricks.length.toLocaleString()} pieces.` });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'Export failed.', bad: true });
    }
  };

  const load = async (file: File | undefined) => {
    if (!file) return;
    try {
      const save = readSaveFile(JSON.parse(await file.text()));
      // Loading over an island with its own changes asks first; those changes would be lost.
      const existing = loadEdits(save.seed);
      if (existing.length && JSON.stringify(existing) !== JSON.stringify(save.edits))
        setPending(save);
      else apply(save);
    } catch (error) {
      setMessage({
        text:
          error instanceof SyntaxError
            ? 'That file is not a save file.'
            : String(error instanceof Error ? error.message : error),
        bad: true,
      });
    }
  };
  const apply = (save: SaveFile) => {
    importSaveFile(save);
    setPending(null);
    onOpenIsland(save.seed);
  };

  return (
    <>
      <fieldset>
        <legend>Model</legend>
        <div className="choices">
          <label>
            <input
              type="radio"
              name="scope"
              checked={scope === 'build'}
              disabled={!hasBuild}
              onChange={() => setScope('build')}
            />
            My build, on its patch of island
          </label>
          <label>
            <input
              type="radio"
              name="scope"
              checked={scope === 'island'}
              onChange={() => setScope('island')}
            />
            The area round you, 128 studs across
          </label>
        </div>
        <div className="choices">
          <label>
            <input
              type="radio"
              name="format"
              checked={format === 'ldr'}
              onChange={() => setFormat('ldr')}
            />
            LDraw (.ldr), for Studio, LDCad and other LDraw tools
          </label>
          <label>
            <input
              type="radio"
              name="format"
              checked={format === 'workshop'}
              onChange={() => setFormat('workshop')}
            />
            Brick Workshop file, for parts lists and instructions
          </label>
        </div>
        <button type="button" className="wide" onClick={exportModel}>
          Download model
        </button>
      </fieldset>
      <fieldset>
        <legend>Save file</legend>
        <p className="note">The island number and your changes, to back up or open elsewhere.</p>
        <div className="actions">
          <button
            type="button"
            onClick={() =>
              download(
                JSON.stringify(createSaveFile(seed, edits)),
                `brick-island-${seed}.save.json`,
                'application/json',
              )
            }
          >
            Download save
          </button>
          <button type="button" onClick={() => input.current?.click()}>
            Load save…
          </button>
          <input
            ref={input}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(event) => {
              void load(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </div>
      </fieldset>
      {pending && (
        <div className="replace">
          <p>Island {pending.seed} already has changes here. Loading the save replaces them.</p>
          <div className="actions">
            <button type="button" className="danger" onClick={() => apply(pending)}>
              Replace
            </button>
            <button type="button" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {message && <p className={message.bad ? 'note bad' : 'note'}>{message.text}</p>}
    </>
  );
}
