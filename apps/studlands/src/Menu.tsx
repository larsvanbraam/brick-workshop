import { useRef, useState } from 'react';
import type { Assembly } from '@brick-workshop/engine';
import type { Edit } from './build.ts';
import { cutOutArea, cutOutBuild, download, ldrawDocument, workshopDocument } from './export.ts';
import {
  createSaveFile,
  deleteSave,
  deleteWorld,
  importSaveFile,
  listSaves,
  listWorlds,
  loadEdits,
  readSaveFile,
} from './save.ts';
import type { SaveFile, SaveGame } from './save.ts';
import { DISTANCES } from './streaming.ts';
import type { DistanceName } from './streaming.ts';
import { MUSIC_LEVELS } from './music.ts';
import type { MusicLevel } from './music.ts';
import { game } from './game.ts';
import { LANDMARKS } from './world/island/map.ts';

type Tab = 'play' | 'saves' | 'worlds' | 'export' | 'settings';

export interface MenuProps {
  /** Where the walker stands, in world studs: the area export is centred on it. */
  position: { x: number; z: number };
  seed: number;
  /** The save game being played, in a game with save slots. */
  slot: number;
  /** Whether the game has been played since it loaded: the button then resumes it. */
  started: boolean;
  /** Whether it opened from a save game, so the first press continues it. */
  resumable: boolean;
  /** Opens a save game, or starts a new one in an empty slot (afresh when it is the current one). */
  onOpenSlot: (slot: number) => void;
  edits: readonly Edit[];
  /** Every loaded piece in one list, built when asked for: only an export needs it. */
  getAssembly: () => Assembly;
  /** Whether any of the player's pieces stand in the loaded chunks. */
  hasBuild: boolean;
  onPlay: () => void;
  onReset: () => void;
  onNewWorld: () => void;
  /** Opens a world, again from its saved edits even when it is the one being played. */
  onOpenWorld: (seed: number) => void;
  /** How far the world reaches round the walker. */
  distance: DistanceName;
  onDistance: (name: DistanceName) => void;
  /** How loud the background piano plays. */
  music: MusicLevel;
  onMusic: (level: MusicLevel) => void;
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

const TABS = ['play', 'saves', 'worlds', 'export', 'settings'] as const;

export function Menu(props: MenuProps) {
  const [tab, setTab] = useState<Tab>('play');
  return (
    <div className="menu">
      <div className="panel">
        <h1>{game().title}</h1>
        {game().seed === undefined && <p>World {props.seed}</p>}
        {game().saveSlots && <p>Game {props.slot + 1}</p>}
        <button type="button" className="play" onClick={props.onPlay} data-pad-start>
          {props.started ? 'Resume' : props.resumable ? 'Continue' : 'Play'} <kbd>Esc</kbd>
        </button>
        <div className="tabs" role="tablist" data-pad-tabs>
          {TABS.filter(
            (name) =>
              (name !== 'saves' || game().saveSlots) &&
              (name !== 'worlds' || game().seed === undefined) &&
              (name !== 'export' || game().building),
          ).map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              className={tab === name ? 'tab selected' : 'tab'}
              onClick={() => setTab(name)}
            >
              {
                {
                  play: 'Controls',
                  saves: 'Saves',
                  worlds: 'Worlds',
                  export: 'Export',
                  settings: 'Settings',
                }[name]
              }
            </button>
          ))}
        </div>
        {tab === 'play' && <Controls {...props} />}
        {tab === 'saves' && <Saves {...props} />}
        {tab === 'worlds' && <Worlds {...props} />}
        {tab === 'export' && <Export {...props} />}
        {tab === 'settings' && <Settings {...props} />}
      </div>
    </div>
  );
}

function Controls({ edits, onReset, onNewWorld }: MenuProps) {
  return (
    <>
      <dl>
        <dt>Move</dt>
        <dd>WASD, Space to jump, Shift to run</dd>
        <dt>Fly</dt>
        <dd>F or double Space; Space up, C down</dd>
        {game().vehicles.length > 0 && (
          <>
            <dt>Vehicles</dt>
            <dd>E gets in and out; WASD drives, Space brakes or climbs, Shift sinks, H honks</dd>
          </>
        )}
        {game().building && (
          <>
            <dt>Build</dt>
            <dd>Right click places, left click takes a piece off</dd>
            <dt>Pieces</dt>
            <dd>1–9 or wheel; Q/E colour, R turn, middle click copies</dd>
            <dt>Bricks</dt>
            <dd>B opens the brick box to fill the bar; B or Esc closes it</dd>
          </>
        )}
        {game().minimap && (
          <>
            <dt>Map</dt>
            <dd>N opens the island map, N or Esc closes it</dd>
          </>
        )}
        <dt>Camera</dt>
        <dd>V for over the shoulder</dd>
        <dt>Menu</dt>
        <dd>M opens this menu, Esc closes it</dd>
      </dl>
      <h2 className="controls-heading">Controller</h2>
      <dl>
        <dt>Move</dt>
        <dd>Left stick, click it in to sprint; right stick looks</dd>
        <dt>Fly</dt>
        <dd>A jumps, Y or double A flies; A up, B down</dd>
        {game().vehicles.length > 0 && (
          <>
            <dt>Vehicles</dt>
            <dd>X gets in and out; left stick or triggers drive, A up, B down, Y honks</dd>
          </>
        )}
        {game().building && (
          <>
            <dt>Build</dt>
            <dd>RT places, LT takes a piece off, X copies</dd>
            <dt>Pieces</dt>
            <dd>LB/RB pick; d-pad ◀ ▶ colour, ▲ turn, ▼ brick box</dd>
          </>
        )}
        {game().minimap && (
          <>
            <dt>Map</dt>
            <dd>D-pad ▼ opens the island map, B closes it</dd>
          </>
        )}
        <dt>Camera</dt>
        <dd>View for over the shoulder</dd>
        <dt>Menu</dt>
        <dd>Menu opens it; stick moves, A presses, LB/RB tabs, B closes</dd>
      </dl>
      {game().building && (
        <div className="actions">
          <button type="button" onClick={onReset} disabled={!edits.length}>
            Reset world
          </button>
          {game().seed === undefined && (
            <button type="button" onClick={onNewWorld}>
              New world
            </button>
          )}
        </div>
      )}
    </>
  );
}

const DISTANCE_LABELS: Record<DistanceName, string> = {
  short: 'Short',
  normal: 'Normal',
  far: 'Far',
  farthest: 'Very far',
};

/** How many studs a reach of chunks covers, out from the walker's own chunk. */
const studs = (chunks: number) => (chunks * 2 + 1) * 32;

const MUSIC_LABELS: Record<MusicLevel, string> = { off: 'Off', quiet: 'Quiet', normal: 'Normal' };

function Settings({ distance, onDistance, music, onMusic }: MenuProps) {
  const reach = DISTANCES[distance];
  return (
    <div className="settings">
      <div className="setting">
        <span id="distance-label">Render distance</span>
        <div className="choices" role="radiogroup" aria-labelledby="distance-label">
          {(Object.keys(DISTANCES) as DistanceName[]).map((name) => (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={distance === name}
              className={distance === name ? 'tab selected' : 'tab'}
              onClick={() => onDistance(name)}
            >
              {DISTANCE_LABELS[name]}
            </button>
          ))}
        </div>
      </div>
      <p className="note">
        Pieces you can build on {studs(reach.load)} studs across, the land beyond out to{' '}
        {studs(reach.far)}. Further reaches more but asks more of your computer; Very far builds
        twice the pieces of Normal.
      </p>
      <div className="setting">
        <span id="music-label">Music</span>
        <div className="choices" role="radiogroup" aria-labelledby="music-label">
          {(Object.keys(MUSIC_LEVELS) as MusicLevel[]).map((level) => (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={music === level}
              className={music === level ? 'tab selected' : 'tab'}
              onClick={() => onMusic(level)}
            >
              {MUSIC_LABELS[level]}
            </button>
          ))}
        </div>
      </div>
      <p className="note">Ambient piano while you play, following the day and the night.</p>
    </div>
  );
}

/** The landmark nearest a save's place, to say where it was left. */
function nearestLandmark({ x, z }: { x: number; z: number }) {
  let best = LANDMARKS[0];
  for (const landmark of LANDMARKS)
    if (Math.hypot(landmark.x - x, landmark.z - z) < Math.hypot(best.x - x, best.z - z))
      best = landmark;
  return best;
}

function playTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} h${rest ? ` ${rest} min` : ''}`;
}

function describeSave(save: SaveGame) {
  const landmark = nearestLandmark(save.place);
  return `${landmark.icon} Near ${landmark.name} · ${playTime(save.playSeconds)} played · ${playedAgo(save.playedAt)}`;
}

/** The save games: each picks up where it was left; an empty slot starts a new game. */
function Saves({ slot, onOpenSlot }: MenuProps) {
  // Read when the menu opens, and again after a delete.
  const [saves, setSaves] = useState(listSaves);
  const [confirming, setConfirming] = useState<number | null>(null);
  const forget = (index: number) => {
    deleteSave(index);
    setConfirming(null);
    // The game being played starts again from the beginning; another slot just empties.
    if (index === slot) onOpenSlot(index);
    else setSaves(listSaves());
  };
  return (
    <>
      <ul className="worlds">
        {saves.map((save, index) => (
          <li key={index} className={index === slot ? 'current' : undefined}>
            <div>
              <strong>Game {index + 1}</strong>
              <span>{save ? describeSave(save) : index === slot ? 'Just started' : 'Empty'}</span>
            </div>
            {confirming === index ? (
              <span className="confirm">
                <button type="button" className="danger" onClick={() => forget(index)}>
                  {index === slot ? 'Start over' : 'Delete'}
                </button>
                <button type="button" onClick={() => setConfirming(null)}>
                  Keep
                </button>
              </span>
            ) : index === slot ? (
              <span className="confirm">
                <em>Playing</em>
                {save && (
                  <button type="button" onClick={() => setConfirming(index)}>
                    Start over
                  </button>
                )}
              </span>
            ) : (
              <span className="confirm">
                <button type="button" onClick={() => onOpenSlot(index)}>
                  {save ? 'Load' : 'New game'}
                </button>
                {save && (
                  <button
                    type="button"
                    aria-label={`Delete game ${index + 1}`}
                    onClick={() => setConfirming(index)}
                  >
                    Delete
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="note">
        {confirming === null
          ? 'Your game saves by itself as you play. Pick another slot to keep a second game.'
          : confirming === slot
            ? 'Starting over goes back to the start and forgets this game. It can’t be undone.'
            : 'Deleting forgets this game. It can’t be undone.'}
      </p>
    </>
  );
}

function Worlds({ seed, onOpenWorld }: MenuProps) {
  // Read when the menu opens, and again after a delete.
  const [worlds, setWorlds] = useState(listWorlds);
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
          if (valid) onOpenWorld(target);
        }}
      >
        <label htmlFor="seed">World number</label>
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
      {worlds.length ? (
        <ul className="worlds">
          {worlds.map((world) => (
            <li key={world.seed} className={world.seed === seed ? 'current' : undefined}>
              <div>
                <strong>World {world.seed}</strong>
                <span>
                  {world.placed} placed
                  {world.placed && world.chunks
                    ? ` in ${world.chunks} chunk${world.chunks === 1 ? '' : 's'}`
                    : ''}
                  {world.removed ? ` · ${world.removed} taken off` : ''} ·{' '}
                  {playedAgo(world.playedAt)}
                </span>
              </div>
              {world.seed === seed ? (
                <em>Playing</em>
              ) : confirming === world.seed ? (
                <span className="confirm">
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      deleteWorld(world.seed);
                      setConfirming(null);
                      setWorlds(listWorlds());
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
                  <button type="button" onClick={() => onOpenWorld(world.seed)}>
                    Open
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete world ${world.seed}`}
                    onClick={() => setConfirming(world.seed)}
                  >
                    Delete
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">Worlds you play show up here.</p>
      )}
      {confirming !== null && (
        <p className="note">Deleting forgets everything built in that world. It can’t be undone.</p>
      )}
    </>
  );
}

type Scope = 'world' | 'build';
type Format = 'ldr' | 'workshop';

function Export({ seed, edits, getAssembly, hasBuild, position, onOpenWorld }: MenuProps) {
  const [scope, setScope] = useState<Scope>(hasBuild ? 'build' : 'world');
  const [format, setFormat] = useState<Format>('ldr');
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null);
  const [pending, setPending] = useState<SaveFile | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const exportModel = () => {
    const name = scope === 'build' ? `My build in world ${seed}` : `World ${seed}`;
    const assembly = getAssembly();
    const model =
      scope === 'build' ? cutOutBuild(assembly, name) : cutOutArea(assembly, position, name);
    if (!model) return setMessage({ text: 'Nothing built yet to export.', bad: true });
    const base = `${game().slug}-${seed}${scope === 'build' ? '-build' : ''}`;
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
      // Loading over a world with its own changes asks first; those changes would be lost.
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
    onOpenWorld(save.seed);
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
            My build, on its patch of ground
          </label>
          <label>
            <input
              type="radio"
              name="scope"
              checked={scope === 'world'}
              onChange={() => setScope('world')}
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
        <p className="note">The world number and your changes, to back up or open elsewhere.</p>
        <div className="actions">
          <button
            type="button"
            onClick={() =>
              download(
                JSON.stringify(createSaveFile(seed, edits)),
                `${game().slug}-${seed}.save.json`,
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
          <p>World {pending.seed} already has changes here. Loading the save replaces them.</p>
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
