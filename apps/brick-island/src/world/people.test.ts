import { describe, expect, it } from 'vite-plus/test';
import { farmAnimals } from '@brick-workshop/game/animals.ts';
import { residentById, residentsOf } from '@brick-workshop/game/npcs.ts';
import { FARM, FIELDS } from './map.ts';
import { islandTerrain } from './terrain.ts';

describe('Brick Island people', () => {
  it('gather in the towns of Brick Island', () => {
    const island = islandTerrain(7);
    let town = 0;
    for (let cz = 0; cz < 12; cz++)
      for (let cx = 0; cx < 12; cx++) {
        const people = residentsOf(island, cx, cz);
        if (people.length >= 2) town++;
        for (const person of people) {
          const column = island.column(Math.floor(person.x), Math.floor(person.z));
          expect(column.water).toBe(0);
        }
      }
    expect(town).toBeGreaterThan(0);
  });

  it('keep Brick Island farm animals on the farm, off its crops', () => {
    const island = islandTerrain(7);
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

  it('finds a resident again by their ID', () => {
    const terrain = islandTerrain(7);
    const someone = [10, 11, 12].flatMap((cz) => residentsOf(terrain, 10, cz))[0];
    expect(someone).toBeDefined();
    expect(residentById(terrain, someone.id)).toEqual(someone);
    expect(residentById(terrain, 'cow1')).toBeNull();
  });
});
