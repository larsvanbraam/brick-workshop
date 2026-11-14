/**
 * Plastic clicks for the walking minifigure, synthesised with Web Audio so no sound files ship:
 * a heel-and-toe tick for each footstep, a snap for a jump (a brick pulled off its studs) and a
 * clatter on landing (one dropped on a baseplate). Every sound is built from a few milliseconds
 * of filtered noise, never a tone, and varies a little so steps never repeat exactly.
 */
export class WalkSounds {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private foot = 0;
  private enabled = true;

  /** Starts audio; call from a key press or click, as browsers only allow sound after one. */
  wake() {
    if (!this.enabled) return;
    if (!this.context) {
      const Context =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) return;
      try {
        this.context = new Context();
      } catch {
        return;
      }
      this.output = this.context.createGain();
      this.output.gain.value = 1.4;
      this.output.connect(this.context.destination);
      // A quarter second of white noise, reused by every burst.
      const length = Math.floor(this.context.sampleRate / 4);
      this.noise = this.context.createBuffer(1, length, this.context.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let index = 0; index < length; index++) data[index] = Math.random() * 2 - 1;
    }
    if (this.context.state === 'suspended') this.context.resume().catch(() => {});
  }

  /** Mutes or unmutes; unmuting also starts audio. */
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.wake();
  }

  dispose() {
    this.context?.close().catch(() => {});
    this.context = null;
    this.output = null;
    this.noise = null;
  }

  /**
   * One footstep: a hard tick as the heel lands and a softer one from the toe, with the hollow
   * knock of plastic on studs. Running steps land harder.
   */
  step(run: boolean) {
    // Feet alternate a touch higher and lower, like left and right.
    this.foot = 1 - this.foot;
    const pitch = (this.foot ? 1.05 : 0.95) * vary(0.08);
    const volume = (run ? 0.7 : 0.5) * vary(0.15);
    this.click({ q: 1.2, frequency: 3500, volume, decay: 0.004 });
    this.click({ frequency: 2000 * pitch, q: 5, volume: volume * 0.6, decay: 0.009 });
    const toe = (run ? 0.014 : 0.022) * vary(0.2);
    this.click({
      type: 'highpass',
      frequency: 4500,
      volume: volume * 0.4,
      decay: 0.003,
      delay: toe,
    });
  }

  /** Pushing off: the snap of a brick pulled off its studs. */
  jump() {
    const pitch = vary(0.06);
    this.click({ q: 1.2, frequency: 4000, volume: 0.6, decay: 0.003 });
    this.click({ frequency: 2800 * pitch, q: 6, volume: 0.45, decay: 0.008 });
    this.click({ q: 1.2, frequency: 5000, volume: 0.35, decay: 0.003, delay: 0.016 });
  }

  /**
   * Coming down: a clatter of clicks, like a brick dropped on a baseplate, louder the faster it
   * falls (`speed` in scene units a second).
   */
  land(speed: number) {
    const strength = Math.min(1, Math.max(0.35, (speed - 4) / 14));
    const pitch = vary(0.06);
    let delay = 0;
    for (const [index, level] of [1, 0.55, 0.35, 0.2].entries()) {
      const volume = level * strength * vary(0.15);
      this.click({ q: 1.2, frequency: 3000, volume, decay: 0.004, delay });
      this.click({
        frequency: (1700 + index * 350) * pitch,
        q: 4,
        volume: volume * 0.7,
        decay: 0.01,
        delay,
      });
      delay += (0.011 + index * 0.006) * vary(0.25);
    }
    // The dull knock of the whole figure, from muffled noise rather than a tone.
    this.click({ type: 'lowpass', frequency: 500, volume: 0.5 * strength, decay: 0.012 });
  }

  /** Taking off into the air or settling back down: a light double tick. */
  toggleFlight(flying: boolean) {
    const pitch = flying ? 1.2 : 0.85;
    this.click({ frequency: 3000 * pitch, q: 2, volume: 0.8, decay: 0.005 });
    this.click({ frequency: 3800 * pitch, q: 2, volume: 0.6, decay: 0.004, delay: 0.03 });
  }

  private ready() {
    if (!this.enabled || !this.context || !this.output || !this.noise) return null;
    if (this.context.state !== 'running') return null;
    return { context: this.context, output: this.output, noise: this.noise };
  }

  /** A few milliseconds of filtered noise: no pitched tone, so it clicks rather than beeps. */
  private click(sound: {
    type?: BiquadFilterType;
    frequency: number;
    q?: number;
    volume: number;
    decay: number;
    delay?: number;
  }) {
    const ready = this.ready();
    if (!ready) return;
    const { context, output, noise } = ready;
    const start = context.currentTime + (sound.delay ?? 0);
    const source = context.createBufferSource();
    source.buffer = noise;
    const filter = context.createBiquadFilter();
    filter.type = sound.type ?? 'bandpass';
    filter.frequency.value = sound.frequency;
    filter.Q.value = sound.q ?? 0.7;
    const gain = context.createGain();
    gain.gain.setValueAtTime(Math.max(0.0002, sound.volume), start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + sound.decay * 4);
    source.connect(filter).connect(gain).connect(output);
    // Starts at a random point in the noise so clicks differ.
    source.start(start, Math.random() * 0.2, sound.decay * 5);
  }
}

/** A factor around 1, up to `amount` either way. */
function vary(amount: number) {
  return 1 + (Math.random() * 2 - 1) * amount;
}
