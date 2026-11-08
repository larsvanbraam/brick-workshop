import { jsPDF } from 'jspdf';
import { COLORS, getBillOfMaterials, getPart } from '@lego-builder/brick-engine';
import type { Assembly, InstructionStep } from '@lego-builder/brick-engine';
import {
  deriveManualTheme,
  getInventoryGrid,
  getPageDimensions,
  getStepGrid,
  rgbCss,
} from './layout';
import type { ManualTheme, Orientation, PageSize, Rgb } from './layout';
import type { CinematicMood } from '../cinematic-look';
import { createCoverArt } from './cover';
import { ManualRenderer, OVERVIEW_SCALE } from './renderer';
import type { StepImage } from './renderer';

export interface ManualSettings {
  pageSize: PageSize;
  orientation: Orientation;
  /** The covers' look: the painted sky, or a shot on one of the cinematic stage's moods. */
  cover?: 'classic' | CinematicMood;
}

export interface ManualProgress {
  label: string;
  done: number;
  total: number;
}

export interface Manual {
  blob: Blob;
  pages: number;
  /** Parts drawn as simple shapes because their LDraw geometry could not be loaded. */
  missingParts: string[];
}

const WHITE: Rgb = [255, 255, 255];
const PART_IMAGE_PIXELS = 256;
/** Step images are sharp in print at this density; very long manuals use less to stay small. */
const STEP_DPI = 150;
const LONG_MANUAL_DPI = 110;
const MAX_IMAGE_PIXELS = 1600;
/** Covers are a single large picture each, so they get more detail. */
const COVER_DPI = 200;
const MAX_COVER_PIXELS = 2400;
const POINTS_PER_MM = 72 / 25.4;

const mix = (color: Rgb, other: Rgb, amount: number) =>
  color.map((value, index) =>
    Math.round(value + (other[index] - value) * amount),
  ) as unknown as Rgb;

/**
 * The color a flat JPEG of this color decodes to. Step images and part thumbnails are JPEGs on
 * the page and callout tints; filling those with the decoded color hides the images' edges.
 */
async function jpegColor(color: Rgb): Promise<Rgb> {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 16;
  const context = canvas.getContext('2d')!;
  context.fillStyle = rgbCss(color);
  context.fillRect(0, 0, 16, 16);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.9),
  );
  if (!blob) return color;
  const bitmap = await createImageBitmap(blob);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const [red, green, blue] = context.getImageData(8, 8, 1, 1).data;
  return [red, green, blue];
}

const pause = () => new Promise((resolve) => setTimeout(resolve));

function colorName(id: number) {
  return COLORS.find((color) => color.id === id)?.name.replaceAll('_', ' ') ?? `Color ${id}`;
}

class ManualWriter {
  readonly doc: jsPDF;
  readonly width: number;
  readonly height: number;
  private readonly partImages = new Map<string, string>();
  private readonly renderer: ManualRenderer;
  private readonly theme: ManualTheme;
  private readonly mood: CinematicMood | undefined;

  constructor(renderer: ManualRenderer, theme: ManualTheme, settings: ManualSettings) {
    this.renderer = renderer;
    this.theme = theme;
    this.mood = settings.cover === 'classic' ? undefined : settings.cover;
    const { width, height } = getPageDimensions(settings.pageSize, settings.orientation);
    this.width = width;
    this.height = height;
    this.doc = new jsPDF({
      unit: 'mm',
      format: [width, height],
      orientation: width > height ? 'landscape' : 'portrait',
      compress: true,
    });
  }

  private fill(color: Rgb) {
    this.doc.setFillColor(...color);
  }

  private stroke(color: Rgb, width: number) {
    this.doc.setDrawColor(...color);
    this.doc.setLineWidth(width);
  }

  text(
    value: string | string[],
    x: number,
    y: number,
    size: number,
    color: Rgb,
    options: { bold?: boolean; align?: 'left' | 'center' | 'right'; outline?: Rgb } = {},
  ) {
    this.doc.setFont('helvetica', options.bold === false ? 'normal' : 'bold');
    this.doc.setFontSize(size);
    this.doc.setTextColor(...color);
    if (options.outline) this.stroke(options.outline, size / 40);
    this.doc.text(value, x, y, {
      align: options.align ?? 'left',
      baseline: 'top',
      renderingMode: options.outline ? 'fillThenStroke' : 'fill',
    });
  }

  newPage(background: Rgb, first = false) {
    if (!first)
      this.doc.addPage(
        [this.width, this.height],
        this.width > this.height ? 'landscape' : 'portrait',
      );
    this.fill(background);
    this.doc.rect(0, 0, this.width, this.height, 'F');
  }

  partImage(partId: string, color: number) {
    const key = `${partId}:${color}`;
    let url = this.partImages.get(key);
    if (!url) {
      url = this.renderer.renderPart(partId, color, PART_IMAGE_PIXELS, this.theme.callout);
      this.partImages.set(key, url);
    }
    return { url, alias: `part-${key}` };
  }

  private pageNumber(scale: number) {
    const page = this.doc.getNumberOfPages();
    const margin = 8 * scale;
    this.text(
      String(page),
      page % 2 ? this.width - margin : margin,
      this.height - margin - 4.5 * scale,
      13 * scale,
      this.theme.ink,
      {
        align: page % 2 ? 'right' : 'left',
      },
    );
  }

  /** Lays out a step page: panels in a grid, divided by thin rules like a printed manual. */
  stepPanels(columns: number, rows: number) {
    const panelWidth = this.width / columns;
    const panelHeight = this.height / rows;
    const scale = Math.min(panelWidth, panelHeight) / 148;
    this.stroke(this.theme.ink, 0.5 * scale);
    for (let column = 1; column < columns; column++)
      this.doc.line(column * panelWidth, 10 * scale, column * panelWidth, this.height - 10 * scale);
    for (let row = 1; row < rows; row++)
      this.doc.line(10 * scale, row * panelHeight, this.width - 10 * scale, row * panelHeight);
    this.pageNumber(scale);
    return { panelWidth, panelHeight, scale };
  }

  /** The parts callout: each part with its quantity, wrapped to the width available. */
  callout(step: InstructionStep, x: number, y: number, maxWidth: number, scale: number) {
    const thumb = 19 * scale;
    const gap = 3 * scale;
    const padding = 3.5 * scale;
    const label = 6 * scale;
    const perRow = Math.max(1, Math.floor((maxWidth - 2 * padding + gap) / (thumb + gap)));
    const columns = Math.min(perRow, step.parts.length);
    const rows = Math.ceil(step.parts.length / perRow);
    const boxWidth = 2 * padding + columns * thumb + (columns - 1) * gap;
    const boxHeight = 2 * padding + rows * (thumb + label) + (rows - 1) * gap;
    this.fill(this.theme.callout);
    this.stroke(this.theme.ink, 0.35 * scale);
    this.doc.roundedRect(x, y, boxWidth, boxHeight, 2.5 * scale, 2.5 * scale, 'FD');
    for (const [index, part] of step.parts.entries()) {
      const left = x + padding + (index % perRow) * (thumb + gap);
      const top = y + padding + Math.floor(index / perRow) * (thumb + label + gap);
      const image = this.partImage(part.partId, part.color);
      this.doc.addImage(image.url, 'JPEG', left, top, thumb, thumb, image.alias);
      this.text(`${part.quantity}x`, left, top + thumb + 0.6 * scale, 11 * scale, this.theme.ink);
    }
    return { width: boxWidth, height: boxHeight };
  }

  /** A quarter-turn arrow, drawn as an arc round the model's vertical axis. */
  /** The whole-model inset in a step image's bottom-left corner, framed like a callout. */
  overview(
    url: string,
    image: { x: number; y: number; width: number; height: number },
    scale: number,
  ) {
    const width = image.width * OVERVIEW_SCALE;
    const height = image.height * OVERVIEW_SCALE;
    const y = image.y + image.height - height;
    this.fill(this.theme.callout);
    this.stroke(this.theme.ink, 0.35 * scale);
    this.doc.roundedRect(image.x, y, width, height, 2.5 * scale, 2.5 * scale, 'FD');
    const inset = 1.5 * scale;
    this.doc.addImage(
      url,
      'JPEG',
      image.x + inset,
      y + inset,
      width - 2 * inset,
      height - 2 * inset,
      undefined,
      'FAST',
    );
  }

  turnArrow(x: number, y: number, size: number, turn: StepImage['turn']) {
    const direction = turn === -1 ? -1 : 1;
    const points: [number, number][] = [];
    for (let index = 0; index <= 16; index++) {
      const angle = Math.PI * (0.15 + (1.3 * index) / 16);
      points.push([x + Math.cos(angle) * size * direction, y + Math.sin(angle) * size * 0.4]);
    }
    this.stroke(this.theme.ink, size / 7);
    this.doc.lines(
      points.slice(1).map(([px, py], index) => [px - points[index][0], py - points[index][1]]),
      points[0][0],
      points[0][1],
    );
    const [endX, endY] = points.at(-1)!;
    const [beforeX, beforeY] = points.at(-3)!;
    const length = Math.hypot(endX - beforeX, endY - beforeY);
    const [ux, uy] = [(endX - beforeX) / length, (endY - beforeY) / length];
    const head = size * 0.45;
    this.fill(this.theme.ink);
    this.doc.triangle(
      endX + ux * head,
      endY + uy * head,
      endX - uy * head * 0.6,
      endY + ux * head * 0.6,
      endX + uy * head * 0.6,
      endY - ux * head * 0.6,
      'F',
    );
    if (turn === 2)
      this.text('2x', x - size * 1.3, y - size * 0.3, size * 1.6, this.theme.ink, {
        align: 'right',
      });
  }

  /** Cover and back cover: a framed panel picture with a quiet line of text below it. */
  private coverPage(
    view: number,
    title: string | null,
    footer: { left: string; right: string; small?: boolean },
  ) {
    const { doc, theme, width, height } = this;
    const scale = Math.min(width, height) / 210;
    const inset = 7 * scale;
    const panel = {
      x: inset,
      y: inset,
      width: width - 2 * inset,
      height: height - inset - 18 * scale,
    };
    const pixelsPerMm = Math.min(
      COVER_DPI / 25.4,
      MAX_COVER_PIXELS / Math.max(panel.width, panel.height),
    );
    const px = (mm: number) => Math.round(mm * pixelsPerMm);

    let lines: string[] = [];
    let titleSize = 0;
    if (title) {
      doc.setFont('helvetica', 'bold');
      for (titleSize = 46 * scale; titleSize > 18 * scale; titleSize -= 2 * scale) {
        doc.setFontSize(titleSize);
        lines = doc.splitTextToSize(title, panel.width * 0.72) as string[];
        if (lines.length <= 2) break;
      }
      lines = lines.slice(0, 2);
    }
    const titleX = 11 * scale;
    const titleY = 10 * scale;
    const lineHeight = (titleSize / POINTS_PER_MM) * 1.05;
    const heroTop = title ? titleY + lineHeight * lines.length + 2 * scale : 8 * scale;
    const hero = {
      x: 6 * scale,
      y: heroTop,
      width: panel.width - 12 * scale,
      height: panel.height - heroTop - 10 * scale,
    };
    const art = createCoverArt(this.renderer, {
      width: px(panel.width),
      height: px(panel.height),
      radius: px(5 * scale),
      frame: theme.frame,
      view,
      mood: this.mood,
      hero: { x: px(hero.x), y: px(hero.y), width: px(hero.width), height: px(hero.height) },
      title: title
        ? {
            lines,
            x: px(titleX),
            y: px(titleY),
            size: px(titleSize / POINTS_PER_MM),
            lineHeight: px(lineHeight),
          }
        : undefined,
    });
    doc.addImage(art, 'JPEG', panel.x, panel.y, panel.width, panel.height);
    if (title) this.text(lines, panel.x + titleX, panel.y + titleY, titleSize, WHITE);
    const baseline = panel.y + panel.height + 6.5 * scale;
    const size = (footer.small ? 8 : 11) * scale;
    this.text(footer.left, panel.x + 2 * scale, baseline, size, WHITE);
    this.text(footer.right, panel.x + panel.width - 2 * scale, baseline, size, WHITE, {
      align: 'right',
      bold: false,
    });
  }

  cover(assembly: Assembly, steps: number) {
    this.coverPage(0, assembly.name, {
      left: `${assembly.bricks.length} pieces  ·  ${steps} steps`,
      right: 'Brick Workshop',
    });
  }

  backCover(assembly: Assembly) {
    this.coverPage(2, null, {
      left: assembly.name,
      right:
        'Generated by Brick Workshop. Unverified draft: physical buildability is not certified.',
      small: true,
    });
  }

  /** Every part and color in the build with its total, like the inventory at the back of a manual. */
  async inventory(assembly: Assembly, onTile: () => Promise<void>) {
    const entries = getBillOfMaterials(assembly).sort(
      (first, second) =>
        colorName(first.color).localeCompare(colorName(second.color)) ||
        first.partId.localeCompare(second.partId, undefined, { numeric: true }),
    );
    const { columns, rows } = getInventoryGrid(this.width, this.height);
    const perPage = columns * rows;
    const tileWidth = 27;
    const tileHeight = 31;
    const left = (this.width - columns * 30 + 3) / 2;
    for (let start = 0; start < entries.length; start += perPage) {
      this.newPage(this.theme.page);
      const scale = Math.min(this.width, this.height) / 210;
      this.text('Parts list', left, 12, 20, this.theme.ink);
      this.text(
        `${assembly.bricks.length} pieces  ·  ${entries.length} kinds`,
        left,
        21,
        9,
        this.theme.ink,
        { bold: false },
      );
      this.pageNumber(Math.max(scale, 0.8));
      for (const [index, entry] of entries.slice(start, start + perPage).entries()) {
        const x = left + (index % columns) * 30;
        const y = 32 + Math.floor(index / columns) * 34;
        this.fill(this.theme.callout);
        this.doc.roundedRect(x, y, tileWidth, tileHeight, 2, 2, 'F');
        const image = this.partImage(entry.partId, entry.color);
        this.doc.addImage(image.url, 'JPEG', x + 4.5, y + 1.5, 18, 18, image.alias);
        this.text(`${entry.quantity}x`, x + 2, y + 19.5, 8, this.theme.ink);
        this.doc.setFont('helvetica', 'normal');
        this.doc.setFontSize(5.2);
        const fit = (value: string) => this.doc.splitTextToSize(value, tileWidth - 4)[0] as string;
        this.text(fit(getPart(entry.partId).name), x + 2, y + 24, 5.2, this.theme.ink, {
          bold: false,
        });
        this.text(
          fit(`${entry.partId} · ${colorName(entry.color)}`),
          x + 2,
          y + 27,
          5.2,
          mix(this.theme.ink, this.theme.callout, 0.35),
          {
            bold: false,
          },
        );
        await onTile();
      }
    }
  }
}

/**
 * Renders and writes the complete manual: cover, steps, parts list and back cover. Steps are
 * rendered one at a time straight into the PDF, so long manuals don't hold every image twice.
 */
export async function createManual(
  assembly: Assembly,
  steps: readonly InstructionStep[],
  settings: ManualSettings,
  onProgress: (progress: ManualProgress) => void,
  signal?: AbortSignal,
): Promise<Manual> {
  onProgress({ label: 'Loading parts', done: 0, total: 1 });
  const { renderer, missing } = await ManualRenderer.create(assembly);
  try {
    const derived = deriveManualTheme(assembly);
    const theme = {
      ...derived,
      page: await jpegColor(derived.page),
      callout: await jpegColor(derived.callout),
      frame: await jpegColor(derived.frame),
    };
    const writer = new ManualWriter(renderer, theme, settings);
    const kinds = getBillOfMaterials(assembly).length;
    const total = steps.length + kinds + 2;
    let done = 0;
    const tick = async (label: string) => {
      done += 1;
      onProgress({ label, done, total });
      signal?.throwIfAborted();
      await pause();
    };

    // The cover needs the finished model, so its page is filled in last.
    writer.newPage(theme.frame, true);

    const { columns, rows } = getStepGrid(settings.pageSize, settings.orientation);
    const dpi = steps.length > 400 ? LONG_MANUAL_DPI : STEP_DPI;
    for (let start = 0; start < steps.length; start += columns * rows) {
      writer.newPage(theme.page);
      const { panelWidth, panelHeight, scale } = writer.stepPanels(columns, rows);
      for (const [index, step] of steps.slice(start, start + columns * rows).entries()) {
        const x = (index % columns) * panelWidth;
        const y = Math.floor(index / columns) * panelHeight;
        const padding = 8 * scale;
        const side = panelWidth / panelHeight > 1.15;
        const column = side ? Math.min(62 * scale, panelWidth * 0.34) : panelWidth - 2 * padding;
        const box = writer.callout(step, x + padding, y + padding, column, scale);
        const numberTop = y + padding + box.height + 2 * scale;
        const numberSize = 30 * scale;
        const image = side
          ? {
              x: x + padding + column,
              y: y + padding,
              width: panelWidth - 2 * padding - column,
              height: panelHeight - 2 * padding - 6 * scale,
            }
          : {
              x: x + padding,
              y: numberTop,
              width: panelWidth - 2 * padding,
              height: y + panelHeight - padding - 6 * scale - numberTop,
            };
        const pixelsPerMm = dpi / 25.4;
        const shrink = Math.min(
          1,
          MAX_IMAGE_PIXELS / (Math.max(image.width, image.height) * pixelsPerMm),
        );
        const rendered = renderer.renderStep(
          step.brickIds,
          Math.max(64, Math.round(image.width * pixelsPerMm * shrink)),
          Math.max(64, Math.round(image.height * pixelsPerMm * shrink)),
          theme.page,
          theme.callout,
        );
        // The render's background is the page color, so the step number can sit over it.
        writer.doc.addImage(
          rendered.url,
          'JPEG',
          image.x,
          image.y,
          image.width,
          image.height,
          undefined,
          'FAST',
        );
        if (rendered.overview) writer.overview(rendered.overview, image, scale);
        writer.text(String(step.number), x + padding, numberTop, numberSize, theme.ink);
        if (rendered.turn)
          writer.turnArrow(
            image.x + image.width - 12 * scale,
            image.y + 10 * scale,
            7 * scale,
            rendered.turn,
          );
        await tick(`Step ${step.number} of ${steps.length}`);
      }
    }

    await writer.inventory(assembly, () => tick('Parts list'));

    writer.newPage(theme.frame);
    const pages = writer.doc.getNumberOfPages();
    writer.backCover(assembly);
    await tick('Back cover');
    writer.doc.setPage(1);
    writer.cover(assembly, steps.length);
    await tick('Cover');

    writer.doc.setProperties({
      title: `${assembly.name} – building instructions`,
      subject: `${assembly.bricks.length} pieces in ${steps.length} steps`,
      creator: 'Brick Workshop',
    });
    onProgress({ label: 'Writing PDF', done: total, total });
    await pause();
    return { blob: writer.doc.output('blob'), pages, missingParts: missing };
  } finally {
    renderer.dispose();
  }
}
