import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseLDrawColors } from '../../../packages/brick-engine/src/colors.ts';

const path = resolve(
  process.argv[2] ?? `${process.env.LDRAW_LIBRARY_PATH ?? 'data/ldraw'}/LDConfig.ldr`,
);
const text = await readFile(path, 'utf8');
const colors = parseLDrawColors(text);
const update = text.match(/^0 !LDRAW_ORG Configuration UPDATE (.+)$/m)?.[1];
if (!update || colors.length === 0)
  throw new Error('Expected a versioned official LDraw color configuration.');
const provenance = {
  url: 'https://library.ldraw.org/library/official/LDConfig.ldr',
  update,
  sha256: createHash('sha256').update(text).digest('hex'),
};
const output = `import type { LDrawColor } from './colors.ts';\n\nexport const COLOR_SOURCE = Object.freeze(${JSON.stringify(provenance)});\n\nexport const COLORS: readonly LDrawColor[] = Object.freeze(([\n${colors.map((color) => `  ${JSON.stringify(color)},`).join('\n')}\n] satisfies LDrawColor[]).map((color) => Object.freeze(color)));\n`;
await writeFile(
  new URL('../../../packages/brick-engine/src/color-catalog.ts', import.meta.url),
  output,
);
console.log(`Imported ${colors.length} colors from LDraw ${update}.`);
