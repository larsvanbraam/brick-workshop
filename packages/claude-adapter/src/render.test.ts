import { describe, expect, it } from 'vite-plus/test';
import sharp from 'sharp';
import type Anthropic from '@anthropic-ai/sdk';
import { createDemoAssembly } from '@brick-workshop/engine';
import { createBuilderSession, runClaudeBuild, splitToolImage } from './index.ts';
import type { BuilderToolResult, ClaudeTransport } from './index.ts';
import { RENDER_VIEWS, renderAssembly } from './render.ts';

type RenderData = {
  view: string;
  pieces: number;
  width: number;
  height: number;
  image: { mediaType: string; data: string };
};

async function pixels(data: string) {
  const { data: raw, info } = await sharp(Buffer.from(data, 'base64'))
    .raw()
    .toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => {
    const offset = (Math.round(y) * info.width + Math.round(x)) * info.channels;
    return [raw[offset], raw[offset + 1], raw[offset + 2]];
  };
  return { info, at };
}

const isRed = ([r, g, b]: number[]) => r > 120 && g < 60 && b < 60;

describe('brick_render', () => {
  // A red 2 x 4 brick in the middle of the board with a blue plate behind it.
  const session = () => {
    const builder = createBuilderSession();
    expect(
      builder.runTool('brick_place', {
        partId: '3001',
        color: 4,
        x: 7,
        y: 0,
        z: 7,
        rotation: 0,
      }).ok,
    ).toBe(true);
    expect(
      builder.runTool('brick_place', {
        partId: '3020',
        color: 1,
        x: 7,
        y: 0,
        z: 3,
        rotation: 0,
      }).ok,
    ).toBe(true);
    return builder;
  };

  it('returns a PNG of the build from the requested side', async () => {
    const builder = session();
    const front = builder.runTool('brick_render', { view: 'front' }) as BuilderToolResult & {
      data: RenderData;
    };
    expect(front.ok).toBe(true);
    expect(front.data).toMatchObject({
      view: 'front',
      pieces: 2,
      image: { mediaType: 'image/png' },
    });
    const image = await pixels(front.data.image.data);
    expect([image.info.width, image.info.height]).toEqual([front.data.width, front.data.height]);
    expect(Math.max(image.info.width, image.info.height)).toBe(768);
    // The brick fills the middle of the front view; the plate behind it is hidden.
    expect(isRed(image.at(image.info.width / 2, image.info.height * 0.6))).toBe(true);

    // From above, the blue plate shows behind (above) the red brick.
    const top = builder.runTool('brick_render', { view: 'top' }) as { data: RenderData };
    const above = await pixels(top.data.image.data);
    const column = Array.from({ length: above.info.height }, (_, y) =>
      above.at(above.info.width / 2, y),
    );
    const firstBlue = column.findIndex(([r, , b]) => b > 120 && r < 80);
    const firstRed = column.findIndex(isRed);
    expect(firstBlue).toBeGreaterThan(0);
    expect(firstRed).toBeGreaterThan(firstBlue);

    // A region leaves out pieces outside it.
    const region = builder.runTool('brick_render', {
      view: 'iso',
      region: { maxZ: 5 },
    }) as { data: RenderData };
    expect(region.data.pieces).toBe(1);
    const plate = await pixels(region.data.image.data);
    const all = Array.from({ length: plate.info.width * plate.info.height }, (_, index) =>
      plate.at(index % plate.info.width, Math.floor(index / plate.info.width)),
    );
    expect(all.some(isRed)).toBe(false);
  });

  it('rejects unknown views and renders every view of the demo build', () => {
    expect(session().runTool('brick_render', { view: 'below' }).ok).toBe(false);
    const demo = createDemoAssembly();
    for (const view of RENDER_VIEWS) {
      const render = renderAssembly(demo, { view, size: 256 });
      expect(render.pieces).toBe(demo.bricks.length);
      expect(render.png.subarray(1, 4).toString('ascii')).toBe('PNG');
    }
  });

  it('splits the image from the result so it travels as an image block', async () => {
    const response = session().runTool('brick_render', {});
    const { response: rest, image } = splitToolImage(response);
    expect(image?.mediaType).toBe('image/png');
    expect(JSON.stringify(rest)).not.toContain(image!.data);
    expect(splitToolImage({ ok: true, revision: 0, data: { pieces: 1 } }).image).toBeUndefined();

    const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const responses: Anthropic.Message[] = [
      {
        id: 'render',
        type: 'message',
        role: 'assistant',
        model: 'test-model',
        content: [
          {
            type: 'tool_use',
            id: 'look',
            name: 'brick_render',
            input: { view: 'back' },
            caller: { type: 'direct' },
          },
        ],
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      } as Anthropic.Message,
      {
        id: 'done',
        type: 'message',
        role: 'assistant',
        model: 'test-model',
        content: [{ type: 'text', text: 'Looked.', citations: null }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      } as Anthropic.Message,
    ];
    const transport: ClaudeTransport = async (request) => {
      requests.push(request);
      return responses.shift()!;
    };
    const result = await runClaudeBuild('Look at it', session(), transport);
    expect(result.trace).toEqual([{ tool: 'brick_render', ok: true, revision: 2 }]);
    expect(requests[0].tools?.some((tool) => 'name' in tool && tool.name === 'brick_render')).toBe(
      true,
    );
    expect(requests[0].system).toContain('brick_render');
    const [toolResult] = requests[1].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
    const [text, picture] = toolResult.content as [
      Anthropic.TextBlockParam,
      Anthropic.ImageBlockParam,
    ];
    expect(JSON.parse(text.text)).toMatchObject({ ok: true, data: { view: 'back', pieces: 2 } });
    expect(text.text).not.toContain('"image"');
    expect(picture).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png' },
    });
  });
});
