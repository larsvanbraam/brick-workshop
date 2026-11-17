import { TOUCH_LABELS, TOUCH_SETTINGS } from './touch-pad.ts';
import type { TouchSetting } from './touch-pad.ts';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Logo, logoLetters } from './Logo.tsx';
import type { Edit } from './build.ts';
import { download } from './export.ts';
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
import { Voices } from '@brick-workshop/audio/voice';
import { LOCALES } from './locale.ts';
import type { Locale } from './locale.ts';
import type { VoiceMode } from '@brick-workshop/audio/voice';
import { game } from './game.ts';
import { Key } from './input-hint.tsx';
import { useArrowNav } from './arrow-nav.ts';
import { MenuPage } from './MenuPage.tsx';

type Page = 'saves' | 'worlds' | 'controls' | 'settings';

const PAGE_TITLES: Record<Page, string> = {
  saves: 'Saves',
  worlds: 'Worlds',
  controls: 'Controls',
  settings: 'Settings',
};

export interface MenuProps {
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
  onPlay: () => void;
  onReset: () => void;
  /** Puts every vehicle back at its spot, for one that got stuck. */
  onReturnVehicles: () => void;
  onNewWorld: () => void;
  /** Opens a world, again from its saved edits even when it is the one being played. */
  onOpenWorld: (seed: number) => void;
  /** How far the world reaches round the walker. */
  distance: DistanceName;
  onDistance: (name: DistanceName) => void;
  /** How loud the background piano plays. */
  music: MusicLevel;
  onMusic: (level: MusicLevel) => void;
  /** One-stick controls for small children. */
  simpleControls: boolean;
  onSimpleControls: (on: boolean) => void;
  /** The on-screen thumbsticks and buttons. */
  touchControls: TouchSetting;
  onTouchControls: (setting: TouchSetting) => void;
  voices: VoiceMode;
  onVoices: (mode: VoiceMode) => void;
  /** The language people speak. */
  locale: Locale;
  onLocale: (locale: Locale) => void;
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

/**
 * The pause menu: the title screen's layout over the paused world, the logo and a list on the
 * left, and the page you pick (settings, controls, saves…) as a panel on the right.
 */
export function Menu(props: MenuProps) {
  const [page, setPage] = useState<Page | null>(null);
  const resume = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useArrowNav(root);

  // Esc closes an open page first, and only then resumes the game (see App.tsx).
  useEffect(() => {
    if (!page) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.code !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setPage(null);
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, [page]);

  useEffect(() => resume.current?.focus({ preventScroll: true }), []);

  const pages: Page[] = [
    ...(game().saveSlots ? (['saves'] as const) : []),
    ...(game().seed === undefined ? (['worlds'] as const) : []),
    'controls',
    'settings',
  ];
  const subtitle = game().seed === undefined ? `World ${props.seed}` : null;
  let item = 0;
  const step = () => ({ '--item': item++ }) as CSSProperties;
  const { title } = game();

  return (
    <div
      ref={root}
      className={page ? 'title-screen pause quick paged' : 'title-screen pause quick'}
      style={{ '--letters': logoLetters(title) } as CSSProperties}
    >
      <div className="title-shade" aria-hidden />
      <div className="title-main">
        <Logo title={title} />
        <p className="title-tagline">Paused</p>
        <nav className="title-actions" aria-label="Pause menu">
          <button
            ref={resume}
            type="button"
            className="title-play"
            style={step()}
            onClick={props.onPlay}
            data-pad-start
          >
            <span>{props.started ? 'Resume' : props.resumable ? 'Continue' : 'Play'}</span>
            <Key k="Esc" pad="B" />
          </button>
          {(subtitle || game().saveSlots) && (
            <p className="title-subtitle" style={step()}>
              {subtitle ?? `Game ${props.slot + 1}`}
            </p>
          )}
          {pages.map((name) => (
            <button
              key={name}
              type="button"
              className={page === name ? 'title-item selected' : 'title-item'}
              aria-expanded={page === name}
              style={step()}
              onClick={() => setPage((current) => (current === name ? null : name))}
            >
              {PAGE_TITLES[name]}
            </button>
          ))}
        </nav>
      </div>
      {page && (
        <MenuPage title={PAGE_TITLES[page]} onBack={() => setPage(null)} key={page}>
          {page === 'saves' && <Saves {...props} />}
          {page === 'worlds' && <Worlds {...props} />}
          {page === 'controls' && <Controls {...props} />}
          {page === 'settings' && <Settings {...props} />}
        </MenuPage>
      )}
    </div>
  );
}

/** One thing you can do and the buttons for it: several keys mean any of them works. */
type Binding = { keys: string[]; does: string };
type Row = { name: string; bindings: Binding[] };

const bind = (does: string, ...keys: string[]): Binding => ({ keys, does });

function keyboardRows(): Row[] {
  const { building, map, vehicles, controls } = game();
  return [
    {
      name: 'Move',
      bindings: [bind('walk', 'WASD'), bind('jump', 'Space'), bind('run', 'Shift')],
    },
    {
      name: 'Fly',
      bindings: [bind('take off', 'Space ×2'), bind('up', 'Space'), bind('down', 'C')],
    },
    ...(vehicles.length > 0
      ? [
          {
            name: 'Vehicles',
            bindings: [
              bind('get in or out', 'E'),
              bind('drive', 'WASD'),
              bind('brake or climb', 'Space'),
              bind('sink', 'Shift'),
              bind('honk', 'H'),
            ],
          },
        ]
      : []),
    ...(building
      ? [
          {
            name: 'Build',
            bindings: [
              bind('place', 'Right click', 'Enter'),
              bind('take off', 'Left click', 'Backspace'),
              bind('copy', 'Middle click', 'G'),
            ],
          },
          {
            name: 'Pieces',
            bindings: [
              bind('pick', '1–9', 'Wheel'),
              bind('colour', 'Q', 'E'),
              bind('turn', 'R'),
              bind('brick box', 'B'),
            ],
          },
        ]
      : []),
    ...(map ? [{ name: 'Map', bindings: [bind('open or close', 'N')] }] : []),
    ...(controls ?? []).map((extra) => ({
      name: extra.group,
      bindings: [bind(extra.action, extra.key)],
    })),
    { name: 'Talk', bindings: [bind('talk, then next line', 'T')] },
    { name: 'Camera', bindings: [bind('over the shoulder', 'V')] },
    { name: 'Screen', bindings: [bind('fullscreen', 'F')] },
    { name: 'Menu', bindings: [bind('open', 'M'), bind('close', 'Esc')] },
  ];
}

function controllerRows(): Row[] {
  const { building, map, vehicles, controls } = game();
  return [
    {
      name: 'Move',
      bindings: [
        bind('walk', 'Left stick'),
        bind('sprint', 'Stick click'),
        bind('look', 'Right stick'),
      ],
    },
    {
      name: 'Fly',
      bindings: [
        bind('jump', 'A'),
        bind('take off', 'Y', 'A ×2'),
        bind('up', 'A'),
        bind('down', 'B'),
      ],
    },
    ...(vehicles.length > 0
      ? [
          {
            name: 'Vehicles',
            bindings: [
              bind('get in or out', 'X'),
              bind('drive', 'Left stick', 'Triggers'),
              bind('up', 'A'),
              bind('down', 'B'),
              bind('honk', 'Y'),
            ],
          },
        ]
      : []),
    ...(building
      ? [
          {
            name: 'Build',
            bindings: [bind('place', 'RT'), bind('take off', 'LT'), bind('copy', 'X')],
          },
          {
            name: 'Pieces',
            bindings: [
              bind('pick', 'LB', 'RB'),
              bind('colour', '◀', '▶'),
              bind('turn', '▲'),
              bind('brick box', '▼'),
            ],
          },
        ]
      : []),
    ...(map ? [{ name: 'Map', bindings: [bind('open', '▼'), bind('close', 'B')] }] : []),
    ...(controls ?? []).map((extra) => ({
      name: extra.group,
      bindings: [bind(extra.action, extra.pad)],
    })),
    { name: 'Talk', bindings: [bind('talk, then next line', 'B')] },
    { name: 'Camera', bindings: [bind('over the shoulder', 'View')] },
    { name: 'Screen', bindings: [bind('fullscreen, in a menu', 'Y')] },
    {
      name: 'Menu',
      bindings: [
        bind('open', 'Menu'),
        bind('move', 'Stick'),
        bind('press', 'A'),
        bind('close', 'B'),
      ],
    },
  ];
}

function BindingList({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <section className="bindings">
      <h3>{title}</h3>
      <dl>
        {rows.map((row) => (
          <div key={row.name} className="binding-row">
            <dt>{row.name}</dt>
            <dd>
              {row.bindings.map((binding) => (
                <span key={binding.does} className="binding">
                  {binding.keys.map((key, index) => (
                    <span key={key}>
                      {index > 0 && <span className="or">or</span>}
                      <kbd>{key}</kbd>
                    </span>
                  ))}
                  <span className="does">{binding.does}</span>
                </span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function Controls({ edits, onReset, onReturnVehicles, onNewWorld }: MenuProps) {
  return (
    <>
      <div className="controls">
        <BindingList title="Keyboard" rows={keyboardRows()} />
        <BindingList title="Controller" rows={controllerRows()} />
      </div>
      {(game().building || game().vehicles.length > 0) && (
        <div className="actions">
          {game().building && (
            <button type="button" onClick={onReset} disabled={!edits.length}>
              Reset world
            </button>
          )}
          {game().building && game().seed === undefined && (
            <button type="button" onClick={onNewWorld}>
              New world
            </button>
          )}
          {game().vehicles.length > 0 && (
            <button
              type="button"
              onClick={onReturnVehicles}
              title="Puts every vehicle back where it was parked, for one that got stuck"
            >
              Return vehicles
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

const VOICE_LABELS: Record<VoiceMode, string> = {
  simlish: 'Simlish',
  device: 'Spoken',
  off: 'Off',
};

export function Settings({
  distance,
  onDistance,
  music,
  onMusic,
  simpleControls,
  touchControls,
  onTouchControls,
  onSimpleControls,
  voices,
  onVoices,
  locale,
  onLocale,
}: MenuProps) {
  const voiceModes = (Object.keys(VOICE_LABELS) as VoiceMode[]).filter(
    (mode) => mode !== 'device' || Voices.deviceSpeech,
  );
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
      <div className="setting">
        <span id="controls-label">Controls</span>
        <div className="choices" role="radiogroup" aria-labelledby="controls-label">
          {([false, true] as const).map((simple) => (
            <button
              key={String(simple)}
              type="button"
              role="radio"
              aria-checked={simpleControls === simple}
              className={simpleControls === simple ? 'tab selected' : 'tab'}
              onClick={() => onSimpleControls(simple)}
            >
              {simple ? 'Simple' : 'Standard'}
            </button>
          ))}
        </div>
      </div>
      <p className="note">
        Simple uses one stick (or <kbd>A</kbd> and <kbd>D</kbd>): up and down walk, left and right
        turn, and the view stays level, so there is no looking up or down.
      </p>
      <div className="setting">
        <span id="touch-label">Touch controls</span>
        <div className="choices" role="radiogroup" aria-labelledby="touch-label">
          {TOUCH_SETTINGS.map((setting) => (
            <button
              key={setting}
              type="button"
              role="radio"
              aria-checked={touchControls === setting}
              className={touchControls === setting ? 'tab selected' : 'tab'}
              onClick={() => onTouchControls(setting)}
            >
              {TOUCH_LABELS[setting]}
            </button>
          ))}
        </div>
      </div>
      <p className="note">
        Thumbsticks and buttons on the screen, for phones and tablets: the left stick walks and
        dragging anywhere else looks round. Auto shows them on touch screens only.
      </p>
      <div className="setting">
        <span id="voices-label">Voices</span>
        <div className="choices" role="radiogroup" aria-labelledby="voices-label">
          {voiceModes.map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={voices === mode}
              className={voices === mode ? 'tab selected' : 'tab'}
              onClick={() => onVoices(mode)}
            >
              {VOICE_LABELS[mode]}
            </button>
          ))}
        </div>
      </div>
      <p className="note">
        How people sound when you talk to them (<Key k="T" pad="B" />
        ): made-up babble, or your device reading their lines aloud.
      </p>
      <div className="setting">
        <span id="locale-label">Language</span>
        <div className="choices" role="radiogroup" aria-labelledby="locale-label">
          {(Object.keys(LOCALES) as Locale[]).map((name) => (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={locale === name}
              className={locale === name ? 'tab selected' : 'tab'}
              onClick={() => onLocale(name)}
            >
              {LOCALES[name].label}
            </button>
          ))}
        </div>
      </div>
      <p className="note">The language people speak. The menus stay in English.</p>
    </div>
  );
}

/** The landmark nearest a save's place, to say where it was left; none in a game without a map. */
function nearestLandmark({ x, z }: { x: number; z: number }) {
  const landmarks = game().map?.landmarks ?? [];
  let best = landmarks[0];
  for (const landmark of landmarks)
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

export function describeSave(save: SaveGame) {
  const landmark = nearestLandmark(save.place);
  const where = landmark ? `${landmark.icon} Near ${landmark.name} · ` : '';
  return `${where}${playTime(save.playSeconds)} played · ${playedAgo(save.playedAt)}`;
}

/** The save games: each picks up where it was left; an empty slot starts a new game. */
export function Saves({ slot, onOpenSlot }: MenuProps) {
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

export function Worlds({ seed, edits, onOpenWorld }: MenuProps) {
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
      <Backup seed={seed} edits={edits} onOpenWorld={onOpenWorld} />
    </>
  );
}

/** Backs the world being played up to a file, and opens a world from one, to move it elsewhere. */
function Backup({ seed, edits, onOpenWorld }: Pick<MenuProps, 'seed' | 'edits' | 'onOpenWorld'>) {
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null);
  const [pending, setPending] = useState<SaveFile | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const apply = (save: SaveFile) => {
    importSaveFile(save);
    setPending(null);
    onOpenWorld(save.seed);
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

  return (
    <fieldset className="backup">
      <legend>Back up</legend>
      <p className="note">
        World {seed} and everything you built in it, as a file to keep or open in another browser.
      </p>
      <div className="actions">
        <button
          type="button"
          onClick={() => {
            download(
              JSON.stringify(createSaveFile(seed, edits)),
              `${game().slug}-${seed}.save.json`,
              'application/json',
            );
            setMessage({ text: `Saved world ${seed} to a file.` });
          }}
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
    </fieldset>
  );
}
