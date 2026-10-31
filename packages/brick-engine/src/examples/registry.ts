import { BUILD_AREA, MAX_BUILD_AREA, placeBrick } from '../core.ts';
import type { Assembly } from '../core.ts';
import type { ExampleDefinition, ExampleMetadata } from './types.ts';
import { courtyardHouse } from './courtyard-house.ts';
import { catalogSampler } from './catalog-sampler.ts';

export function createExampleRegistry(definitions: readonly ExampleDefinition[]) {
  const byId = new Map<string, ExampleDefinition>();
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
      let assembly: Assembly = {
        name: definition.name,
        bricks: [],
        ...(definition.buildArea === undefined ? {} : { buildArea: definition.buildArea }),
      };
      definition.build((partId, color, x, y, z, rotation = 0) => {
        const result = placeBrick(assembly, {
          id: `${definition.brickIdPrefix ?? definition.name}-${assembly.bricks.length + 1}`,
          partId,
          color,
          x,
          y,
          z,
          rotation,
        });
        if (!result.ok) throw new Error(`${definition.id}: ${JSON.stringify(result.issues)}`);
        assembly = result.assembly;
      });
      if (assembly.bricks.length !== definition.expectedPieceCount)
        throw new Error(
          `${definition.id}: expected ${definition.expectedPieceCount} pieces, got ${assembly.bricks.length}.`,
        );
      return assembly;
    },
  };
}

const registry = createExampleRegistry([courtyardHouse, catalogSampler]);
export const EXAMPLES = registry.examples;
export const createExampleAssembly = registry.createAssembly;

export function createDemoAssembly(): Assembly {
  return createExampleAssembly('courtyard-house');
}
