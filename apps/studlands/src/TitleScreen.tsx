import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Controls, Saves, Settings, Worlds, describeSave } from './Menu.tsx';
import type { MenuProps } from './Menu.tsx';
import type { SaveGame } from './save.ts';
import { game } from './game.ts';

type Page = 'saves' | 'worlds' | 'controls' | 'settings';

const PAGE_TITLES: Record<Page, string> = {
  saves: 'Saves',
  worlds: 'Worlds',
  controls: 'Controls',
  settings: 'Settings',
};

/** The logo's brick colours, in turn: red, blue, yellow, green, orange and white. */
const BRICKS = [
  { color: '#c91a09', ink: '#fff6ec' },
  { color: '#0055bf', ink: '#f2f6ff' },
  { color: '#f2cd37', ink: '#3b2d07' },
  { color: '#237841', ink: '#effaf1' },
  { color: '#fe8a18', ink: '#3a1d02' },
  { color: '#f4f4f4', ink: '#2a2a2a' },
];

/** How long the title takes to leave once Play is pressed, in milliseconds (see game.css). */
const LEAVE_MS = 900;

/** Whether the full intro has run on this page: opening another world gets a short one. */
let introShown = false;

export interface TitleScreenProps extends MenuProps {
  /** The save game this picks up from, in a game with save slots. */
  save: SaveGame | null;
  /** Set once Play is pressed: the title animates away, then calls `onGone`. */
  leaving: boolean;
  onGone: () => void;
}

/**
 * The title screen in front of the game when it opens: the game's name built from bricks that
 * drop in one by one, then the menu, over the live world. The pause menu (`Menu`) takes over once
 * the game has started.
 */
export function TitleScreen(props: TitleScreenProps) {
  const { leaving, onGone, onPlay, save } = props;
  const [full] = useState(() => !introShown);
  useEffect(() => {
    introShown = true;
  }, []);
  const [page, setPage] = useState<Page | null>(null);
  const play = useRef<HTMLButtonElement>(null);

  // Esc closes an open page, so the keyboard can get back to the buttons.
  useEffect(() => {
    if (!page) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.code !== 'Escape') return;
      event.preventDefault();
      setPage(null);
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [page]);

  // The Play button takes the focus once it has shown, so Enter starts the game.
  useEffect(() => {
    const timer = setTimeout(() => play.current?.focus({ preventScroll: true }), full ? 2000 : 300);
    return () => clearTimeout(timer);
  }, [full]);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(onGone, LEAVE_MS);
    return () => clearTimeout(timer);
  }, [leaving, onGone]);

  const { title, tagline } = game();
  let at = 0;
  const words = title
    .split(' ')
    .map((word) => [...word].map((letter) => ({ letter, index: at++ })));
  const letters = at;
  const subtitle =
    game().seed === undefined
      ? `World ${props.seed}`
      : game().saveSlots
        ? `Game ${props.slot + 1}${save ? ` · ${describeSave(save)}` : ' · New game'}`
        : null;
  const pages: Page[] = [
    ...(game().saveSlots ? (['saves'] as const) : []),
    ...(game().seed === undefined ? (['worlds'] as const) : []),
    'controls',
    'settings',
  ];
  let item = 0;
  const step = () => ({ '--item': item++ }) as CSSProperties;

  return (
    <div
      className={[
        'title-screen',
        full ? 'intro' : 'quick',
        leaving ? 'leaving' : '',
        page ? 'paged' : '',
      ].join(' ')}
      style={{ '--letters': letters } as CSSProperties}
      inert={leaving}
    >
      <div className="title-shade" aria-hidden />
      <div className="title-main">
        <h1 className="title-logo" aria-label={title}>
          {words.map((word, w) => (
            <span key={w} className="title-word" aria-hidden>
              {word.map(({ letter, index }) => {
                const brick = BRICKS[index % BRICKS.length];
                // A small tilt per letter, the same every time, so the logo looks stacked by hand.
                const tilt = (((index * 37) % 7) - 3) * 0.9;
                return (
                  <span
                    key={index}
                    className="title-brick"
                    style={
                      {
                        '--c': brick.color,
                        '--ink': brick.ink,
                        '--i': index,
                        '--tilt': `${tilt}deg`,
                      } as CSSProperties
                    }
                  >
                    {letter}
                  </span>
                );
              })}
            </span>
          ))}
        </h1>
        <p className="title-tagline">{tagline}</p>
        <nav className="title-actions" aria-label="Title menu">
          <button
            ref={play}
            type="button"
            className="title-play"
            style={step()}
            onClick={onPlay}
            data-pad-start
          >
            <span>{props.resumable ? 'Continue' : 'Play'}</span>
            <kbd>Enter</kbd>
          </button>
          {subtitle && (
            <p className="title-subtitle" style={step()}>
              {subtitle}
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
        <section className="title-page panel" aria-label={PAGE_TITLES[page]} key={page}>
          <header>
            <h2>{PAGE_TITLES[page]}</h2>
            <button type="button" onClick={() => setPage(null)} data-pad-back>
              Back <kbd>Esc</kbd>
            </button>
          </header>
          {page === 'saves' && <Saves {...props} />}
          {page === 'worlds' && <Worlds {...props} />}
          {page === 'controls' && <Controls {...props} />}
          {page === 'settings' && <Settings {...props} />}
        </section>
      )}
      <p className="title-credit">Built from real LDraw parts</p>
    </div>
  );
}
