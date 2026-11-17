import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { createGunzip } from 'node:zlib';
import { parse } from 'csv-parse';
import { importPartColorEvidence } from '../../../packages/brick-engine/src/part-colors.ts';
import type { PartColorEvidence } from '../../../packages/brick-engine/src/part-colors.ts';
import { DEFAULT_PART_COLOR_EVIDENCE } from '../../../packages/brick-engine/src/part-color-evidence.ts';

/**
 * The reviewed mappings already in the committed snapshot, so a plain refresh keeps every part
 * and colour mapped there and only updates the observations and retrieval time.
 */
export function basicInventoryConfiguration(retrievedAt: string): PartColorEvidence {
  const { source, mappings } = DEFAULT_PART_COLOR_EVIDENCE;
  return importPartColorEvidence({
    version: 1,
    source: { ...source, retrievedAt },
    mappings,
    observations: [],
  });
}

export async function readInventoryEvidence(
  input: Readable,
  configuration: unknown,
  compressed = false,
): Promise<PartColorEvidence> {
  const config = importPartColorEvidence({ ...(configuration as object), observations: [] });
  const parts = new Set(Object.values(config.mappings.parts));
  const colors = new Set(Object.values(config.mappings.colors));
  const observations: PartColorEvidence['observations'][number][] = [];
  const seen = new Set<string>();
  const parser = parse({
    bom: true,
    skip_empty_lines: true,
    columns: (fields: string[]) => {
      if (
        !['inventory_id', 'part_num', 'color_id', 'quantity'].every((field) =>
          fields.includes(field),
        )
      )
        throw new Error('Expected the Rebrickable inventory_parts CSV schema.');
      return fields;
    },
  });
  let failure: unknown;
  const completion = (
    compressed ? pipeline(input, createGunzip(), parser) : pipeline(input, parser)
  ).catch((error: unknown) => {
    failure = error;
  });
  try {
    for await (const row of parser as AsyncIterable<Record<string, string>>) {
      const partId = row.part_num;
      const colorId = Number(row.color_id);
      if (!parts.has(partId) || !colors.has(colorId)) continue;
      const quantity = Number(row.quantity);
      if (!Number.isSafeInteger(quantity) || quantity < 0)
        throw new Error('Invalid inventory quantity.');
      if (quantity === 0) continue;
      const key = `${partId}:${colorId}`;
      if (!seen.has(key)) {
        observations.push({ partId, colorId, inventoryId: Number(row.inventory_id) });
        seen.add(key);
      }
    }
  } finally {
    parser.destroy();
    await completion;
  }
  if (failure) throw failure;
  return importPartColorEvidence({ ...config, observations });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const input = process.argv[2];
  if (!input)
    throw new Error(
      'Usage: pnpm colors:inventory inventory_parts.csv[.gz] [mapping-config.json|-] [output.json]',
    );
  const configuration =
    process.argv[3] && process.argv[3] !== '-'
      ? (JSON.parse(await readFile(process.argv[3], 'utf8')) as unknown)
      : basicInventoryConfiguration((await stat(input)).mtime.toISOString());
  const evidence = await readInventoryEvidence(
    createReadStream(input),
    configuration,
    input.endsWith('.gz'),
  );
  const output = process.argv[4];
  if (output) await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
  else
    await writeFile(
      new URL('../../../packages/brick-engine/src/part-color-evidence.ts', import.meta.url),
      `import { importPartColorEvidence } from './part-colors.ts';\n\nexport const DEFAULT_PART_COLOR_EVIDENCE = importPartColorEvidence(${JSON.stringify(evidence, null, 2)});\n`,
    );
  console.log(
    `Imported ${evidence.observations.length} observed combinations with ${Object.keys(evidence.mappings.colors).length} explicit color mappings.`,
  );
}
