/**
 * A slow, endless piano piece, written a few seconds ahead of where it is played. It knows
 * nothing about audio: it hands out notes with the time they start, and `music.ts` plays them.
 *
 * The piece is a string of sections, each a minute or two long: a four-chord progression played
 * round in one key with one texture (sparse chords, a wandering melody, rippling broken chords
 * or high bells). Between sections the progression, the texture, the tempo and now and then the
 * key change, always on a chord boundary and never all abruptly: a new key is a fifth away, so
 * most of its notes are shared; the tempo glides; the melody carries on from the note it was on.
 * The melody keeps to the key's pentatonic scale, which fits every chord, so nothing clashes.
 */

/** Day is bright and a little livelier; night turns to minor progressions and slows down. */
export type Mood = 'day' | 'night';

/** What plays over the chords: see `writeChord`. */
export type Texture = 'drift' | 'song' | 'ripple' | 'bells';
export const TEXTURES: readonly Texture[] = ['drift', 'song', 'ripple', 'bells'];

export interface Note {
  /** Seconds from the start of the piece. */
  time: number;
  /** MIDI note number: 60 is middle C. */
  midi: number;
  /** How hard the key is struck, 0 to 1. */
  velocity: number;
  /** Seconds until the key is let go and the damper falls. */
  length: number;
  part: 'bass' | 'chord' | 'melody';
}

export interface Section {
  /** Seconds from the start of the piece. */
  start: number;
  mood: Mood;
  /** Semitones above D, -5 to 6. */
  key: number;
  /** Which of the mood's progressions. */
  progression: number;
  texture: Texture;
}

/** D above middle C: the key sections are measured from. */
const HOME = 62;
/** The major pentatonic scale, which is also the relative minor's. */
export const SCALE = [0, 2, 4, 7, 9];

interface Chord {
  /** Semitones above the key. */
  root: number;
  /** Semitones above the chord's root. */
  tones: number[];
}

const MAJ7 = [0, 4, 7, 11];
const MAJ9 = [0, 4, 7, 11, 14];
const ADD9 = [0, 4, 7, 14];
const MIN7 = [0, 3, 7, 10];
const MIN9 = [0, 3, 7, 10, 14];
const MINADD9 = [0, 3, 7, 14];
const SUS = [0, 5, 7, 10];
const SUS6 = [0, 2, 7, 9];
const chord = (root: number, tones: number[]): Chord => ({ root, tones });

/** Four-chord progressions, roots in semitones above the key. */
export const PROGRESSIONS: Record<Mood, Chord[][]> = {
  day: [
    [chord(0, MAJ9), chord(9, MIN7), chord(5, MAJ7), chord(7, SUS6)], // I vi IV V
    [chord(5, MAJ7), chord(7, SUS), chord(4, MIN7), chord(9, MIN7)], // IV V iii vi
    [chord(0, ADD9), chord(7, SUS6), chord(9, MIN7), chord(5, ADD9)], // I V vi IV
    [chord(2, MIN9), chord(7, SUS), chord(0, MAJ7), chord(5, MAJ7)], // ii V I IV
  ],
  night: [
    [chord(9, MINADD9), chord(5, MAJ7), chord(2, MIN7), chord(4, MIN7)], // vi IV ii iii
    [chord(9, MIN7), chord(7, SUS), chord(5, MAJ7), chord(4, MIN7)], // vi V IV iii
    [chord(5, MAJ7), chord(9, MIN7), chord(2, MIN9), chord(9, MINADD9)], // IV vi ii vi
  ],
};

const TEMPO: Record<Mood, number> = { day: 66, night: 54 };
/** How far a section's tempo strays from its mood's, either way. */
const TEMPO_SPREAD = 5;
/** How much the tempo may change from one chord to the next, in beats a minute. */
const TEMPO_GLIDE = 1.5;
const BEATS_PER_CHORD = 8;
/** A section lasts this many chords, give or take. */
const SECTION_CHORDS = [8, 12];

/** Each texture's melody: its range, how often it plays and how loud. */
const MELODY: Record<
  Texture,
  { low: number; high: number; density: number; velocity: number; rests: number }
> = {
  drift: { low: 64, high: 81, density: 0.55, velocity: 0.26, rests: 0.35 },
  song: { low: 66, high: 86, density: 1, velocity: 0.3, rests: 0.12 },
  ripple: { low: 69, high: 88, density: 0.5, velocity: 0.26, rests: 0.3 },
  bells: { low: 76, high: 93, density: 0.45, velocity: 0.2, rests: 0.25 },
};

const pitchClass = (midi: number) => ((midi % 12) + 12) % 12;
/** The note of `pitch` class nearest above `floor`. */
const above = (floor: number, pitch: number) => floor + pitchClass(pitch - floor);

/** A small, fast seeded random source (mulberry32), so a seed always plays the same piece. */
export function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Composer {
  /** The mood the next chord is written in; a change starts a new section from that chord. */
  mood: Mood;
  /** The sections played so far, the latest last (only the most recent are kept). */
  readonly sections: Section[] = [];
  private readonly rand: () => number;
  /** Notes written but not yet taken, in order of time. */
  private queue: Note[] = [];
  /** When the next chord starts, in seconds. */
  private next = 0;
  private section!: Section;
  /** Chords left in this section, and which of its four is next. */
  private left = 0;
  private chord = 0;
  private tempo: number;
  private target: number;
  /** The melody's last note, so it moves on by steps from there, even into a new key. */
  private pitch = 74;

  constructor(seed = 1, mood: Mood = 'day') {
    this.rand = random(seed);
    this.mood = mood;
    this.tempo = this.target = TEMPO[mood];
  }

  /** The notes that start before `until` seconds, in order; each is handed out once. */
  take(until: number): Note[] {
    while (this.next <= until) this.writeChord();
    const due = this.queue.filter((note) => note.time < until);
    this.queue = this.queue.filter((note) => note.time >= until);
    return due;
  }

  private pick<T>(items: readonly T[], not?: T) {
    const choices = items.length > 1 && not !== undefined ? items.filter((i) => i !== not) : items;
    return choices[Math.floor(this.rand() * choices.length)];
  }

  /** Starts the next section: something changes, but not everything at once. */
  private newSection() {
    const { rand, mood } = this;
    const last = this.sections.at(-1);
    const progressions = PROGRESSIONS[mood].map((_, i) => i);
    let key = last?.key ?? 0;
    let texture: Texture = last ? this.pick(TEXTURES, last.texture) : 'drift';
    let progression = this.pick(progressions, last?.progression);
    if (last && last.mood !== mood) {
      // A change of mood keeps the key and the texture: only the chords turn.
      texture = last.texture;
      progression = this.pick(progressions);
    } else if (last && rand() < 0.35) {
      // Up or down a fifth, staying within half an octave of home.
      key += rand() < 0.5 ? 7 : -7;
      key = ((((key + 5) % 12) + 12) % 12) - 5;
    }
    this.section = { start: this.next, mood, key, progression, texture };
    this.sections.push(this.section);
    if (this.sections.length > 64) this.sections.shift();
    this.left =
      SECTION_CHORDS[0] + Math.floor(rand() * (SECTION_CHORDS[1] - SECTION_CHORDS[0] + 1));
    this.chord = 0;
    this.target = TEMPO[mood] + (rand() * 2 - 1) * TEMPO_SPREAD;
  }

  private writeChord() {
    if (!this.left || this.section.mood !== this.mood) this.newSection();
    const { rand, section } = this;
    this.tempo += Math.max(-TEMPO_GLIDE, Math.min(TEMPO_GLIDE, this.target - this.tempo));
    const beat = 60 / this.tempo;
    const start = this.next;
    const span = BEATS_PER_CHORD * beat;
    const key = HOME + section.key;
    const { root, tones } = PROGRESSIONS[section.mood][section.progression][this.chord % 4];
    const notes: Note[] = [];
    const add = (note: Note) => notes.push(note);

    // The root low in the bass, held through the chord.
    add({
      time: start,
      midi: above(38, key + root),
      velocity: 0.5 + rand() * 0.1,
      length: span,
      part: 'bass',
    });
    // Three of the chord's tones round middle C.
    const voicing = tones.map((tone) => above(50, key + root + tone));
    while (voicing.length > 3) voicing.splice(1 + Math.floor(rand() * (voicing.length - 1)), 1);
    voicing.sort((a, b) => a - b);

    if (section.texture === 'ripple') {
      // Broken chords: the voicing up and back down, a note a beat, with an octave on top.
      const pattern = [...voicing, voicing[0] + 12, ...voicing.slice(1).reverse()];
      for (let i = 0; i < BEATS_PER_CHORD; i++)
        add({
          time: start + i * beat + (rand() - 0.5) * 0.03,
          midi: pattern[i % pattern.length],
          velocity: (i % 4 === 0 ? 0.24 : 0.17) + rand() * 0.05,
          length: beat * 2.5,
          part: 'chord',
        });
    } else {
      // Rolled upwards, slowly at night and under bells, which want a held wash.
      const slow = section.mood === 'night' || section.texture === 'bells';
      let roll = start + 0.02;
      for (const midi of voicing) {
        roll += (slow ? 0.12 : 0.05) + rand() * 0.1;
        add({
          time: roll,
          midi,
          velocity: 0.22 + rand() * 0.1,
          length: span * 0.95,
          part: 'chord',
        });
      }
    }

    // The melody: phrases on the half-beat grid with rests between, now and then sitting out a
    // chord, and always sitting out the last of a section so the change breathes.
    const melody = MELODY[section.texture];
    const scale: number[] = [];
    for (let midi = melody.low; midi <= melody.high; midi++)
      if (SCALE.includes(pitchClass(midi - key))) scale.push(midi);
    if (this.left > 1 && rand() > melody.rests) {
      let at = start + beat * (1 + Math.floor(rand() * 3));
      // Carry on from the last note, moved to the nearest note of this key and range.
      let step = 0;
      for (let i = 1; i < scale.length; i++)
        if (Math.abs(scale[i] - this.pitch) < Math.abs(scale[step] - this.pitch)) step = i;
      while (at < start + span - beat * 0.5) {
        const move = rand();
        step += move < 0.35 ? -1 : move < 0.7 ? 1 : move < 0.82 ? -2 : move < 0.94 ? 2 : 0;
        // Turn back short of the range's edges.
        step = Math.max(1, Math.min(scale.length - 2, step));
        this.pitch = scale[step];
        add({
          time: at + (rand() - 0.5) * 0.04,
          midi: this.pitch,
          velocity: melody.velocity + rand() * 0.2,
          length: beat * (1.5 + rand() * 2),
          part: 'melody',
        });
        const gaps = [0.5, 1, 1, 1.5, 2, 2, 3];
        at += (this.pick(gaps) / melody.density) * beat;
      }
    }

    this.queue.push(...notes);
    this.queue.sort((a, b) => a.time - b.time);
    this.next = start + span;
    this.chord++;
    this.left--;
  }
}
