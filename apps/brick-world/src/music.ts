import type { Style } from '@brick-workshop/audio/music';
import type { Biome } from './world/terrain.ts';

/** How loud the background piano plays at each setting, as the music's volume. */
export const MUSIC_LEVELS = { off: 0, quiet: 0.35, normal: 0.7 } as const;
export type MusicLevel = keyof typeof MUSIC_LEVELS;
export const DEFAULT_MUSIC: MusicLevel = 'normal';

export const isMusicLevel = (name: unknown): name is MusicLevel =>
  typeof name === 'string' && Object.hasOwn(MUSIC_LEVELS, name);

/** In the menu the music carries on, softer, under the buttons. */
export const MENU_SHARE = 0.5;

/** The song each kind of ground plays. */
export const STYLE_OF_BIOME: Record<Biome, Style> = {
  meadow: 'meadow',
  forest: 'forest',
  beach: 'beach',
  sea: 'sea',
  river: 'sea',
  desert: 'desert',
  snow: 'snow',
  marsh: 'marsh',
  rock: 'rock',
  volcanic: 'volcanic',
  lava: 'volcanic',
  road: 'town',
  pavement: 'town',
  yard: 'town',
  field: 'town',
};

/** How long the player stays in a place before its song takes over, in milliseconds. */
export const STYLE_DWELL = 12000;
