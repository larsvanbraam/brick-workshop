import type Anthropic from '@anthropic-ai/sdk';
import { BUILDER_TOOLS } from './session.ts';
import type { BuilderSession } from './session.ts';

export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5-5';
export type ClaudeTransport = (
  request: Anthropic.MessageCreateParamsNonStreaming,
) => Promise<Anthropic.Message>;

const system = `You plan LEGO assemblies through a deterministic engine. Use brick_catalog before placing pieces. Prefer brick_candidates to obtain engine-validated coordinates and host-policy results; use brick_connection to inspect existing supports. Candidate IDs are temporary, not successful mutations. Never invent parts, color IDs, positions, connections, stock availability, or successful mutations. Follow the host's requireObservedColors policy; rendering recognition is not manufacturing evidence. All pieces are upright; X/Z are studs at the minimum reserved-footprint corner, Y is plate units, all in increments of 0.5; one brick is three plates. Baseplates are half a plate thick and must remain grounded. Follow engine-owned connector offsets and matchingInsertFrameId exceptions; hinges remain static and other openings are reserved collision space. Elevated pieces need grounded matching stud support or an explicitly reviewed insert frame. Execute dependencies bottom-up and removals top-down, using returned piece IDs. Read tool errors and revise the plan; only successful tool results change the assembly. Physical rejection is based on the host's selected mass and strength model; do not override or invent mass or connection limits. Call brick_physics before declaring a build finished. Report whether masses are measured, catalogue-reported, estimated, mixed or missing, whether gravity needs clutch tension, and remaining unknowns. Catalogue weights are nominal observations, not independently measured exact-piece masses; preserve their source and variant mappings. Solid-envelope estimates are not actual part weights. Static balance and supplied tensile limits do not certify bending, shear, compression strength, disturbance resistance or real assembly access. Use only the provided engine tools, never code, shell commands, network requests, or file paths. End with a concise account of what was built and remaining limitations. Never claim that unknown physical feasibility is safe or certified.`;

const patchInstructions = `For multi-piece changes, prefer brick_preview_patch before brick_apply_patch. Supply the current expectedRevision from tool results and refresh the plan after revision_conflict. Additions propose unique IDs that become real only after a successful commit; updates preserve existing IDs. Patch operations describe a final arrangement, not a physical construction order. Never claim that atomic acceptance verifies intermediate stability or construction access. Declared personal inventory quantities are not marketplace stock or independently authenticated evidence. Host policy cannot be changed through patch tools.`;

const techniqueInstructions = `When planning foundations, walls or reinforcement, use brick_techniques with the relevant id or topic before choosing placements. Load only relevant guidance rather than every guide. Techniques are advisory connectivity heuristics; engine capabilities, host policies and tool results remain authoritative. Reference examples are separate assemblies: adapt their geometry to the current build using brick_candidates and patch previews, and never assume their illustrative IDs already exist. Never treat a seam bridge or staggered joint as measured strength, a guaranteed stud-count rule, verified construction order or build certification. Do not extend these upright guides into unsupported sideways, clip, moving-hinge or Technic techniques.`;

export async function runClaudeBuild(
  prompt: string,
  session: BuilderSession,
  transport: ClaudeTransport,
  options: { model?: string; maxTurns?: number } = {},
) {
  const maxTurns = options.maxTurns ?? 12;
  const model = options.model ?? DEFAULT_CLAUDE_MODEL;
  if (!prompt.trim() || prompt.length > 20_000)
    throw new Error('Prompt must contain 1-20,000 characters.');
  if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 32)
    throw new Error('Turn limit must be 1-32.');
  if (!model.trim()) throw new Error('A model ID is required.');
  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `${prompt}\n\nInitial engine assembly:\n${JSON.stringify(session.snapshot())}`,
    },
  ];
  const trace: { tool: string; ok: boolean; revision: number }[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  const result = (complete: boolean, reason: string, text: string, turns: number) => ({
    complete,
    reason,
    text,
    turns,
    trace: [...trace],
    assembly: session.snapshot(),
    document: session.document(),
    usage: { inputTokens, outputTokens },
  });
  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const response = await transport({
      model,
      max_tokens: 4096,
      stream: false,
      system: `${system}\n${patchInstructions}\n${techniqueInstructions}`,
      tools: BUILDER_TOOLS.map((tool) => structuredClone(tool)),
      messages: structuredClone(messages),
    });
    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    if (response.stop_reason === 'max_tokens') return result(false, 'output-limit', text, turn);
    const calls = response.content.filter((block) => block.type === 'tool_use');
    if (!calls.length)
      return result(
        response.stop_reason === 'end_turn',
        response.stop_reason ?? 'incomplete-response',
        text,
        turn,
      );
    if (
      response.stop_reason !== 'tool_use' ||
      new Set(calls.map((call) => call.id)).size !== calls.length ||
      calls.some((call) => !call.id)
    )
      return result(false, 'invalid-tool-response', text, turn);
    messages.push({ role: 'assistant', content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const call of calls) {
      const response = session.runTool(call.name, call.input);
      trace.push({ tool: call.name, ok: response.ok, revision: response.revision });
      results.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: JSON.stringify(response),
        is_error: !response.ok,
      });
    }
    messages.push({ role: 'user', content: results });
  }
  return result(
    false,
    'turn-limit',
    'Claude reached the configured turn limit. The assembly is a partial result.',
    maxTurns,
  );
}
