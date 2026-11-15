import { describe, expect, it } from 'vite-plus/test';
import { residentsOf, wanderRules } from './npcs.ts';
import { Terrain } from './world/terrain.ts';
import { createTerrain } from './world/worlds.ts';

describe('the people of Studlands', () => {
  const terrain = new Terrain(1234);
  const chunks: [number, number][] = [];
  for (let cz = -3; cz < 6; cz++) for (let cx = -3; cx < 6; cx++) chunks.push([cx, cz]);
  const everyone = chunks.flatMap(([cx, cz]) => residentsOf(terrain, cx, cz));

  it('live in some chunks but not all', () => {
    expect(everyone.length).toBeGreaterThan(chunks.length * 0.1);
    expect(everyone.length).toBeLessThan(chunks.length * 0.6);
  });

  it('are the same people whenever a chunk loads', () => {
    const again = new Terrain(1234);
    for (const [cx, cz] of chunks)
      expect(residentsOf(again, cx, cz)).toEqual(residentsOf(terrain, cx, cz));
  });

  it('live on dry open ground', () => {
    for (const person of everyone) {
      const column = terrain.column(Math.floor(person.x), Math.floor(person.z));
      expect(column.water).toBe(0);
      expect(['sea', 'river', 'rock', 'volcanic', 'lava']).not.toContain(column.biome);
      expect(person.ground).toBe(column.height);
    }
  });

  it('wear a variety of outfits', () => {
    const looks = new Set(everyone.map((person) => JSON.stringify(person.outfit)));
    expect(looks.size).toBe(everyone.length);
    expect(everyone.some((person) => person.outfit.headgear)).toBe(true);
  });

  it('are women and men, with faces and hair to suit', () => {
    const women = everyone.filter((person) => person.figure === 'woman');
    const men = everyone.filter((person) => person.figure === 'man');
    expect(women.length).toBeGreaterThan(0);
    expect(men.length).toBeGreaterThan(0);
    const womensFaces = ['3626bp02', '3626bp08', '3626bp09'];
    const womensHair = ['62696', '3625', '85974', '92083', '87990'];
    for (const person of everyone) {
      const woman = person.figure === 'woman';
      expect(womensFaces.includes(person.outfit.head)).toBe(woman);
      const hair = person.outfit.headgear?.part;
      if (hair && !['3624', '3878', '3833', '3629', '86035'].includes(hair))
        expect(womensHair.includes(hair)).toBe(woman);
    }
  });

  it('keep out of unloaded chunks and off cliffs', () => {
    const rules = wanderRules(terrain, 128, () => false);
    expect(rules.canWalk({ x: 0, z: 0 }, { x: 1, z: 0 })).toBe(false);
  });

  it('gather in the towns of Brick Island', () => {
    const island = createTerrain(7, 'island');
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
});
