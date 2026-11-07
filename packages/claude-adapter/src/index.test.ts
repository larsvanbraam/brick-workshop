import { describe, expect, it } from 'vite-plus/test';
import { MAX_BUILD_AREA, validateAssembly } from '@lego-builder/brick-engine';
import { MODEL_TOOLS, createBuilderSession, runClaudeBuild } from './index.ts';
import type { ClaudeTransport } from './index.ts';
import Anthropic from '@anthropic-ai/sdk';

const placement = { partId: '3001', color: 4, x: 0, y: 0, z: 0, rotation: 0 };

type TestBlock = Anthropic.TextBlock | Omit<Anthropic.ToolUseBlock, 'caller'>;
function message(
  content: TestBlock[],
  stopReason: Anthropic.Message['stop_reason'],
): Anthropic.Message {
  return {
    id: 'test-message',
    type: 'message',
    role: 'assistant',
    model: 'test-model',
    content: content.map((block) =>
      block.type === 'tool_use' ? { ...block, caller: { type: 'direct' } } : block,
    ),
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  } as Anthropic.Message;
}

describe('Claude tool-use loop', () => {
  it('sends bounded photo references with progress through the normal tool loop', async () => {
    const events: unknown[] = [];
    const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const responses = [
      message(
        [{ type: 'tool_use', id: 'photo-brick', name: 'brick_place', input: placement }],
        'tool_use',
      ),
      message([{ type: 'text', text: 'A simplified draft.', citations: null }], 'end_turn'),
    ];
    const result = await runClaudeBuild(
      'Use this reference',
      createBuilderSession(),
      async (request) => {
        requests.push(request);
        return responses.shift()!;
      },
      {
        images: [{ mediaType: 'image/png', data: 'aW1hZ2U=' }],
        onProgress: (event) => events.push(event),
      },
    );
    expect(requests[0].messages[0].content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining(`Board: 16 x 16 studs; brick_board resizes it up to ${MAX_BUILD_AREA}.`),
      }),
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' } },
    ]);
    expect(events).toContainEqual({
      type: 'tool',
      turn: 1,
      tool: 'brick_place',
      ok: true,
      revision: 1,
      pieces: 1,
    });
    expect(events).toContainEqual({ type: 'usage', inputTokens: 20, cachedInputTokens: 0, outputTokens: 10 });
    expect(result.complete).toBe(true);
  });

  it('marks follow-ups on an existing build as revisions with a labelled render', async () => {
    const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const session = createBuilderSession({ name: 'Draft', bricks: [{ ...placement, id: 'a' }] });
    await runClaudeBuild(
      'Make it taller',
      session,
      async (request) => {
        requests.push(request);
        return message([{ type: 'text', text: 'Done.', citations: null }], 'end_turn');
      },
      { render: { mediaType: 'image/png', data: 'aW1hZ2U=' } },
    );
    expect(requests[0].messages[0].content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('Revising an existing build'),
      }),
      { type: 'text', text: 'Render of the current build:' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' } },
    ]);
    await runClaudeBuild('Build a wall', createBuilderSession(), async (request) => {
      requests.push(request);
      return message([{ type: 'text', text: 'Done.', citations: null }], 'end_turn');
    });
    expect(requests[1].messages[0].content).not.toContain('Revising an existing build');
  });
  it('rejects malformed or oversized references before transport', async () => {
    let calls = 0;
    const transport: ClaudeTransport = async () => {
      calls += 1;
      return message([], 'end_turn');
    };
    for (const images of [
      Array(5).fill({ mediaType: 'image/png', data: 'aW1hZ2U=' }),
      [{ mediaType: 'image/svg+xml', data: 'aW1hZ2U=' }],
      [{ mediaType: 'image/png', data: 'not-base64' }],
    ]) {
      await expect(
        runClaudeBuild('Build', createBuilderSession(), transport, { images: images as never }),
      ).rejects.toThrow();
    }
    expect(calls).toBe(0);
  });

  it('cancels before executing returned tools and propagates the abort signal', async () => {
    const controller = new AbortController();
    const session = createBuilderSession();
    const result = await runClaudeBuild(
      'Build',
      session,
      async (_request, options) => {
        expect(options?.signal).toBe(controller.signal);
        controller.abort();
        return message(
          [{ type: 'tool_use', id: 'late', name: 'brick_place', input: placement }],
          'tool_use',
        );
      },
      { signal: controller.signal },
    );
    expect(result).toMatchObject({
      complete: false,
      reason: 'cancelled',
      trace: [],
      assembly: { bricks: [] },
    });
  });

  it('sends technique instructions and selected guide content through the actual tool loop', async () => {
    const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const transport: ClaudeTransport = async (request) => {
      requests.push(request);
      return requests.length === 1
        ? message(
            [
              {
                type: 'tool_use',
                id: 'guide-call',
                name: 'brick_techniques',
                input: { id: 'staggered-walls', includeExamples: false },
              },
            ],
            'tool_use',
          )
        : message(
            [
              {
                type: 'text',
                text: 'The wall plan uses staggered joints; strength and construction remain unverified.',
                citations: null,
              },
            ],
            'end_turn',
          );
    };
    const session = createBuilderSession();
    const result = await runClaudeBuild('Plan a staggered wall.', session, transport);
    expect(requests[0].system).toContain('use brick_techniques');
    expect(
      requests[0].tools?.some((tool) => 'name' in tool && tool.name === 'brick_techniques'),
    ).toBe(true);
    const results = requests[1].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
    expect(JSON.parse(results[0].content as string)).toMatchObject({
      ok: true,
      revision: 0,
      data: {
        version: 1,
        techniques: [expect.objectContaining({ id: 'staggered-walls', steps: expect.any(Array) })],
        certified: false,
      },
    });
    expect(result.trace).toEqual([{ tool: 'brick_techniques', ok: true, revision: 0 }]);
    expect(session.snapshot().bricks).toEqual([]);
  });

  it('integrates the official SDK over a mocked HTTP transport without network access', async () => {
    const requests: Record<string, unknown>[] = [];
    const responses = [
      message(
        [{ type: 'tool_use', id: 'sdk-base', name: 'brick_place', input: placement }],
        'tool_use',
      ),
      message([{ type: 'text', text: 'Built one brick.', citations: null }], 'end_turn'),
    ];
    const client = new Anthropic({
      apiKey: 'test-not-a-secret',
      maxRetries: 0,
      fetch: async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify(responses.shift()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    const result = await runClaudeBuild(
      'Build one brick',
      createBuilderSession(),
      (request) => client.messages.create(request),
      { model: 'test-model' },
    );
    expect(result.complete).toBe(true);
    expect(result.assembly.bricks).toHaveLength(1);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ model: 'test-model', max_tokens: 4096, stream: false });
  });
  it('executes dependent calls in response order and returns matching tool-result IDs', async () => {
    const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const responses = [
      message(
        [
          { type: 'tool_use', id: 'base', name: 'brick_place', input: placement },
          { type: 'tool_use', id: 'top', name: 'brick_place', input: { ...placement, y: 3 } },
        ],
        'tool_use',
      ),
      message([{ type: 'text', text: 'Built a two-brick stack.', citations: null }], 'end_turn'),
    ];
    const transport: ClaudeTransport = async (request) => {
      requests.push(request);
      return responses.shift()!;
    };
    const result = await runClaudeBuild('Build a stack', createBuilderSession(), transport);
    expect(result.complete).toBe(true);
    expect(result.assembly.bricks).toHaveLength(2);
    expect(validateAssembly(result.assembly)).toEqual([]);
    expect(result.trace.map((entry) => entry.revision)).toEqual([1, 2]);
    expect(requests[1].messages.at(-1)).toMatchObject({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'base', is_error: false },
        { type: 'tool_result', tool_use_id: 'top', is_error: false },
      ],
    });
    expect(result.usage).toEqual({ inputTokens: 20, cachedInputTokens: 0, outputTokens: 10 });
  });
  it('reports rejected tools as errors and lets Claude revise without trusting its claims', async () => {
    const responses = [
      message(
        [{ type: 'tool_use', id: 'bad', name: 'brick_place', input: { ...placement, y: 3 } }],
        'tool_use',
      ),
      message(
        [{ type: 'tool_use', id: 'fixed', name: 'brick_place', input: placement }],
        'tool_use',
      ),
      message([{ type: 'text', text: 'Done.', citations: null }], 'end_turn'),
    ];
    const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const result = await runClaudeBuild('Build', createBuilderSession(), async (request) => {
      requests.push(request);
      return responses.shift()!;
    });
    expect(result.trace.map((entry) => entry.ok)).toEqual([false, true]);
    expect(requests[1].messages.at(-1)).toMatchObject({
      content: [
        {
          tool_use_id: 'bad',
          is_error: true,
          content: expect.stringContaining('geometry_rejected'),
        },
      ],
    });
    expect(result.assembly.bricks).toHaveLength(1);
  });
  it('returns partial state at its iteration limit rather than declaring completion', async () => {
    const result = await runClaudeBuild(
      'Build',
      createBuilderSession(),
      async () =>
        message(
          [{ type: 'tool_use', id: 'catalog', name: 'brick_catalog', input: {} }],
          'tool_use',
        ),
      { maxTurns: 1 },
    );
    expect(result).toMatchObject({ complete: false, reason: 'turn-limit', turns: 1 });
    await expect(
      runClaudeBuild(
        'Build',
        createBuilderSession(),
        async () => {
          throw new Error('Should not call');
        },
        { maxTurns: 0 },
      ),
    ).rejects.toThrow('Turn limit');
  });
  it('does not execute truncated or duplicate-ID tool responses', async () => {
    const call = { type: 'tool_use' as const, id: 'same', name: 'brick_place', input: placement };
    for (const response of [message([call], 'max_tokens'), message([call, call], 'tool_use')]) {
      const session = createBuilderSession();
      const result = await runClaudeBuild('Build', session, async () => response);
      expect(result.complete).toBe(false);
      expect(session.snapshot().bricks).toEqual([]);
    }
  });
  it('propagates transport errors instead of fabricating an assembly', async () => {
    const session = createBuilderSession();
    await expect(
      runClaudeBuild('Build', session, async () => {
        throw new Error('API unavailable');
      }),
    ).rejects.toThrow('API unavailable');
    expect(session.snapshot().bricks).toEqual([]);
  });
});

describe('headless Claude builder tools', () => {
  it('never upgrades reference geometry into host inventory approval', () => {
    const session = createBuilderSession(undefined, { requireInventory: true, inventory: [] });
    expect(session.runTool('brick_techniques', { id: 'foundations' })).toMatchObject({
      ok: true,
      revision: 0,
      data: {
        techniques: [
          expect.objectContaining({
            example: expect.objectContaining({ hostPolicyApproval: 'not-evaluated' }),
          }),
        ],
      },
    });
    expect(session.runTool('brick_place', placement)).toMatchObject({
      ok: false,
      revision: 0,
      error: { code: 'inventory_unknown' },
    });
    expect(session.snapshot().bricks).toEqual([]);
  });

  it('retrieves bounded versioned technique guidance and isolated reference examples without mutation', () => {
    const session = createBuilderSession();
    const before = session.snapshot();
    const result = session.runTool('brick_techniques', { topic: 'walls', limit: 1 });
    expect(result).toMatchObject({
      ok: true,
      revision: 0,
      data: {
        version: 1,
        totalMatches: 2,
        truncated: true,
        certified: false,
        constructionSequence: 'not-validated',
        techniques: [
          expect.objectContaining({
            id: 'staggered-walls',
            example: {
              assembly: expect.objectContaining({ bricks: expect.any(Array) }),
              coordinateSpace: 'standalone-reference-not-current-build',
              ids: 'illustrative-only',
              geometry: 'validated-reference-only',
              hostPolicyApproval: 'not-evaluated',
              parameters: expect.any(Object),
            },
          }),
        ],
      },
    });
    expect(session.snapshot()).toEqual(before);
    if (!result.ok) throw new Error('Technique query rejected');
    const data = result.data as {
      techniques: { title: string; example: { assembly: { bricks: { x: number }[] } } }[];
    };
    data.techniques[0].title = 'Changed';
    data.techniques[0].example.assembly.bricks[0].x = 12;
    expect(session.runTool('brick_techniques', { id: 'staggered-walls' })).toMatchObject({
      ok: true,
      revision: 0,
      data: {
        techniques: [
          expect.objectContaining({
            title: 'Staggered wall joints',
            example: expect.objectContaining({
              assembly: expect.objectContaining({
                bricks: expect.arrayContaining([expect.objectContaining({ x: 0 })]),
              }),
            }),
          }),
        ],
      },
    });
    const brief = session.runTool('brick_techniques', {
      id: 'foundations',
      includeExamples: false,
    });
    expect(brief).toMatchObject({
      ok: true,
      data: { techniques: [expect.objectContaining({ id: 'foundations' })] },
    });
    if (!brief.ok) throw new Error('Technique query rejected');
    expect((brief.data as { techniques: object[] }).techniques[0]).not.toHaveProperty('example');
    expect(session.runTool('brick_techniques', { limit: 4 }).ok).toBe(false);
    expect(session.runTool('brick_techniques', { id: 'technic' }).ok).toBe(false);
    expect(session.runTool('brick_techniques', { rejectInfeasible: false }).ok).toBe(false);
    expect(session.runTool('brick_place', placement)).toMatchObject({
      ok: true,
      revision: 1,
      data: { brick: { id: 'ai-1' } },
    });
  });

  it('previews and applies patches atomically with revision guards and stable IDs', () => {
    const session = createBuilderSession();
    const operations = [
      { type: 'add', brick: { ...placement, id: 'foundation' } },
      { type: 'add', brick: { ...placement, id: 'upper', partId: '3005', y: 3 } },
    ];
    const before = session.snapshot();
    expect(
      session.runTool('brick_preview_patch', { expectedRevision: 0, operations }),
    ).toMatchObject({
      ok: true,
      revision: 0,
      data: {
        purpose: 'preview-only',
        assessment: { constructionSequence: 'not-validated', buildability: { certified: false } },
      },
    });
    expect(session.snapshot()).toEqual(before);
    const applied = session.runTool('brick_apply_patch', { expectedRevision: 0, operations });
    expect(applied).toMatchObject({ ok: true, revision: 1 });
    // Only the changes come back, as compact rows, not the whole assembly.
    expect((applied as { data: Record<string, unknown> }).data.assembly).toBeUndefined();
    expect((applied as { data: { changes: unknown } }).data.changes).toMatchObject({
      pieceCount: 2,
      added: [expect.arrayContaining(['foundation']), expect.arrayContaining(['upper'])],
      updated: [],
      removed: [],
    });
    const region = session.runTool('brick_inspect', { region: { minY: 1 } }) as {
      data: { pieceCount: number; bricks: { rows: unknown[][] } };
    };
    expect(region.data.pieceCount).toBe(2);
    expect(region.data.bricks.rows.map((row) => row[0])).toEqual(['upper']);
    const built = session.snapshot();
    expect(built.bricks.map((brick) => brick.id)).toEqual(['foundation', 'upper']);
    expect(
      session.runTool('brick_apply_patch', {
        expectedRevision: 0,
        operations: [{ type: 'remove', id: 'upper' }],
      }),
    ).toMatchObject({ ok: false, revision: 1, error: { code: 'revision_conflict' } });
    expect(
      session.runTool('brick_apply_patch', {
        expectedRevision: 1,
        operations: [{ type: 'update', id: 'upper', changes: { color: 47 } }],
      }),
    ).toMatchObject({ ok: false, revision: 1, error: { code: 'unverified_color' } });
    expect(session.snapshot()).toEqual(built);
    expect(
      session.runTool('brick_apply_patch', {
        expectedRevision: 1,
        operations: [
          { type: 'remove', id: 'foundation' },
          { type: 'add', brick: { ...placement, id: 'replacement' } },
        ],
      }),
    ).toMatchObject({ ok: true, revision: 2 });
    expect(session.runTool('brick_place', { ...placement, x: 8 }).ok).toBe(true);
    expect(session.snapshot().bricks.at(-1)?.id).toBe('ai-1');
  });

  it('uses declared inventory for patches, single edits and candidates without accepting tool policy overrides', () => {
    const session = createBuilderSession(undefined, {
      requireInventory: true,
      inventory: [{ partId: '3005', color: 4, quantity: 1 }],
    });
    const operations = [{ type: 'add', brick: { ...placement, id: 'stock', partId: '3005' } }];
    expect(
      session.runTool('brick_apply_patch', {
        expectedRevision: 0,
        operations,
        rejectInfeasible: false,
      }),
    ).toMatchObject({ ok: false, revision: 0, error: { code: 'invalid_input' } });
    expect(session.runTool('brick_apply_patch', { expectedRevision: 0, operations })).toMatchObject(
      { ok: true, revision: 1 },
    );
    expect(session.runTool('brick_place', { ...placement, partId: '3005', x: 4 })).toMatchObject({
      ok: false,
      revision: 1,
      error: { code: 'inventory_exceeded' },
    });
    expect(
      session.runTool('brick_candidates', { partId: '3005', color: 4, maxCandidates: 1 }),
    ).toMatchObject({
      ok: true,
      revision: 1,
      data: {
        candidates: [
          expect.objectContaining({
            placementAllowed: false,
            policyIssues: [expect.objectContaining({ code: 'inventory_exceeded' })],
          }),
        ],
      },
    });
    expect(
      session.runTool('brick_apply_patch', {
        expectedRevision: 1,
        operations: [{ type: 'update', id: 'stock', changes: { partId: '3001' } }],
      }),
    ).toMatchObject({ ok: false, error: { code: 'inventory_unknown' } });
    expect(session.snapshot().bricks).toHaveLength(1);
  });

  it('rejects a model-infeasible batch without committing any additions', () => {
    const session = createBuilderSession();
    expect(session.runTool('brick_place', { ...placement, partId: '3003' }).ok).toBe(true);
    const before = session.snapshot();
    const operations = [
      { type: 'add', brick: { ...placement, id: 'arm', partId: '3009', y: 3 } },
      { type: 'add', brick: { ...placement, id: 'unrelated', x: 8 } },
    ];
    expect(
      session.runTool('brick_preview_patch', { expectedRevision: 1, operations }),
    ).toMatchObject({ ok: false, revision: 1, error: { code: 'physical_rejected' } });
    expect(session.runTool('brick_apply_patch', { expectedRevision: 1, operations })).toMatchObject(
      { ok: false, revision: 1, error: { code: 'physical_rejected' } },
    );
    expect(session.snapshot()).toEqual(before);
  });

  it('sculpts pixel-art layers into staggered bricks atomically, on top of earlier pieces', () => {
    const session = createBuilderSession();
    const column = { palette: { r: 4, b: 1 }, x: 2, z: 3, y: 0 };
    const legs = session.runTool('brick_sculpt', {
      ...column,
      layers: [{ rows: ['b2.2b2', 'b2.2b2'], repeat: 2 }],
    });
    expect(legs).toMatchObject({ ok: true, revision: 1, data: { skippedCells: 0, region: { maxX: 7, maxY: 6 } } });
    const body = session.runTool('brick_sculpt', {
      ...column,
      y: 6,
      layers: [{ rows: ['r6', 'r6'], repeat: 3 }],
    });
    expect(body).toMatchObject({ ok: true, revision: 2, data: { filledCells: 36, skippedCells: 0 } });
    const assembly = session.snapshot();
    expect(validateAssembly(assembly)).toEqual([]);
    expect(new Set(assembly.bricks.map((brick) => brick.id)).size).toBe(assembly.bricks.length);
    expect(assembly.bricks.filter((brick) => brick.y >= 6).every((brick) => brick.color === 4)).toBe(true);

    // Overlapping the body changes nothing.
    expect(session.runTool('brick_sculpt', { ...column, layers: [{ rows: ['r'] }] })).toMatchObject({
      ok: false,
      revision: 2,
    });
    expect(session.runTool('brick_sculpt', { ...column, layers: [{ rows: ['q'] }] })).toMatchObject({
      ok: false,
      error: { code: 'invalid_input' },
    });
    expect(session.runTool('brick_sculpt', { ...column, x: 12, layers: [{ rows: ['r6'] }] })).toMatchObject({
      ok: false,
      error: { code: 'out_of_bounds' },
    });
    expect(session.snapshot()).toEqual(assembly);

    // Plate layers stack one plate at a time above the brick layers of the same call.
    const face = session.runTool('brick_sculpt', {
      palette: { n: 78, k: 0 },
      x: 2,
      z: 3,
      y: 15,
      layers: [{ rows: ['n6', 'n6'] }, { rows: ['nkn2kn', 'n6'], plates: true }, { rows: ['n6', 'n6'], plates: true, repeat: 2 }],
    });
    expect(face).toMatchObject({ ok: true, revision: 3, data: { skippedCells: 0, region: { maxY: 21 } } });
    const plates = session.snapshot().bricks.filter((brick) => brick.y >= 18);
    expect(plates.map((brick) => brick.y).sort()).toContain(20);
    expect(plates.filter((brick) => brick.color === 0).every((brick) => brick.partId === '3024' || brick.partId === '3023b')).toBe(true);
    expect(validateAssembly(session.snapshot())).toEqual([]);
  });

  it('sculpts rounded shapes in plates, previews without adding and reports unseen details', () => {
    const session = createBuilderSession(undefined, { maxPieces: 2000 });
    const head = {
      shapes: [
        { type: 'ellipsoid', center: [8, 3, 8], radii: [3, 3, 3], color: 78 },
        { type: 'box', min: [7, 3, 4], max: [9, 4, 6], color: 15, mode: 'paint' },
        { type: 'box', min: [7.6, 3, 4], max: [7.9, 4, 6], color: 0, mode: 'paint' },
        { type: 'ellipsoid', center: [8, 3, 8], radii: [1, 1, 1], color: 4, mode: 'cut' },
      ],
    };
    const preview = session.runTool('brick_shape', { ...head, preview: true });
    expect(preview).toMatchObject({ ok: true, revision: 0, data: { purpose: 'preview-only', unseenShapes: [2] } });
    expect(session.snapshot().bricks).toEqual([]);

    const result = session.runTool('brick_shape', head);
    expect(result).toMatchObject({ ok: true, revision: 1, data: { skippedCells: 0 } });
    const bricks = session.snapshot().bricks;
    expect(validateAssembly(session.snapshot())).toEqual([]);
    expect(bricks.map((brick) => brick.y)).toContain(7);
    expect(bricks.every((brick) => ['3020', '3021', '3022', '3023b', '3024', '3710', '3623', '3666', '3460', '3034', '3795', '3832'].includes(brick.partId))).toBe(true);
    // Rounded: the widest layer is wider than the bottom one, and the eye paint shows.
    const widths = (y: number) => bricks.filter((brick) => brick.y === y).length;
    expect(widths(7)).toBeGreaterThan(widths(0));
    expect(bricks.some((brick) => brick.color === 15)).toBe(true);
    expect(session.runTool('brick_shape', { shapes: [{ type: 'capsule', from: [1, 0, 1], to: [1, 2, 1], color: 4 }] }))
      .toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  });

  it('offers read-only candidates with color policy, physical coverage and engine capabilities', () => {
    const session = createBuilderSession();
    expect(session.runTool('brick_catalog', {})).toMatchObject({
      ok: true,
      data: {
        capabilities: { insertFrames: { '60602': '60593' }, staticGravity: { maxPieces: 200 } },
      },
    });
    const before = session.snapshot();
    expect(
      session.runTool('brick_candidates', { partId: '3005', color: 4, maxCandidates: 1 }),
    ).toMatchObject({
      ok: true,
      revision: 0,
      data: {
        truncated: true,
        candidates: [
          expect.objectContaining({
            placementAllowed: true,
            physical: {
              status: 'unknown',
              gravity: 'balanced',
              massBasis: 'catalog',
              connectionStrength: 'unknown',
              reasons: expect.any(Array),
              certified: false,
            },
          }),
        ],
      },
    });
    expect(session.snapshot()).toEqual(before);
    expect(
      session.runTool('brick_candidates', { partId: '3005', color: 4, supportId: 'missing' }),
    ).toMatchObject({ ok: false, revision: 0, error: { code: 'search_rejected' } });
    expect(
      session.runTool('brick_candidates', { partId: '3005', color: 4, maxCandidates: 21 }).ok,
    ).toBe(false);
    expect(session.runTool('brick_candidates', { partId: '3005', color: 47 })).toMatchObject({
      ok: false,
      error: { code: 'unverified_color' },
    });
    expect(session.runTool('brick_connection', { id: 'missing' })).toMatchObject({
      ok: false,
      error: { code: 'piece_not_found' },
    });
    expect(session.runTool('brick_place', placement).ok).toBe(true);
    expect(session.runTool('brick_connection', { id: 'ai-1' })).toMatchObject({
      ok: true,
      revision: 1,
      data: { grounded: true, issues: [], strength: 'unknown' },
    });
  });

  it('labels tipping candidates as rejected unless the host explicitly opts out', () => {
    for (const rejectInfeasible of [true, false]) {
      const session = createBuilderSession(undefined, { rejectInfeasible });
      expect(session.runTool('brick_place', { ...placement, partId: '3003' }).ok).toBe(true);
      const before = session.snapshot();
      expect(
        session.runTool('brick_candidates', {
          partId: '3009',
          color: 4,
          supportId: 'ai-1',
          rotations: [0],
          maxCandidates: 1,
        }),
      ).toMatchObject({
        ok: true,
        revision: 1,
        data: {
          candidates: [
            expect.objectContaining({
              placementAllowed: !rejectInfeasible,
              brick: expect.objectContaining({ x: 0, y: 3, z: 0 }),
              physical: expect.objectContaining({
                status: 'infeasible',
                gravity: 'unstable',
                certified: false,
              }),
            }),
          ],
        },
      });
      expect(session.snapshot()).toEqual(before);
    }
  });

  it('keeps missing-mass and shaped candidates unknown and enforces piece limits', () => {
    const missingMass = createBuilderSession(undefined, {
      physical: { useCatalogMasses: false, estimateMissingMasses: false },
    });
    expect(
      missingMass.runTool('brick_candidates', { partId: '3005', color: 4, maxCandidates: 1 }),
    ).toMatchObject({
      ok: true,
      data: {
        candidates: [
          expect.objectContaining({
            placementAllowed: true,
            physical: expect.objectContaining({
              status: 'unknown',
              gravity: 'not-assessed',
              massBasis: 'missing',
            }),
          }),
        ],
      },
    });
    const shaped = createBuilderSession(undefined, { requireObservedColors: false });
    expect(
      shaped.runTool('brick_candidates', { partId: '3942c', color: 4, maxCandidates: 1 }),
    ).toMatchObject({
      ok: true,
      data: {
        candidates: [
          expect.objectContaining({
            placementAllowed: true,
            physical: expect.objectContaining({
              status: 'unknown',
              gravity: 'not-assessed',
              certified: false,
            }),
          }),
        ],
      },
    });
    const limited = createBuilderSession(undefined, { maxPieces: 1 });
    expect(limited.runTool('brick_place', placement).ok).toBe(true);
    expect(limited.runTool('brick_candidates', { partId: '3005', color: 4 })).toMatchObject({
      ok: false,
      revision: 1,
      error: { code: 'piece_limit' },
    });
  });

  it('respects the host assembly board size in catalogue, placements and exports', () => {
    const session = createBuilderSession({ name: 'Wide board', bricks: [], buildArea: 64 });
    expect(session.runTool('brick_catalog', {})).toMatchObject({
      ok: true,
      data: { buildArea: 64 },
    });
    expect(session.runTool('brick_place', { ...placement, x: 60, z: 60 }).ok).toBe(true);
    expect(session.snapshot().buildArea).toBe(64);
    const before = session.snapshot();
    expect(session.runTool('brick_place', { ...placement, x: 63, z: 60 }).ok).toBe(false);
    expect(session.snapshot()).toEqual(before);
    expect(createBuilderSession().runTool('brick_place', { ...placement, x: 60 }).ok).toBe(false);
    expect(() => createBuilderSession({ name: 'Bad board', bricks: [], buildArea: MAX_BUILD_AREA + 1 })).toThrow(
      'Invalid initial assembly',
    );
  });
  it('resizes the board around existing pieces and refuses sizes they do not fit', () => {
    const session = createBuilderSession();
    expect(session.runTool('brick_place', { ...placement, x: 6, z: 6 }).ok).toBe(true);
    expect(session.runTool('brick_board', { size: 32 })).toEqual({
      ok: true,
      revision: 2,
      data: { buildArea: 32, shift: { x: 8, z: 8 }, pieceCount: 1 },
    });
    expect(session.snapshot().bricks[0]).toMatchObject({ x: 14, z: 14 });
    expect(session.runTool('brick_place', { ...placement, x: 28, z: 28 }).ok).toBe(true);
    const before = session.snapshot();
    expect(session.runTool('brick_board', { size: 16 })).toMatchObject({
      ok: false,
      error: { code: 'board_too_small' },
    });
    expect(session.runTool('brick_board', { size: MAX_BUILD_AREA + 1 }).ok).toBe(false);
    expect(session.snapshot()).toEqual(before);
  });
  it('accepts half-unit baseplate and cone placements but rejects quarter-unit inputs atomically', () => {
    const session = createBuilderSession(undefined, { requireObservedColors: false });
    expect(session.runTool('brick_place', { ...placement, partId: '3867' }).ok).toBe(true);
    expect(session.runTool('brick_place', { ...placement, partId: '3942c', y: 0.5 }).ok).toBe(true);
    expect(
      session.runTool('brick_place', { ...placement, partId: '6141', x: 0.5, y: 6.5, z: 0.5 }).ok,
    ).toBe(true);
    const before = session.snapshot();
    expect(session.runTool('brick_place', { ...placement, x: 4.25, y: 0.5 }).ok).toBe(false);
    expect(session.snapshot()).toEqual(before);
    expect(session.runTool('brick_physics', {})).toMatchObject({
      ok: true,
      data: { status: 'unknown', gravity: 'not-assessed' },
    });
  });
  it('exposes and places new families without claiming shaped contact physics', () => {
    const catalogue = createBuilderSession().runTool('brick_catalog', {}) as {
      data: { partColumns: string[]; partRows: unknown[][] };
    };
    const rows = catalogue.data.partRows.map((row) =>
      Object.fromEntries(catalogue.data.partColumns.map((column, index) => [column, row[index]])),
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: '2453b', height: 15, family: 'tall', shape: 'box' }),
        expect.objectContaining({ id: '3039', family: 'slope', shape: 'slope', contactPhysics: 'not-assessed' }),
        expect.objectContaining({ id: '3062b', family: 'round', shape: 'round', contactPhysics: 'not-assessed' }),
      ]),
    );
    for (const partId of ['2453b', '3039', '3062b']) {
      const session = createBuilderSession();
      expect(session.runTool('brick_place', { ...placement, partId }).ok).toBe(true);
      if (partId !== '2453b')
        expect(session.runTool('brick_physics', {})).toMatchObject({
          ok: true,
          data: { gravity: 'not-assessed', status: 'unknown', massBasis: 'catalog' },
        });
    }
  });
  it('refuses construction exports and keeps ordinary exports explicitly uncertified drafts', () => {
    const session = createBuilderSession();
    expect(session.runTool('brick_place', placement).ok).toBe(true);
    const before = session.snapshot();
    for (const format of ['ldraw', 'json']) {
      expect(session.runTool('brick_export', { format, purpose: 'construction' })).toMatchObject({
        ok: false,
        revision: 1,
        error: {
          code: 'buildability_not_certified',
          issues: { certified: false, blockers: expect.arrayContaining(['Physical validation']) },
        },
      });
    }
    expect(session.snapshot()).toEqual(before);
    expect(session.runTool('brick_export', { format: 'json' })).toMatchObject({
      ok: true,
      data: { exportPurpose: 'unverified-draft', buildability: { certified: false } },
    });
    expect(session.runTool('brick_export', { format: 'ldraw' })).toMatchObject({
      ok: true,
      data: expect.stringContaining('UNVERIFIED DRAFT'),
    });
    expect(session.runTool('brick_physics', {})).toMatchObject({
      ok: true,
      data: {
        buildability: {
          certified: false,
          checks: expect.arrayContaining([
            expect.objectContaining({ id: 'body-strength', status: 'unknown' }),
          ]),
        },
      },
    });
  });
  it('rejects tipping under catalogue-reported weights without changing state or revision', () => {
    const session = createBuilderSession();
    expect(session.runTool('brick_place', { ...placement, partId: '3003' })).toMatchObject({
      ok: true,
      revision: 1,
    });
    const before = session.snapshot();
    expect(session.runTool('brick_place', { ...placement, partId: '3009', y: 3 })).toMatchObject({
      ok: false,
      revision: 1,
      error: {
        code: 'physical_rejected',
        issues: { status: 'infeasible', gravity: 'unstable', massBasis: 'catalog' },
      },
    });
    expect(session.snapshot()).toEqual(before);
    expect(session.runTool('brick_physics', {})).toMatchObject({
      ok: true,
      data: {
        status: 'unknown',
        gravity: 'balanced',
        massBasis: 'catalog',
        connectionStrength: 'unknown',
      },
    });
    expect(session.runTool('brick_physics', { massGrams: 0 })).toMatchObject({
      ok: false,
      error: { code: 'invalid_input' },
    });
  });
  it('rejects removal of a necessary counterweight using host-supplied mass data', () => {
    const mass = (massGrams: number) => ({
      massGrams,
      kind: 'measured' as const,
      source: 'Synthetic test fixture.',
    });
    const initial = {
      name: 'Counterweight',
      bricks: [
        { ...placement, id: 'base', partId: '3003' },
        { ...placement, id: 'arm', partId: '3009', y: 3 },
        { ...placement, id: 'counterweight', partId: '3005', y: 6 },
      ],
    };
    const session = createBuilderSession(initial, {
      physical: {
        data: { version: 1, parts: { '3003': mass(10), '3009': mass(30), '3005': mass(100) } },
      },
    });
    expect(session.runTool('brick_remove', { id: 'counterweight' })).toMatchObject({
      ok: false,
      revision: 0,
      error: { code: 'physical_rejected' },
    });
    expect(session.snapshot()).toEqual(initial);
    expect(session.document()).toMatchObject({
      physicalAssessment: { gravity: 'balanced', massBasis: 'measured', status: 'unknown' },
      checks: { strength: 'unknown', physicalFeasibility: 'unknown' },
    });
  });
  it('supports explicit host opt-out and missing-mass uncertainty without model overrides', () => {
    const session = createBuilderSession(undefined, {
      physical: { estimateMissingMasses: false, useCatalogMasses: false },
      rejectInfeasible: false,
    });
    expect(session.runTool('brick_place', placement)).toMatchObject({ ok: true });
    expect(session.runTool('brick_physics', {})).toMatchObject({
      ok: true,
      data: { gravity: 'not-assessed', totalMassGrams: null, status: 'unknown' },
    });
    expect(session.runTool('brick_place', { ...placement, rejectInfeasible: false })).toMatchObject(
      { ok: false, error: { code: 'invalid_input' } },
    );
  });
  it('retains catalogue mass provenance and host policy in inspection and JSON exports', () => {
    const session = createBuilderSession(undefined, { physical: { estimateMissingMasses: false } });
    expect(session.runTool('brick_place', placement)).toMatchObject({ ok: true });
    expect(session.document()).toMatchObject({
      physicalPolicy: { useCatalogMasses: true, estimateMissingMasses: false },
      physicalAssessment: {
        massBasis: 'catalog',
        totalMassGrams: 2.32,
        masses: [
          {
            mass: {
              kind: 'catalog',
              catalog: {
                partId: '3001',
                retrievedAt: '2026-10-31',
                url: 'https://www.bricklink.com/v2/catalog/catalogitem.page?P=3001',
              },
            },
          },
        ],
      },
      buildability: {
        certified: false,
        checks: expect.arrayContaining([
          expect.objectContaining({ id: 'mass', status: 'reported' }),
        ]),
      },
    });
    expect(session.runTool('brick_export', { format: 'json' })).toMatchObject({
      ok: true,
      data: session.document(),
    });
    expect(session.runTool('brick_physics', { useCatalogMasses: false })).toMatchObject({
      ok: false,
      error: { code: 'invalid_input' },
    });
  });
  it('exposes tile connectors and places observed-color tiles without allowing stud support above them', () => {
    const session = createBuilderSession();
    expect(session.runTool('brick_catalog', {})).toMatchObject({ data: { parts: [] } });
    expect(session.runTool('brick_catalog', { partIds: ['87079'] })).toMatchObject({
      ok: true,
      data: {
        parts: [
          expect.objectContaining({
            id: '87079',
            kind: 'tile',
            connections: { topStuds: [], bottomReceivers: 'full' },
            observedColors: expect.arrayContaining([4]),
          }),
        ],
      },
    });
    expect(session.runTool('brick_place', placement)).toMatchObject({ ok: true, revision: 1 });
    expect(session.runTool('brick_place', { ...placement, partId: '87079', y: 3 })).toMatchObject({
      ok: true,
      revision: 2,
    });
    expect(session.runTool('brick_place', { ...placement, partId: '3024', y: 4 })).toMatchObject({
      ok: false,
      revision: 2,
      error: { code: 'geometry_rejected' },
    });
    expect(session.snapshot().bricks).toHaveLength(2);
    expect(session.runTool('brick_export', { format: 'ldraw' })).toMatchObject({
      ok: true,
      data: expect.stringContaining('87079.dat'),
    });
  });
  it('adds through the engine and rejects collisions, floating pieces, and support removal without mutation', () => {
    const session = createBuilderSession();
    expect(session.runTool('brick_place', placement)).toMatchObject({ ok: true, revision: 1 });
    const base = session.snapshot();
    expect(session.runTool('brick_place', placement)).toMatchObject({
      ok: false,
      revision: 1,
      error: { code: 'geometry_rejected' },
    });
    expect(session.runTool('brick_place', { ...placement, x: 8, y: 3 })).toMatchObject({
      ok: false,
      revision: 1,
    });
    expect(session.snapshot()).toEqual(base);
    expect(session.runTool('brick_place', { ...placement, y: 3 })).toMatchObject({
      ok: true,
      revision: 2,
    });
    expect(session.runTool('brick_remove', { id: base.bricks[0].id })).toMatchObject({
      ok: false,
      revision: 2,
    });
    expect(validateAssembly(session.snapshot())).toEqual([]);
    expect(session.runTool('brick_remove', { id: session.snapshot().bricks[1].id })).toMatchObject({
      ok: true,
      revision: 3,
    });
    expect(session.runTool('brick_remove', { id: base.bricks[0].id })).toMatchObject({
      ok: true,
      revision: 4,
    });
  });
  it.each([
    null,
    { ...placement, color: '4' },
    { ...placement, x: 0.25 },
    { ...placement, rotation: 45 },
    { ...placement, partId: 'fake' },
    { ...placement, command: 'execute' },
  ])('rejects malformed input %j without mutation', (input) => {
    const session = createBuilderSession();
    expect(session.runTool('brick_place', input)).toMatchObject({
      ok: false,
      revision: 0,
      error: { code: 'invalid_input' },
    });
    expect(session.snapshot().bricks).toEqual([]);
  });
  it('requires observed colors by default and labels unverified rendering when explicitly allowed by the host', () => {
    const session = createBuilderSession();
    expect(session.runTool('brick_place', { ...placement, color: 36 })).toMatchObject({
      ok: false,
      revision: 0,
      error: { code: 'unverified_color' },
    });
    const preview = createBuilderSession(undefined, { requireObservedColors: false });
    expect(preview.runTool('brick_place', { ...placement, color: 36 })).toMatchObject({
      ok: true,
      data: { colorStatus: { rendering: 'recognized', manufactured: 'unknown', stock: 'unknown' } },
    });
  });
  it('keeps a reference 3D model behind tools and sends only the missing regions', async () => {
    const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const transport: ClaudeTransport = async (request) => {
      requests.push(structuredClone(request));
      return message([{ type: 'text', text: 'Refined.', citations: null }], 'end_turn');
    };
    // A two-layer model; the build covers its bottom layer with one 1 x 2 brick.
    const reference = {
      model: { name: 'Model', width: 2, depth: 1, layers: 2, cells: [4, 4, 4, null] },
      origin: { x: 0, z: 0 },
    };
    const shell = {
      name: 'Shell',
      bricks: [{ id: 'a', partId: '3004', color: 4, x: 0, y: 0, z: 0, rotation: 90 }],
    };
    const session = createBuilderSession(shell, { reference });
    await runClaudeBuild('Refine the shell.', session, transport);
    const first = requests[0].messages[0].content as string;
    expect(first).toContain('Reference 3D model');
    expect(first).toContain('"missingCells":1');
    expect(first).toContain('"y":[3,6]');
    expect(session.runTool('model_layer', { layer: 1 })).toMatchObject({
      ok: true,
      data: expect.stringContaining('Model:\na.\nBuild:\n..'),
    });
    expect(session.runTool('model_layer', { layer: 2 })).toMatchObject({ ok: false });
    expect(createBuilderSession().runTool('model_gaps', {})).toMatchObject({
      ok: false,
      error: { code: 'no_reference' },
    });
  });

  it('sends compact part and color references to Claude but still validates them strictly', () => {
    const place = MODEL_TOOLS.find((tool) => tool.name === 'brick_place');
    expect(JSON.stringify(MODEL_TOOLS)).not.toContain('"3001"');
    expect(place?.input_schema.properties).toMatchObject({
      partId: { type: 'string', description: 'Part ID from brick_catalog.' },
    });
    const session = createBuilderSession();
    expect(session.runTool('brick_place', { ...placement, partId: 'not-a-part' })).toMatchObject({
      ok: false,
      error: { code: 'invalid_input' },
    });
    expect(session.snapshot().bricks).toHaveLength(0);
  });

  it('isolates returned snapshots, respects piece limits, and cannot execute unknown tools', () => {
    const session = createBuilderSession(undefined, { maxPieces: 1 });
    session.runTool('brick_place', placement);
    (session.snapshot().bricks as unknown[]).length = 0;
    expect(session.snapshot().bricks).toHaveLength(1);
    expect(session.runTool('brick_place', { ...placement, x: 8 })).toMatchObject({
      ok: false,
      error: { code: 'piece_limit' },
    });
    expect(session.runTool('bash', { command: 'anything' })).toMatchObject({
      ok: false,
      error: { code: 'unknown_tool' },
    });
    expect(session.runTool('toString', {})).toMatchObject({
      ok: false,
      error: { code: 'unknown_tool' },
    });
  });
  it('validates initial assemblies, keeps stable unique IDs, and exports without file access', () => {
    expect(() => createBuilderSession({ name: 'Broken', bricks: [{}] })).toThrow(
      'initial assembly',
    );
    expect(() =>
      createBuilderSession({ name: 'Floating', bricks: [{ ...placement, id: 'base', y: 3 }] }),
    ).toThrow('initial geometry');
    expect(() =>
      createBuilderSession({
        name: 'Unknown color',
        bricks: [{ ...placement, id: 'base', color: 36 }],
      }),
    ).toThrow('unverified');
    const session = createBuilderSession({
      name: 'Imported',
      bricks: [{ ...placement, id: 'ai-1' }],
    });
    session.runTool('brick_place', { ...placement, x: 8 });
    expect(session.snapshot().bricks.map((brick) => brick.id)).toEqual(['ai-1', 'ai-2']);
    expect(session.runTool('brick_export', { format: 'ldraw' })).toMatchObject({
      ok: true,
      data: expect.stringContaining('3001.dat'),
    });
    expect(session.runTool('brick_export', { format: 'json' })).toMatchObject({
      ok: true,
      data: { checks: { geometry: 'validated', strength: 'unknown', stock: 'unknown' } },
    });
  });
});
