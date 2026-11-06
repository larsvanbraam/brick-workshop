import { describe, expect, it } from 'vite-plus/test';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createExampleAssembly, importAssembly } from '@lego-builder/brick-engine';
import { createBuildDocument, openBuildDocument } from '../src/saved-builds';
import { savedBuildsPlugin, slugify } from './saved-builds';

type Handler = (request: unknown, response: unknown, next: () => void) => Promise<void>;

async function withPlugin(test: (call: ReturnType<typeof caller>, root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'saved-builds-'));
  try {
    const plugin = savedBuildsPlugin(join(root, 'builds'), root);
    let handler: Handler | undefined;
    if (typeof plugin.configureServer !== 'function') throw new Error('Missing middleware');
    await plugin.configureServer({ middlewares: { use: (h: Handler) => (handler = h) } } as never);
    await test(caller(handler!), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function caller(handler: Handler) {
  return async (
    method: string,
    url: string,
    body?: unknown,
    headers: Record<string, string> = {
      origin: 'http://127.0.0.1:5173',
      host: '127.0.0.1:5173',
      'content-type': 'application/json',
    },
  ) => {
    const request = Object.assign(
      Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]),
      { method, url, headers },
    );
    let passed = false;
    const result = await new Promise<{ status: number; body: unknown }>((resolve) => {
      const response = {
        statusCode: 200,
        setHeader() {},
        end(text: string) {
          resolve({ status: response.statusCode, body: JSON.parse(text) });
        },
      };
      void handler(request, response, () => {
        passed = true;
        resolve({ status: 0, body: null });
      });
    });
    return passed ? null : result;
  };
}

describe('saved builds', () => {
  it('names files after the build without overwriting others', () => {
    expect(slugify('Courtyard House!')).toBe('courtyard-house');
    expect(slugify('  ')).toBe('build');
    expect(slugify('../../etc/passwd')).toBe('etc-passwd');
  });

  it('creates, lists, reads and updates builds in the folder', async () => {
    await withPlugin(async (call, root) => {
      const document = createBuildDocument(createExampleAssembly('seaside-lighthouse'), []);
      expect(await call('GET', '/api/builds')).toEqual({ status: 200, body: [] });

      const first = await call('POST', '/api/builds', document);
      expect(first).toMatchObject({
        status: 201,
        body: { id: 'seaside-lighthouse', path: join('builds', 'seaside-lighthouse.json') },
      });
      const second = await call('POST', '/api/builds', document);
      expect(second?.body).toMatchObject({ id: 'seaside-lighthouse-2' });

      const renamed = { ...document, assembly: { ...document.assembly, name: 'Renamed' } };
      expect(await call('PUT', '/api/builds/seaside-lighthouse', renamed)).toMatchObject({
        status: 200,
      });
      const list = (await call('GET', '/api/builds'))?.body as { id: string; name: string }[];
      expect(
        list.map(({ id, name }) => ({ id, name })).sort((a, b) => a.id.localeCompare(b.id)),
      ).toEqual([
        { id: 'seaside-lighthouse', name: 'Renamed' },
        { id: 'seaside-lighthouse-2', name: document.assembly.name },
      ]);

      // Saved files are ordinary version-1 documents, so Import JSON reads them too.
      const file = JSON.parse(
        await readFile(join(root, 'builds', 'seaside-lighthouse.json'), 'utf8'),
      );
      expect(importAssembly(file).name).toBe('Renamed');
      const opened = openBuildDocument(
        (await call('GET', '/api/builds/seaside-lighthouse-2'))?.body,
      );
      expect(opened.assembly).toEqual(document.assembly);
      expect(await readdir(join(root, 'builds'))).toHaveLength(2);
    });
  });

  it('refuses unsafe IDs, invalid documents and cross-origin writes', async () => {
    await withPlugin(async (call, root) => {
      const document = createBuildDocument(createExampleAssembly('seaside-lighthouse'), []);
      expect(await call('GET', '/api/builds/..%2Fsecret')).toMatchObject({ status: 400 });
      expect(await call('PUT', '/api/builds/..%2Fsecret', document)).toMatchObject({
        status: 400,
      });
      expect(await call('GET', '/api/builds/missing')).toMatchObject({ status: 404 });
      expect(await call('POST', '/api/builds', { version: 2 })).toMatchObject({ status: 400 });
      expect(await call('DELETE', '/api/builds/x')).toMatchObject({ status: 405 });
      expect(
        await call('POST', '/api/builds', document, {
          origin: 'https://example.com',
          host: '127.0.0.1:5173',
          'content-type': 'application/json',
        }),
      ).toMatchObject({ status: 403 });
      expect(
        await call('POST', '/api/builds', document, {
          origin: 'http://127.0.0.1:5173',
          host: '127.0.0.1:5173',
          'content-type': 'text/plain',
        }),
      ).toMatchObject({ status: 415 });
      expect(await call('GET', '/ldraw/catalog.json')).toBeNull();

      await mkdir(join(root, 'builds'));
      await writeFile(join(root, 'builds', 'notes.json'), '{}');
      expect(await call('GET', '/api/builds')).toEqual({ status: 200, body: [] });
    });
  });
});
