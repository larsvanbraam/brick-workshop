import { serveChunks } from '@brick-workshop/game/world/serve.ts';
import { ISLAND_SOURCE } from './source.ts';

/** Brick Island's worker: its hand-drawn island. */
serveChunks(ISLAND_SOURCE);
