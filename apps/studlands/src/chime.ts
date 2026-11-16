/**
 * Little cheerful sounds for the jobs on Brick Island, played on the fly with Web Audio: a
 * blip for picking something up, a rising run when everything is found, a clack for a brick
 * going on and a fanfare when a job is done.
 */

export type Chime = 'start' | 'pick' | 'all' | 'place' | 'done' | 'siren' | 'splash' | 'clang';

/** Notes for each, as semitones above C5, and how long each note lasts in seconds. */
const TUNES: Record<Chime, { notes: readonly number[]; step: number; wave: OscillatorType }> = {
  start: { notes: [0, 7], step: 0.1, wave: 'triangle' },
  pick: { notes: [12, 19], step: 0.07, wave: 'square' },
  all: { notes: [0, 4, 7, 12], step: 0.09, wave: 'triangle' },
  place: { notes: [-5], step: 0.08, wave: 'square' },
  done: { notes: [0, 4, 7, 12, 7, 12, 16], step: 0.11, wave: 'triangle' },
  // The fire engine's nee-naw, a splash of water and the clang of a cell door.
  siren: { notes: [7, 2, 7, 2, 7, 2], step: 0.3, wave: 'sawtooth' },
  splash: { notes: [19, 16, 12, 9, 14, 7], step: 0.045, wave: 'sine' },
  clang: { notes: [-17, -16, -17], step: 0.12, wave: 'square' },
};

let context: AudioContext | null = null;

export function chime(kind: Chime) {
  try {
    context ??= new AudioContext();
    const audio = context;
    const { notes, step, wave } = TUNES[kind];
    const start = audio.currentTime + 0.01;
    notes.forEach((note, index) => {
      const at = start + index * step;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = wave;
      oscillator.frequency.value = 523.25 * 2 ** (note / 12);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.08, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, at + step * 1.8);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(at);
      oscillator.stop(at + step * 2);
    });
  } catch {
    // No sound where the browser has none to give.
  }
}
