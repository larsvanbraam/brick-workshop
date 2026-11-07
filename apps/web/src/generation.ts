import { importAssembly } from '@lego-builder/brick-engine';
import type { Assembly } from '@lego-builder/brick-engine';

export interface PhotoReference {
  name: string;
  mediaType: 'image/jpeg';
  data: string;
}
export interface DraftResult {
  assembly: Assembly;
  complete: boolean;
  reason: string;
  text: string;
  usage: { inputTokens: number; cachedInputTokens?: number; outputTokens: number };
}
export interface GenerationEvent {
  type: string;
  turn?: number;
  tool?: string;
  ok?: boolean;
  revision?: number;
  pieces?: number;
  text?: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
}

export async function preparePhoto(file: File): Promise<PhotoReference> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5_000_000)
    throw new Error('Use JPEG, PNG or WebP photos smaller than 5 MB.');
  const image = await createImageBitmap(file);
  try {
    if (image.width * image.height > 16_000_000)
      throw new Error('Photos must be at most 16 megapixels.');
    const scale = Math.min(1, 1536 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Photo processing is unavailable.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
    if (!data || data.length > 2_796_204) throw new Error('Processed photo exceeds 2 MB.');
    return { name: file.name, mediaType: 'image/jpeg', data };
  } finally {
    image.close();
  }
}

/** A JPEG of a rendered preview canvas, or null when it is blank or too large. */
export function captureCanvas(source: HTMLCanvasElement): string | null {
  if (!source.width || !source.height) return null;
  const scale = Math.min(1, 1024 / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const data = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
  return data && data.length <= 2_796_204 ? data : null;
}

export async function streamGeneration(
  input: unknown,
  signal: AbortSignal,
  onProgress: (event: GenerationEvent) => void,
  transport: typeof fetch = fetch,
): Promise<DraftResult> {
  const response = await transport('/api/workshop/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? `Generation request failed (${response.status}).`);
  }
  if (!response.body) throw new Error('Generation stream is unavailable.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: DraftResult | null = null;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (!event || typeof event !== 'object') throw new Error('Invalid generation event.');
    if (event.type === 'error')
      throw new Error(typeof event.error === 'string' ? event.error : 'Generation failed.');
    if (event.type === 'result') {
      const value = event.result;
      if (
        result ||
        !value ||
        typeof value.complete !== 'boolean' ||
        typeof value.reason !== 'string' ||
        typeof value.text !== 'string' ||
        !Number.isSafeInteger(value.usage?.inputTokens) ||
        value.usage.inputTokens < 0 ||
        !Number.isSafeInteger(value.usage?.outputTokens) ||
        value.usage.outputTokens < 0
      )
        throw new Error('Invalid generation result.');
      result = { ...value, assembly: importAssembly(value.assembly) };
    } else if (['turn', 'tool', 'text', 'usage'].includes(event.type)) onProgress(event);
    else throw new Error('Unknown generation event.');
  };
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 4_000_000) throw new Error('Generation response is too large.');
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) consume(line);
      if (done) break;
    }
    consume(buffer);
    if (!result) throw new Error('Generation ended without a draft.');
    return result;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
