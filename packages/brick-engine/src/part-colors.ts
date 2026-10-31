import { COLORS, PARTS } from './core.ts';

export interface PartColorEvidence {
  readonly version: 1;
  readonly source: Readonly<{
    provider: 'rebrickable';
    url: string;
    retrievedAt: string;
    mappingNote: string;
  }>;
  readonly mappings: Readonly<{
    parts: Readonly<Record<string, string>>;
    colors: Readonly<Record<string, number>>;
  }>;
  readonly observations: readonly Readonly<{
    partId: string;
    colorId: number;
    inventoryId: number;
  }>[];
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Invalid ${name}.`);
  return value as Record<string, unknown>;
}

export function importPartColorEvidence(input: unknown): PartColorEvidence {
  const data = record(input, 'evidence');
  if (data.version !== 1) throw new Error('Unsupported evidence version.');
  const source = record(data.source, 'source');
  if (
    source.provider !== 'rebrickable' ||
    typeof source.url !== 'string' ||
    typeof source.retrievedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T.+Z$/.test(source.retrievedAt) ||
    !Number.isFinite(Date.parse(source.retrievedAt)) ||
    typeof source.mappingNote !== 'string' ||
    !source.mappingNote.trim()
  )
    throw new Error('Invalid evidence provenance.');
  const url = new URL(source.url);
  if (
    url.protocol !== 'https:' ||
    !(url.hostname === 'rebrickable.com' || url.hostname.endsWith('.rebrickable.com')) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Expected a public Rebrickable source URL without credentials.');
  const mappings = record(data.mappings, 'mappings');
  const parts: Record<string, string> = {};
  const colors: Record<string, number> = {};
  const externalParts = new Set<string>();
  const externalColors = new Set<number>();
  for (const [ldraw, external] of Object.entries(record(mappings.parts, 'part mappings'))) {
    if (
      !PARTS.some((part) => part.id === ldraw) ||
      typeof external !== 'string' ||
      !/^[a-z\d][a-z\d_.-]*$/i.test(external) ||
      externalParts.has(external)
    )
      throw new Error(`Invalid or ambiguous part mapping: ${ldraw}`);
    parts[ldraw] = external;
    externalParts.add(external);
  }
  for (const [ldraw, external] of Object.entries(record(mappings.colors, 'color mappings'))) {
    if (
      String(Number(ldraw)) !== ldraw ||
      !COLORS.some((color) => color.id === Number(ldraw)) ||
      typeof external !== 'number' ||
      !Number.isSafeInteger(external) ||
      external < 0 ||
      externalColors.has(external)
    )
      throw new Error(`Invalid or ambiguous color mapping: ${ldraw}`);
    colors[ldraw] = external;
    externalColors.add(external);
  }
  if (!Array.isArray(data.observations) || data.observations.length > 100_000)
    throw new Error('Invalid observations.');
  const observations: PartColorEvidence['observations'][number][] = [];
  const seen = new Set<string>();
  for (const value of data.observations) {
    const observation = record(value, 'observation');
    const { partId, colorId, inventoryId } = observation;
    if (
      typeof partId !== 'string' ||
      !externalParts.has(partId) ||
      typeof colorId !== 'number' ||
      !externalColors.has(colorId) ||
      typeof inventoryId !== 'number' ||
      !Number.isSafeInteger(inventoryId) ||
      inventoryId <= 0
    )
      throw new Error('Observation requires mapped external IDs and a positive inventory ID.');
    const key = `${partId}:${colorId}`;
    if (!seen.has(key)) {
      observations.push(Object.freeze({ partId, colorId, inventoryId }));
      seen.add(key);
    }
  }
  return Object.freeze({
    version: 1,
    source: Object.freeze({
      provider: 'rebrickable',
      url: url.href,
      retrievedAt: source.retrievedAt,
      mappingNote: source.mappingNote,
    }),
    mappings: Object.freeze({ parts: Object.freeze(parts), colors: Object.freeze(colors) }),
    observations: Object.freeze(observations),
  });
}

export function getPartColorStatus(
  partId: string,
  colorId: number,
  evidence?: PartColorEvidence | null,
) {
  const rendering = COLORS.some((color) => color.id === colorId)
    ? ('recognized' as const)
    : ('unknown' as const);
  const externalPart = evidence?.mappings.parts[partId];
  const externalColor = evidence?.mappings.colors[String(colorId)];
  const observation =
    rendering === 'recognized' && externalPart !== undefined && externalColor !== undefined
      ? evidence?.observations.find(
          (entry) => entry.partId === externalPart && entry.colorId === externalColor,
        )
      : undefined;
  const reason = !evidence
    ? 'no-data'
    : !externalPart
      ? 'unmapped-part'
      : externalColor === undefined
        ? 'unmapped-color'
        : observation
          ? 'observed'
          : 'not-observed';
  return {
    rendering,
    manufactured: observation ? ('observed' as const) : ('unknown' as const),
    stock: 'unknown' as const,
    reason,
    ...(observation
      ? {
          source: evidence!.source,
          inventoryId: observation.inventoryId,
          rebrickablePartId: externalPart,
          rebrickableColorId: externalColor,
        }
      : {}),
  };
}
