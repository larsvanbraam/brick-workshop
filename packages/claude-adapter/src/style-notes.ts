import { readFileSync } from 'node:fs';

/**
 * The technique notes in docs/techniques/, served on demand by brick_style_notes so a build
 * only pays tokens for the subjects it has (a lighthouse never loads the vehicle note). The
 * system prompt carries just this index.
 */
export const STYLE_NOTES = [
  {
    id: 'walls',
    file: 'walls',
    use: 'stone, brick, half-timber, siding, log and render walls; depth levels, quoins, buttresses, arches',
  },
  {
    id: 'facades',
    file: 'facades-and-openings',
    use: 'storey bands, windows, doors, bay windows, awnings, balconies, signs, cornices',
  },
  {
    id: 'roofs',
    file: 'roofs-and-rooflines',
    use: 'roof types and texture, chimneys, dormers, towers, spires, skyline',
  },
  {
    id: 'flora',
    file: 'flora-and-terrain',
    use: 'ground, trees by species, bushes, flowers, rocks, water, paths, base outlines',
  },
  {
    id: 'vehicles',
    file: 'vehicles',
    use: 'cars, wagons, trains, boats: silhouette, colour, wheels',
  },
  { id: 'fauna', file: 'fauna', use: 'animals from catalogue parts, posture, habitat' },
  {
    id: 'street',
    file: 'city-and-props',
    use: 'street layers, furniture, signs, interiors, market stalls, town infrastructure',
  },
] as const;

export type StyleNoteId = (typeof STYLE_NOTES)[number]['id'];
export const STYLE_NOTE_IDS: readonly StyleNoteId[] = STYLE_NOTES.map((note) => note.id);

const cache = new Map<StyleNoteId, string>();

/** One technique note's text, without the file's own heading. */
export function readStyleNote(id: StyleNoteId): string {
  const cached = cache.get(id);
  if (cached) return cached;
  const note = STYLE_NOTES.find((entry) => entry.id === id);
  if (!note) throw new Error(`Unknown style note: ${id}`);
  const text = readFileSync(
    new URL(`../../../docs/techniques/${note.file}.md`, import.meta.url),
    'utf8',
  ).trim();
  cache.set(id, text);
  return text;
}

/** The index the system prompt carries: what each note covers and when to call for it. */
export function styleNoteIndex(): string {
  return STYLE_NOTES.map((note) => `- ${note.id}: ${note.use}`).join('\n');
}
