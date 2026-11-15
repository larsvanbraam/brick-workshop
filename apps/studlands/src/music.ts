/** How loud the background piano plays at each setting, as the music's volume. */
export const MUSIC_LEVELS = { off: 0, quiet: 0.35, normal: 0.7 } as const;
export type MusicLevel = keyof typeof MUSIC_LEVELS;
export const DEFAULT_MUSIC: MusicLevel = 'normal';

export const isMusicLevel = (name: unknown): name is MusicLevel =>
  typeof name === 'string' && Object.hasOwn(MUSIC_LEVELS, name);

/** In the menu the music carries on, softer, under the buttons. */
export const MENU_SHARE = 0.5;
