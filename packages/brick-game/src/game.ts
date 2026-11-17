import type { VehicleKind } from '@brick-workshop/vehicles/vehicle';
import type { Pasture } from './animals.ts';
import type { Addon, AddonHost } from './extension.ts';
import type { Locale } from './locale.ts';
import type { WorldSource } from './world/terrain.ts';

/** Which way a parked vehicle faces, by the compass: north is -z. */
export type Heading = 'north' | 'east' | 'south' | 'west';

/** A vehicle waiting at its spot, in world studs, for the player to find and drive. */
export interface VehicleSpawn {
  id: string;
  kind: VehicleKind;
  x: number;
  z: number;
  heading: Heading;
}

/** A place worth finding, marked on the map with an icon and its name. */
export interface Landmark {
  name: string;
  x: number;
  z: number;
  icon: string;
}

/** A game's map: its picture, drawn from above, and the places worth finding on it. */
export interface GameMap {
  /** The box of world studs the picture covers. */
  bounds: { x0: number; z0: number; x1: number; z1: number };
  /** Studs per pixel. */
  step: number;
  /** The picture as RGBA pixels, `(x1 - x0) / step` by `(z1 - z0) / step`. */
  draw: (seed: number) => Uint8ClampedArray;
  landmarks: readonly Landmark[];
}

/** A key the game adds to the controls page. */
export interface ExtraControl {
  group: string;
  action: string;
  key: string;
  pad: string;
}

/**
 * Which game this is. Brick World and Brick Island share every system (streaming, building,
 * walking, the menu); they differ in their world and their name. Brick World shapes endless land
 * from any seed; Brick Island is one hand-drawn island, the same for everyone. What a game adds
 * on top (Brick Island's jobs and tide) comes in through `useAddon`.
 */
export interface GameConfig {
  /** The name on the menu and in the status bar. */
  title: string;
  /** The line under the name on the title screen. */
  tagline: string;
  /** What shapes the world. */
  source: WorldSource;
  /**
   * Starts the worker that builds chunks. It lives with the game that has the world: the worker
   * builds its terrain from the same `source` (see `serveChunks`).
   */
  createWorker: () => Worker;
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
  /** A map of the world in the corner, with its landmarks (`N` opens it full). */
  map?: GameMap;
  /**
   * Whether the game keeps save games: slots that each remember where the player was, so a
   * game picks up where it was left. Brick World keeps worlds instead, each with its building.
   */
  saveSlots: boolean;
  /** The vehicles parked round the world for the player to drive, and where. */
  vehicles: readonly VehicleSpawn[];
  /** Pastures where farm animals graze. */
  pastures?: readonly Pasture[];
  /** What the people say beyond the usual: lines about the game's own place. */
  chat?: Record<Locale, readonly string[]>;
  /** Keys the game adds to the controls page, for what its add-on does. */
  controls?: readonly ExtraControl[];
  /** The hook that gives the game its own systems; see `Addon`. */
  useAddon?: (host: AddonHost) => Addon;
}

let current: GameConfig | null = null;

/** The game being played. Set once at start-up (see `startGame`), before anything reads it. */
export const game = () => {
  if (!current) throw new Error('No game is set: start one with startGame.');
  return current;
};

export function setGame(config: GameConfig) {
  current = config;
}
