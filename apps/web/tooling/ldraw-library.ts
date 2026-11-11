import { createReadStream } from 'node:fs';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import type { Plugin, ViteDevServer } from 'vite-plus';
import { PARTS } from '@brick-workshop/engine';

export interface LibraryManifest {
  available: boolean;
  parts: string[];
  fileMap: Record<string, string>;
  licenses: string[];
  message?: string;
}

export interface CatalogPart {
  id: string;
  name: string;
  category: string;
  keywords: string[];
  supported: boolean;
  official: boolean;
}

export interface LibraryCatalog {
  available: boolean;
  parts: CatalogPart[];
  categories: string[];
}

export function isExcludedCatalogPart(part: Pick<CatalogPart, 'name' | 'category' | 'keywords'>) {
  return /\b(?:minifig(?:ure)?s?|figure|duplo|electr(?:ic|ical|onic)s?|motor|batter(?:y|ies)|wire|cable|sensor|led|powered up|power functions|mindstorms|rcx)\b/i.test(
    `${part.category} ${part.name} ${part.keywords.join(' ')}`,
  );
}

export function parsePartHeader(id: string, header: string): CatalogPart {
  const lines = header.split(/\r?\n/);
  const name = lines[0]?.replace(/^0\s+/, '').replace(/\s+/g, ' ').trim() || id;
  const categoryLine = lines.find((line) => /^0\s+!CATEGORY\s/.test(line));
  const category =
    categoryLine?.replace(/^0\s+!CATEGORY\s+/, '').trim() ||
    name.replace(/^[~= _]+/, '').split(' ')[0];
  const keywords = lines
    .filter((line) => /^0\s+!KEYWORDS\s/.test(line))
    .flatMap((line) =>
      line
        .replace(/^0\s+!KEYWORDS\s+/, '')
        .split(',')
        .map((keyword) => keyword.replace(/\s+/g, ' ').trim()),
    )
    .filter(Boolean);
  return {
    id,
    name,
    category,
    keywords,
    supported: PARTS.some((part) => part.id === id),
    official: lines.some((line) => /^0 !LDRAW_ORG Part(?:\s|$)/i.test(line)),
  };
}

export async function indexLibrary(libraryPath: string): Promise<LibraryCatalog> {
  let root: string;
  try {
    root = await realpath(libraryPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return { available: false, parts: [], categories: [] };
  }
  const files = (await readdir(resolve(root, 'parts'), { withFileTypes: true })).filter(
    (file) => file.isFile() && file.name.toLowerCase().endsWith('.dat'),
  );
  const parts: CatalogPart[] = [];
  for (let offset = 0; offset < files.length; offset += 24) {
    const batch = await Promise.all(
      files.slice(offset, offset + 24).map(async (file) => {
        const stream = createReadStream(await findFile(root, `parts/${file.name}`), {
          encoding: 'utf8',
          highWaterMark: 4096,
        });
        const reader = createInterface({ input: stream, crlfDelay: Infinity });
        const header: string[] = [];
        try {
          for await (const line of reader) {
            if (/^[1-5]\s/.test(line.trim())) break;
            header.push(line);
          }
        } finally {
          reader.close();
          stream.destroy();
        }
        return parsePartHeader(file.name.slice(0, -4), header.join('\n'));
      }),
    );
    parts.push(...batch.filter((part) => part.official && !isExcludedCatalogPart(part)));
  }
  parts.sort((first, second) => first.id.localeCompare(second.id, 'en', { numeric: true }));
  return {
    available: true,
    parts,
    categories: [...new Set(parts.map((part) => part.category))].sort(),
  };
}

export function getReferences(text: string): string[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const fields = line.trim().split(/\s+/);
    if (fields[0] !== '1' || fields.length < 15) return [];
    return [fields.slice(14).join(' ').replaceAll('\\', '/').toLowerCase()];
  });
}

export function isLibraryPath(path: string): boolean {
  return (
    !isAbsolute(path) &&
    !path.includes('\\') &&
    !path.includes('\0') &&
    path.split('/').every((segment) => segment !== '..' && segment !== '.' && segment !== '')
  );
}

async function findFile(root: string, reference: string): Promise<string> {
  if (!isLibraryPath(reference)) throw new Error('Invalid LDraw reference.');
  for (const directory of ['', 'parts', 'p', 'models']) {
    try {
      const file = await realpath(resolve(root, directory, reference));
      const local = relative(root, file);
      if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local))
        throw new Error('External LDraw reference.');
      return file;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw Object.assign(new Error(`Missing LDraw dependency: ${reference}`), { code: 'ENOENT' });
}

export async function collectLibrary(
  libraryPath: string,
  partIds: readonly string[] = PARTS.map((part) => part.id),
) {
  const assets = new Map<string, string>();
  const manifest: LibraryManifest = { available: false, parts: [], fileMap: {}, licenses: [] };
  let root: string;
  try {
    root = await realpath(libraryPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    manifest.message = 'LDraw library not installed. Using prototype geometry.';
    return { assets, manifest };
  }
  assets.set('LDConfig.ldr', await readFile(await findFile(root, 'LDConfig.ldr'), 'utf8'));
  const visit = async (reference: string): Promise<void> => {
    const file = await findFile(root, reference);
    const assetPath = relative(root, file).split(sep).join('/');
    manifest.fileMap[reference] = relative(resolve(root, 'parts'), file).split(sep).join('/');
    if (assets.has(assetPath)) return;
    const text = await readFile(file, 'utf8');
    assets.set(assetPath, text);
    for (const dependency of getReferences(text)) await visit(dependency);
  };
  for (const id of partIds) {
    if (!/^[a-z0-9_-]+$/i.test(id)) throw new Error('Invalid part ID.');
    await visit(`${id}.dat`);
  }
  for (const name of ['CAlicense.txt', 'CAlicense4.txt', 'CAreadme.txt', 'Readme.txt']) {
    try {
      assets.set(name, await readFile(await findFile(root, name), 'utf8'));
      manifest.licenses.push(name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  if (!manifest.licenses.includes('CAreadme.txt'))
    throw new Error('LDraw library attribution file is missing.');
  manifest.available = true;
  manifest.parts = [...partIds];
  return { assets, manifest };
}

export function ldrawLibraryPlugin(libraryPath: string): Plugin {
  let library: ReturnType<typeof collectLibrary> | undefined;
  const loadLibrary = () => (library ??= collectLibrary(libraryPath));
  let catalog: Promise<LibraryCatalog> | undefined;
  const loadCatalog = () => (catalog ??= indexLibrary(libraryPath));
  const previews = new Map<string, ReturnType<typeof collectLibrary>>();
  const assets = new Map<string, string>();
  const loadSubset = (ids: readonly string[]) => {
    const key = [...new Set(ids)].sort().join(',');
    let pending = previews.get(key);
    if (!pending) {
      pending = collectLibrary(libraryPath, key.split(','))
        .then((result) => {
          for (const [path, text] of result.assets) assets.set(path, text);
          return result;
        })
        .catch((error: unknown) => {
          previews.delete(key);
          throw error;
        });
      previews.set(key, pending);
      if (previews.size > 12) previews.delete(previews.keys().next().value!);
    }
    return pending;
  };
  const attach = (server: Pick<ViteDevServer, 'middlewares'>) => {
    server.middlewares.use(async (request, response, next) => {
      if (!request.url?.startsWith('/ldraw/')) return next();
      try {
        const url = new URL(request.url, 'http://localhost');
        const path = decodeURIComponent(url.pathname.slice('/ldraw/'.length));
        if (!isLibraryPath(path)) {
          response.statusCode = 400;
          response.end('Invalid library path');
          return;
        }
        let content: string | undefined;
        if (path === 'catalog.json') {
          content = JSON.stringify(await loadCatalog());
        } else if (path === 'manifest.json' && url.searchParams.has('parts')) {
          const ids = url.searchParams.get('parts')!.split(',');
          if (
            url.searchParams.getAll('parts').length !== 1 ||
            ids.length > PARTS.length ||
            ids.some((id) => !PARTS.some((part) => part.id === id))
          ) {
            response.statusCode = 400;
            response.end('Expected supported part IDs.');
            return;
          }
          content = JSON.stringify((await loadSubset(ids)).manifest);
        } else if (/^preview\/[a-z0-9_-]+\/manifest\.json$/i.test(path)) {
          const id = path.split('/')[1];
          if (!(await loadCatalog()).parts.some((part) => part.id === id)) {
            response.statusCode = 404;
            response.end('Part not found in the library');
            return;
          }
          content = JSON.stringify((await loadSubset([id])).manifest);
        } else if (path === 'manifest.json') {
          content = JSON.stringify((await loadLibrary()).manifest);
        } else if (
          /^(parts|p)\/.*\.dat$/i.test(path) ||
          [
            'LDConfig.ldr',
            'CAreadme.txt',
            'CAlicense.txt',
            'CAlicense4.txt',
            'Readme.txt',
          ].includes(path)
        ) {
          content = assets.get(path);
          if (content === undefined) {
            try {
              content = await readFile(await findFile(await realpath(libraryPath), path), 'utf8');
              assets.set(path, content);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            }
          }
        }
        if (content === undefined) {
          response.statusCode = 404;
          response.end('Library asset not found');
          return;
        }
        response.setHeader(
          'Content-Type',
          path.endsWith('.json') ? 'application/json' : 'text/plain; charset=utf-8',
        );
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.end(content);
      } catch {
        response.statusCode = 503;
        response.end('LDraw library could not be loaded. Check its structure and dependencies.');
      }
    });
  };
  return {
    name: 'local-ldraw-library',
    configureServer: attach,
    configurePreviewServer: attach,
    async generateBundle() {
      const { assets, manifest } = await loadLibrary();
      // A static deploy only carries the supported parts' geometry; listing the rest of the
      // library would offer parts whose previews need the dev server's on-demand manifests.
      const full = await loadCatalog();
      const parts = full.parts.filter((part) => part.supported);
      const catalog: LibraryCatalog = {
        ...full,
        parts,
        categories: [...new Set(parts.map((part) => part.category))].sort(),
      };
      this.emitFile({
        type: 'asset',
        fileName: 'ldraw/catalog.json',
        source: JSON.stringify(catalog),
      });
      this.emitFile({
        type: 'asset',
        fileName: 'ldraw/manifest.json',
        source: JSON.stringify(manifest),
      });
      for (const [path, source] of assets)
        this.emitFile({ type: 'asset', fileName: `ldraw/${path}`, source });
    },
  };
}
