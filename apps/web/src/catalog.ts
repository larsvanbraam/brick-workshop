import type { Part } from '@brick-workshop/engine';
import type { CatalogPart } from '../tooling/ldraw-library';

export function inferLDrawPartDefinition(
  part: CatalogPart,
  bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } },
): Part | null {
  const extents = {
    x: bounds.max.x - bounds.min.x,
    y: bounds.max.y - bounds.min.y,
    z: bounds.max.z - bounds.min.z,
  };
  if (!Object.values(extents).every((extent) => Number.isFinite(extent) && extent > 0)) return null;
  const roundUp = (extent: number, grid: number) =>
    Math.max(0.5, Math.ceil((extent / grid) * 2 - 1e-6) / 2);
  return {
    id: part.id,
    name: part.name,
    width: roundUp(extents.x, 20),
    depth: roundUp(extents.z, 20),
    height: roundUp(extents.y, 8),
    kind: 'brick',
    family: 'detail',
    shape: 'detail',
    ldrawRotation: 0,
    ldrawCenter: {
      x: (bounds.min.x + bounds.max.x) / 2,
      z: (bounds.min.z + bounds.max.z) / 2,
    },
    ldrawBaseY: bounds.max.y,
    connections: { topStuds: [], bottomReceivers: [] },
  };
}

export function searchCatalog(
  parts: readonly CatalogPart[],
  query: string,
  category: string,
  supportedOnly: boolean,
): CatalogPart[] {
  const normalized = query.trim().toLowerCase();
  const terms = normalized.split(/\s+/).filter(Boolean);
  return parts
    .filter((part) => {
      if ((category && part.category !== category) || (supportedOnly && !part.supported))
        return false;
      const text =
        `${part.id} ${part.name} ${part.category} ${part.keywords.join(' ')}`.toLowerCase();
      return terms.every((term) => text.includes(term));
    })
    .sort(
      (first, second) =>
        Number(second.id.toLowerCase() === normalized) -
        Number(first.id.toLowerCase() === normalized),
    );
}
