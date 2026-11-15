import { describe, expect, it } from 'vite-plus/test';
import { Composer, PROGRESSIONS, SCALE } from './composer.ts';
import type { Section } from './composer.ts';

const pitchClass = (midi: number) => ((midi % 12) + 12) % 12;
/** The section a time falls in. */
const sectionAt = (sections: Section[], time: number) =>
  sections.findLast((section) => section.start <= time)!;

describe('the composer', () => {
  it('plays the same piece for the same seed, and another for another seed', () => {
    const a = new Composer(7).take(120);
    const b = new Composer(7).take(120);
    const c = new Composer(8).take(120);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('hands out notes in order, each once, whatever the steps it is asked in', () => {
    const whole = new Composer(3).take(90);
    const stepped = new Composer(3);
    const parts = [];
    for (let until = 0.25; until <= 90; until += 0.25) parts.push(...stepped.take(until));
    expect(parts).toEqual(whole);
    for (let i = 1; i < whole.length; i++)
      expect(whole[i].time).toBeGreaterThanOrEqual(whole[i - 1].time);
  });

  it('keeps notes on a piano and soft', () => {
    for (const note of new Composer(11).take(1200)) {
      expect(note.midi).toBeGreaterThanOrEqual(38);
      expect(note.midi).toBeLessThanOrEqual(93);
      expect(note.velocity).toBeGreaterThan(0);
      expect(note.velocity).toBeLessThanOrEqual(0.6);
      expect(note.length).toBeGreaterThan(0);
    }
  });

  it('changes texture, progression and key every minute or two, over twenty minutes', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const composer = new Composer(seed);
      composer.take(20 * 60);
      const { sections } = composer;
      expect(sections.length).toBeGreaterThanOrEqual(10);
      expect(new Set(sections.map((s) => s.texture)).size).toBeGreaterThanOrEqual(3);
      expect(new Set(sections.map((s) => s.progression)).size).toBeGreaterThanOrEqual(3);
      expect(new Set(sections.map((s) => s.key)).size).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < sections.length; i++) {
        const [last, next] = [sections[i - 1], sections[i]];
        // Each change brings a new texture, and a new key only ever a fifth away.
        expect(next.texture).not.toBe(last.texture);
        expect([0, 5, 7]).toContain(pitchClass(next.key - last.key));
        // Sections last long enough to settle in: at least eight chords.
        expect(next.start - last.start).toBeGreaterThan(40);
      }
    }
  });

  it('changes seamlessly: no silences, and the tempo glides', () => {
    const notes = new Composer(9).take(30 * 60);
    for (let i = 1; i < notes.length; i++)
      expect(notes[i].time - notes[i - 1].time).toBeLessThan(10);
    const chords = notes.filter((note) => note.part === 'bass').map((note) => note.time);
    for (let i = 2; i < chords.length; i++) {
      const [a, b] = [chords[i - 1] - chords[i - 2], chords[i] - chords[i - 1]];
      // 1.5 beats a minute at most from one chord to the next.
      expect(Math.abs(480 / a - 480 / b)).toBeLessThanOrEqual(1.5 + 1e-9);
    }
  });

  it('writes the melody in its key’s pentatonic scale, so it fits every chord', () => {
    const composer = new Composer(5);
    const melody = composer.take(20 * 60).filter((note) => note.part === 'melody');
    expect(melody.length).toBeGreaterThan(150);
    for (const note of melody) {
      const { key } = sectionAt(composer.sections, note.time);
      expect(SCALE).toContain(pitchClass(note.midi - 62 - key));
    }
  });

  it('moves the melody on by steps, even across a change of section', () => {
    const melody = new Composer(6).take(20 * 60).filter((note) => note.part === 'melody');
    const leaps = melody.filter((note, i) => i && Math.abs(note.midi - melody[i - 1].midi) > 7);
    // Only a change of texture to a higher or lower range may leap.
    expect(leaps.length).toBeLessThan(melody.length * 0.02);
  });

  it('turns to a night progression in the same key, more slowly, from the next chord', () => {
    const composer = new Composer(2);
    composer.take(1);
    const day = composer.sections[0];
    composer.mood = 'night';
    const notes = composer.take(10 * 60);
    const night = composer.sections[1];
    expect(night.mood).toBe('night');
    expect(night.key).toBe(day.key);
    expect(night.texture).toBe(day.texture);
    // The first night chord's root is the bass, in the night progression.
    const bass = notes.find((note) => note.part === 'bass' && note.time >= night.start)!;
    const root = PROGRESSIONS.night[night.progression][0].root;
    expect(pitchClass(bass.midi - 62 - night.key)).toBe(root);
    // Once settled, night chords last 8 beats at 49 to 59 a minute.
    const chords = notes.filter((note) => note.part === 'bass').map((note) => note.time);
    const late = chords.at(-1)! - chords.at(-2)!;
    expect(480 / late).toBeGreaterThanOrEqual(49 - 1e-9);
    expect(480 / late).toBeLessThanOrEqual(59 + 1e-9);
  });
});
