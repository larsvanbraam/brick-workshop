import { describe, expect, it } from 'vite-plus/test';
import { streamGeneration } from '../src/generation.ts';

const draft = {
  type: 'result',
  result: {
    assembly: { name: 'Draft', bricks: [] },
    complete: true,
    reason: 'end_turn',
    text: 'Draft',
    usage: { inputTokens: 10, outputTokens: 5 },
  },
};
const transport =
  (chunks: string[], status = 200): typeof fetch =>
  async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
          controller.close();
        },
      }),
      { status },
    );

describe('workshop generation stream', () => {
  it('reads fragmented events and validates a final draft without trailing newline', async () => {
    const events: unknown[] = [];
    const data = `${JSON.stringify({ type: 'turn', turn: 1 })}\n${JSON.stringify(draft)}`;
    const result = await streamGeneration(
      {},
      new AbortController().signal,
      (event) => events.push(event),
      transport([data.slice(0, 9), data.slice(9, 51), data.slice(51)]),
    );
    expect(events).toEqual([{ type: 'turn', turn: 1 }]);
    expect(result.assembly).toEqual({ name: 'Draft', bricks: [] });
  });
  it('rejects truncated, malformed, server-error and invalid-geometry responses', async () => {
    for (const data of [
      '{"type":"turn","turn":1}\n',
      '{broken}',
      '{"type":"error","error":"Quota exhausted"}\n',
      JSON.stringify({
        ...draft,
        result: { ...draft.result, assembly: { name: 'Broken', bricks: [{}] } },
      }),
    ])
      await expect(
        streamGeneration({}, new AbortController().signal, () => {}, transport([data])),
      ).rejects.toThrow();
    await expect(
      streamGeneration(
        {},
        new AbortController().signal,
        () => {},
        transport(['{"error":"No API key"}'], 503),
      ),
    ).rejects.toThrow('No API key');
  });
  it('honors cancellation before accepting a result', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      streamGeneration({}, controller.signal, () => {}, transport([JSON.stringify(draft)])),
    ).rejects.toThrow();
  });
});
