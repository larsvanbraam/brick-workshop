import { inject } from '@vercel/analytics';
import { BRICK_ISLAND, startGame } from '@brick-workshop/game/start';

startGame(BRICK_ISLAND);

inject();
