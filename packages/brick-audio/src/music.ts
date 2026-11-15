import { Composer } from './composer.ts';
import type { Mood, Note } from './composer.ts';

export type { Mood } from './composer.ts';

/** How far ahead notes are put on the audio clock, in seconds; covers a throttled timer. */
const LOOKAHEAD = 1.5;
/** How often the scheduler looks for notes to queue, in milliseconds. */
const TICK = 250;

/**
 * Ambient piano, made in the browser: a soft, felt-like piano synthesised note by note, in a
 * large reverb, playing an endless piece from `Composer`. No sound files.
 *
 * Browsers only start audio after the page is clicked or a key pressed, so call `start` from a
 * click or key handler. If it was called without one, the music starts at the next click or key.
 * It pauses on its own while the tab is hidden and while the volume is 0.
 */
export class AmbientMusic {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private notes: GainNode | null = null;
  private composer: Composer;
  /** The audio clock's time where the piece began. */
  private origin = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private volume = 0.7;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;

  constructor({ seed = Math.floor(Math.random() * 2 ** 31), mood = 'day' as Mood } = {}) {
    this.composer = new Composer(seed, mood);
  }

  /** Starts the music, or carries on with it. */
  start() {
    if (typeof AudioContext === 'undefined') return;
    if (!this.context) this.build(new AudioContext());
    this.update();
  }

  /** The loudness, 0 (silent and paused) to 1, faded to over `fade` seconds. */
  setVolume(volume: number, fade = 1.5) {
    this.volume = Math.max(0, Math.min(1, volume));
    const { context, master } = this;
    if (context && master) {
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setValueAtTime(master.gain.value, context.currentTime);
      // A ramp rather than a curve, so a fade out really reaches silence before the pause.
      master.gain.linearRampToValueAtTime(this.volume, context.currentTime + fade);
    }
    this.update(fade);
  }

  /** Day or night; takes effect from the chord after the one playing. */
  setMood(mood: Mood) {
    this.composer.mood = mood;
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    document.removeEventListener('visibilitychange', this.visibility);
    this.unlisten();
    void this.context?.close();
    this.context = null;
  }

  private build(context: AudioContext) {
    this.context = context;
    // Notes → a dry path and a long hall → the master volume → a gentle top cut.
    const notes = context.createGain();
    const dry = context.createGain();
    dry.gain.value = 0.55;
    const reverb = context.createConvolver();
    reverb.buffer = hall(context, 5);
    const wet = context.createGain();
    wet.gain.value = 0.7;
    const master = context.createGain();
    master.gain.value = 0;
    const warmth = context.createBiquadFilter();
    warmth.type = 'lowpass';
    warmth.frequency.value = 4200;
    notes.connect(dry).connect(master);
    notes.connect(reverb).connect(wet).connect(master);
    master.connect(warmth).connect(context.destination);
    master.gain.setTargetAtTime(this.volume, context.currentTime, 1);
    this.notes = notes;
    this.master = master;
    this.origin = context.currentTime + 0.2;
    this.timer = setInterval(() => this.schedule(), TICK);
    document.addEventListener('visibilitychange', this.visibility);
  }

  private schedule() {
    const { context, notes } = this;
    if (!context || !notes || context.state !== 'running') return;
    const now = context.currentTime - this.origin;
    for (const note of this.composer.take(now + LOOKAHEAD))
      // A note missed while the timer was held up is dropped, not played late in a burst.
      if (note.time > now - 0.05) piano(context, notes, note, this.origin + note.time);
  }

  /** Runs the audio clock only while there is something to hear. */
  private update(fade = 0) {
    const { context } = this;
    if (!context) return;
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
    const audible = this.volume > 0 && document.visibilityState !== 'hidden';
    if (audible) {
      if (context.state === 'suspended')
        context.resume().then(this.unlisten, () => {
          // Refused without a click or key: wait for one.
        });
      if (context.state !== 'running') this.listen();
    } else
      this.suspendTimer = setTimeout(
        () => void context.suspend().catch(() => {}),
        document.visibilityState === 'hidden' ? 0 : fade * 1000 + 100,
      );
  }

  private readonly visibility = () => this.update();
  private readonly unlock = () => this.update();
  private listen() {
    window.addEventListener('pointerdown', this.unlock);
    window.addEventListener('keydown', this.unlock);
  }
  private readonly unlisten = () => {
    window.removeEventListener('pointerdown', this.unlock);
    window.removeEventListener('keydown', this.unlock);
  };
}

/** A hall's echo: stereo noise dying away over `seconds`, darker as it fades. */
function hall(context: BaseAudioContext, seconds: number) {
  const length = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let low = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // A one-pole lowpass that closes as the tail goes on, so the echo loses its top first.
      low += (Math.random() * 2 - 1 - low) * (0.6 - 0.5 * t);
      data[i] =
        low *
        Math.pow(1 - t, 3) *
        (i < 0.01 * context.sampleRate ? i / (0.01 * context.sampleRate) : 1);
    }
  }
  return buffer;
}

/** How far a piano string's overtones sit sharp of whole multiples. */
const STIFFNESS = 0.0003;

/**
 * One piano note: a few sine overtones, slightly sharp as on a real string, the higher ones
 * fainter and quicker to die, with a second string a touch out of tune on the fundamental for
 * warmth. A soft attack makes it a felt piano rather than a bright grand.
 */
function piano(context: BaseAudioContext, out: AudioNode, note: Note, at: number) {
  const frequency = 440 * 2 ** ((note.midi - 69) / 12);
  // Low strings ring longer than high ones.
  const ring = Math.max(0.9, Math.min(5, 4 * 2 ** (-(note.midi - 48) / 24)));
  const release = at + note.length;
  const end = release + 1.2;

  const voice = context.createGain();
  voice.gain.setValueAtTime(note.velocity * 0.32, at);
  voice.gain.setTargetAtTime(0, release, 0.3);
  const pan = context.createStereoPanner();
  pan.pan.value = Math.max(-0.6, Math.min(0.6, (note.midi - 64) / 36));
  voice.connect(pan).connect(out);

  // Harder notes are brighter: their overtones are louder.
  const brightness = 1.6 - note.velocity;
  const overtones: [number, number, number][] = [];
  for (let n = 1; n <= 6; n++) {
    const pitch = frequency * n * Math.sqrt(1 + STIFFNESS * n * n);
    if (pitch > 9000) break;
    overtones.push([pitch, 1 / n ** brightness, ring / (1 + 0.6 * (n - 1))]);
  }
  overtones.push([frequency * 2 ** (3 / 1200), 0.5, ring]);

  for (const [pitch, level, decay] of overtones) {
    const oscillator = context.createOscillator();
    oscillator.frequency.value = pitch;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + 0.012);
    gain.gain.setTargetAtTime(0, at + 0.012, decay / 3);
    oscillator.connect(gain).connect(voice);
    oscillator.start(at);
    oscillator.stop(Math.min(end, at + decay * 2.5));
  }
}
