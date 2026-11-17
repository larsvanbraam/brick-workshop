import { inject } from '@vercel/analytics';
import { startGame } from '@brick-workshop/game/start';
import { BRICK_WORLD } from './world.ts';

startGame(BRICK_WORLD);

inject();
