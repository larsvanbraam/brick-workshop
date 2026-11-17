import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './game.css';
import { App } from './App.tsx';
import { setGame } from './game.ts';
import type { GameConfig } from './game.ts';

export { BRICK_ISLAND, BRICK_WORLD } from './game.ts';
export type { GameConfig } from './game.ts';

/** Starts a game in the page's `#root`. */
export function startGame(config: GameConfig) {
  setGame(config);
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
