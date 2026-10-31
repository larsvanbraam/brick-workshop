import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';
import { PARTS, getPart } from '../../../packages/brick-engine/src/core.ts';
import { CATALOG_PART_MASSES } from '../../../packages/brick-engine/src/part-masses.ts';

export function readCatalogueWeight(html: string, catalogueId: string) {
  const { document } = parseHTML(html);
  const title = document.querySelector('#item-name-title')?.textContent?.trim();
  const itemId = document.body.textContent?.match(/Item No:\s*([a-z0-9]+)/i)?.[1];
  const weight = document.querySelector('#item-weight-info')?.textContent?.trim();
  if (!title || itemId !== catalogueId || !weight || !/^\d+(?:\.\d+)?g$/.test(weight))
    throw new Error(`Missing or mismatched catalogue weight for ${catalogueId}.`);
  const massGrams = Number(weight.slice(0, -1));
  if (massGrams <= 0 || massGrams > 1_000_000)
    throw new Error(`Invalid catalogue weight for ${catalogueId}.`);
  return { title, massGrams };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const output = process.argv[2];
  if (!output)
    throw new Error(
      'Usage: node apps/web/tooling/import-masses.ts output.json [engineId=catalogueId ...]. Review names and variants before adding records to the snapshot.',
    );
  const requests =
    process.argv.length > 3
      ? process.argv.slice(3)
      : PARTS.filter((part) => !CATALOG_PART_MASSES[part.id]).map((part) => part.id);
  const entries: [string, string, number, string][] = [];
  const missing: { partId: string; catalogueId: string; reason: string }[] = [];
  for (const request of requests) {
    const [partId, catalogueId = partId] = request.split('=');
    getPart(partId);
    if (!/^[a-z0-9]+$/i.test(catalogueId)) throw new Error('Invalid catalogue identifier.');
    const url = `https://www.bricklink.com/v2/catalog/catalogitem.page?P=${catalogueId}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok)
      throw new Error(
        `Catalogue request failed: HTTP ${response.status}. No snapshot was written.`,
      );
    try {
      const { title, massGrams } = readCatalogueWeight(await response.text(), catalogueId);
      entries.push([
        partId,
        catalogueId,
        massGrams,
        `BrickLink lists ${title}. Review exact mould/variant correspondence; nominal weight, not an exact-piece measurement.`,
      ]);
    } catch (error) {
      missing.push({
        partId,
        catalogueId,
        reason: error instanceof Error ? error.message : 'Unknown catalogue data.',
      });
    }
  }
  await writeFile(
    output,
    `${JSON.stringify({ retrievedAt: new Date().toISOString().slice(0, 10), entries, missing }, null, 2)}\n`,
  );
  console.log(JSON.stringify({ records: entries.length, missing, output }));
}
