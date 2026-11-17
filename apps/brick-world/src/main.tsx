import { inject } from '@vercel/analytics';
import { BRICK_WORLD, startGame } from '@brick-workshop/game/start';

startGame(BRICK_WORLD);

inject();
