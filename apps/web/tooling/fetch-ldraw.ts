/**
 * Downloads and extracts the official LDraw library for hosted builds (e.g. Vercel),
 * where the Git-ignored data/ldraw folder does not exist. Skips the download when a
 * library is already present at LDRAW_LIBRARY_PATH (default data/ldraw).
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'three/examples/jsm/libs/fflate.module.js';

const LIBRARY_URL =
  process.env.LDRAW_LIBRARY_URL || 'https://library.ldraw.org/library/updates/complete.zip';
const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const target = resolve(workspaceRoot, process.env.LDRAW_LIBRARY_PATH || 'data/ldraw');

if (existsSync(resolve(target, 'LDConfig.ldr'))) {
  console.log(`LDraw library already present at ${target}; skipping download.`);
  process.exit(0);
}

console.log(`Downloading LDraw library from ${LIBRARY_URL}…`);
// The download can drop mid-stream on build machines, so retry a few times.
const ATTEMPTS = 5;
let archive: Uint8Array | undefined;
for (let attempt = 1; !archive; attempt++) {
  try {
    const response = await fetch(LIBRARY_URL, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok)
      throw new Error(`LDraw download failed: ${response.status} ${response.statusText}`);
    archive = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    if (attempt >= ATTEMPTS) throw error;
    console.warn(`Download attempt ${attempt} failed (${String(error)}); retrying…`);
    await new Promise((done) => setTimeout(done, attempt * 2000));
  }
}

// The archive nests everything under ldraw/. Only the root files, parts/ and p/ are used.
const keep = (name: string) => {
  const path = name.replace(/^ldraw\//, '');
  return !path.includes('/') || path.startsWith('parts/') || path.startsWith('p/');
};
const files = unzipSync(archive, { filter: (file) => keep(file.name) });

let count = 0;
for (const [name, data] of Object.entries(files)) {
  if (name.endsWith('/')) continue;
  const path = resolve(target, name.replace(/^ldraw\//, ''));
  if (!path.startsWith(target)) throw new Error(`Unsafe archive path: ${name}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
  count++;
}
console.log(`Extracted ${count} LDraw files to ${target}.`);
