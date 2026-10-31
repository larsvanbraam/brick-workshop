import type { CatalogPart } from '../tooling/ldraw-library';

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
