import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Key } from './input-hint.tsx';
import { MenuPage } from './MenuPage.tsx';
import { Logo, logoLetters } from './Logo.tsx';
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
      style={{ '--letters': logoLetters(title) } as CSSProperties}
      inert={leaving}
    >
      <div className="title-shade" aria-hidden />
      <div className="title-main">
        <Logo title={title} />
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
            <Key k="Enter" pad="A" />
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
        <MenuPage title={PAGE_TITLES[page]} onBack={() => setPage(null)} key={page}>
          {page === 'saves' && <Saves {...props} />}
          {page === 'worlds' && <Worlds {...props} />}
          {page === 'controls' && <Controls {...props} />}
          {page === 'settings' && <Settings {...props} />}
        </MenuPage>
      )}
      <p className="title-credit">Built from real LDraw parts</p>
    </div>
  );
}
