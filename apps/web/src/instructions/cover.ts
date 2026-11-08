import type { CinematicMood } from '../cinematic-look';
import { rgbCss } from './layout';
import type { Rgb } from './layout';
import type { ManualRenderer } from './renderer';

export interface CoverArtOptions {
  /** Panel size in pixels. */
  width: number;
  height: number;
  radius: number;
  /** Color outside the rounded corners: the page's frame. */
  frame: Rgb;
  /** Which side of the model to show. */
  view: number;
  /** Where the model goes, in panel pixels. */
  hero: { x: number; y: number; width: number; height: number };
  /** Shoots the model on the workshop's cinematic stage instead of under a painted sky. */
  mood?: CinematicMood;
  /** Title lines to cast a soft shadow for; the crisp text itself is drawn in the PDF. */
  title?: { lines: string[]; x: number; y: number; size: number; lineHeight: number };
}

/** The hero is rendered this much larger than drawn, so cropping to it stays sharp. */
const HERO_OVERSAMPLE = 1.5;

/** Bounds of the opaque pixels in a canvas, or null when it is empty. */
function opaqueBounds(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d')!;
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
  let [left, top, right, bottom] = [width, height, -1, -1];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 16) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  return right < 0 ? null : { left, top, right, bottom };
}

/** Shadow only: the text is drawn far off the canvas and its shadow shifted back into place. */
function titleShadow(context: CanvasRenderingContext2D, { title, width }: CoverArtOptions) {
  if (!title) return;
  const { lines, x, y, size, lineHeight } = title;
  const offset = width * 4;
  context.font = `bold ${size}px Helvetica, Arial, sans-serif`;
  context.textBaseline = 'top';
  context.fillStyle = '#000';
  context.shadowColor = 'rgba(0, 25, 60, 0.55)';
  context.shadowBlur = size * 0.35;
  context.shadowOffsetX = offset;
  context.shadowOffsetY = size * 0.06;
  for (const [index, line] of lines.entries())
    context.fillText(line, x - offset, y + index * lineHeight);
  context.shadowColor = 'transparent';
  context.shadowOffsetX = context.shadowOffsetY = context.shadowBlur = 0;
}

/**
 * The cover's picture, like a box photo: the model large on sandy ground under a blue sky,
 * with a soft shadow beneath it and behind the title, or on the dark cinematic stage. Returned as a JPEG of the whole panel,
 * its rounded corners filled with the frame color.
 */
export function createCoverArt(renderer: ManualRenderer, options: CoverArtOptions) {
  const { width, height, hero } = options;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  context.fillStyle = rgbCss(options.frame);
  context.fillRect(0, 0, width, height);
  context.save();
  context.beginPath();
  context.roundRect(0, 0, width, height, options.radius);
  context.clip();

  if (options.mood) {
    context.drawImage(
      renderer.renderCinematic(options.view, width, height, hero, options.mood),
      0,
      0,
    );
    titleShadow(context, options);
    context.restore();
    return canvas.toDataURL('image/jpeg', 0.92);
  }

  const horizon = height * 0.64;
  const sky = context.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#2c7dd1');
  sky.addColorStop(0.7, '#86c3ef');
  sky.addColorStop(1, '#d9eefb');
  context.fillStyle = sky;
  context.fillRect(0, 0, width, horizon);
  const ground = context.createLinearGradient(0, horizon, 0, height);
  ground.addColorStop(0, '#f3eee3');
  ground.addColorStop(1, '#ddd1b8');
  context.fillStyle = ground;
  context.fillRect(0, horizon, width, height - horizon);
  // Haze softens the horizon line.
  const haze = context.createLinearGradient(0, horizon - height * 0.06, 0, horizon + height * 0.06);
  haze.addColorStop(0, 'rgba(255, 255, 255, 0)');
  haze.addColorStop(0.5, 'rgba(255, 255, 255, 0.7)');
  haze.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = haze;
  context.fillRect(0, horizon - height * 0.06, width, height * 0.12);
  const sun = context.createRadialGradient(
    width * 0.8,
    height * 0.08,
    0,
    width * 0.8,
    height * 0.08,
    width * 0.45,
  );
  sun.addColorStop(0, 'rgba(255, 255, 255, 0.75)');
  sun.addColorStop(0.25, 'rgba(255, 255, 255, 0.25)');
  sun.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = sun;
  context.fillRect(0, 0, width, horizon);

  titleShadow(context, options);

  // Render larger than needed, then crop to the model's own pixels so it fills the hero area
  // instead of the camera's safety margin, standing centred on its bottom edge.
  const model = document.createElement('canvas');
  model.width = Math.round(hero.width * HERO_OVERSAMPLE);
  model.height = Math.round(hero.height * HERO_OVERSAMPLE);
  model
    .getContext('2d')!
    .drawImage(renderer.renderModel(options.view, model.width, model.height), 0, 0);
  const bounds = opaqueBounds(model);
  if (bounds) {
    const cropWidth = bounds.right - bounds.left + 1;
    const cropHeight = bounds.bottom - bounds.top + 1;
    const fit = Math.min(hero.width / cropWidth, hero.height / cropHeight);
    const drawWidth = cropWidth * fit;
    const drawHeight = cropHeight * fit;
    const left = hero.x + (hero.width - drawWidth) / 2;
    const top = hero.y + hero.height - drawHeight;
    context.save();
    context.filter = `blur(${Math.round(drawWidth * 0.04)}px)`;
    context.fillStyle = 'rgba(60, 45, 20, 0.35)';
    context.beginPath();
    context.ellipse(
      left + drawWidth / 2,
      top + drawHeight - drawWidth * 0.08,
      drawWidth * 0.5,
      drawWidth * 0.1,
      0,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.restore();
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      model,
      bounds.left,
      bounds.top,
      cropWidth,
      cropHeight,
      left,
      top,
      drawWidth,
      drawHeight,
    );
  }
  context.restore();
  return canvas.toDataURL('image/jpeg', 0.92);
}
