import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { relative, resolve } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite-plus';

const MAX_BODY_BYTES = 2_000_000;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+){0,15}$/;

export interface SavedBuildSummary {
  id: string;
  name: string;
  pieces: number;
  savedAt: string;
}

class RequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .split('-')
      .slice(0, 8)
      .join('-')
      .slice(0, 60)
      .replace(/-+$/, '') || 'build'
  );
}

/**
 * Checks the document shape only. Geometry needs the browser's runtime parts, so the
 * workshop validates it with importAssembly when a build is opened.
 */
function validDocument(value: unknown): value is {
  version: 1;
  assembly: { name: string; bricks: unknown[] };
  parts?: unknown[];
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const document = value as Record<string, unknown>;
  const assembly = document.assembly as Record<string, unknown> | undefined;
  return (
    document.version === 1 &&
    typeof assembly === 'object' &&
    assembly !== null &&
    typeof assembly.name === 'string' &&
    !!assembly.name.trim() &&
    assembly.name.length <= 200 &&
    Array.isArray(assembly.bricks) &&
    (document.parts === undefined || Array.isArray(document.parts))
  );
}

function readJSON(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(new RequestError(413, 'Builds must be smaller than 2 MB.'));
        request.destroy();
      } else chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new RequestError(400, 'Invalid JSON.'));
      }
    });
    request.on('error', reject);
  });
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(JSON.stringify(value));
}

/** Writes refuse other origins, so a page on another site cannot write into the folder. */
function sameOrigin(request: IncomingMessage) {
  try {
    const origin = new URL(request.headers.origin ?? '');
    return origin.host === request.headers.host && ['http:', 'https:'].includes(origin.protocol);
  } catch {
    return false;
  }
}

export function createSavedBuildStore(directory: string) {
  const path = (id: string) => resolve(directory, `${id}.json`);
  async function list(): Promise<SavedBuildSummary[]> {
    let files: string[];
    try {
      files = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const builds: SavedBuildSummary[] = [];
    for (const file of files) {
      const id = file.replace(/\.json$/, '');
      if (!file.endsWith('.json') || !ID.test(id)) continue;
      try {
        const value: unknown = JSON.parse(await readFile(path(id), 'utf8'));
        if (!validDocument(value)) continue;
        builds.push({
          id,
          name: value.assembly.name,
          pieces: value.assembly.bricks.length,
          savedAt: String((value as { savedAt?: unknown }).savedAt ?? ''),
        });
      } catch {
        // Unreadable files are left alone and simply not listed.
      }
    }
    return builds.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }
  async function read(id: string) {
    if (!ID.test(id)) throw new RequestError(400, 'Invalid build ID.');
    try {
      return JSON.parse(await readFile(path(id), 'utf8')) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new RequestError(404, 'Saved build not found.');
      throw error;
    }
  }
  async function write(id: string | null, value: unknown) {
    if (!validDocument(value))
      throw new RequestError(400, 'Expected a version-1 build with a name and bricks.');
    if (id !== null && !ID.test(id)) throw new RequestError(400, 'Invalid build ID.');
    await mkdir(directory, { recursive: true });
    if (id === null) {
      // A new build takes the first free name, so saving never overwrites another build.
      const taken = new Set((await readdir(directory)).map((file) => file.replace(/\.json$/, '')));
      const base = slugify(value.assembly.name);
      id = base;
      for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    }
    const document = { ...value, savedAt: new Date().toISOString() };
    const temporary = `${path(id)}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`);
    await rename(temporary, path(id));
    return { id, savedAt: document.savedAt };
  }
  return { list, read, write };
}

export function savedBuildsPlugin(directory: string, workspaceRoot = process.cwd()): Plugin {
  const store = createSavedBuildStore(directory);
  const attach = (server: Pick<ViteDevServer, 'middlewares'>) => {
    server.middlewares.use(async (request, response, next) => {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (pathname !== '/api/builds' && !pathname.startsWith('/api/builds/')) return next();
      const id = pathname === '/api/builds' ? null : decodeURIComponent(pathname.slice(12));
      try {
        if (request.method === 'GET') {
          json(response, 200, id === null ? await store.list() : await store.read(id));
          return;
        }
        if (!(id === null ? request.method === 'POST' : request.method === 'PUT'))
          throw new RequestError(405, 'Use GET, POST /api/builds or PUT /api/builds/:id.');
        if (!sameOrigin(request)) throw new RequestError(403, 'Cross-origin saves are refused.');
        if (!request.headers['content-type']?.startsWith('application/json'))
          throw new RequestError(415, 'Expected application/json.');
        const saved = await store.write(id, await readJSON(request));
        json(response, id === null ? 201 : 200, {
          ...saved,
          path: relative(workspaceRoot, resolve(directory, `${saved.id}.json`)),
        });
      } catch (error) {
        if (error instanceof RequestError) json(response, error.status, { error: error.message });
        else json(response, 500, { error: 'The builds folder could not be read or written.' });
      }
    });
  };
  return { name: 'saved-builds', configureServer: attach, configurePreviewServer: attach };
}
