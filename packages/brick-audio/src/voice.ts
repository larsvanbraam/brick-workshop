/**
 * Voices for the people of a game, made in the browser: either Simlish-like babble, synthesised
 * syllable by syllable from a buzzing source shaped into vowels, or the device's own speech.
 * No sound files.
 *
 * Browsers only start audio after the page is clicked or a key pressed, so call `speak` from a
 * click or key handler.
 */

/** How a voice speaks: either way of speaking reads the same traits. */
export interface VoiceTraits {
  /** The voice's pitch, in hertz, where its sentences start. */
  pitch: number;
  /** Syllables a second, about 1 for an even pace. */
  rate: number;
  /** Shifts the vowels up (a smaller head) or down, about 0.85 to 1.2. */
  formants: number;
  /** Picks among the device's voices, 0 to 1. */
  pick: number;
  /** High or low, so the device speaks in a voice to match. */
  register: VoiceRegister;
}

export type VoiceMode = 'simlish' | 'device' | 'off';

/** A small seeded 0 to 1 generator (mulberry32). */
export function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** A number from a string, for seeding. */
function hashText(text: string) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++)
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return hash >>> 0;
}

/** Whether a voice is high (a woman's, say) or low (a man's). */
export type VoiceRegister = 'high' | 'low';

/**
 * The voice someone with this seed speaks in: low or high, quick or slow. Pass `register` to
 * match the voice to who is speaking; otherwise about half are low voices and half high.
 */
export function voiceFor(seed: number, register?: VoiceRegister): VoiceTraits {
  const next = seeded(seed ^ 0x5eed);
  const roll = next();
  const high = register ? register === 'high' : roll < 0.5;
  return {
    pitch: high ? 190 + next() * 70 : 95 + next() * 50,
    rate: 0.85 + next() * 0.35,
    formants: high ? 1.05 + next() * 0.15 : 0.88 + next() * 0.12,
    pick: next(),
    register: high ? 'high' : 'low',
  };
}

/**
 * Device voices whose names say they are women's or men's. Browsers do not say which a voice is,
 * so this goes by the names of common system voices.
 */
const HIGH_VOICES =
  /female|woman|samantha|victoria|karen|moira|tessa|fiona|veena|zira|hazel|susan|ellen|claire|flo|sandy|shelley|grandma|kathy|amélie|amelie|anna|alice|joana|paulina|monica|sara|helena|nora|zuzana|yuna|ting-ting|mei-jia|sin-ji|kyoko|aria|jenny|libby|sonia|natasha/i;
const LOW_VOICES =
  /\bmale|\bman\b|daniel|alex|fred|rishi|david|mark|george|james|xander|thomas|reed|eddy|rocko|grandpa|ralph|albert|junior|aaron|arthur|gordon|oliver|guy|ryan|william|diego|jorge|juan|luca|yannick|maged|tarik|yuri/i;

/**
 * The device voices to speak in a register: those named as such, or every voice when the names
 * say nothing either way.
 */
export function deviceVoicesFor<T extends { name: string }>(voices: T[], register: VoiceRegister) {
  const match = register === 'high' ? HIGH_VOICES : LOW_VOICES;
  const other = register === 'high' ? LOW_VOICES : HIGH_VOICES;
  const named = voices.filter((entry) => match.test(entry.name) && !other.test(entry.name));
  if (named.length) return named;
  // Nothing named for this register: at least keep clear of the other one.
  const unnamed = voices.filter((entry) => !other.test(entry.name));
  return unnamed.length ? unnamed : voices;
}

/** Vowel formants, F1 and F2 in hertz: a, e, i, o, u and the "uh" of "but". */
const VOWELS: readonly (readonly [number, number])[] = [
  [730, 1090],
  [530, 1840],
  [300, 2250],
  [570, 840],
  [320, 900],
  [640, 1190],
];

/** One syllable of babble: its vowel, how it starts, and how long and how high it is. */
export interface Syllable {
  vowel: number;
  /** A hiss (s, sh, f), a pop (b, d, k) or a hum (m, n, l) before the vowel, or none. */
  onset: 'hiss' | 'pop' | 'hum' | null;
  /** Seconds from the start of the line. */
  at: number;
  length: number;
  /** The pitch at the start and end of the syllable, as shares of the voice's own. */
  from: number;
  to: number;
  /** Loudness, 0 to 1. */
  stress: number;
}

/** A word's syllables: its groups of vowels, at least one and at most four. */
function syllableCount(word: string) {
  const groups = word.toLowerCase().match(/[aeiouy]+/g)?.length ?? 0;
  return Math.max(1, Math.min(4, groups));
}

/**
 * The babble for a line: a syllable for each of its own, so a long line babbles long, with
 * pauses at its commas and stops and the pitch falling through a statement and rising at the end
 * of a question. The same line in the same voice always babbles alike.
 */
export function babble(
  text: string,
  voice: VoiceTraits,
): { syllables: Syllable[]; length: number } {
  const next = seeded(hashText(text) ^ Math.floor(voice.pick * 2 ** 31));
  const syllables: Syllable[] = [];
  // Sentences, each with its words.
  const sentences = text.match(/[^.!?]+[.!?]*/g) ?? [text];
  let at = 0;
  for (const sentence of sentences) {
    const end = sentence.trim().slice(-1);
    const words = sentence.split(/\s+/).filter((word) => /\w/.test(word));
    const total = words.reduce((sum, word) => sum + syllableCount(word), 0);
    let index = 0;
    for (const word of words) {
      const count = syllableCount(word);
      for (let part = 0; part < count; part++) {
        // Through the sentence the pitch drifts down, a little up and down on each syllable.
        const through = total > 1 ? index / (total - 1) : 0;
        let from = 1.08 - through * 0.18 + (next() - 0.5) * 0.18;
        let to = from + (next() - 0.5) * 0.12;
        const last = index === total - 1;
        if (last && end === '?') to = from * 1.35;
        else if (last && end === '!') {
          from *= 1.2;
          to = from * 0.85;
        } else if (last) to = from * 0.82;
        const length = (0.1 + next() * 0.07 + (last ? 0.08 : 0)) / voice.rate;
        const roll = next();
        syllables.push({
          vowel: Math.floor(next() * VOWELS.length),
          onset: roll < 0.3 ? 'hiss' : roll < 0.6 ? 'pop' : roll < 0.8 ? 'hum' : null,
          at,
          length,
          from,
          to,
          stress: part === 0 ? 1 : 0.75 + next() * 0.15,
        });
        at += length + 0.015;
        index++;
      }
      at += (/,|;|:/.test(word) ? 0.18 : 0.04) / voice.rate;
    }
    at += 0.28 / voice.rate;
  }
  return { syllables, length: Math.max(0, at - 0.28 / voice.rate) };
}

/**
 * Speaks lines in people's voices. One line at a time: a new one cuts off the last.
 */
export class Voices {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private playing: AudioScheduledSourceNode[] = [];
  private done: (() => void) | null = null;
  private utterance: SpeechSynthesisUtterance | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Counts lines, so a cut-off line's late end does not end the next one. */
  private line = 0;
  volume = 0.8;

  /** Whether the device can speak lines aloud itself. */
  static get deviceSpeech() {
    return (
      typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined'
    );
  }

  /**
   * Says `text` in `voice`, as babble or in the device's speech, and resolves once it is said,
   * or at once when off or cut off. `language` is a BCP 47 tag for the device's speech ("nl-NL"),
   * the browser's own when left out.
   */
  speak(text: string, voice: VoiceTraits, mode: VoiceMode, language?: string): Promise<void> {
    this.stop();
    this.line++;
    if (mode === 'off') return Promise.resolve();
    return new Promise((resolve) => {
      this.done = resolve;
      if (mode === 'device' && Voices.deviceSpeech) this.speakDevice(text, voice, language);
      else this.speakBabble(text, voice);
    });
  }

  /** Cuts off whatever is being said. */
  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const now = this.context?.currentTime ?? 0;
    for (const source of this.playing)
      try {
        source.stop(now + 0.02);
      } catch {
        // Already stopped.
      }
    this.playing = [];
    if (this.utterance) this.utterance.onend = this.utterance.onerror = null;
    this.utterance = null;
    if (Voices.deviceSpeech && (speechSynthesis.speaking || speechSynthesis.pending))
      speechSynthesis.cancel();
    this.finish();
  }

  dispose() {
    this.stop();
    void this.context?.close();
    this.context = null;
  }

  private finish() {
    const done = this.done;
    this.done = null;
    done?.();
  }

  private speakDevice(text: string, voice: VoiceTraits, tag?: string) {
    const utterance = new SpeechSynthesisUtterance(text);
    const wanted = tag ?? navigator.language ?? 'en';
    const language = wanted.slice(0, 2);
    // Without a voice installed for the language the browser still reads it in its closest one.
    utterance.lang = wanted;
    const installed = speechSynthesis
      .getVoices()
      .filter((entry) => entry.lang.startsWith(language));
    // Network voices (Chrome's "Google ..." ones) stall or cut off, so prefer the device's own.
    const local = installed.filter((entry) => entry.localService);
    const voices = deviceVoicesFor(local.length ? local : installed, voice.register);
    if (voices.length) utterance.voice = voices[Math.floor(voice.pick * voices.length)];
    // The babble's pitch, 95 to 260 Hz, onto the device's 0 to 2 around 1.
    utterance.pitch = Math.max(0.3, Math.min(1.8, 0.5 + (voice.pitch - 95) / 165));
    utterance.rate = voice.rate;
    utterance.volume = this.volume;
    const line = this.line;
    // Held on `this`: Chrome may collect an utterance still being said, and then it falls silent.
    this.utterance = utterance;
    utterance.onend = utterance.onerror = () => {
      if (line === this.line) this.finish();
    };
    // Chrome drops a line spoken in the same tick as a cancel, so let the cancel settle first.
    this.timer = setTimeout(() => {
      this.timer = null;
      if (line !== this.line) return;
      speechSynthesis.resume();
      speechSynthesis.speak(utterance);
    }, 60);
  }

  private speakBabble(text: string, voice: VoiceTraits) {
    if (typeof AudioContext === 'undefined') return this.finish();
    const context = (this.context ??= new AudioContext());
    void context.resume();
    if (!this.output) {
      // A gentle compressor keeps pops and loud vowels even, and a lowpass takes the buzz's edge.
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -20;
      compressor.ratio.value = 4;
      const soften = context.createBiquadFilter();
      soften.type = 'lowpass';
      soften.frequency.value = 3800;
      this.output = context.createGain();
      this.output.connect(soften).connect(compressor).connect(context.destination);
    }
    this.output.gain.value = this.volume * 0.9;
    const { syllables, length } = babble(text, voice);
    const start = context.currentTime + 0.04;
    for (const syllable of syllables) this.syllable(context, syllable, voice, start);
    this.timer = setTimeout(() => this.finish(), (length + 0.1) * 1000);
  }

  /** One syllable: an onset, then a buzzing vowel shaped by two formant filters. */
  private syllable(context: AudioContext, syllable: Syllable, voice: VoiceTraits, start: number) {
    const output = this.output!;
    const at = start + syllable.at;
    const end = at + syllable.length;
    const onset = syllable.onset ? 0.045 / voice.rate : 0;
    if (syllable.onset === 'hiss' || syllable.onset === 'pop') {
      const noise = context.createBufferSource();
      noise.buffer = this.noiseBuffer(context);
      const band = context.createBiquadFilter();
      band.type = syllable.onset === 'hiss' ? 'highpass' : 'bandpass';
      band.frequency.value = syllable.onset === 'hiss' ? 3500 : 1200 * voice.formants;
      const gain = context.createGain();
      const peak = syllable.onset === 'hiss' ? 0.12 : 0.3;
      const last = syllable.onset === 'hiss' ? onset : 0.018;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(peak * syllable.stress, at + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, at + last);
      noise.connect(band).connect(gain).connect(output);
      noise.start(at, Math.random() * 0.5, last + 0.01);
      this.playing.push(noise);
    }
    // The voiced part: a buzz through the vowel's two formants, plus a little of it straight
    // through for body. A hum onset starts it early, nasal and low, before the vowel opens.
    const buzz = context.createOscillator();
    buzz.type = 'sawtooth';
    const pitch = voice.pitch;
    buzz.frequency.setValueAtTime(pitch * syllable.from, at);
    buzz.frequency.linearRampToValueAtTime(pitch * syllable.to, end);
    const [f1, f2] = VOWELS[syllable.vowel].map((hz) => hz * voice.formants);
    const shape = context.createGain();
    for (const [frequency, level, q] of [
      [f1, 1, 6],
      [f2, 0.55, 9],
    ]) {
      const band = context.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = q;
      band.frequency.setValueAtTime(syllable.onset === 'hum' ? 280 : frequency, at);
      band.frequency.linearRampToValueAtTime(frequency, at + onset + 0.02);
      const gain = context.createGain();
      gain.gain.value = level * 2.2;
      buzz.connect(band).connect(gain).connect(shape);
    }
    const body = context.createGain();
    body.gain.value = 0.05;
    buzz.connect(body).connect(shape);
    const envelope = context.createGain();
    const voicedFrom =
      at + (syllable.onset === 'hiss' ? onset * 0.7 : syllable.onset === 'pop' ? 0.012 : 0);
    const level = 0.32 * syllable.stress;
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.setValueAtTime(0, voicedFrom);
    envelope.gain.linearRampToValueAtTime(
      syllable.onset === 'hum' ? level * 0.5 : level,
      voicedFrom + 0.02,
    );
    envelope.gain.linearRampToValueAtTime(level, voicedFrom + onset + 0.03);
    envelope.gain.setValueAtTime(level, end - 0.035);
    envelope.gain.linearRampToValueAtTime(0, end);
    shape.connect(envelope).connect(output);
    buzz.start(at);
    buzz.stop(end + 0.02);
    this.playing.push(buzz);
    buzz.onended = () => {
      this.playing = this.playing.filter((source) => source !== buzz);
    };
  }

  private noiseBuffer(context: AudioContext) {
    if (this.noise) return this.noise;
    const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1;
    return (this.noise = buffer);
  }
}
