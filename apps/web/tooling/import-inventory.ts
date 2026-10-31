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

export function basicInventoryConfiguration(retrievedAt: string): PartColorEvidence {
  return importPartColorEvidence({
    version: 1,
    source: {
      provider: 'rebrickable',
      url: 'https://cdn.rebrickable.com/media/downloads/inventory_parts.csv.gz',
      retrievedAt,
      mappingNote:
        '106 supported design mappings reviewed against public Rebrickable parts.csv.gz; six opaque solid color names reviewed against colors.csv.gz. LDraw 3023b maps to Rebrickable 3023. Native LDraw keywords explicitly map 6934 to Rebrickable 6934a, 39266 to 39268, and 3861c to 3861b. Grooved tiles and suffixed mould IDs retain reviewed variants. Legacy doors 801a and 802a remain unmapped because native and inventory handle names disagree. These are reviewed mappings, not numeric-ID or RGB inference.',
    },
    mappings: {
      parts: {
        '3001': '3001',
        '3002': '3002',
        '3003': '3003',
        '3004': '3004',
        '3005': '3005',
        '3008': '3008',
        '3009': '3009',
        '3010': '3010',
        '2456': '2456',
        '3622': '3622',
        '3020': '3020',
        '3021': '3021',
        '3022': '3022',
        '3023b': '3023',
        '3024': '3024',
        '3460': '3460',
        '3623': '3623',
        '3666': '3666',
        '3710': '3710',
        '3795': '3795',
        '3070b': '3070b',
        '3069b': '3069b',
        '63864': '63864',
        '2431': '2431',
        '3068b': '3068b',
        '87079': '87079',
        '6111': '6111',
        '6112': '6112',
        '2465': '2465',
        '3006': '3006',
        '3007': '3007',
        '2356': '2356',
        '6212': '6212',
        '4201': '4201',
        '4202': '4202',
        '4204': '4204',
        '78329': '78329',
        '4477': '4477',
        '60479': '60479',
        '3034': '3034',
        '3832': '3832',
        '2445': '2445',
        '91988': '91988',
        '4282': '4282',
        '11212': '11212',
        '3031': '3031',
        '3032': '3032',
        '3035': '3035',
        '3030': '3030',
        '3029': '3029',
        '3958': '3958',
        '3036': '3036',
        '3033': '3033',
        '3028': '3028',
        '3456': '3456',
        '3027': '3027',
        '41539': '41539',
        '92438': '92438',
        '91405': '91405',
        '26603': '26603',
        '6636': '6636',
        '4162': '4162',
        '69729': '69729',
        '1751': '1751',
        '6934': '6934a',
        '8165': '8165',
        '6320': '6320',
        '48288': '48288',
        '14716': '14716',
        '2453b': '2453b',
        '3245c': '3245c',
        '2454b': '2454b',
        '49311': '49311',
        '3754': '3754',
        '39266': '39268',
        '30145': '30145',
        '30144': '30144',
        '6213': '6213',
        '3040b': '3040b',
        '3039': '3039',
        '3038': '3038',
        '3037': '3037',
        '3062b': '3062b',
        '3941': '3941',
        '6141': '6141',
        '4032a': '4032a',
        '98138': '98138',
        '14769': '14769',
        '3659': '3659',
        '4490': '4490',
        '6182': '6182',
        '3307': '3307',
        '3865': '3865',
        '3867': '3867',
        '4589': '4589',
        '3942c': '3942c',
        '3943b': '3943b',
        '6233': '6233',
        '3861c': '3861b',
        '3579': '3579',
        '60596': '60596',
        '60592': '60592',
        '60593': '60593',
        '60594': '60594',
        '2493b': '2493b',
        '3853': '3853',
      },
      colors: { '0': 0, '1': 1, '2': 2, '4': 4, '14': 14, '15': 15 },
    },
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
