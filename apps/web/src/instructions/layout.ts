import { COLORS } from '@brick-workshop/engine';
import type { Assembly } from '@brick-workshop/engine';
import { displayHex } from '../ldraw-materials';

/** ISO and North American paper sizes, portrait, in millimetres. */
export const PAGE_SIZES = {
  a5: { label: 'A5', width: 148, height: 210 },
  a4: { label: 'A4', width: 210, height: 297 },
  a3: { label: 'A3', width: 297, height: 420 },
  letter: { label: 'US Letter', width: 215.9, height: 279.4 },
  legal: { label: 'US Legal', width: 215.9, height: 355.6 },
} as const;

export type PageSize = keyof typeof PAGE_SIZES;
export type Orientation = 'portrait' | 'landscape';

/** Pieces and part kinds per step, from small and easy to fewer, fuller pages. */
export const STEP_SIZES = {
  small: { label: 'Small', maxPiecesPerStep: 4, maxKindsPerStep: 3 },
  standard: { label: 'Standard', maxPiecesPerStep: 6, maxKindsPerStep: 4 },
  large: { label: 'Large', maxPiecesPerStep: 8, maxKindsPerStep: 4 },
} as const;

export type StepSize = keyof typeof STEP_SIZES;

/** Smallest side, in millimetres, a step's panel may have before the page takes fewer. */
const MIN_STEP_PANEL = 135;

export function getPageDimensions(size: PageSize, orientation: Orientation) {
  const { width, height } = PAGE_SIZES[size];
  return orientation === 'portrait' ? { width, height } : { width: height, height: width };
}

/** How many steps share a page: a grid of panels no smaller than MIN_STEP_PANEL. */
export function getStepGrid(size: PageSize, orientation: Orientation) {
  const { width, height } = getPageDimensions(size, orientation);
  return {
    columns: Math.max(1, Math.floor(width / MIN_STEP_PANEL)),
    rows: Math.max(1, Math.floor(height / MIN_STEP_PANEL)),
  };
}

export function countPages(steps: number, kinds: number, size: PageSize, orientation: Orientation) {
  const { columns, rows } = getStepGrid(size, orientation);
  const { width, height } = getPageDimensions(size, orientation);
  const inventory = getInventoryGrid(width, height);
  // Cover, step pages, parts list pages and the back cover.
  return (
    1 +
    Math.ceil(steps / (columns * rows)) +
    Math.ceil(kinds / (inventory.columns * inventory.rows)) +
    1
  );
}

/** Parts list tiles per page: each tile is 30 by 34 mm inside a 12 mm margin and a title. */
export function getInventoryGrid(width: number, height: number) {
  return {
    columns: Math.max(3, Math.floor((width - 24) / 30)),
    rows: Math.max(3, Math.floor((height - 46) / 34)),
  };
}

export type Rgb = readonly [number, number, number];

export interface ManualTheme {
  /** Light tint behind the steps. */
  page: Rgb;
  /** Slightly deeper tint behind each parts callout. */
  callout: Rgb;
  /** Outlines, dividers and step numbers. */
  ink: Rgb;
  /** The covers' frame: the build's leading color, deepened. */
  frame: Rgb;
}

export function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgbToHsl([red, green, blue]: Rgb) {
  const [r, g, b] = [red / 255, green / 255, blue / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return { hue: 0, saturation: 0, lightness };
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const hue =
    max === r
      ? ((g - b) / delta + (g < b ? 6 : 0)) * 60
      : max === g
        ? ((b - r) / delta + 2) * 60
        : ((r - g) / delta + 4) * 60;
  return { hue, saturation, lightness };
}

export function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const section = (((hue % 360) + 360) % 360) / 60;
  const second = chroma * (1 - Math.abs((section % 2) - 1));
  const [r, g, b] =
    section < 1
      ? [chroma, second, 0]
      : section < 2
        ? [second, chroma, 0]
        : section < 3
          ? [0, chroma, second]
          : section < 4
            ? [0, second, chroma]
            : section < 5
              ? [second, 0, chroma]
              : [chroma, 0, second];
  const offset = lightness - chroma / 2;
  return [r, g, b].map((value) => Math.round((value + offset) * 255)) as unknown as Rgb;
}

/**
 * Colors the manual after the build: pages tinted with its most used colorful brick and the
 * covers framed in a deep shade of it. Builds without colorful bricks get a blue manual.
 */
export function deriveManualTheme(assembly: Assembly): ManualTheme {
  const counts = new Map<number, number>();
  for (const brick of assembly.bricks) counts.set(brick.color, (counts.get(brick.color) ?? 0) + 1);
  const leading = [...counts.entries()]
    .sort((first, second) => second[1] - first[1] || first[0] - second[0])
    .map(([id]) => COLORS.find((color) => color.id === id))
    .filter((color) => color !== undefined)
    .map((color) => rgbToHsl(hexToRgb(displayHex(color))))
    .find((hsl) => hsl.saturation > 0.25 && hsl.lightness > 0.15 && hsl.lightness < 0.85);
  const hue = leading?.hue ?? 210;
  return {
    page: hslToRgb(hue, 0.55, 0.93),
    callout: hslToRgb(hue, 0.5, 0.85),
    ink: hslToRgb(hue, 0.35, 0.16),
    frame: hslToRgb(hue, 0.6, 0.38),
  };
}

export function rgbCss([red, green, blue]: Rgb) {
  return `rgb(${red} ${green} ${blue})`;
}
