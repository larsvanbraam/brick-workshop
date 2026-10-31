import { describe, expect, it } from 'vite-plus/test';
import { validateAssembly } from '@lego-builder/brick-engine';
import { createBuilderSession, runClaudeBuild } from './index.ts';
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
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 10 });
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
    expect(() => createBuilderSession({ name: 'Bad board', bricks: [], buildArea: 65 })).toThrow(
      'Invalid initial assembly',
    );
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
    const catalogue = createBuilderSession().runTool('brick_catalog', {});
    expect(catalogue).toMatchObject({
      ok: true,
      data: {
        parts: expect.arrayContaining([
          expect.objectContaining({ id: '2453b', height: 15, family: 'tall', shape: 'box' }),
          expect.objectContaining({
            id: '3039',
            family: 'slope',
            shape: 'slope',
            contactPhysics: 'not-assessed',
          }),
          expect.objectContaining({
            id: '3062b',
            family: 'round',
            shape: 'round',
            contactPhysics: 'not-assessed',
          }),
        ]),
      },
    });
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
    expect(session.runTool('brick_catalog', {})).toMatchObject({
      ok: true,
      data: {
        parts: expect.arrayContaining([
          expect.objectContaining({
            id: '87079',
            kind: 'tile',
            connections: { topStuds: [], bottomReceivers: expect.any(Array) },
            observedColors: expect.arrayContaining([4]),
          }),
        ]),
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
