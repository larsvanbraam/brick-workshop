/**
 * Plastic clicks for the walking minifigure, synthesised with Web Audio so no sound files ship:
 * a hollow tap for each footstep, a snap for a jump (a brick pulled off its studs) and a clack
 * on landing (one pressed home). Each sound is a short burst of filtered noise for the plastic's
 * rattle plus a decaying tone for its ring, varied a little so steps never repeat exactly.
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
      this.output.gain.value = 0.55;
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

  /** One footstep: running steps land harder. */
  step(run: boolean) {
    // Feet alternate a touch higher and lower, like left and right.
    this.foot = 1 - this.foot;
    const pitch = (this.foot ? 1.06 : 0.95) * vary(0.06);
    const volume = (run ? 0.5 : 0.36) * vary(0.15);
    this.burst({ frequency: 3200 * pitch, q: 3, volume, decay: 0.035 });
    this.tone({ frequency: 1250 * pitch, volume: volume * 0.35, decay: 0.03 });
    this.tone({ frequency: 240 * pitch, volume: volume * 0.5, decay: 0.05 });
  }

  /** Pushing off: a quick double snap rising in pitch. */
  jump() {
    const pitch = vary(0.05);
    this.burst({ frequency: 4200 * pitch, q: 5, volume: 0.32, decay: 0.025 });
    this.burst({ frequency: 5200 * pitch, q: 6, volume: 0.24, decay: 0.03, delay: 0.035 });
    this.tone({ frequency: 900 * pitch, to: 1700 * pitch, volume: 0.16, decay: 0.09 });
  }

  /** Coming down, louder the faster it falls (`speed` in scene units a second). */
  land(speed: number) {
    const strength = Math.min(1, Math.max(0.25, (speed - 4) / 16));
    const pitch = vary(0.05);
    this.burst({ frequency: 2300 * pitch, q: 2.2, volume: 0.65 * strength, decay: 0.06 });
    this.burst({ frequency: 4800 * pitch, q: 4, volume: 0.3 * strength, decay: 0.03 });
    this.tone({ frequency: 170 * pitch, to: 110 * pitch, volume: 0.6 * strength, decay: 0.1 });
    this.tone({ frequency: 1500 * pitch, volume: 0.12 * strength, decay: 0.05 });
  }

  /** Taking off into the air or settling back down: a soft click. */
  toggleFlight(flying: boolean) {
    const pitch = flying ? 1.25 : 0.85;
    this.burst({ frequency: 3600 * pitch, q: 6, volume: 0.22, decay: 0.03 });
    this.tone({
      frequency: 700 * pitch,
      to: (flying ? 1300 : 450) * pitch,
      volume: 0.1,
      decay: 0.12,
    });
  }

  private ready() {
    if (!this.enabled || !this.context || !this.output || !this.noise) return null;
    if (this.context.state !== 'running') return null;
    return { context: this.context, output: this.output, noise: this.noise };
  }

  private burst(sound: {
    frequency: number;
    q: number;
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
    filter.type = 'bandpass';
    filter.frequency.value = sound.frequency;
    filter.Q.value = sound.q;
    const gain = envelope(context, start, sound.volume, sound.decay);
    source.connect(filter).connect(gain).connect(output);
    // Starts at a random point in the noise so bursts differ.
    source.start(start, Math.random() * 0.15, sound.decay * 4);
  }

  private tone(sound: { frequency: number; to?: number; volume: number; decay: number }) {
    const ready = this.ready();
    if (!ready) return;
    const { context, output } = ready;
    const start = context.currentTime;
    const oscillator = context.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(sound.frequency, start);
    if (sound.to) oscillator.frequency.exponentialRampToValueAtTime(sound.to, start + sound.decay);
    const gain = envelope(context, start, sound.volume, sound.decay);
    oscillator.connect(gain).connect(output);
    oscillator.start(start);
    oscillator.stop(start + sound.decay * 4);
  }
}

/** A sharp attack and an exponential fall, quiet after `decay` seconds. */
function envelope(context: AudioContext, start: number, volume: number, decay: number) {
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.002 + decay * 3);
  return gain;
}

/** A factor around 1, up to `amount` either way. */
function vary(amount: number) {
  return 1 + (Math.random() * 2 - 1) * amount;
}
