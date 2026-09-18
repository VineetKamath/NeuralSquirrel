// Seeded pseudo-random utilities. Every experiment derives all randomness from its seed.

export type RNG = (() => number) & { getState: () => number; setState: (s: number) => void };

export function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  const f = function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  } as RNG;
  f.getState = () => a;
  f.setState = (s: number) => {
    a = s >>> 0;
  };
  return f;
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function range(rng: RNG, min: number, max: number) {
  return min + rng() * (max - min);
}

export function pick<T>(rng: RNG, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

export function gaussian(rng: RNG) {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function newSeed() {
  return 100000 + Math.floor(Math.random() * 899999);
}

/** Deterministic 2D hash in [0,1) */
export function hash2(x: number, z: number, seed = 0) {
  let h = Math.imul((x | 0) ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul((z | 0) ^ seed, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  return ((h >>> 0) % 100000) / 100000;
}

/** Smooth value noise, 2D */
export class ValueNoise {
  private perm: Uint16Array;
  private values: Float32Array;

  constructor(seed: number) {
    const rng = mulberry32(seed);
    this.perm = new Uint16Array(512);
    this.values = new Float32Array(256);
    const p: number[] = [];
    for (let i = 0; i < 256; i++) {
      p.push(i);
      this.values[i] = rng();
    }
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  private v(ix: number, iz: number) {
    return this.values[this.perm[(ix & 255) + this.perm[iz & 255]]];
  }

  noise(x: number, z: number) {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx);
    const sz = fz * fz * (3 - 2 * fz);
    const a = this.v(ix, iz);
    const b = this.v(ix + 1, iz);
    const c = this.v(ix, iz + 1);
    const d = this.v(ix + 1, iz + 1);
    return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
  }

  fbm(x: number, z: number, octaves = 4) {
    let amp = 0.5;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise(x * freq, z * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return sum / norm;
  }
}
