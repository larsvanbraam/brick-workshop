import Anthropic from '@anthropic-ai/sdk';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { importPhysicalData } from '@lego-builder/brick-engine';
import { createBuilderSession, runClaudeBuild } from './index.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: 'boolean', short: 'h' },
    out: { type: 'string' },
    input: { type: 'string' },
    model: { type: 'string' },
    'max-turns': { type: 'string' },
    'allow-unverified-colors': { type: 'boolean' },
    'physical-data': { type: 'string' },
    'no-mass-estimates': { type: 'boolean' },
    'no-catalog-masses': { type: 'boolean' },
  },
});

if (values.help) {
  console.log(
    'Usage: pnpm claude:build "Build a small bridge" [--out output/bridge] [--input assembly.json] [--model MODEL_ID] [--max-turns 12] [--allow-unverified-colors] [--physical-data measurements.json] [--no-mass-estimates] [--no-catalog-masses]\nRequires ANTHROPIC_API_KEY in the local environment. Sends prompt, assembly and tool-returned physical data to Anthropic. API usage is billed. By default uses catalogue-reported nominal weights, with explicit solid-envelope estimates only for missing masses, and rejects model-infeasible edits. Missing strength remains unknown. No browser secrets or model-controlled file paths.',
  );
} else {
  const prompt = positionals.join(' ').trim();
  if (!prompt) throw new Error('Provide a build prompt. Use --help for usage.');
  if (!process.env.ANTHROPIC_API_KEY)
    throw new Error(
      'Set ANTHROPIC_API_KEY in your local environment. Never put it in a VITE_ variable or a browser bundle.',
    );
  const maxTurns = Number(values['max-turns'] ?? 12);
  if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 32)
    throw new Error('--max-turns must be 1-32.');
  let initial: unknown;
  if (values.input) {
    const text = await readFile(values.input, 'utf8');
    if (text.length > 2_000_000) throw new Error('Input must be smaller than 2 MB.');
    const input = JSON.parse(text) as unknown;
    initial = input && typeof input === 'object' && 'assembly' in input ? input.assembly : input;
  }
  let physicalData;
  if (values['physical-data']) {
    const text = await readFile(values['physical-data'], 'utf8');
    if (text.length > 2_000_000) throw new Error('Physical data must be smaller than 2 MB.');
    physicalData = importPhysicalData(JSON.parse(text));
  }
  const session = createBuilderSession(initial, {
    requireObservedColors: !values['allow-unverified-colors'],
    physical: {
      data: physicalData,
      estimateMissingMasses: !values['no-mass-estimates'],
      useCatalogMasses: !values['no-catalog-masses'],
    },
  });
  const client = new Anthropic({ timeout: 60_000, maxRetries: 0 });
  const result = await runClaudeBuild(
    prompt,
    session,
    (request) => client.messages.create(request),
    { model: values.model ?? process.env.CLAUDE_MODEL, maxTurns },
  );
  const directory = resolve(values.out ?? 'output/claude-build');
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, 'assembly.json'),
    `${JSON.stringify({ ...result.document, run: { complete: result.complete, reason: result.reason, text: result.text, usage: result.usage, trace: result.trace } }, null, 2)}\n`,
  );
  const ldraw = session.runTool('brick_export', { format: 'ldraw' });
  if (!ldraw.ok) throw new Error(ldraw.error.message);
  await writeFile(resolve(directory, 'assembly.ldr'), ldraw.data as string);
  console.log(
    `${result.complete ? 'Finished' : 'Partial result'}: ${result.reason}\n${result.text}\n${result.assembly.bricks.length} pieces; ${result.usage.inputTokens} input / ${result.usage.outputTokens} output tokens.\nExports: ${directory}`,
  );
  if (!result.complete) process.exitCode = 2;
}
