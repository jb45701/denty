/**
 * Seeded RNG — the only source of randomness in the engine.
 *
 * Algorithm: mulberry32, a small, fast, well-known 32-bit PRNG with a single
 * uint32 of state. It is fully deterministic and portable: the same seed and
 * the same call sequence always produce the same output, on any platform.
 *
 * `Math.random()` anywhere under src/ is a review finding (AGENTS.md).
 *
 * Determinism contract:
 *   - a numeric seed is truncated to a uint32;
 *   - a string seed is hashed by `hashSeed` (stable, order-sensitive);
 *   - `getState()` / `Rng.fromState()` round-trip the internal state exactly,
 *     so a save file can resume an in-flight sequence.
 */

/** Serialisable snapshot of an RNG's position in its sequence. */
export interface RngState {
  readonly algorithm: 'mulberry32';
  readonly state: number;
}

const UINT32_MASK = 0xffffffff;

/**
 * Hash an arbitrary string to a uint32 seed (an xmur3-style mix). Deterministic
 * for a given string across runs and platforms.
 */
export function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

function toSeedValue(seed: number | string): number {
  if (typeof seed === 'string') {
    return hashSeed(seed);
  }
  if (!Number.isFinite(seed)) {
    throw new TypeError('Rng: seed must be a finite number or a string');
  }
  return Math.trunc(seed) >>> 0;
}

/** A seeded, deterministic pseudo-random number generator. */
export class Rng {
  private state: number;

  constructor(seed: number | string) {
    this.state = toSeedValue(seed);
  }

  /** Rebuild an RNG exactly where a previous one left off. */
  static fromState(state: RngState): Rng {
    if (state.algorithm !== 'mulberry32') {
      throw new TypeError(`Rng.fromState: unknown algorithm "${String(state.algorithm)}"`);
    }
    const rng = new Rng(0);
    rng.state = Math.trunc(state.state) >>> 0;
    return rng;
  }

  /** Snapshot the current position in the sequence (for save/load). */
  getState(): RngState {
    return { algorithm: 'mulberry32', state: this.state >>> 0 };
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Next integer in [minInclusive, maxExclusive). */
  nextInt(minInclusive: number, maxExclusive: number): number {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxExclusive)) {
      throw new TypeError('Rng.nextInt: bounds must be integers');
    }
    if (maxExclusive <= minInclusive) {
      throw new RangeError('Rng.nextInt: maxExclusive must be greater than minInclusive');
    }
    return minInclusive + Math.floor(this.next() * (maxExclusive - minInclusive));
  }

  /** Next integer in [minInclusive, maxInclusive], both ends possible. */
  nextInclusive(minInclusive: number, maxInclusive: number): number {
    return this.nextInt(minInclusive, maxInclusive + 1);
  }

  /** True with probability `p`, clamped to [0, 1]. */
  chance(p: number): boolean {
    if (!Number.isFinite(p)) {
      throw new TypeError('Rng.chance: probability must be finite');
    }
    const bounded = p <= 0 ? 0 : p >= 1 ? 1 : p;
    return this.next() < bounded;
  }

  /** Uniformly pick one element; throws on an empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new RangeError('Rng.pick: cannot pick from an empty array');
    }
    return items[this.nextInt(0, items.length)]!;
  }

  /** Fisher-Yates shuffle; returns a new array and never mutates the input. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i + 1);
      const tmp = out[i]!;
      out[i] = out[j]!;
      out[j] = tmp;
    }
    return out;
  }
}

/** Convenience factory: `createRng(seed)`. */
export function createRng(seed: number | string): Rng {
  return new Rng(seed);
}

export { UINT32_MASK };
