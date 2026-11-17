import { inject } from '@vercel/analytics';
import { startGame } from '@brick-workshop/game/start';
import './island.css';
import { BRICK_ISLAND } from './island.ts';

startGame(BRICK_ISLAND);

inject();
