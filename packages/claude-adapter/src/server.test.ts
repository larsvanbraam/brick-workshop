import { afterEach, describe, expect, it } from 'vite-plus/test';
import type { Server } from 'node:http';
import type Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { MAX_PIECES } from '@lego-builder/brick-engine';
import { createWorkshopServer } from './server.ts';

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
async function start(options: Parameters<typeof createWorkshopServer>[0]) {
  const server = createWorkshopServer(options);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No server address.');
  const url = `http://127.0.0.1:${address.port}`;
  return {
    url,
    post: (input: unknown, origin = url, signal?: AbortSignal) =>
      fetch(`${url}/api/workshop/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify(input),
        signal,
      }),
  };
}
const input = {
  prompt: 'Build a tiny reference',
  initial: { name: 'Draft', bricks: [] },
  images: [],
  consent: true,
  maxTurns: 2,
  maxPieces: 20,
  policy: {},
};
const reply = (content: unknown[], stop_reason: string) =>
  ({ content, stop_reason, usage: { input_tokens: 10, output_tokens: 5 } }) as Anthropic.Message;

describe('local workshop generation server', () => {
  it('normalizes real photo bytes and streams isolated validated drafts through mocked transport', async () => {
    const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const api = await start({
      model: 'test-model',
      transport: async (request) => {
        calls.push(request);
        return calls.length === 1
          ? reply(
              [
                {
                  type: 'tool_use',
                  id: 'base',
                  name: 'brick_place',
                  input: {
                    partId: '3001',
                    color: 4,
                    x: 0,
                    y: 0,
                    z: 0,
                  },
                },
              ],
              'tool_use',
            )
          : reply([{ type: 'text', text: 'A draft.' }], 'end_turn');
      },
    });
    const photo = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    const response = await api.post({
      ...input,
      images: [{ mediaType: 'image/png', data: photo.toString('base64') }],
    });
    expect(response.status).toBe(200);
    const events = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'tool', revision: 1, pieces: 1 }),
    );
    expect(events.at(-1)).toMatchObject({
      type: 'result',
      result: {
        complete: true,
        assembly: { bricks: [expect.objectContaining({ id: 'ai-1' })] },
        document: { buildability: { certified: false } },
      },
    });
    const blocks = calls[0].messages[0].content as Anthropic.ImageBlockParam[];
    expect(blocks[1].source).toMatchObject({ type: 'base64', media_type: 'image/jpeg' });
    expect(input.initial.bricks).toEqual([]);
  });

  it('rejects missing consent, hostile origins, invalid builds, media and request overrides before API usage', async () => {
    let calls = 0;
    const api = await start({
      transport: async () => {
        calls += 1;
        return reply([], 'end_turn');
      },
    });
    expect((await api.post(input, 'https://other.example')).status).toBe(403);
    for (const invalid of [
      { ...input, consent: false },
      { ...input, apiKey: 'not-accepted' },
      { ...input, maxPieces: MAX_PIECES + 1 },
      { ...input, initial: { name: 'Broken', bricks: [{}] } },
      { ...input, images: [{ mediaType: 'image/png', data: 'aW1hZ2U=' }] },
    ])
      expect((await api.post(invalid)).status).toBe(400);
    expect(calls).toBe(0);
    const oversized = await api.post({ ...input, prompt: 'x'.repeat(12_000_001) });
    expect(oversized.status).toBe(413);
  });

  it('reports unconfigured state without exposing credentials', async () => {
    const api = await start({});
    expect(await (await fetch(`${api.url}/api/workshop/status`)).json()).toMatchObject({
      configured: false,
      busy: false,
    });
    expect((await api.post(input)).status).toBe(503);
  });

  it('reports the Claude Code backend when no API key or transport is given', async () => {
    const api = await start({ claudeCode: true });
    expect(await (await fetch(`${api.url}/api/workshop/status`)).json()).toMatchObject({
      configured: true,
      backend: 'claude-code',
    });
  });

  it('refuses concurrent runs and cancels transport on browser disconnect', async () => {
    let observedAbort!: () => void;
    const aborted = new Promise<void>((resolve) => {
      observedAbort = resolve;
    });
    const api = await start({
      transport: async (_request, options) =>
        new Promise((_resolve, reject) => {
          options!.signal!.addEventListener(
            'abort',
            () => {
              observedAbort();
              reject(new Error('aborted'));
            },
            { once: true },
          );
        }),
    });
    const controller = new AbortController();
    const response = await api.post(input, api.url, controller.signal);
    expect(response.status).toBe(200);
    expect((await api.post(input)).status).toBe(409);
    controller.abort();
    await aborted;
    expect(await (await fetch(`${api.url}/api/workshop/status`)).json()).toMatchObject({
      busy: false,
    });
  });
});
