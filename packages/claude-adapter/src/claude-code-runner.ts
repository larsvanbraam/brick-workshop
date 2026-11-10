import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKResultMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { BUILD_SYSTEM_PROMPT, prepareBuild } from './runner.ts';
import type { BuildOptions } from './runner.ts';
import { BUILDER_TOOLS, MODEL_TOOLS } from './session.ts';
import type { BuilderSession } from './session.ts';

const SERVER_NAME = 'brick';

/**
 * Runs a build through the Claude Agent SDK, which authenticates with the local Claude Code
 * login (subscription) instead of ANTHROPIC_API_KEY. Built-in Claude Code tools, filesystem
 * settings, other MCP servers and session persistence are disabled; Claude only sees the
 * engine tools, served from an in-process MCP server backed by the same BuilderSession.
 */
export async function runClaudeCodeBuild(
  prompt: string,
  session: BuilderSession,
  options: BuildOptions = {},
) {
  const { maxTurns, model, content } = prepareBuild(prompt, session, options);
  const trace: { tool: string; ok: boolean; revision: number }[] = [];
  let turns = 0;
  // New input (including cache writes) and cache reads, which cost about a tenth as much.
  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;
  const result = (complete: boolean, reason: string, text: string) => ({
    complete,
    reason,
    text,
    turns,
    trace: [...trace],
    assembly: session.snapshot(),
    document: session.document(),
    usage: { inputTokens, cachedInputTokens, outputTokens },
  });
  if (options.signal?.aborted) return result(false, 'cancelled', 'Generation cancelled.');
  const controller = new AbortController();

  const server = new McpServer(
    { name: SERVER_NAME, version: '0.0.0' },
    { capabilities: { tools: {} } },
  );
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: MODEL_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: structuredClone(tool.input_schema) as { type: 'object' },
    })),
  }));
  server.server.setRequestHandler(CallToolRequestSchema, (request) => {
    if (controller.signal.aborted)
      return { content: [{ type: 'text', text: 'Generation cancelled.' }], isError: true };
    const response = session.runTool(request.params.name, request.params.arguments ?? {});
    trace.push({ tool: request.params.name, ok: response.ok, revision: response.revision });
    options.onProgress?.({
      type: 'tool',
      turn: turns,
      tool: request.params.name,
      ok: response.ok,
      revision: response.revision,
      pieces: session.snapshot().bricks.length,
    });
    return { content: [{ type: 'text', text: JSON.stringify(response) }], isError: !response.ok };
  });

  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  // In-process MCP servers require streaming input, so the prompt is a one-message iterable.
  async function* input(): AsyncGenerator<SDKUserMessage> {
    yield { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null };
  }
  let final: SDKResultMessage | undefined;
  let lastMessageId: string | undefined;
  try {
    for await (const message of query({
      prompt: input(),
      options: {
        model,
        maxTurns,
        systemPrompt: BUILD_SYSTEM_PROMPT,
        tools: [],
        mcpServers: { [SERVER_NAME]: { type: 'sdk', name: SERVER_NAME, instance: server } },
        strictMcpConfig: true,
        allowedTools: BUILDER_TOOLS.map((tool) => `mcp__${SERVER_NAME}__${tool.name}`),
        permissionMode: 'dontAsk',
        settingSources: [],
        persistSession: false,
        // brick_catalog returns ~35k tokens; Claude Code's default 25k MCP output cap would
        // divert it to a file that Claude cannot read without the disabled built-in tools.
        env: {
          ...process.env,
          ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
          MAX_MCP_OUTPUT_TOKENS: '100000',
        },
        abortController: controller,
      },
    })) {
      if (message.type === 'assistant' && message.parent_tool_use_id === null) {
        // Claude Code may split one model response into several messages sharing an ID.
        if (message.message.id !== lastMessageId) {
          lastMessageId = message.message.id;
          turns += 1;
          options.onProgress?.({ type: 'turn', turn: turns });
          const usage = message.message.usage;
          inputTokens += usage.input_tokens + (usage.cache_creation_input_tokens ?? 0);
          cachedInputTokens += usage.cache_read_input_tokens ?? 0;
          outputTokens += usage.output_tokens;
          options.onProgress?.({ type: 'usage', inputTokens, cachedInputTokens, outputTokens });
        }
        const text = message.message.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('\n');
        if (text) options.onProgress?.({ type: 'text', turn: turns, text });
      } else if (message.type === 'result') final = message;
    }
  } catch (error) {
    if (controller.signal.aborted) return result(false, 'cancelled', 'Generation cancelled.');
    // The SDK throws after yielding an error result (e.g. the turn limit); report that result.
    if (!final || final.subtype === 'success') throw error;
  } finally {
    options.signal?.removeEventListener('abort', abort);
    await server.close();
  }
  if (controller.signal.aborted) return result(false, 'cancelled', 'Generation cancelled.');
  if (!final) return result(false, 'incomplete-response', '');
  inputTokens = final.usage.input_tokens + final.usage.cache_creation_input_tokens;
  cachedInputTokens = final.usage.cache_read_input_tokens;
  outputTokens = final.usage.output_tokens;
  options.onProgress?.({ type: 'usage', inputTokens, cachedInputTokens, outputTokens });
  if (final.subtype === 'error_max_turns')
    return result(
      false,
      'turn-limit',
      'Claude reached the configured turn limit. The assembly is a partial result.',
    );
  if (final.subtype !== 'success') return result(false, final.subtype, final.errors.join('\n'));
  if (final.stop_reason === 'max_tokens') return result(false, 'output-limit', final.result);
  return result(
    !final.is_error,
    final.is_error ? 'error' : (final.stop_reason ?? 'end_turn'),
    final.result,
  );
}
