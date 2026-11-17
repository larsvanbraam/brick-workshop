import { describe, expect, it } from 'vite-plus/test';
import { ANIMAL_PARTS } from '@brick-workshop/render/animal-parts';
import { ANIMAL_WORDS, SPECIES, pettable, wildlifeOf } from './animals.ts';
import { NOISE_WORLD } from './world/noise-world.ts';
import { Terrain } from './world/terrain.ts';

describe('the animals', () => {
  it('are all drawn from parts the library ships', () => {
    for (const kind of Object.values(SPECIES))
      for (const { part } of kind.parts) expect(ANIMAL_PARTS).toContain(part);
  });

  it('live wild in some chunks, on dry ground that suits them, the same every time', () => {
    const terrain = new Terrain(1234, NOISE_WORLD);
    const again = new Terrain(1234, NOISE_WORLD);
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
});

describe('petting', () => {
  it('works on every animal, each with words in both languages', () => {
    for (const kind of Object.values(SPECIES)) {
      expect(pettable(kind)).toBe(true);
      expect(ANIMAL_WORDS[kind.name].nl).toBeTruthy();
    }
  });
});
