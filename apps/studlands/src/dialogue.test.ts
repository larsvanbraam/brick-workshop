import { describe, expect, it } from 'vite-plus/test';
import { conversation, lineFor, personality } from './dialogue.ts';
import { residentById, residentsOf } from './npcs.ts';
import { createTerrain } from './world/worlds.ts';

describe('dialogue', () => {
  const day = { daytime: true, island: false };

  it('gives everyone a name and a conversation of their own, the same every time', () => {
    expect(personality(5)).toEqual(personality(5));
    const talker = { seed: 5, biome: 'meadow' as const };
    expect(conversation(talker, day)).toEqual(conversation(talker, day));
    const lines = conversation(talker, day);
    expect(lines).toHaveLength(5);
    expect(new Set(lines).size).toBe(5);
  });

  it('carries on through the conversation, then repeats the farewell', () => {
    const talker = { seed: 9, biome: 'desert' as const };
    const lines = conversation(talker, day);
    expect(lineFor(talker, day, 0)).toBe(lines[0]);
    expect(lineFor(talker, day, 3)).toBe(lines[3]);
    expect(lineFor(talker, day, 12)).toBe(lines[4]);
  });

  it('finds a resident again by their ID', () => {
    const terrain = createTerrain(7, 'island');
    const someone = [10, 11, 12].flatMap((cz) => residentsOf(terrain, 10, cz))[0];
    expect(someone).toBeDefined();
    expect(residentById(terrain, someone.id)).toEqual(someone);
    expect(residentById(terrain, 'cow1')).toBeNull();
  });
});
