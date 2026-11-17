import { serveChunks } from '@brick-workshop/game/world/serve.ts';
import { NOISE_WORLD } from '@brick-workshop/game/world/noise-world.ts';

/** Brick World's worker: the endless land. */
serveChunks(NOISE_WORLD);
