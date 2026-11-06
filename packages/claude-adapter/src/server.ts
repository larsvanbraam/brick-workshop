import Anthropic from '@anthropic-ai/sdk';
import Ajv from 'ajv';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { MAX_BUILD_AREA, MAX_PIECES, MAX_VOXEL_LAYERS, decodeVoxelModel } from '@lego-builder/brick-engine';
import { createBuilderSession } from './session.ts';
import {
  DEFAULT_CLAUDE_MODEL,
  runClaudeBuild,
  validateReferenceImages,
} from './runner.ts';
import { runClaudeCodeBuild } from './claude-code-runner.ts';
import type { ClaudeTransport, ReferenceImage } from './runner.ts';
import type { EncodedVoxelModel } from '@lego-builder/brick-engine';

const MAX_BODY_BYTES = 12_000_000;
const schema = new Ajv({ allErrors: true }).compile({
  type: 'object',
  additionalProperties: false,
  required: ['prompt', 'initial', 'images', 'consent', 'maxTurns', 'maxPieces', 'policy'],
  properties: {
    prompt: { type: 'string', minLength: 1, maxLength: 20_000 },
    initial: { type: 'object' },
    images: { type: 'array', maxItems: 4 },
    // The converted 3D model, one character per cell; it stays on the server behind tools.
    model: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'width', 'depth', 'layers', 'colors', 'cells', 'origin'],
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 200 },
        width: { type: 'integer', minimum: 1, maximum: MAX_BUILD_AREA },
        depth: { type: 'integer', minimum: 1, maximum: MAX_BUILD_AREA },
        layers: { type: 'integer', minimum: 1, maximum: MAX_VOXEL_LAYERS },
        colors: { type: 'array', maxItems: 52, items: { type: 'integer' } },
        cells: {
          type: 'string',
          pattern: '^[.a-zA-Z]*$',
          maxLength: MAX_BUILD_AREA * MAX_BUILD_AREA * MAX_VOXEL_LAYERS,
        },
        origin: {
          type: 'object',
          additionalProperties: false,
          required: ['x', 'z'],
          properties: {
            x: { type: 'integer', minimum: 0, maximum: MAX_BUILD_AREA },
            z: { type: 'integer', minimum: 0, maximum: MAX_BUILD_AREA },
          },
        },
      },
    },
    consent: { const: true },
    maxTurns: { type: 'integer', minimum: 1, maximum: 32 },
    maxPieces: { type: 'integer', minimum: 1, maximum: MAX_PIECES },
    policy: {
      type: 'object',
      additionalProperties: false,
      properties: {
        requireObservedColors: { type: 'boolean' },
        rejectInfeasible: { type: 'boolean' },
        evidence: { type: 'object' },
        physical: {
          type: 'object',
          additionalProperties: false,
          properties: {
            data: { type: 'object' },
            estimateMissingMasses: { type: 'boolean' },
            useCatalogMasses: { type: 'boolean' },
          },
        },
      },
    },
  },
});

interface GenerationRequest {
  prompt: string;
  initial: unknown;
  images: ReferenceImage[];
  model?: EncodedVoxelModel & { origin: { x: number; z: number } };
  consent: true;
  maxTurns: number;
  maxPieces: number;
  policy: NonNullable<Parameters<typeof createBuilderSession>[1]>;
}

class RequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function readJSON(request: IncomingMessage): Promise<unknown> {
  if (Number(request.headers['content-length']) > MAX_BODY_BYTES) {
    request.resume();
    return Promise.reject(new RequestError(413, 'Request exceeds 12 MB.'));
  }
  return new Promise((resolve, reject) => {
    let bytes = 0;
    let oversized = false;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        oversized = true;
        chunks.length = 0;
        reject(new RequestError(413, 'Request exceeds 12 MB.'));
      } else if (!oversized) chunks.push(chunk);
    });
    request.on('end', () => {
      if (oversized) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new RequestError(400, 'Invalid JSON request.'));
      }
    });
    request.on('error', reject);
    request.on('aborted', () => reject(new RequestError(400, 'Upload interrupted.')));
  });
}

async function normalizeImages(value: unknown): Promise<ReferenceImage[]> {
  const normalized: ReferenceImage[] = [];
  for (const image of validateReferenceImages(value)) {
    const decoder = sharp(Buffer.from(image.data, 'base64'), {
      limitInputPixels: 16_000_000,
      failOn: 'error',
    });
    const metadata = await decoder.metadata();
    if (`image/${metadata.format}` !== image.mediaType || (metadata.pages ?? 1) > 1)
      throw new Error(
        'References must be non-animated JPEG, PNG or WebP files matching their media type.',
      );
    const buffer = await decoder
      .rotate()
      .resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 85 })
      .toBuffer();
    if (buffer.length > 2_097_152) throw new Error('Normalized reference exceeds 2 MB.');
    normalized.push({ mediaType: 'image/jpeg', data: buffer.toString('base64') });
  }
  return normalized;
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

export function createWorkshopServer(
  options: { apiKey?: string; model?: string; transport?: ClaudeTransport; claudeCode?: boolean } = {},
) {
  const model = options.model ?? DEFAULT_CLAUDE_MODEL;
  // Without an API key or transport, claudeCode runs builds on the local Claude Code login.
  const backend = options.apiKey || options.transport ? 'api' : options.claudeCode ? 'claude-code' : null;
  const configured = !!backend;
  const client = options.apiKey
    ? new Anthropic({ apiKey: options.apiKey, timeout: 60_000, maxRetries: 0 })
    : null;
  const transport =
    options.transport ??
    ((request, requestOptions) => client!.messages.create(request, requestOptions));
  let active: AbortController | null = null;
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (request.method === 'GET' && pathname === '/api/workshop/status') {
      json(response, 200, { configured, backend, busy: !!active, model, maxImages: 4, maxPieces: MAX_PIECES });
      return;
    }
    if (pathname !== '/api/workshop/generate') {
      json(response, 404, { error: 'Not found.' });
      return;
    }
    if (request.method !== 'POST') {
      json(response, 405, { error: 'Use POST.' });
      return;
    }
    let origin: URL;
    try {
      origin = new URL(request.headers.origin ?? '');
    } catch {
      json(response, 403, { error: 'A same-origin browser request is required.' });
      return;
    }
    if (
      !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) ||
      origin.host !== request.headers.host ||
      !['http:', 'https:'].includes(origin.protocol)
    ) {
      json(response, 403, { error: 'Cross-origin generation is refused.' });
      return;
    }
    if (!request.headers['content-type']?.startsWith('application/json')) {
      json(response, 415, { error: 'Expected application/json.' });
      return;
    }
    if (!configured) {
      json(response, 503, { error: 'ANTHROPIC_API_KEY is not configured on the local server.' });
      return;
    }
    if (active) {
      json(response, 409, { error: 'Another generation is running.' });
      return;
    }
    const controller = new AbortController();
    active = controller;
    const disconnect = () => controller.abort();
    response.on('close', disconnect);
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 300_000);
    deadline.unref();
    try {
      const value = await readJSON(request);
      if (!schema(value)) {
        const problems = (schema.errors ?? [])
          .slice(0, 3)
          .map((error) => `${error.instancePath || 'request'} ${error.message}`)
          .join('; ');
        throw new RequestError(
          400,
          `Invalid generation request (${problems}). Consent, bounded limits and a build are required.`,
        );
      }
      const input = value as GenerationRequest;
      let images: ReferenceImage[];
      try {
        images = await normalizeImages(input.images);
      } catch {
        throw new RequestError(
          400,
          'Invalid reference image. Use up to four non-animated JPEG, PNG or WebP files, at most 2 MB and 16 megapixels each.',
        );
      }
      let session: ReturnType<typeof createBuilderSession>;
      try {
        session = createBuilderSession(input.initial, {
          ...input.policy,
          maxPieces: input.maxPieces,
          ...(input.model && {
            reference: { model: decodeVoxelModel(input.model), origin: input.model.origin },
          }),
        });
      } catch (error) {
        throw new RequestError(
          400,
          error instanceof Error ? error.message : 'Invalid initial build or host policy.',
        );
      }
      if (controller.signal.aborted) return;
      response.writeHead(200, {
        'content-type': 'application/x-ndjson',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      response.flushHeaders();
      const emit = (value: unknown) => {
        if (!controller.signal.aborted && !response.write(`${JSON.stringify(value)}\n`))
          controller.abort();
      };
      const buildOptions = {
        model,
        images,
        maxTurns: input.maxTurns,
        signal: controller.signal,
        onProgress: emit,
      };
      const result =
        backend === 'claude-code'
          ? await runClaudeCodeBuild(input.prompt, session, buildOptions)
          : await runClaudeBuild(input.prompt, session, transport, buildOptions);
      if (!response.destroyed)
        response.end(
          `${JSON.stringify(
            timedOut
              ? { type: 'error', error: 'Generation exceeded the five-minute limit.' }
              : { type: 'result', result },
          )}\n`,
        );
    } catch (error) {
      if (response.destroyed) return;
      if (response.headersSent)
        response.end(
          `${JSON.stringify({ type: 'error', error: 'Generation failed. Check the local server model, API configuration or quota.' })}\n`,
        );
      else
        json(response, error instanceof RequestError ? error.status : 500, {
          error: error instanceof RequestError ? error.message : 'Local generation failed.',
        });
    } finally {
      clearTimeout(deadline);
      response.off('close', disconnect);
      if (active === controller) active = null;
    }
  });
  server.headersTimeout = 20_000;
  server.requestTimeout = 60_000;
  server.on('close', () => active?.abort());
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.WORKSHOP_API_PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('WORKSHOP_API_PORT must be 1024-65535.');
  createWorkshopServer({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.CLAUDE_MODEL,
    claudeCode: true,
  }).listen(port, '127.0.0.1', () =>
    console.log(
      `Workshop API: http://127.0.0.1:${port} (${process.env.ANTHROPIC_API_KEY ? 'API key' : 'local Claude Code login'})`,
    ),
  );
}
