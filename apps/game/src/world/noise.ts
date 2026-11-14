/** A stable hash of a seed and a lattice point, 0 to 1. */
export function hash2(seed: number, x: number, z: number): number {
  let value = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  value = Math.imul(value ^ Math.imul(x, 0x27d4eb2d), 0xc2b2ae35);
  value = Math.imul(value ^ Math.imul(z, 0x165667b1), 0x9e3779b1);
  value ^= value >>> 15;
  value = Math.imul(value, 0x2c1b3c6d);
  value ^= value >>> 12;
  return (value >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Value noise: lattice values eased between, 0 to 1, one lattice cell per `scale` studs. */
export function valueNoise(seed: number, x: number, z: number, scale: number): number {
  const u = x / scale;
  const v = z / scale;
  const x0 = Math.floor(u);
  const z0 = Math.floor(v);
  const tx = smooth(u - x0);
  const tz = smooth(v - z0);
  const a = hash2(seed, x0, z0);
  const b = hash2(seed, x0 + 1, z0);
  const c = hash2(seed, x0, z0 + 1);
  const d = hash2(seed, x0 + 1, z0 + 1);
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}

/** Fractal noise: octaves of value noise, each half the size and weight of the last, 0 to 1. */
export function fbm(seed: number, x: number, z: number, scale: number, octaves = 4): number {
  let total = 0;
  let weight = 1;
  let sum = 0;
  for (let octave = 0; octave < octaves; octave++) {
    total += valueNoise(seed + octave * 1013, x, z, scale) * weight;
    sum += weight;
    weight /= 2;
    scale /= 2;
  }
  return total / sum;
}

/** A small seeded generator, 0 to 1 (mulberry32). */
export function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
