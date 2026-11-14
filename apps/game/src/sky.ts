import { Color, Vector3 } from 'three';

/**
 * Time of day as a fraction of a day: 0 is midnight, 0.25 sunrise at six, 0.5 noon and 0.75
 * sunset at six in the evening.
 */
export type TimeOfDay = number;

/** Real seconds one day on the island lasts. */
export const DAY_SECONDS = 600;

/** A new island starts on a bright morning. */
export const START_TIME: TimeOfDay = 0.3;

/** The clock face for a time of day, as 24-hour hours and minutes. */
export function clockTime(time: TimeOfDay) {
  const minutes = Math.floor((((time % 1) + 1) % 1) * 24 * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Whether the sun is up: between six in the morning and six in the evening. */
export const isDaytime = (time: TimeOfDay) => time >= 0.25 && time < 0.75;

export interface SkyState {
  /** Toward the sun and the moon, unit vectors; the sun rises in the east (+x) and sets west. */
  sun: Vector3;
  moon: Vector3;
  /** The sun's height over the horizon, -1 to 1. */
  elevation: number;
  /** The light that casts shadows: the sun by day, the moon by night. */
  key: { direction: Vector3; color: Color; intensity: number };
  /** Sky and ground tints of the fill light. */
  fill: { sky: Color; ground: Color; intensity: number };
  zenith: Color;
  horizon: Color;
  /** Reflections of the plastic, brightest at noon. */
  environment: number;
  /**
   * How bright unlit things should be, 1 by day: brick outlines are drawn without lighting, so
   * they would glow in the dark.
   */
  unlit: number;
  /** How much of the sky the stars show through, 0 by day to 1 at night. */
  stars: number;
  /** How bright the sun's disc is, fading as it sets. */
  sunDisc: number;
  moonDisc: number;
}

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

const mix = (a: string, b: string, t: number) => new Color(a).lerp(new Color(b), t);

/** The sun's path tilts toward the south (-z), so noon shadows fall north and faces shade. */
const TILT = 0.45;

/**
 * Sky colours and lights for a time of day. Day blends in from a warm dawn, night from a cool
 * dusk; the sun's warmth peaks while it is low. The moon stands opposite the sun.
 */
export function skyAt(time: TimeOfDay): SkyState {
  const angle = (time - 0.25) * Math.PI * 2;
  const sun = new Vector3(Math.cos(angle), Math.sin(angle), -TILT).normalize();
  const moon = sun.clone().negate();
  moon.z = -TILT * 0.8;
  moon.normalize();
  const elevation = sun.y;
  const day = smoothstep(-0.12, 0.28, elevation);
  const night = 1 - smoothstep(-0.25, 0.02, elevation);
  // Warm light while the sun is low on either side of the horizon.
  const glow = Math.max(0, 1 - Math.abs(elevation) / 0.32) * (1 - night * 0.6);

  const sunUp = elevation > -0.02;
  const sunLight = smoothstep(-0.02, 0.18, elevation);
  const moonLight = smoothstep(-0.02, 0.2, moon.y) * night;
  const key = sunUp
    ? {
        direction: sun.clone(),
        color: mix('#ff9b5c', '#fff1dc', smoothstep(0.05, 0.45, elevation)),
        intensity: 2.6 * sunLight,
      }
    : { direction: moon.clone(), color: new Color('#a9bfff'), intensity: 0.55 * moonLight };

  const dayZenith = '#4b8ad3';
  const dayHorizon = '#bcd7ec';
  const nightZenith = '#03060f';
  const nightHorizon = '#141d35';
  const zenith = mix(nightZenith, dayZenith, day).lerp(new Color('#3a4a86'), glow * 0.35);
  const horizon = mix(nightHorizon, dayHorizon, day).lerp(new Color('#f0a066'), glow * 0.75);

  return {
    sun,
    moon,
    elevation,
    key,
    fill: {
      sky: mix('#2b3a62', '#d6e9ff', day).lerp(new Color('#ffc59a'), glow * 0.3),
      ground: mix('#121318', '#6b5b47', day),
      intensity: 0.45 + 0.65 * day,
    },
    zenith,
    horizon,
    environment: 0.06 + 0.29 * day,
    unlit: 0.18 + 0.82 * day,
    stars: night,
    sunDisc: smoothstep(-0.08, 0.02, elevation),
    moonDisc: smoothstep(-0.08, 0.02, moon.y) * (0.3 + 0.7 * night),
  };
}

/**
 * The island's clock: runs at `speed` days per real second unless paused, and can be set. Read
 * every frame without React; the HUD subscribes for a once-a-second update.
 */
export class DayClock {
  time: TimeOfDay;
  speed = 1 / DAY_SECONDS;
  paused = false;
  private readonly listeners = new Set<() => void>();
  private shown = '';

  constructor(time: TimeOfDay = START_TIME) {
    this.time = ((time % 1) + 1) % 1;
    this.shown = clockTime(this.time);
  }

  advance(seconds: number) {
    if (this.paused) return;
    this.set(this.time + seconds * this.speed);
  }

  set(time: TimeOfDay) {
    this.time = ((time % 1) + 1) % 1;
    const shown = clockTime(this.time);
    if (shown === this.shown) return;
    this.shown = shown;
    for (const listener of this.listeners) listener();
  }

  /** Tells listeners after a change of speed or pause too, for the debug window. */
  changed() {
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => `${this.shown}|${this.speed}|${this.paused}`;
}
