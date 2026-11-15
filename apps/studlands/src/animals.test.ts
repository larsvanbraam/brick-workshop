import { describe, expect, it } from 'vite-plus/test';
import { ANIMAL_PARTS } from '@brick-workshop/render/animal-parts';
import { SPECIES, farmAnimals, wildlifeOf } from './animals.ts';
import { FARM, FIELDS } from './world/island/map.ts';
import { Terrain } from './world/terrain.ts';
import { createTerrain } from './world/worlds.ts';

describe('the animals', () => {
  it('are all drawn from parts the library ships', () => {
    for (const kind of Object.values(SPECIES))
      for (const { part } of kind.parts) expect(ANIMAL_PARTS).toContain(part);
  });

  it('live wild in some chunks, on dry ground that suits them, the same every time', () => {
    const terrain = new Terrain(1234);
    const again = new Terrain(1234);
    let found = 0;
    for (let cz = -4; cz < 6; cz++)
      for (let cx = -4; cx < 6; cx++) {
        const animals = wildlifeOf(terrain, cx, cz);
        expect(wildlifeOf(again, cx, cz)).toEqual(animals);
        found += animals.length;
        for (const animal of animals)
          expect(terrain.column(Math.floor(animal.x), Math.floor(animal.z)).water).toBe(0);
        // A group is one kind.
        expect(new Set(animals.map((animal) => animal.species.name)).size).toBeLessThanOrEqual(1);
      }
    expect(found).toBeGreaterThan(0);
  });

  it('keep Brick Island farm animals on the farm, off its crops', () => {
    const island = createTerrain(7, 'island');
    const animals = farmAnimals(island, FARM);
    const kinds = new Set(animals.map((animal) => animal.species.name));
    for (const kind of ['cow', 'pig', 'lamb', 'chicken', 'horse']) expect(kinds).toContain(kind);
    for (const animal of animals) {
      expect(animal.x).toBeGreaterThan(FARM.x0);
      expect(animal.x).toBeLessThan(FARM.x1);
      expect(animal.z).toBeGreaterThan(FARM.z0);
      expect(animal.z).toBeLessThan(FARM.z1);
      const onCrops = FIELDS.some(
        (field) =>
          animal.x >= field.x0 &&
          animal.x < field.x1 &&
          animal.z >= field.z0 &&
          animal.z < field.z1,
      );
      expect(onCrops).toBe(false);
    }
  });
});
