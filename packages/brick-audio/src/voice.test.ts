import { describe, expect, it } from 'vite-plus/test';
import { babble, voiceFor } from './voice.ts';

describe('voices', () => {
  it('gives each seed its own voice, the same every time', () => {
    expect(voiceFor(7)).toEqual(voiceFor(7));
    expect(voiceFor(7)).not.toEqual(voiceFor(8));
    for (let seed = 0; seed < 50; seed++) {
      const voice = voiceFor(seed);
      expect(voice.pitch).toBeGreaterThanOrEqual(95);
      expect(voice.pitch).toBeLessThanOrEqual(260);
    }
  });

  it('babbles a syllable for each of the line, longer for longer lines', () => {
    const voice = voiceFor(1);
    const short = babble('Hello!', voice);
    const long = babble('What a lovely day it is for a walk along the beach, is it not?', voice);
    expect(short.syllables).toHaveLength(2);
    expect(long.syllables.length).toBeGreaterThan(12);
    expect(long.length).toBeGreaterThan(short.length);
    expect(babble('Hello!', voice)).toEqual(short);
  });

  it('rises at the end of a question and falls at the end of a statement', () => {
    const voice = voiceFor(2);
    const question = babble('Are you new round here?', voice).syllables.at(-1)!;
    const statement = babble('You are new round here.', voice).syllables.at(-1)!;
    expect(question.to).toBeGreaterThan(question.from);
    expect(statement.to).toBeLessThan(statement.from);
  });
});
