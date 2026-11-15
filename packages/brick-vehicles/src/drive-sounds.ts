import type { VehicleKind } from './vehicle';

/**
 * Engine sounds for the vehicle being driven, synthesised with Web Audio so no sound files ship: a
 * buzzing two-oscillator engine whose pitch follows the speed (a deep hum for the car, a high rasp
 * for the motorcycle and the race car, a drone for the airplane), the chop of a helicopter's rotor
 * from noise pulsed at the rotor's beat, and a horn. The bike is pedalled, so it only ticks
 * faintly as it freewheels.
 */
export class DriveSounds {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private engine: {
    kind: VehicleKind;
    gain: GainNode;
    filter: BiquadFilterNode;
    low: OscillatorNode;
    high: OscillatorNode;
    chop: GainNode | null;
    sources: AudioScheduledSourceNode[];
  } | null = null;
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
      this.output.gain.value = 0.5;
      this.output.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') this.context.resume().catch(() => {});
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.stop();
    else this.wake();
  }

  dispose() {
    this.stop();
    this.context?.close().catch(() => {});
    this.context = null;
    this.output = null;
  }

  /** Starts the engine of a vehicle of this kind, replacing any other. */
  start(kind: VehicleKind) {
    this.stop();
    const context = this.context;
    const output = this.output;
    if (!this.enabled || !context || !output || kind === 'bike') return;
    const gain = context.createGain();
    gain.gain.value = 0;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    filter.Q.value = 2;
    const low = context.createOscillator();
    low.type = 'sawtooth';
    const high = context.createOscillator();
    high.type = 'square';
    low.connect(filter);
    const highGain = context.createGain();
    highGain.gain.value = 0.35;
    high.connect(highGain).connect(filter);
    filter.connect(gain).connect(output);
    const sources: AudioScheduledSourceNode[] = [low, high];
    let chop: GainNode | null = null;
    if (kind === 'helicopter') {
      // The rotor's chop: noise through a low band, pulsed by a slow oscillator.
      const length = context.sampleRate;
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let index = 0; index < length; index++) data[index] = Math.random() * 2 - 1;
      const noise = context.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;
      const band = context.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 180;
      band.Q.value = 0.9;
      chop = context.createGain();
      chop.gain.value = 0;
      const beat = context.createOscillator();
      beat.frequency.value = 0;
      const depth = context.createGain();
      depth.gain.value = 0.5;
      beat.connect(depth).connect(chop.gain);
      noise.connect(band).connect(chop).connect(gain);
      sources.push(noise, beat);
      highGain.gain.value = 0.1;
    }
    for (const source of sources) source.start();
    this.engine = { kind, gain, filter, low, high, chop, sources };
    this.update(0, 0);
  }

  /** Stops the engine, fading it out. */
  stop() {
    const engine = this.engine;
    const context = this.context;
    this.engine = null;
    if (!engine || !context) return;
    const now = context.currentTime;
    engine.gain.gain.cancelScheduledValues(now);
    engine.gain.gain.setTargetAtTime(0, now, 0.15);
    for (const source of engine.sources) source.stop(now + 0.8);
  }

  /**
   * Follows the vehicle: `revs` 0 to 1 is how hard the engine works (speed, or a rotor's spin), and
   * `throttle` 0 to 1 how far the pedal is down, which makes it louder and brighter.
   */
  update(revs: number, throttle: number) {
    const engine = this.engine;
    const context = this.context;
    if (!engine || !context) return;
    const now = context.currentTime;
    const at = (param: AudioParam, value: number, time = 0.08) =>
      param.setTargetAtTime(value, now, time);
    const r = Math.max(0, Math.min(1, revs));
    const tone = TONES[engine.kind];
    const pitch = tone.idle + (tone.top - tone.idle) * r;
    at(engine.low.frequency, pitch);
    at(engine.high.frequency, pitch * 2.01);
    at(engine.filter.frequency, tone.bright * (0.6 + 0.4 * r + 0.5 * throttle));
    const volume =
      engine.kind === 'helicopter' ? 0.12 * r : tone.volume * (0.55 + 0.25 * r + 0.2 * throttle);
    at(engine.gain.gain, volume, 0.12);
    if (engine.chop) {
      at(engine.chop.gain, 0.5 * r);
      const beat = (engine.sources[3] as OscillatorNode | undefined)?.frequency;
      if (beat) at(beat, 13 * r);
    }
  }

  /** A short toot of the horn. */
  honk() {
    const context = this.context;
    const output = this.output;
    if (!this.enabled || !context || !output || context.state !== 'running') return;
    const now = context.currentTime;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.3, now + 0.02);
    gain.gain.setValueAtTime(0.3, now + 0.28);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1800;
    filter.connect(gain).connect(output);
    // Two notes a third apart, like a car's horn.
    for (const frequency of [392, 494]) {
      const note = context.createOscillator();
      note.type = 'square';
      note.frequency.value = frequency;
      note.connect(filter);
      note.start(now);
      note.stop(now + 0.4);
    }
  }

  /** A bump against a wall: a dull knock. */
  bump(strength: number) {
    const context = this.context;
    const output = this.output;
    if (!this.enabled || !context || !output || context.state !== 'running') return;
    const now = context.currentTime;
    const gain = context.createGain();
    gain.gain.setValueAtTime(Math.min(0.6, 0.15 + strength * 0.03), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    const knock = context.createOscillator();
    knock.type = 'sine';
    knock.frequency.setValueAtTime(140, now);
    knock.frequency.exponentialRampToValueAtTime(50, now + 0.2);
    knock.connect(gain).connect(output);
    knock.start(now);
    knock.stop(now + 0.3);
  }
}

/** Each engine's pitch at idle and flat out, how bright it sounds and how loud. */
const TONES: Record<VehicleKind, { idle: number; top: number; bright: number; volume: number }> = {
  bike: { idle: 0, top: 0, bright: 0, volume: 0 },
  car: { idle: 48, top: 120, bright: 700, volume: 0.22 },
  motorcycle: { idle: 70, top: 230, bright: 1400, volume: 0.2 },
  racecar: { idle: 90, top: 320, bright: 1800, volume: 0.2 },
  helicopter: { idle: 30, top: 55, bright: 400, volume: 0.15 },
  airplane: { idle: 60, top: 130, bright: 900, volume: 0.2 },
};
