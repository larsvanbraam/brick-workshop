import type { ReactNode } from 'react';
import type { VoiceTraits } from '@brick-workshop/audio/voice';
import type { WandererSpec } from '@brick-workshop/npc/wanderers';
import type { MinifigOutfit } from '@brick-workshop/walk/minifig';
import type { WalkWorld } from '@brick-workshop/walk/walk';
import type { WalkProbe } from '@brick-workshop/walk/walk-view';
import type { Locale } from './locale.ts';
import type { MapPin } from './Minimap.tsx';
import type { Terrain } from './world/terrain.ts';

/**
 * What a game adds to the core game: Brick Island's jobs and tide, say. A game's `GameConfig`
 * names a hook (`useAddon`); the game calls it once a frame's render with what the add-on may
 * reach (`AddonHost`) and puts what it returns (`Addon`) in the scene, over the screen, in the
 * status bar and in the save game.
 */

/** What the game lets an add-on reach. */
export interface AddonHost {
  seed: number;
  /** The scene's frame, in studs. */
  frame: number;
  terrain: Terrain;
  /** The walker's collision world; an add-on may push the walker (`drift`). */
  walk: WalkWorld;
  /** Filled with the live walker and its look. */
  probe: { current: WalkProbe | null };
  playing: boolean;
  locale: Locale;
  /** What the add-on kept in the save game being resumed (see `Addon.save`), if any. */
  saved: unknown;
  /** Has someone say a line: in a bubble over their head and out loud. */
  speak: (id: string, name: string, text: string, voice: VoiceTraits) => void;
  /** Whether someone is speaking now. */
  saying: boolean;
  /** Who the walker stands beside to talk to, by wanderer ID. */
  nearbyPerson: string | null;
}

/** Where the scene is when it asks an add-on for its people. */
export interface PeopleContext {
  terrain: Terrain;
  buildArea: number;
  /** The chunks round the walker whose people are about, as `chunkKey`s. */
  keys: ReadonlySet<string>;
  /** Whether a chunk is loaded. */
  isLoaded: (cx: number, cz: number) => boolean;
}

/** What an add-on gives back, each render. */
export interface Addon {
  /** What the player's minifigure wears, if it is not the classic one. */
  outfit?: MinifigOutfit;
  /** Drawn inside the canvas, in the scene. */
  scene: ReactNode;
  /** Drawn over the game: cards, notes and speech bubbles. */
  overlay: ReactNode;
  /** An extra line in the status bar. */
  status: ReactNode;
  /** Pins for the map. */
  pins?: readonly MapPin[];
  /** People the add-on brings to life, and where they stand (written by the scene). */
  people?: {
    positions: Map<string, { x: number; y: number; z: number }>;
    specs: (context: PeopleContext) => WandererSpec[];
  };
  /** What to keep in the save game. */
  save: () => unknown;
  /** Whether a wanderer is the add-on's, so talking to them is up to it. */
  owns: (id: string) => boolean;
  /** The walker talks to one of the add-on's people. */
  talkTo: (id: string) => void;
  /** The name of one of the add-on's people, for the hint beside them. */
  nameOf: (id: string) => string | null;
  /** What the press beside someone does instead of talking, if the add-on has a use for it. */
  action: (id: string) => string | null;
  /** The hat key. Says whether it did anything. */
  changeHat: () => boolean;
}

const NONE: Addon = {
  scene: null,
  overlay: null,
  status: null,
  save: () => undefined,
  owns: () => false,
  talkTo: () => {},
  nameOf: () => null,
  action: () => null,
  changeHat: () => false,
};

/** The add-on of a game without one. */
export const useNoAddon = (): Addon => NONE;
