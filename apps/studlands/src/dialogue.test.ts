import { describe, expect, it } from 'vite-plus/test';
import { conversation, lineFor, personality } from './dialogue.ts';
import { residentById, residentsOf } from './npcs.ts';
import { createTerrain } from './world/worlds.ts';

describe('dialogue', () => {
  const day = { daytime: true, island: false };

  it('gives everyone a name and a conversation of their own, the same every time', () => {
    const someone = { seed: 5, figure: 'woman' as const };
    expect(personality(someone)).toEqual(personality(someone));
    const talker = { seed: 5, biome: 'meadow' as const, figure: 'woman' as const };
    expect(conversation(talker, day)).toEqual(conversation(talker, day));
    const lines = conversation(talker, day);
    expect(lines).toHaveLength(5);
    expect(new Set(lines).size).toBe(5);
  });

  it('carries on through the conversation, then repeats the farewell', () => {
    const talker = { seed: 9, biome: 'desert' as const, figure: 'man' as const };
    const lines = conversation(talker, day);
    expect(lineFor(talker, day, 0)).toBe(lines[0]);
    expect(lineFor(talker, day, 3)).toBe(lines[3]);
    expect(lineFor(talker, day, 12)).toBe(lines[4]);
  });

  it('names women and men to suit them', () => {
    const women = new Set<string>();
    const men = new Set<string>();
    for (let seed = 0; seed < 400; seed++) {
      women.add(personality({ seed, figure: 'woman' }).name);
      men.add(personality({ seed, figure: 'man' }).name);
    }
    expect(women.has('Lotte')).toBe(true);
    expect(women.has('Joost')).toBe(false);
    expect(men.has('Joost')).toBe(true);
    expect([...women].filter((name) => men.has(name))).toEqual([]);
  });

  it('finds a resident again by their ID', () => {
    const terrain = createTerrain(7, 'island');
    const someone = [10, 11, 12].flatMap((cz) => residentsOf(terrain, 10, cz))[0];
    expect(someone).toBeDefined();
    expect(residentById(terrain, someone.id)).toEqual(someone);
    expect(residentById(terrain, 'cow1')).toBeNull();
  });
});
