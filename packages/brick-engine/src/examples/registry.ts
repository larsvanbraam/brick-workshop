import { BUILD_AREA, MAX_BUILD_AREA, placeBrick, validateAssembly } from '../core.ts';
import type { Assembly, Brick } from '../core.ts';
import { smoothAssembly } from '../smoothing.ts';
import type { ExampleDefinition, ExampleMetadata } from './types.ts';
import { courtyardHouse } from './courtyard-house.ts';
import { catalogSampler } from './catalog-sampler.ts';
import { seasideLighthouse } from './seaside-lighthouse.ts';
import { flowerStall } from './flower-stall.ts';
import { nordiskaMuseet } from './nordiska-museet.ts';
import { castle } from './castle.ts';
import { hillValley } from './hill-valley.ts';

export function createExampleRegistry(definitions: readonly ExampleDefinition[]) {
  const byId = new Map<string, ExampleDefinition>();
  const templates = new Map<string, Assembly>();
  for (const definition of definitions) {
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(definition.id) ||
      !definition.name.trim() ||
      !Number.isInteger(definition.expectedPieceCount) ||
      definition.expectedPieceCount < 0 ||
      (definition.buildArea !== undefined &&
        (!Number.isInteger(definition.buildArea) ||
          definition.buildArea < BUILD_AREA ||
          definition.buildArea > MAX_BUILD_AREA))
    )
      throw new Error(`Invalid example metadata: ${definition.id}`);
    if (byId.has(definition.id)) throw new Error(`Duplicate example ID: ${definition.id}`);
    byId.set(definition.id, definition);
  }
  const examples: readonly ExampleMetadata[] = Object.freeze(
    definitions.map(({ id, name, tags, expectedPieceCount, buildArea }) =>
      Object.freeze({
        id,
        name,
        tags: Object.freeze([...tags]),
        expectedPieceCount,
        ...(buildArea === undefined ? {} : { buildArea }),
      }),
    ),
  );
  return {
    examples,
    createAssembly(exampleId: string): Assembly {
      const definition = byId.get(exampleId);
      if (!definition) throw new Error(`Unknown example: ${exampleId}`);
      const template = templates.get(exampleId);
      if (template) return structuredClone(template);
      let assembly: Assembly = {
        name: definition.name,
        bricks: [],
        ...(definition.buildArea === undefined ? {} : { buildArea: definition.buildArea }),
      };
      const bricks: Brick[] = [];
      definition.build((partId, color, x, y, z, rotation = 0, facing, upsideDown, tilt) => {
        bricks.push({
          id: `${definition.brickIdPrefix ?? definition.name}-${bricks.length + 1}`,
          partId,
          color,
          x,
          y,
          z,
          rotation,
          ...(facing ? { facing } : {}),
          ...(upsideDown ? { upsideDown: true as const } : {}),
          ...(tilt ? { tilt } : {}),
        });
      });
      // Checking the finished build once keeps large examples linear; only a failing build is
      // replayed piece by piece, to name the first piece that breaks it.
      if (validateAssembly({ ...assembly, bricks }).length)
        for (const brick of bricks) {
          const result = placeBrick(assembly, brick);
          if (!result.ok)
            throw new Error(
              `${definition.id}: ${JSON.stringify({ brick, issues: result.issues })}`,
            );
          assembly = result.assembly;
        }
      assembly = { ...assembly, bricks };
      for (const pass of definition.smooth ?? []) {
        let serial = assembly.bricks.length;
        assembly = smoothAssembly(assembly, {
          ...pass,
          nextId: () => `${definition.brickIdPrefix ?? definition.name}-${++serial}`,
        }).assembly;
      }
      if (assembly.bricks.length !== definition.expectedPieceCount)
        throw new Error(
          `${definition.id}: expected ${definition.expectedPieceCount} pieces, got ${assembly.bricks.length}.`,
        );
      templates.set(exampleId, assembly);
      return structuredClone(assembly);
    },
  };
}

const registry = createExampleRegistry([
  courtyardHouse,
  catalogSampler,
  seasideLighthouse,
  flowerStall,
  nordiskaMuseet,
  castle,
  hillValley,
]);
export const EXAMPLES = registry.examples;
export const createExampleAssembly = registry.createAssembly;

export function createDemoAssembly(): Assembly {
  return createExampleAssembly('courtyard-house');
}
