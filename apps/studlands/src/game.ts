import type { WorldKind } from './world/terrain.ts';

/**
 * Which game this is. Studlands and Brick Island share every system (streaming, building,
 * walking, the menu); they differ in their world and their name. Studlands shapes endless land
 * from any seed; Brick Island is one hand-drawn island, the same for everyone.
 */
export interface GameConfig {
  /** The name on the menu and in the status bar. */
  title: string;
  /** What shapes the world. */
  world: WorldKind;
  /** Saves are kept under this prefix, so the two games never read each other's. */
  savePrefix: string;
  /** For a game of one world: its seed, with no worlds to switch between. */
  seed?: number;
  /** File names for exports and saves start with this. */
  slug: string;
  /** Whether the player builds: the hotbar, the brick box, placing and taking off pieces. */
  building: boolean;
  /** A time of day to stay at (0.5 is noon), for a game without day and night. */
  fixedTime?: number;
  /** Whether a map of the world shows in the corner, with its landmarks (`N` opens it full). */
  minimap: boolean;
  /**
   * Whether the game keeps save games: slots that each remember where the player was, so a
   * game picks up where it was left. Studlands keeps worlds instead, each with its building.
   */
  saveSlots: boolean;
}

export const STUDLANDS: GameConfig = {
  title: 'Studlands',
  world: 'studlands',
  // Keys keep the game's first name, so saves from before the rename still load.
  savePrefix: 'brick-island',
  slug: 'studlands',
  building: true,
  minimap: false,
  saveSlots: false,
};

export const BRICK_ISLAND: GameConfig = {
  title: 'Brick Island',
  world: 'island',
  savePrefix: 'brick-island-map',
  seed: 7,
  slug: 'brick-island',
  // A game for walking round and doing things, not for building.
  building: false,
  // Always a bright morning: no nights, which suits a game for children.
  fixedTime: 0.42,
  minimap: true,
  saveSlots: true,
};

let current: GameConfig = STUDLANDS;

/** The game being played. Set once at start-up, before anything reads it. */
export const game = () => current;

export function setGame(config: GameConfig) {
  current = config;
}
